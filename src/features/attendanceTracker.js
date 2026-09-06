const storage = require('../storage');
const bindings = require('./bindings');
const leaveManager = require('./leaveManager');
const sheets = require('../sheets');
const time = require('../time');
const { resolveTag } = require('./voiceTracker');
const { SHEET_TABS, ABSENCE_WARNING_THRESHOLD, ATTENDANCE_REPORT_USER_ID } = require('../config');

const SUMMARY_HEADER = [
  'Discord',
  'ชื่อตัวละคร',
  'เดือน',
  'มาวอร์ (รอบ)',
  'ขาด (รอบ)',
  'ลากิจ (ครั้ง)',
  'ใบเตือน (ใบ)',
  'เวลาห้องเสียงรวม (นาที)',
  'นับขาดรวม',
  'สถานะ',
];

const WARNING_LOG_HEADER = ['Discord', 'ตัวละคร', 'เหตุ', 'ได้รับใบ'];

function getRecord(all, userId, monthKey) {
  if (!all[userId]) all[userId] = {};
  if (!all[userId][monthKey]) {
    all[userId][monthKey] = { warAttended: 0, warAbsent: 0, totalAbsent: 0, voiceMinutes: 0 };
  }
  return all[userId][monthKey];
}

function buildSummaryRow(discordTag, gameName, monthKey, record, leave) {
  const status = leave.redCard ? '🔴 ใบแดง' : leave.warnings > 0 ? '🟡 มีใบเตือน' : '🟢 ปกติ';
  return [
    discordTag,
    gameName,
    monthKey,
    String(record.warAttended),
    String(record.warAbsent),
    String(leave.count),
    String(leave.warnings),
    record.voiceMinutes.toFixed(1),
    String(record.totalAbsent),
    status,
  ];
}

// ใช้ตอนมีคนเดียว (เช่นหลังกดปุ่มลา/ยกเลิกลา) ไม่ต้อง batch เพราะเป็นแค่คนเดียว
async function upsertSummaryRow(userId, monthKey, guild) {
  const gameName = bindings.getNameByUserId(userId);
  if (!gameName) return;

  const all = storage.load('attendance', {});
  const record = getRecord(all, userId, monthKey);
  const leave = leaveManager.getStatus(userId, monthKey);
  const discordTag = await resolveTag(guild, userId);
  const row = buildSummaryRow(discordTag, gameName, monthKey, record, leave);

  try {
    await sheets.upsertRowByKeys(SHEET_TABS.SUMMARY, SUMMARY_HEADER, [[0, discordTag], [2, monthKey]], row);
  } catch (err) {
    console.error('[attendanceTracker] เขียนชีตสรุปล้มเหลว:', err.message);
  }
}

async function sendReportDM(client, title, attended, onLeave, partial, noShow) {
  if (!ATTENDANCE_REPORT_USER_ID) return;
  const list = (arr) => (arr.length ? arr.join(', ') : '-');
  const lines = [
    `📋 ${title}`,
    `✅ มา (${attended.length}): ${list(attended)}`,
    `🟡 ลา (${onLeave.length}): ${list(onLeave)}`,
    `🟠 มาไม่ครบเวลา (${partial.length}): ${list(partial)}`,
    `🔴 ขาด ไม่มาเลย (${noShow.length}): ${list(noShow)}`,
  ];
  try {
    const user = await client.users.fetch(ATTENDANCE_REPORT_USER_ID);
    await user.send(lines.join('\n'));
  } catch (err) {
    console.error('[attendanceTracker] ส่ง DM ล้มเหลว:', err.message);
  }
}

/**
 * mergedResults: { [userId]: { minutes, attended } } รวมผลจากทุก sessionKey ในกลุ่ม check เดียวกันแล้ว
 * (attended = true ถ้า attended ในอย่างน้อยหนึ่ง session ของกลุ่ม)
 * ไม่มี entry ใน mergedResults เลย = ไม่เข้าห้องเลยสักวินาที ต่างจาก entry ที่มีแต่ attended=false (เข้าแต่ไม่ครบเวลา)
 *
 * เขียนชีตแบบ batch ทั้งหมด (สรุป + ใบเตือน) ไม่ว่าจะมีคนผูกไว้กี่ร้อยคน ก็ยิง API แค่ไม่กี่ครั้งจบ
 */
async function recordCheck(check, dateStr, mergedResults, guild, client) {
  const monthKey = dateStr.slice(0, 7);
  const all = storage.load('attendance', {});
  const attendedNames = [];
  const onLeaveNames = [];
  const partialNames = [];
  const noShowNames = [];
  const warningLogRows = [];
  const affectedUsers = []; // [{userId, gameName}] ที่ต้องอัปเดตแท็บสรุป

  for (const [userId, gameName] of Object.entries(bindings.all())) {
    const result = mergedResults[userId];
    const attended = Boolean(result && result.attended);
    const record = getRecord(all, userId, monthKey);

    if (attended) {
      attendedNames.push(gameName);
      record.voiceMinutes = Math.round((record.voiceMinutes + result.minutes) * 100) / 100;
      if (check.countsTowardWar) record.warAttended += 1;
      affectedUsers.push({ userId, gameName });
      continue;
    }

    if (leaveManager.hasApprovedLeaveFor(userId, dateStr)) {
      onLeaveNames.push(gameName);
      continue;
    }

    if (result) {
      partialNames.push(`${gameName} (${result.minutes.toFixed(1)} นาที)`);
    } else {
      noShowNames.push(gameName);
    }

    record.totalAbsent += 1;
    if (check.countsTowardWar) record.warAbsent += 1;

    if (record.totalAbsent === ABSENCE_WARNING_THRESHOLD) {
      const warned = leaveManager.addAbsenceWarning(userId, monthKey);
      const discordTag = await resolveTag(guild, userId);
      warningLogRows.push([discordTag, gameName, `ขาดครบ ${ABSENCE_WARNING_THRESHOLD} ครั้ง/เดือน`, 'ใบเตือน']);
      if (warned.newlyRedCarded) {
        warningLogRows.push([discordTag, gameName, 'ใบเตือนสะสมครบ 2 ใบ', 'ใบแดง']);
      }
    }

    affectedUsers.push({ userId, gameName });
  }

  storage.save('attendance', all);

  const summaryItems = [];
  for (const { userId, gameName } of affectedUsers) {
    const record = getRecord(all, userId, monthKey);
    const leave = leaveManager.getStatus(userId, monthKey);
    const discordTag = await resolveTag(guild, userId); // ใช้ cache แล้ว ไม่ยิง API ต่อคนถ้า warmMemberCache ทำงานแล้ว
    summaryItems.push({
      matches: [[0, discordTag], [2, monthKey]],
      row: buildSummaryRow(discordTag, gameName, monthKey, record, leave),
    });
  }

  try {
    await sheets.upsertRowsByKeys(SHEET_TABS.SUMMARY, SUMMARY_HEADER, summaryItems);
  } catch (err) {
    console.error('[attendanceTracker] เขียนชีตสรุปล้มเหลว (batch):', err.message);
  }

  if (warningLogRows.length > 0) {
    try {
      await sheets.appendRows(SHEET_TABS.WARNING_LOG, WARNING_LOG_HEADER, warningLogRows);
    } catch (err) {
      console.error('[attendanceTracker] เขียนชีตใบเตือนล้มเหลว (batch):', err.message);
    }
  }

  await sendReportDM(
    client,
    `สรุป${check.label} ${time.formatThaiDate(dateStr)}`,
    attendedNames,
    onLeaveNames,
    partialNames,
    noShowNames
  );
}

module.exports = { recordCheck, upsertSummaryRow, SUMMARY_HEADER };

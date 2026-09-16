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
    all[userId][monthKey] = { warAttended: 0, warAbsent: 0, totalAbsent: 0, voiceMinutes: 0, absences: [] };
  }
  if (!all[userId][monthKey].absences) all[userId][monthKey].absences = [];
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
    String(Math.round(record.voiceMinutes)),
    String(record.totalAbsent),
    status,
  ];
}

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

// อ่านอย่างเดียว ไว้ให้ /สถานะ เช็คของตัวเอง (ไม่บันทึกอะไรเพิ่ม)
function getMonthlyRecord(userId, monthKey) {
  const all = storage.load('attendance', {});
  return getRecord(all, userId, monthKey);
}

// รายการขาดทั้งหมดของคนคนนี้ (ทุกเดือนที่มีข้อมูล) เรียงวันที่ล่าสุดก่อน ไว้ให้แอดมินเลือกยกเลิก
function getAbsences(userId) {
  const all = storage.load('attendance', {});
  const userRecord = all[userId] || {};
  const results = [];
  for (const [monthKey, record] of Object.entries(userRecord)) {
    (record.absences || []).forEach((a, index) => results.push({ monthKey, index, ...a }));
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

// ยกเลิกขาด 1 รายการ (ระบุ index ใน absences ของเดือนนั้น) แล้วปรับตัวนับ + คืนใบเตือนขาดถ้าหลุดโควตาแล้ว
function cancelAbsence(userId, monthKey, index) {
  const all = storage.load('attendance', {});
  const record = all[userId] && all[userId][monthKey];
  if (!record || !record.absences || !record.absences[index]) return { ok: false, reason: 'NOT_FOUND' };

  const [removed] = record.absences.splice(index, 1);
  record.totalAbsent = Math.max(0, record.totalAbsent - 1);
  if (removed.countsTowardWar) record.warAbsent = Math.max(0, record.warAbsent - 1);
  storage.save('attendance', all);

  let warningRevoked = false;
  if (record.totalAbsent < ABSENCE_WARNING_THRESHOLD) {
    warningRevoked = leaveManager.removeAbsenceWarning(userId, monthKey).revoked;
  }

  return { ok: true, removed, warningRevoked };
}

// ยกเลิกขาดของ "ทุกคน" ในวันที่ระบุ ระบุ checkKey ด้วยถ้าจะยกเลิกเฉพาะรอบนั้น (ไม่ระบุ = ยกเลิกทุกรอบของวันนั้น)
function cancelAllAbsencesForDate(dateStr, checkKey = null) {
  const all = storage.load('attendance', {});
  const monthKey = dateStr.slice(0, 7);
  const touched = [];
  const matches = (a) => a.date === dateStr && (!checkKey || a.checkKey === checkKey);

  for (const [userId, months] of Object.entries(all)) {
    const record = months[monthKey];
    if (!record || !record.absences || record.absences.length === 0) continue;

    const removed = record.absences.filter(matches);
    if (removed.length === 0) continue;

    record.absences = record.absences.filter((a) => !matches(a));
    record.totalAbsent = Math.max(0, record.totalAbsent - removed.length);
    const warRemoved = removed.filter((a) => a.countsTowardWar).length;
    if (warRemoved > 0) record.warAbsent = Math.max(0, record.warAbsent - warRemoved);

    touched.push({ userId, monthKey, removedCount: removed.length });
  }
  storage.save('attendance', all);

  return touched.map(({ userId, monthKey, removedCount }) => {
    const record = all[userId][monthKey];
    const warningRevoked =
      record.totalAbsent < ABSENCE_WARNING_THRESHOLD ? leaveManager.removeAbsenceWarning(userId, monthKey).revoked : false;
    return { userId, monthKey, removedCount, warningRevoked };
  });
}

// วันที่ยังมีข้อมูลขาดค้างอยู่ (อย่างน้อย 1 คน) ไว้โชว์ให้เลือกใน /ยกเลิกขาดทั้งหมด ระบุ checkKey ด้วยถ้าจะกรองเฉพาะรอบนั้น
function listDatesWithAbsences(checkKey = null) {
  const all = storage.load('attendance', {});
  const dates = new Set();
  for (const months of Object.values(all)) {
    for (const record of Object.values(months)) {
      for (const a of record.absences || []) {
        if (!checkKey || a.checkKey === checkKey) dates.add(a.date);
      }
    }
  }
  return [...dates].sort((a, b) => b.localeCompare(a));
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

// ไม่มี entry ใน mergedResults = ไม่เข้าห้องเลย ต่างจาก attended=false (เข้าแต่ไม่ครบเวลา)
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

    if (leaveManager.hasApprovedLeaveFor(userId, dateStr, check.key)) {
      onLeaveNames.push(gameName);
      continue;
    }

    if (result) {
      partialNames.push(`${gameName} (${Math.round(result.minutes)} นาที)`);
    } else {
      noShowNames.push(gameName);
    }

    record.totalAbsent += 1;
    if (check.countsTowardWar) record.warAbsent += 1;
    record.absences.push({ date: dateStr, checkKey: check.key, checkLabel: check.label, countsTowardWar: check.countsTowardWar });

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

module.exports = {
  recordCheck,
  upsertSummaryRow,
  getMonthlyRecord,
  getAbsences,
  cancelAbsence,
  cancelAllAbsencesForDate,
  listDatesWithAbsences,
  SUMMARY_HEADER,
};

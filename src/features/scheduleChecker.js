const cron = require('node-cron');
const { CHECKS, SESSIONS, GUILD_ID, TIMEZONE, ATTENDANCE_REPORT_USER_ID } = require('../config');
const voiceTracker = require('./voiceTracker');
const attendanceTracker = require('./attendanceTracker');
const sheets = require('../sheets');
const time = require('../time');

function toCron(timeStr, days) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * ${days.join(',')}`;
}

function mergeResults(target, results) {
  for (const [userId, r] of Object.entries(results)) {
    if (!target[userId]) {
      target[userId] = { ...r };
    } else {
      const t = target[userId];
      t.minutes += r.minutes;
      t.attended = t.attended || r.attended;
      t.firstJoin = Math.min(t.firstJoin, r.firstJoin);
      t.lastLeave = Math.max(t.lastLeave, r.lastLeave);
      t.segments += r.segments;
      t.gameName = t.gameName || r.gameName;
      t.discordTag = t.discordTag || r.discordTag;
    }
  }
}

async function writeSheets(dateStr, sessionResultsList) {
  const merged = {};
  for (const { sessionKey, results } of sessionResultsList) {
    const session = SESSIONS.find((s) => s.key === sessionKey);
    if (session.sheetTab) {
      const rows = [];
      const highlightFlags = [];
      const sorted = Object.values(results).sort((a, b) => b.minutes - a.minutes);
      for (const r of sorted) {
        const { row, belowMin } = voiceTracker.buildPracticeRow(dateStr, session.minMinutes, r);
        rows.push(row);
        highlightFlags.push(belowMin);
      }
      try {
        await sheets.appendRows(session.sheetTab, voiceTracker.PRACTICE_HEADER, rows, highlightFlags);
      } catch (err) {
        console.error(`[scheduleChecker] เขียนชีตล้มเหลว (${session.sheetTab}):`, err.message);
      }
    }
    mergeResults(merged, results);
  }
  return merged;
}

function runCheckStart(checkKey, guild) {
  const check = CHECKS.find((c) => c.key === checkKey);
  for (const sessionKey of check.sessionKeys) {
    voiceTracker.startSession(sessionKey, guild);
  }
}

async function runCheckEnd(checkKey, guild, client) {
  const check = CHECKS.find((c) => c.key === checkKey);
  const sessionResultsList = [];
  let dateStr = time.dateKey();

  for (const sessionKey of check.sessionKeys) {
    const { dateStr: d, results } = await voiceTracker.endSession(sessionKey, guild);
    dateStr = d;
    sessionResultsList.push({ sessionKey, results });
  }

  const merged = await writeSheets(dateStr, sessionResultsList);
  await attendanceTracker.recordCheck(check, dateStr, merged, guild, client);
}

function toSeconds(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 3600 + m * 60;
}

async function alertRecovery(client, message) {
  console.log(`[scheduler] ${message}`);
  if (!ATTENDANCE_REPORT_USER_ID) return;
  try {
    const user = await client.users.fetch(ATTENDANCE_REPORT_USER_ID);
    await user.send(`⚠️ ${message}`);
  } catch (err) {
    console.error('[scheduler] แจ้งเตือนกู้คืนไม่สำเร็จ:', err.message);
  }
}

// กันชนกับ cron เริ่ม/จบตัวจริงที่ตรงกับเวลานาทีคู่พอดี (เช่น 20:00, 21:00) reconcile รันทุก 2 นาที
// เลยมีจังหวะไปชนกันได้ ถ้าเผลอไปเช็คแทรกก่อน cron ตัวจริงจะเข้าใจผิดว่าพลาดทั้งที่จริงกำลังจะเริ่ม/จบพอดี
// เผื่อเวลาไว้ 90 วิให้ cron ตัวจริงได้ทำงานก่อนเสมอ ค่อยถือว่า "พลาดจริง"
const RECONCILE_GRACE_SEC = 90;

// เช็คทุกรอบว่า "ตอนนี้ควรอยู่ในช่วงเช็คของวันนี้ไหม" เทียบกับสถานะจริงที่เก็บไว้
// พลาดจังหวะเริ่ม (บอทเพิ่งมาออนไลน์กลางช่วง) -> เริ่มให้ตอนนี้เลย นับจากตอนที่รู้ตัวเท่านั้น (ไม่ย้อนไปตั้งแต่เวลาเริ่มจริง กันนับเวลาที่ไม่มีใครเห็นจริงๆ)
// พลาดจังหวะจบ (ยัง active ค้างทั้งที่เลยเวลาไปแล้ว) -> ปิดรอบให้ตอนนี้เลย กันข้อมูลค้างจนถูกรอบถัดไปทับหาย
async function reconcile(client) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const p = time.nowParts();
  const todayKey = time.dateKey();
  const nowSec = p.hour * 3600 + p.minute * 60 + p.second;

  for (const check of CHECKS) {
    const startSec = toSeconds(check.startTime);
    const endSec = toSeconds(check.endTime);
    const inWindowToday = check.days.includes(p.weekday) && nowSec >= startSec && nowSec < endSec;

    if (inWindowToday) {
      if (nowSec < startSec + RECONCILE_GRACE_SEC) continue; // เพิ่งเข้าช่วง ให้เวลา cron ตัวจริงทำงานก่อน

      const missed = check.sessionKeys.filter((sk) => {
        const st = voiceTracker.getSessionState(sk);
        return !st || !st.active || st.date !== todayKey;
      });
      if (missed.length === 0) continue;

      for (const sessionKey of missed) {
        voiceTracker.startSession(sessionKey, guild);
      }
      const nowLabel = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
      await alertRecovery(
        client,
        `กู้คืนการจับเวลา "${check.label}" ที่พลาดจังหวะเริ่มไป (บอทเพิ่งมาออนไลน์ตอน ${nowLabel} ทั้งที่ควรเริ่ม ${check.startTime}) เริ่มจับให้ตั้งแต่ตอนนี้ ${nowLabel} เป็นต้นไป`
      );
      continue;
    }

    const justEnded = check.days.includes(p.weekday) && nowSec >= endSec && nowSec < endSec + RECONCILE_GRACE_SEC;
    if (justEnded) continue; // เพิ่งพ้นช่วงไปหมาดๆ ให้เวลา cron ตัวจริงปิดรอบก่อน

    const stuck = check.sessionKeys.some((sk) => voiceTracker.getSessionState(sk)?.active);
    if (stuck) {
      await runCheckEnd(check.key, guild, client);
      await alertRecovery(
        client,
        `กู้คืนการจับเวลา "${check.label}" ที่พลาดจังหวะจบไป ปิดรอบและบันทึกชีตให้แล้ว (ถ้าบอทดับไปนานเวลาที่ได้อาจน้อยกว่าจริง)`
      );
    }
  }
}

function startReconcileLoop(client) {
  reconcile(client).catch((err) => console.error('[scheduler] reconcile ล้มเหลว:', err.message));
  cron.schedule(
    '*/2 * * * *',
    () => reconcile(client).catch((err) => console.error('[scheduler] reconcile ล้มเหลว:', err.message)),
    { timezone: TIMEZONE }
  );
}

function setupSchedules(client) {
  for (const check of CHECKS) {
    const startCron = toCron(check.startTime, check.days);
    const endCron = toCron(check.endTime, check.days);

    cron.schedule(
      startCron,
      () => {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return console.error(`[scheduler] ไม่พบ guild ${GUILD_ID}`);
        console.log(`[scheduler] เริ่มเช็ค: ${check.label}`);
        runCheckStart(check.key, guild);
      },
      { timezone: TIMEZONE }
    );

    cron.schedule(
      endCron,
      async () => {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return console.error(`[scheduler] ไม่พบ guild ${GUILD_ID}`);
        console.log(`[scheduler] จบรอบเช็ค: ${check.label} -> บันทึกชีต + DM สรุป`);
        await runCheckEnd(check.key, guild, client);
      },
      { timezone: TIMEZONE }
    );
  }
}

module.exports = { setupSchedules, runCheckStart, runCheckEnd, reconcile, startReconcileLoop };

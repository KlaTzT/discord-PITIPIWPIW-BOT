const cron = require('node-cron');
const { CHECKS, SESSIONS, GUILD_ID, TIMEZONE } = require('../config');
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

module.exports = { setupSchedules, runCheckStart, runCheckEnd };

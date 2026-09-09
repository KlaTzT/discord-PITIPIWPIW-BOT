const storage = require('../storage');
const time = require('../time');
const bindings = require('./bindings');
const { SESSIONS } = require('../config');

const PRACTICE_HEADER = ['วันวอร์', 'ตัวละคร', 'Discord', 'เข้า', 'ออก', 'รวมนาที', 'กี่ช่วง'];

function freshState() {
  return { date: null, active: false, joinedAt: {}, totals: {}, segments: {}, firstJoin: {}, lastLeave: {} };
}

function stateFor(sessionKey) {
  const all = storage.load('liveSessions', {});
  if (!all[sessionKey]) all[sessionKey] = freshState();
  return all;
}

function saveAll(all) {
  storage.save('liveSessions', all);
}

function sessionsForChannel(channelId) {
  return SESSIONS.filter((s) => s.channelIds.includes(channelId));
}

function markJoin(st, userId, atMs) {
  st.joinedAt[userId] = atMs;
  st.segments[userId] = (st.segments[userId] || 0) + 1;
  if (!st.firstJoin[userId]) st.firstJoin[userId] = atMs;
}

function markLeave(st, userId, atMs) {
  const startedAt = st.joinedAt[userId];
  if (!startedAt) return false;
  st.totals[userId] = (st.totals[userId] || 0) + (atMs - startedAt) / 1000;
  st.lastLeave[userId] = atMs;
  delete st.joinedAt[userId];
  return true;
}

function registerVoiceEvents(client) {
  client.on('voiceStateUpdate', (oldState, newState) => {
    const userId = newState.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    if (oldChannelId === newChannelId) return;

    const touched = new Set([
      ...sessionsForChannel(oldChannelId).map((s) => s.key),
      ...sessionsForChannel(newChannelId).map((s) => s.key),
    ]);
    if (touched.size === 0) return;

    const all = storage.load('liveSessions', {});
    const now = Date.now();
    let changed = false;

    for (const key of touched) {
      const session = SESSIONS.find((s) => s.key === key);
      const st = all[key];
      if (!st || !st.active) continue; // นอกช่วงเวลาที่กำลังเช็ค ไม่ต้องนับ

      const wasIn = session.channelIds.includes(oldChannelId);
      const isIn = session.channelIds.includes(newChannelId);
      if (wasIn === isIn) continue;

      if (!wasIn && isIn) {
        markJoin(st, userId, now);
        changed = true;
      } else if (wasIn && !isIn) {
        changed = markLeave(st, userId, now) || changed;
      }
    }

    if (changed) saveAll(all);
  });
}

function startSession(sessionKey, guild) {
  const session = SESSIONS.find((s) => s.key === sessionKey);
  const all = stateFor(sessionKey);
  const now = Date.now();

  all[sessionKey] = freshState();
  all[sessionKey].date = time.dateKey();
  all[sessionKey].active = true;

  for (const channelId of session.channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.members) continue;
    for (const member of channel.members.values()) {
      markJoin(all[sessionKey], member.id, now);
    }
  }

  saveAll(all);
}

function getSessionState(sessionKey) {
  const all = storage.load('liveSessions', {});
  return all[sessionKey] || null;
}

async function resolveTag(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached.user.tag;
  try {
    const member = await guild.members.fetch(userId);
    return member.user.tag;
  } catch {
    return userId; // สมาชิกอาจออกจากดิสไปแล้ว
  }
}

async function warmMemberCache(guild) {
  try {
    await guild.members.fetch();
  } catch (err) {
    console.error('[voiceTracker] โหลดรายชื่อสมาชิกล่วงหน้าล้มเหลว:', err.message);
  }
}

async function endSession(sessionKey, guild) {
  const session = SESSIONS.find((s) => s.key === sessionKey);
  const all = stateFor(sessionKey);
  const st = all[sessionKey];
  const now = Date.now();

  for (const userId of Object.keys(st.joinedAt)) {
    markLeave(st, userId, now);
  }
  st.active = false;
  saveAll(all);

  const dateStr = time.dateKey();
  const results = {};
  for (const userId of Object.keys(st.totals)) {
    const seconds = st.totals[userId];
    const minutes = Math.round((seconds / 60) * 100) / 100;
    const gameName = bindings.getNameByUserId(userId);
    const discordTag = await resolveTag(guild, userId);

    results[userId] = {
      minutes,
      attended: minutes >= session.minMinutes,
      gameName,
      discordTag,
      firstJoin: st.firstJoin[userId],
      lastLeave: st.lastLeave[userId] || now,
      segments: st.segments[userId] || 0,
    };
  }

  const all2 = storage.load('liveSessions', {});
  all2[sessionKey] = freshState();
  saveAll(all2);

  return { dateStr, results };
}

function buildPracticeRow(dateStr, minMinutes, merged) {
  const belowMin = merged.minutes < minMinutes;
  const row = [
    time.formatThaiDate(dateStr),
    merged.gameName || '(ไม่ได้ผูกชื่อ)',
    merged.discordTag,
    time.timeLabel(new Date(merged.firstJoin)),
    time.timeLabel(new Date(merged.lastLeave)),
    String(Math.round(merged.minutes)),
    String(merged.segments),
  ];
  return { row, belowMin };
}

module.exports = {
  registerVoiceEvents,
  startSession,
  endSession,
  getSessionState,
  buildPracticeRow,
  warmMemberCache,
  resolveTag,
  PRACTICE_HEADER,
};

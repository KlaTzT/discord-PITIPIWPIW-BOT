require('dotenv').config();

const TIMEZONE = 'Asia/Bangkok';

const FIELD_MAIN = '1542147777046384741'; // สนามตี้หลัก
const FIELD_SUB = '1537713291231498261'; // สนามรอง
const TALK_MAIN = '1537674250620764204'; // พูดคุยหลัก
const TALK_CRAZY = '1543892475758911508'; // พูดคุยประสาท

const WAR_DAYS = [2, 4]; // อังคาร, พฤหัสบดี (ใช้กับการเช็คห้องซ้อมเท่านั้น)
const LEAVE_DAYS = [2, 4, 0]; // ลำดับที่โชว์ในปุ่มลา: อังคาร, พฤหัสบดี, อาทิตย์

const SESSIONS = [
  {
    key: 'practice_main',
    label: 'วอร์ปาร์ตี้หลัก',
    days: WAR_DAYS,
    startTime: '20:00',
    endTime: '22:25',
    channelIds: [FIELD_MAIN],
    minMinutes: 30, // ต่ำกว่านี้ = ไฮไลท์เหลืองในชีต
    sheetTab: 'วอร์ปาร์ตี้หลัก',
  },
  {
    key: 'practice_sub',
    label: 'วอร์ปาร์ตี้รอง',
    days: WAR_DAYS,
    startTime: '20:00',
    endTime: '22:25',
    channelIds: [FIELD_SUB],
    minMinutes: 30,
    sheetTab: 'วอร์ปาร์ตี้รอง',
  },
  {
    key: 'thu_talk',
    label: 'กิจกรรมกิลด์',
    days: [4],
    startTime: '21:00',
    endTime: '21:45',
    channelIds: [TALK_MAIN],
    minMinutes: 30,
    sheetTab: 'กิจกรรมกิลด์',
  },
  {
    key: 'sun_talk',
    label: 'ตีบอสกิลด์',
    days: [0],
    startTime: '18:00',
    endTime: '20:00',
    channelIds: [TALK_MAIN],
    minMinutes: 30,
    sheetTab: 'ตีบอสกิลด์',
  },
  {
    key: 'sun_crazy',
    label: 'วอร์วันอาทิตย์',
    days: [0],
    startTime: '20:01',
    endTime: '22:00',
    channelIds: [TALK_CRAZY],
    graceMinutes: 5,
    sheetTab: 'วอร์วันอาทิตย์',
  },
];

for (const s of SESSIONS) {
  const [sh, sm] = s.startTime.split(':').map(Number);
  const [eh, em] = s.endTime.split(':').map(Number);
  s.windowMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (s.minMinutes === undefined) {
    s.minMinutes = s.windowMinutes - (s.graceMinutes || 0);
  }
}

// countsTowardWar คุมคอลัมน์ "มาวอร์"/"ขาด (รอบ)" ในแท็บสรุป
const CHECKS = [
  { key: 'war', label: 'วอร์', sessionKeys: ['practice_main', 'practice_sub'], countsTowardWar: true },
  { key: 'thu_guild', label: 'กิจกรรมกิลด์', sessionKeys: ['thu_talk'], countsTowardWar: false },
  { key: 'sun_boss', label: 'ตีบอสกิลด์', sessionKeys: ['sun_talk'], countsTowardWar: false },
  { key: 'sun_war', label: 'วอร์วันอาทิตย์', sessionKeys: ['sun_crazy'], countsTowardWar: true },
];

for (const c of CHECKS) {
  const s = SESSIONS.find((s) => s.key === c.sessionKeys[0]);
  c.days = s.days;
  c.startTime = s.startTime;
  c.endTime = s.endTime;
}

const TEST_DAYS = [
  { key: 'tuesday', label: 'วันอังคาร (วอร์)', checkKeys: ['war'] },
  { key: 'thursday', label: 'วันพฤหัสบดี (วอร์ + กิจกรรมกิลด์)', checkKeys: ['war', 'thu_guild'] },
  { key: 'sunday', label: 'วันอาทิตย์ (ตีบอสกิลด์ + วอร์วันอาทิตย์)', checkKeys: ['sun_boss', 'sun_war'] },
];

const LEAVE_RULES = {
  MAX_LEAVES_PER_MONTH: 3,
  LATE_CUTOFF_HOUR: 15,
  WARNINGS_TO_RED_CARD: 2,
};

const ABSENCE_WARNING_THRESHOLD = 3; // ขาด (ไม่แจ้งลา) รวมทุกการเช็ค ครบเท่านี้ครั้ง/เดือน -> ใบเตือนอัตโนมัติ

const ATTENDANCE_REPORT_USER_ID = '974333079747436595'; // ส่ง DM สรุปมา/ลา/ขาด ให้คนนี้

// DM แจ้งเตือนก่อนวอร์ ทุกวันอังคาร/พฤหัสบดี/อาทิตย์ เวลา 12:00 หายศใดยศหนึ่งก็แจ้ง (มีทั้งคู่แจ้งรอบเดียว)
const ROUND_NOTIFY_ROLE_IDS = ['1538604206540455987', '1538604405287420025'];
const ROUND_NOTIFY_TEST_USER_ID = '974333079747436595';
// true = กระจายจริงตามยศ, false (ตอนนี้) = ส่งให้ ROUND_NOTIFY_TEST_USER_ID คนเดียวก่อนเสมอ ไม่ว่าจะรอบจริงหรือ /เทสแจ้งเตือน
const ROUND_NOTIFY_LIVE = false;

const SHEET_TABS = {
  LEAVE_LOG: 'แจ้งลา',
  WARNING_LOG: 'ใบเตือน',
  BINDINGS: 'ผูกID',
  SUMMARY: 'สรุป',
};

module.exports = {
  TIMEZONE,
  FIELD_MAIN,
  FIELD_SUB,
  TALK_MAIN,
  TALK_CRAZY,
  WAR_DAYS,
  LEAVE_DAYS,
  SESSIONS,
  CHECKS,
  TEST_DAYS,
  SHEET_TABS,
  LEAVE_RULES,
  ABSENCE_WARNING_THRESHOLD,
  ATTENDANCE_REPORT_USER_ID,
  ROUND_NOTIFY_ROLE_IDS,
  ROUND_NOTIFY_TEST_USER_ID,
  ROUND_NOTIFY_LIVE,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  LEAVE_CHANNEL_ID: process.env.LEAVE_CHANNEL_ID,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_FILE: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './credentials/service-account.json',
};

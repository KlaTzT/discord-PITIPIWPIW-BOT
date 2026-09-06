const storage = require('../storage');
const time = require('../time');
const { LEAVE_RULES } = require('../config');

// data/leaves.json
// { [discordUserId]: { [yyyy-mm]: { history: [{warDate, notifiedAt, late}], absenceWarnings } } }
// count/warnings/redCard ไม่เก็บเป็นฟิลด์แยก คำนวณจาก history+absenceWarnings ทุกครั้งที่อ่าน (deriveStatus)
// กันปัญหาข้อมูลไม่ตรงกันเวลามีการยกเลิกใบลาย้อนหลัง
function all() {
  return storage.load('leaves', {});
}

function rawRecord(map, userId, mKey) {
  if (!map[userId]) map[userId] = {};
  if (!map[userId][mKey]) map[userId][mKey] = { history: [], absenceWarnings: 0 };
  return map[userId][mKey];
}

function deriveStatus(raw) {
  const count = raw.history.length;
  const lateCount = raw.history.filter((h) => h.late).length;
  const warnings = lateCount + (raw.absenceWarnings || 0);
  const overQuota = count > LEAVE_RULES.MAX_LEAVES_PER_MONTH;
  const redCard = overQuota || warnings >= LEAVE_RULES.WARNINGS_TO_RED_CARD;
  return { count, warnings, redCard, overQuota, history: raw.history };
}

function getStatus(userId, monthKey) {
  const map = all();
  const raw = (map[userId] && map[userId][monthKey]) || { history: [], absenceWarnings: 0 };
  return deriveStatus(raw);
}

function monthKeyOf(warDateKey) {
  return warDateKey.slice(0, 7);
}

function canRequestLeave(userId, warDateKey) {
  return getStatus(userId, monthKeyOf(warDateKey)).count < LEAVE_RULES.MAX_LEAVES_PER_MONTH;
}

// โควตาถูกบล็อกที่ leavePanel.js ก่อนเรียกฟังก์ชันนี้แล้ว เช็ค overQuota ที่นี่ไว้เผื่อข้อมูลหลุดโควตามาเฉยๆ
function recordLeave(userId, warDateKey, notifiedAt = new Date()) {
  const map = all();
  const mKey = monthKeyOf(warDateKey);
  const raw = rawRecord(map, userId, mKey);
  const before = deriveStatus(raw);

  const late = notifiedAt.getTime() >= time.cutoffMomentMs(warDateKey, LEAVE_RULES.LATE_CUTOFF_HOUR);
  raw.history.push({ warDate: warDateKey, notifiedAt: time.dateTimeLabel(notifiedAt), late });
  storage.save('leaves', map);

  const after = deriveStatus(raw);
  return {
    monthKey: mKey,
    count: after.count,
    remaining: Math.max(0, LEAVE_RULES.MAX_LEAVES_PER_MONTH - after.count),
    warnings: after.warnings,
    late,
    redCard: after.redCard,
    newlyRedCarded: after.redCard && !before.redCard,
    newWarning: after.warnings > before.warnings,
    overQuota: after.overQuota,
  };
}

// ยกเลิกใบลาที่เคยแจ้งไว้ (ระบุ index ใน history ของเดือนนั้น) แล้วคำนวณสถานะใหม่ทั้งหมด
function cancelLeave(userId, monthKey, historyIndex) {
  const map = all();
  const raw = map[userId] && map[userId][monthKey];
  if (!raw || !raw.history[historyIndex]) return { ok: false, reason: 'NOT_FOUND' };

  const [removed] = raw.history.splice(historyIndex, 1);
  storage.save('leaves', map);
  return { ok: true, canceledDate: removed.warDate, status: deriveStatus(raw) };
}

// ใบลาที่ยังยกเลิกได้ (เฉพาะวันที่ยังไม่ถึง/ยังไม่ผ่านไป) ทุกเดือนที่มีข้อมูล
function getCancellableLeaves(userId) {
  const map = all();
  const userRecord = map[userId] || {};
  const todayKey = time.dateKey();
  const results = [];
  for (const [monthKey, raw] of Object.entries(userRecord)) {
    raw.history.forEach((h, index) => {
      if (h.warDate >= todayKey) results.push({ monthKey, index, warDate: h.warDate });
    });
  }
  return results.sort((a, b) => a.warDate.localeCompare(b.warDate));
}

function hasApprovedLeaveFor(userId, dateStr) {
  return getStatus(userId, monthKeyOf(dateStr)).history.some((h) => h.warDate === dateStr);
}

// ใช้เหมือนกลไกใบเตือนจากการลาสาย แต่ทริกเกอร์จากขาดครบโควตาแทน (เก็บแยกจาก history เพราะไม่ใช่การลา)
function addAbsenceWarning(userId, monthKey) {
  const map = all();
  const raw = rawRecord(map, userId, monthKey);
  const before = deriveStatus(raw);

  raw.absenceWarnings = (raw.absenceWarnings || 0) + 1;
  storage.save('leaves', map);

  const after = deriveStatus(raw);
  return { warnings: after.warnings, redCard: after.redCard, newlyRedCarded: after.redCard && !before.redCard };
}

module.exports = {
  recordLeave,
  cancelLeave,
  getCancellableLeaves,
  getStatus,
  canRequestLeave,
  monthKeyOf,
  hasApprovedLeaveFor,
  addAbsenceWarning,
};

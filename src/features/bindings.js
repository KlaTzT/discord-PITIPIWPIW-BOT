const storage = require('../storage');
const sheets = require('../sheets');
const { SHEET_TABS } = require('../config');

const SHEET_HEADER = ['Discord', 'ตัวละคร'];

// data/bindings.json: { [discordUserId]: gameName }
function all() {
  return storage.load('bindings', {});
}

function getNameByUserId(userId) {
  return all()[userId] || null;
}

function getUserIdByName(name) {
  const map = all();
  const target = name.trim().toLowerCase();
  const entry = Object.entries(map).find(([, n]) => n.trim().toLowerCase() === target);
  return entry ? entry[0] : null;
}

function bind(userId, name) {
  const map = all();
  if (map[userId]) {
    return { ok: false, reason: 'USER_ALREADY_BOUND', existingName: map[userId] };
  }
  const owner = getUserIdByName(name);
  if (owner) {
    return { ok: false, reason: 'NAME_TAKEN', ownerId: owner };
  }
  map[userId] = name;
  storage.save('bindings', map);
  return { ok: true };
}

function rename(oldUserId, oldName, newName) {
  const map = all();
  if (map[oldUserId] !== oldName) {
    return { ok: false, reason: 'NOT_MATCHED', currentName: map[oldUserId] || null };
  }
  const owner = getUserIdByName(newName);
  if (owner && owner !== oldUserId) {
    return { ok: false, reason: 'NAME_TAKEN', ownerId: owner };
  }
  map[oldUserId] = newName;
  storage.save('bindings', map);
  return { ok: true };
}

// ตั้ง/เปลี่ยนชื่อให้ userId ตรงๆ โดยไม่ต้องรู้ชื่อเก่า (ใช้กับคำสั่งแอดมิน /name)
function setName(userId, newName) {
  const map = all();
  const owner = getUserIdByName(newName);
  if (owner && owner !== userId) {
    return { ok: false, reason: 'NAME_TAKEN', ownerId: owner };
  }
  const oldName = map[userId] || null;
  map[userId] = newName;
  storage.save('bindings', map);
  return { ok: true, oldName };
}

function unbind(name) {
  const map = all();
  const userId = getUserIdByName(name);
  if (!userId) return { ok: false, reason: 'NOT_FOUND' };
  delete map[userId];
  storage.save('bindings', map);
  return { ok: true, userId };
}

async function syncToSheet(discordTag, name, oldName = null) {
  try {
    await sheets.upsertRow(SHEET_TABS.BINDINGS, SHEET_HEADER, 1, oldName || name, [discordTag, name]);
  } catch (err) {
    console.error('[bindings] เขียนชีตผูกIDล้มเหลว:', err.message);
  }
}

async function removeFromSheet(name) {
  try {
    await sheets.deleteRowByValue(SHEET_TABS.BINDINGS, SHEET_HEADER, 1, name);
  } catch (err) {
    console.error('[bindings] ลบแถวชีตผูกIDล้มเหลว:', err.message);
  }
}

module.exports = {
  all,
  getNameByUserId,
  getUserIdByName,
  bind,
  rename,
  setName,
  unbind,
  syncToSheet,
  removeFromSheet,
  SHEET_HEADER,
};

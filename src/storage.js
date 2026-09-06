const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map();

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name, defaultValue) {
  if (cache.has(name)) return cache.get(name);
  const fp = filePath(name);
  let value = defaultValue;
  if (fs.existsSync(fp)) {
    try {
      value = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (err) {
      console.error(`[storage] ${name}.json corrupted, falling back to default:`, err.message);
    }
  }
  cache.set(name, value);
  return value;
}

// เขียนแบบ atomic (เขียน temp แล้ว rename ทับ) กันไฟล์พังถ้าโปรเซสตายกลางคัน
function save(name, value) {
  cache.set(name, value);
  const fp = filePath(name);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

module.exports = { load, save };

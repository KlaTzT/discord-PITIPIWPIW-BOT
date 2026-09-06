const { TIMEZONE } = require('./config');

function nowParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday],
  };
}

function monthKey(date = new Date()) {
  const { year, month } = nowParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function dateKey(date = new Date()) {
  const { year, month, day } = nowParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isBeforeHour(hour, date = new Date()) {
  const p = nowParts(date);
  const secondsSinceMidnight = p.hour * 3600 + p.minute * 60 + p.second;
  return secondsSinceMidnight < hour * 3600;
}

// Bangkok = UTC+7 คงที่ตลอดปี (ไม่มี DST) เลยคำนวณตรงๆ ได้
function cutoffMomentMs(dateKeyStr, hour) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour - 7, 0, 0);
}

function upcomingWeekdayDates(weekdays, count, fromDate = new Date()) {
  const p = nowParts(fromDate);
  const todayMidnightMs = Date.UTC(p.year, p.month - 1, p.day, -7, 0, 0);
  const results = [];
  for (let n = 0; results.length < count && n < 60; n++) {
    const dayParts = nowParts(new Date(todayMidnightMs + n * 86400000));
    if (weekdays.includes(dayParts.weekday)) {
      results.push({
        dateKey: `${dayParts.year}-${String(dayParts.month).padStart(2, '0')}-${String(dayParts.day).padStart(2, '0')}`,
        weekday: dayParts.weekday,
      });
    }
  }
  return results;
}

// วันที่ใกล้ที่สุด (รวมวันนี้) ที่ตรงกับ weekday ที่ต้องการ
function nextOccurrenceOf(weekday, fromDate = new Date()) {
  const p = nowParts(fromDate);
  const todayMidnightMs = Date.UTC(p.year, p.month - 1, p.day, -7, 0, 0);
  for (let n = 0; n < 7; n++) {
    const dayParts = nowParts(new Date(todayMidnightMs + n * 86400000));
    if (dayParts.weekday === weekday) {
      return {
        dateKey: `${dayParts.year}-${String(dayParts.month).padStart(2, '0')}-${String(dayParts.day).padStart(2, '0')}`,
        weekday,
      };
    }
  }
  return null;
}

function formatThaiDate(dateKeyStr) {
  const [y, m, d] = dateKeyStr.split('-');
  return `${d}/${m}/${y}`;
}

function timeLabel(date = new Date()) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function dateTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: TIMEZONE,
    calendar: 'gregory',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

module.exports = {
  nowParts,
  monthKey,
  dateKey,
  isBeforeHour,
  cutoffMomentMs,
  upcomingWeekdayDates,
  nextOccurrenceOf,
  formatThaiDate,
  timeLabel,
  dateTimeLabel,
  TIMEZONE,
};

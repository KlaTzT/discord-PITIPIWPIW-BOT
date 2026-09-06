const sheets = require('../sheets');
const { SESSIONS, SHEET_TABS } = require('../config');
const { PRACTICE_HEADER } = require('./voiceTracker');
const { LEAVE_LOG_HEADER, WARNING_LOG_HEADER } = require('./leavePanel');
const { SHEET_HEADER: BINDINGS_HEADER } = require('./bindings');
const { SUMMARY_HEADER } = require('./attendanceTracker');

// สร้างทุกแท็บที่ระบบต้องใช้ไว้ล่วงหน้าตอนบอทพร้อมทำงาน จะได้ไม่ต้องรอมีคนเข้าห้องก่อนแท็บถึงจะโผล่
async function ensureAllTabs() {
  const jobs = [];
  for (const session of SESSIONS) {
    if (session.sheetTab) jobs.push(sheets.ensureTab(session.sheetTab, PRACTICE_HEADER));
  }
  jobs.push(sheets.ensureTab(SHEET_TABS.LEAVE_LOG, LEAVE_LOG_HEADER));
  jobs.push(sheets.ensureTab(SHEET_TABS.WARNING_LOG, WARNING_LOG_HEADER));
  jobs.push(sheets.ensureTab(SHEET_TABS.BINDINGS, BINDINGS_HEADER));
  jobs.push(sheets.ensureTab(SHEET_TABS.SUMMARY, SUMMARY_HEADER));

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[sheetSetup] สร้างแท็บล้มเหลว:', r.reason.message);
  }
}

module.exports = { ensureAllTabs };

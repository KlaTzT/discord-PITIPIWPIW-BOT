const fs = require('fs');
const { google } = require('googleapis');
const { GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_FILE } = require('./config');

let sheetsApi = null;
const tabIdCache = new Map(); // tabName -> numeric sheetId ภายใน spreadsheet

function getClient() {
  if (sheetsApi) return sheetsApi;
  if (!fs.existsSync(GOOGLE_SERVICE_ACCOUNT_FILE)) {
    throw new Error(`ไม่พบไฟล์ service account: ${GOOGLE_SERVICE_ACCOUNT_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: GOOGLE_SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

async function ensureTab(tabName, header) {
  if (tabIdCache.has(tabName)) return tabIdCache.get(tabName);
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
  let sheet = meta.data.sheets.find((s) => s.properties.title === tabName);

  if (!sheet) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    const sheetId = res.data.replies[0].addSheet.properties.sheetId;
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
    tabIdCache.set(tabName, sheetId);
    return sheetId;
  }

  tabIdCache.set(tabName, sheet.properties.sheetId);
  return sheet.properties.sheetId;
}

function highlightRow(sheetId, rowIndex, columnCount) {
  const sheets = getClient();
  return sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: columnCount,
            },
            cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.92, blue: 0.6 } } },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ],
    },
  });
}

async function appendRow(tabName, header, row, highlight = false) {
  const sheets = getClient();
  const sheetId = await ensureTab(tabName, header);

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  if (!highlight) return;

  const updatedRange = appendRes.data.updates.updatedRange;
  const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
  if (!match) return;
  const rowIndex = Number(match[1]) - 1;
  await highlightRow(sheetId, rowIndex, header.length);
}

// เหมือน appendRow แต่ส่งหลายแถวในคำขอเดียว (1 append + 1 batchUpdate ไฮไลท์ ไม่ว่าจะกี่แถว)
// ใช้เวลามีคนเยอะๆ พร้อมกัน (เช่นวอร์ 200 คน) กันยิง API ทีละคนจนช้า/โดน rate limit
async function appendRows(tabName, header, rows, highlightFlags = []) {
  if (rows.length === 0) return;
  const sheets = getClient();
  const sheetId = await ensureTab(tabName, header);

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  const updatedRange = appendRes.data.updates.updatedRange;
  const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
  if (!match) return;
  const startRowIndex = Number(match[1]) - 1;

  const highlightRequests = [];
  rows.forEach((_, i) => {
    if (!highlightFlags[i]) return;
    highlightRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: startRowIndex + i,
          endRowIndex: startRowIndex + i + 1,
          startColumnIndex: 0,
          endColumnIndex: header.length,
        },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.92, blue: 0.6 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  });

  if (highlightRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: { requests: highlightRequests },
    });
  }
}

async function findRowIndex(tabName, matches) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tabName}!A2:Z`,
  });
  const rows = res.data.values || [];
  return rows.findIndex((r) => matches.every(([colIndex, value]) => r[colIndex] === value));
}

async function writeRow(tabName, header, foundIndex, row) {
  const sheets = getClient();
  if (foundIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    return;
  }

  const sheetRowNumber = foundIndex + 2; // +1 เพราะเริ่มอ่านจาก A2, +1 เพราะ sheet index เริ่มที่ 1
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tabName}!A${sheetRowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

// หาแถวที่ตรง matchValue แล้วอัปเดตทับ ถ้าไม่เจอเพิ่มแถวใหม่แทน (ใช้กับตารางที่ต้องมี 1 คน 1 แถว)
async function upsertRow(tabName, header, matchColIndex, matchValue, row) {
  await ensureTab(tabName, header);
  const foundIndex = await findRowIndex(tabName, [[matchColIndex, matchValue]]);
  await writeRow(tabName, header, foundIndex, row);
}

// เหมือน upsertRow แต่จับคู่ได้หลายคอลัมน์พร้อมกัน เช่น Discord+เดือน (ใช้กับตารางที่ต้องมี 1 คน 1 เดือน 1 แถว)
async function upsertRowByKeys(tabName, header, matches, row) {
  await ensureTab(tabName, header);
  const foundIndex = await findRowIndex(tabName, matches);
  await writeRow(tabName, header, foundIndex, row);
}

// เหมือน upsertRowByKeys แต่ทำหลายคนในคำขอเดียว (1 อ่าน + สูงสุด 1 batchUpdate + 1 append รวม ไม่ว่าจะกี่คน)
// items: [{ matches: [[colIndex, value], ...], row: [...] }, ...]
async function upsertRowsByKeys(tabName, header, items) {
  if (items.length === 0) return;
  const sheets = getClient();
  await ensureTab(tabName, header);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tabName}!A2:Z`,
  });
  const existingRows = res.data.values || [];

  const updateData = [];
  const rowsToAppend = [];

  for (const item of items) {
    const foundIndex = existingRows.findIndex((r) => item.matches.every(([colIndex, value]) => r[colIndex] === value));
    if (foundIndex === -1) {
      rowsToAppend.push(item.row);
    } else {
      const sheetRowNumber = foundIndex + 2;
      updateData.push({ range: `${tabName}!A${sheetRowNumber}`, values: [item.row] });
    }
  }

  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updateData },
    });
  }
  if (rowsToAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rowsToAppend },
    });
  }
}

// หาแถวที่ตรง matchValue แล้วลบแถวนั้นทิ้งทั้งแถว ไม่เจอก็ไม่ทำอะไร
async function deleteRowByValue(tabName, header, matchColIndex, matchValue) {
  const sheets = getClient();
  const sheetId = await ensureTab(tabName, header);
  const foundIndex = await findRowIndex(tabName, [[matchColIndex, matchValue]]);
  if (foundIndex === -1) return false;

  const rowIndex = foundIndex + 1; // +1 เพราะ A2 คือ grid index 1 (index 0 คือแถว header)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } },
      ],
    },
  });
  return true;
}

module.exports = {
  appendRow,
  appendRows,
  upsertRow,
  upsertRowByKeys,
  upsertRowsByKeys,
  deleteRowByValue,
  ensureTab,
};

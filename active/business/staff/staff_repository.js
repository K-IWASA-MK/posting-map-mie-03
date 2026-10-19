/**
 * Business Layer - Staff Repository
 * 
 * Target Domain: Staff Management
 * Owner Layer: Business Layer
 * Responsibility: 名簿スプレッドシート（A:ID, B:名前, C:LINE_USER_ID, D:登録日時）に対するデータ操作
 */

function normalizeName(str) {
  if (!str) return "";
  let s = String(str);
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFC');
  }
  return s.replace(/[\s\u3000\u200b\u200c\u200d\uFEFF]/g, "");
}

if (typeof sanitizeFormula === 'undefined') {
  sanitizeFormula = function(val) {
    if (typeof val !== 'string') return val;
    if (/^[=\+\-@\t\r]/.test(val)) {
      return "'" + val;
    }
    return val;
  };
}

if (typeof StaffRepository === 'undefined') {
  StaffRepository = class StaffRepository {
    constructor() {
      // Data source access via Infrastructure Adapter
    }

    static getInstance() {
      if (!StaffRepository.instance) {
        StaffRepository.instance = new StaffRepository();
      }
      return StaffRepository.instance;
    }

    getRosterSheet(districtId = "") {
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        return MonthlySheetResolver.getInstance().getCurrentSheet("staff", districtId);
      }
      return null;
    }

    findByLineUserId(lineUserId, districtId = "") {
      if (!lineUserId) return null;
      const sheet = this.getRosterSheet(districtId);
      if (!sheet) return null;

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return null;

      const values = sheet.getRange(1, 1, lastRow, 4).getValues();
      const cleanTargetId = String(lineUserId).trim();

      for (let i = 1; i < values.length; i++) {
        const rowId = String(values[i][0] || "").trim();
        const rowName = String(values[i][1] || "").trim();
        const rowLineUserId = String(values[i][2] || "").trim();
        const rowRegisteredAt = String(values[i][3] || "").trim();

        if (rowLineUserId === cleanTargetId && rowId !== "") {
          return new Staff({
            id: rowId,
            name: rowName,
            lineUserId: rowLineUserId,
            registeredAt: rowRegisteredAt
          });
        }
      }
      return null;
    }

    insertNewStaff(staff, districtId = "") {
      const sheet = this.getRosterSheet(districtId);
      if (!sheet) throw new Error("Roster sheet not found");

      const lastRow = sheet.getLastRow();
      let values = [];
      if (lastRow >= 1) {
        values = sheet.getRange(1, 1, lastRow, 4).getValues();
      }

      let maxIdNum = 0;
      let prefix = "S";
      let paddingWidth = 3;
      let targetRow = 0;
      let foundEmptyRow = false;

      for (let i = 1; i < values.length; i++) {
        const valId = typeof normalizeName === 'function' ? normalizeName(values[i][0]) : String(values[i][0] || "").trim();
        const valName = typeof normalizeName === 'function' ? normalizeName(values[i][1]) : String(values[i][1] || "").trim();

        if (valId !== "") {
          const match = valId.match(/^([A-Za-z]*)(0*)(\d+)$/);
          if (match) {
            const currentPrefix = match[1];
            const zeros = match[2];
            const numStr = match[3];
            const idNum = parseInt(numStr, 10);
            
            if (!isNaN(idNum) && idNum > maxIdNum) {
              maxIdNum = idNum;
              prefix = currentPrefix;
              paddingWidth = (zeros + numStr).length;
            }
          } else {
            const idNum = parseInt(valId, 10);
            if (!isNaN(idNum) && idNum > maxIdNum) {
              maxIdNum = idNum;
              prefix = "";
              paddingWidth = 0;
            }
          }
        }

        if (!foundEmptyRow && valId === "" && valName === "") {
          targetRow = i + 1;
          foundEmptyRow = true;
        }
      }

      if (!foundEmptyRow) {
        targetRow = values.length + 1;
      }

      const nextIdNum = maxIdNum + 1;
      let newId = "";
      if (paddingWidth > 0) {
        newId = prefix + String(nextIdNum).padStart(paddingWidth, '0');
      } else {
        newId = prefix + nextIdNum;
      }

      const cleanName = String(staff.name || "").trim();
      const cleanLineUserId = String(staff.lineUserId || "").trim();

      // Backend SSOT timestamp generation (JST: yyyy/MM/dd HH:mm:ss)
      const now = new Date();
      let registeredAt = "";
      if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
        registeredAt = Utilities.formatDate(now, "JST", "yyyy/MM/dd HH:mm:ss");
      } else {
        const pad = (n) => String(n).padStart(2, '0');
        registeredAt = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      }

      const safeName = sanitizeFormula(cleanName);
      sheet.getRange(targetRow, 1, 1, 4).setValues([[newId, safeName, cleanLineUserId, registeredAt]]);
      if (typeof SpreadsheetApp !== 'undefined' && typeof SpreadsheetApp.flush === 'function') {
        SpreadsheetApp.flush();
      }

      return new Staff({
        id: newId,
        name: cleanName,
        lineUserId: cleanLineUserId,
        registeredAt: registeredAt
      });
    }
  };
  StaffRepository.instance = null;
}

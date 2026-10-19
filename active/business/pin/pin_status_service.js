(function(global) {
  class PinStatusService {
    constructor() {}

    static getInstance() {
      if (!PinStatusService.instance) {
        PinStatusService.instance = new PinStatusService();
      }
      return PinStatusService.instance;
    }

    getMonthlySheet(type, districtId = "") {
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        return MonthlySheetResolver.getInstance().getCurrentSheet(type, districtId);
      }
      return null;
    }

    getStatus(districtId = "") {
      try {
        let pinSheet = this.getMonthlySheet('pin', districtId);
        let inProgress = [];
        if (pinSheet) {
          const lr = pinSheet.getLastRow();
          if (lr > 0) {
            const values = pinSheet.getRange(1, 1, lr, 1).getValues();
            inProgress = values.map(r => parseInt(r[0], 10)).filter(id => !isNaN(id));
          }
        }

        let completed = [];
        const distSheet = this.getMonthlySheet('distribution', districtId);
        if (distSheet) {
          const lr = distSheet.getLastRow();
          if (lr > 0) {
            const values = distSheet.getRange(1, 1, lr, 4).getValues();
            completed = values
              .filter(r => r[0] && r[3] !== "" && r[3] !== null) // D列 (completedAt)
              .map(r => parseInt(r[0], 10))
              .filter(id => !isNaN(id));
          }
        }

        return { success: true, inProgress, completed };
      } catch (e) {
        return { success: false, message: e.toString() };
      }
    }

    setInProgress(data, districtId = "") {
      try {
        const rowId = parseInt(data.rowId, 10);
        if (isNaN(rowId)) return { success: false, message: 'Invalid rowId' };

        const targetDistId = String(districtId || "").trim();
        let pinSheet = this.getMonthlySheet('pin', targetDistId);
        if (!pinSheet) {
          return { success: false, code: "SHEET_NOT_READY", message: "PinStatus sheet unavailable" };
        }

        const lock = LockService.getScriptLock();
        lock.waitLock(10000);
        try {
          const lr = pinSheet.getLastRow();
          let rowIndex = -1;
          if (lr > 0) {
            const values = pinSheet.getRange(1, 1, lr, 1).getValues();
            for (let i = 0; i < values.length; i++) {
              if (parseInt(values[i][0], 10) === rowId) {
                rowIndex = i + 1;
                break;
              }
            }
          }

          if (data.pinAction === "add") {
            if (rowIndex === -1) {
              pinSheet.appendRow([rowId, "IN_PROGRESS"]);
            }
          } else if (data.pinAction === "remove") {
            if (rowIndex !== -1) {
              pinSheet.deleteRow(rowIndex);
            }
          }
          return { success: true };
        } finally {
          lock.releaseLock();
        }
      } catch (e) {
        return { success: false, message: e.toString() };
      }
    }
  }

  PinStatusService.instance = null;
  global.PinStatusService = PinStatusService;
})(this);

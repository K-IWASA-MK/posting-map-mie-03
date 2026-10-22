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

    _isSchemaReady(pinSheet) {
      if (!pinSheet) return false;
      const lr = pinSheet.getLastRow();
      const lc = typeof pinSheet.getLastColumn === 'function' ? pinSheet.getLastColumn() : 5;
      if (lr < 1 || lc < 5) return false;
      const headerRow = pinSheet.getRange(1, 1, 1, 5).getValues()[0] || [];
      const expected = ["rowId", "status", "lineUserId", "lockId", "startedAt"];
      for (let i = 0; i < expected.length; i++) {
        if (String(headerRow[i] || "").trim() !== expected[i]) {
          return false;
        }
      }
      return true;
    }

    _deleteSheetRow(sheet, rowNumber) {
      if (typeof sheet.deleteRow === 'function') {
        sheet.deleteRow(rowNumber);
      } else if (typeof sheet.deleteRows === 'function') {
        sheet.deleteRows(rowNumber, 1);
      }
    }

    getStatus(districtId = "", viewerLineUserId = "") {
      try {
        const targetDistId = String(districtId || "").trim();
        const viewer = String(viewerLineUserId || "").trim();
        let pinSheet = this.getMonthlySheet('pin', targetDistId);
        let inProgress = [];
        let myInProgress = [];

        if (pinSheet) {
          const lr = pinSheet.getLastRow();
          if (lr >= 2) {
            if (this._isSchemaReady(pinSheet)) {
              const values = pinSheet.getRange(2, 1, lr - 1, 5).getValues();
              const seenInProgress = new Set();
              for (let i = 0; i < values.length; i++) {
                const r = values[i];
                const id = parseInt(r[0], 10);
                if (isNaN(id) || id < 1) continue;
                const statusVal = String(r[1] || "").trim();
                if (statusVal && statusVal !== "IN_PROGRESS" && statusVal !== "inProgress") continue;
                if (!seenInProgress.has(id)) {
                  seenInProgress.add(id);
                  inProgress.push(id);
                }
                const rowOwner = String(r[2] || "").trim();
                const rowLockId = String(r[3] || "").trim();
                if (viewer && rowOwner === viewer && rowLockId) {
                  myInProgress.push({ rowId: id, lockId: rowLockId });
                }
              }
            } else {
              const values = pinSheet.getRange(2, 1, lr - 1, 1).getValues();
              const seenInProgress = new Set();
              for (let i = 0; i < values.length; i++) {
                const id = parseInt(values[i][0], 10);
                if (!isNaN(id) && id >= 1 && !seenInProgress.has(id)) {
                  seenInProgress.add(id);
                  inProgress.push(id);
                }
              }
            }
          }
        }

        let completed = [];
        const distSheet = this.getMonthlySheet('distribution', targetDistId);
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

        return { success: true, inProgress, completed, myInProgress };
      } catch (e) {
        return { success: false, message: e.toString() };
      }
    }

    setInProgress(data, districtId = "", reqLineUserId = "") {
      try {
        const rowId = parseInt(data && data.rowId, 10);
        if (isNaN(rowId) || rowId < 1) {
          return { success: false, code: "INVALID_ROW_ID", message: "Invalid rowId" };
        }

        const owner = String(reqLineUserId || "").trim();
        if (!owner) {
          return { success: false, code: "UNAUTHORIZED", message: "Verified LINE identity required" };
        }

        const pinAction = String((data && data.pinAction) || "").trim();
        if (pinAction !== "add" && pinAction !== "remove") {
          return { success: false, code: "INVALID_ACTION", message: "Invalid pinAction" };
        }

        const incomingLockId = String((data && data.lockId) || "").trim();
        const targetDistId = String(districtId || "").trim();
        let pinSheet = this.getMonthlySheet('pin', targetDistId);
        if (!pinSheet) {
          return { success: false, code: "SHEET_NOT_READY", message: "PinStatus sheet unavailable" };
        }

        const lock = LockService.getScriptLock();
        lock.waitLock(10000);
        try {
          if (!this._isSchemaReady(pinSheet)) {
            return {
              success: false,
              code: "SCHEMA_NOT_READY",
              message: "PinStatus schema not ready (5 columns required)"
            };
          }

          if (pinAction === "add") {
            if (!incomingLockId) {
              return { success: false, code: "INVALID_LOCK_ID", message: "lockId is required for add" };
            }

            // Step 1: ALREADY_COMPLETED 判定（他ピン削除より前に必ず実施）
            const distSheet = this.getMonthlySheet('distribution', targetDistId);
            if (distSheet) {
              const distLr = distSheet.getLastRow();
              if (distLr >= 2) {
                const distRows = distSheet.getRange(2, 1, distLr - 1, 4).getValues();
                for (let i = 0; i < distRows.length; i++) {
                  const dRowId = parseInt(distRows[i][0], 10);
                  const dCompletedAt = distRows[i][3];
                  if (dRowId === rowId && dCompletedAt !== "" && dCompletedAt !== null && dCompletedAt !== undefined) {
                    return {
                      success: false,
                      code: "ALREADY_COMPLETED",
                      rowId: rowId,
                      message: "This pin is already completed"
                    };
                  }
                }
              }
            }

            // Step 2: LOCKED_BY_OTHER 判定（他ピン削除より前に必ず実施）
            const lr = pinSheet.getLastRow();
            let rows = [];
            if (lr >= 2) {
              rows = pinSheet.getRange(2, 1, lr - 1, 5).getValues();
            }

            for (let i = 0; i < rows.length; i++) {
              const rRowId = parseInt(rows[i][0], 10);
              const rOwner = String(rows[i][2] || "").trim();
              if (rRowId === rowId && rOwner !== owner) {
                return {
                  success: false,
                  code: "LOCKED_BY_OTHER",
                  rowId: rowId,
                  message: "This pin is currently locked by another user"
                };
              }
            }

            // Step 3: 1人1ピン整理（同一 owner の別 rowId 行を下から削除）
            for (let i = rows.length - 1; i >= 0; i--) {
              const rRowId = parseInt(rows[i][0], 10);
              const rOwner = String(rows[i][2] || "").trim();
              if (rOwner === owner && rRowId !== rowId) {
                this._deleteSheetRow(pinSheet, i + 2);
              }
            }

            // Step 4: 同一 rowId・同一 owner の既存ロック確認または新規追加
            const afterLr = pinSheet.getLastRow();
            if (afterLr >= 2) {
              const afterRows = pinSheet.getRange(2, 1, afterLr - 1, 5).getValues();
              for (let i = 0; i < afterRows.length; i++) {
                const rRowId = parseInt(afterRows[i][0], 10);
                const rOwner = String(afterRows[i][2] || "").trim();
                const rLockId = String(afterRows[i][3] || "").trim();
                if (rRowId === rowId && rOwner === owner) {
                  if (rLockId) {
                    return {
                      success: true,
                      status: "IN_PROGRESS",
                      rowId: rowId,
                      lockId: rLockId,
                      restored: true
                    };
                  } else {
                    // 万一 lockId が空の本人行があれば下から削除して新規ロックに置き換える
                    this._deleteSheetRow(pinSheet, i + 2);
                    break;
                  }
                }
              }
            }

            const startedAt = (typeof Utilities !== 'undefined' && Utilities.formatDate)
              ? Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm:ss")
              : new Date().toISOString();
            pinSheet.appendRow([rowId, "IN_PROGRESS", owner, incomingLockId, startedAt]);

            return {
              success: true,
              status: "IN_PROGRESS",
              rowId: rowId,
              lockId: incomingLockId,
              restored: false
            };
          } else {
            // pinAction === "remove"
            if (!incomingLockId) {
              return {
                success: false,
                code: "LOCK_MISMATCH",
                rowId: rowId,
                message: "lockId is required for remove"
              };
            }

            const lr = pinSheet.getLastRow();
            if (lr < 2) {
              return { success: true, status: "ALREADY_REMOVED", rowId: rowId };
            }

            const rows = pinSheet.getRange(2, 1, lr - 1, 5).getValues();
            let targetIndex = -1;
            let storedOwner = "";
            let storedLockId = "";
            for (let i = 0; i < rows.length; i++) {
              if (parseInt(rows[i][0], 10) === rowId) {
                targetIndex = i + 2;
                storedOwner = String(rows[i][2] || "").trim();
                storedLockId = String(rows[i][3] || "").trim();
                break;
              }
            }

            if (targetIndex === -1) {
              return { success: true, status: "ALREADY_REMOVED", rowId: rowId };
            }

            if (!storedOwner || storedOwner !== owner) {
              return {
                success: false,
                code: "OWNER_MISMATCH",
                rowId: rowId,
                message: "Pin lock is owned by another user"
              };
            }

            if (!storedLockId || storedLockId !== incomingLockId) {
              return {
                success: false,
                code: "LOCK_MISMATCH",
                rowId: rowId,
                message: "Pin lock generation mismatch"
              };
            }

            this._deleteSheetRow(pinSheet, targetIndex);
            return {
              success: true,
              status: "REMOVED",
              rowId: rowId,
              lockId: incomingLockId
            };
          }
        } finally {
          lock.releaseLock();
        }
      } catch (e) {
        return { success: false, message: e.toString() };
      }
    }

    /**
     * GPSService.updateRecordWithGPSPhoto の既存 ScriptLock 排他区間内から直列呼び出しされる完了時ロック解除。
     * rowId + owner + lockId (両方非空) が完全一致する行のみ削除する。
     */
    releasePinInExistingLock(rowId, reqLineUserId, lockId, districtId = "") {
      try {
        const targetRowId = parseInt(rowId, 10);
        if (isNaN(targetRowId) || targetRowId < 1) {
          return { success: true, status: "ALREADY_REMOVED" };
        }

        const targetDistId = String(districtId || "").trim();
        const pinSheet = this.getMonthlySheet('pin', targetDistId);
        if (!pinSheet) {
          // 最小構成の単体テスト等で PinStatus シート自体が存在しない環境では ALREADY_REMOVED として扱う
          return { success: true, status: "ALREADY_REMOVED" };
        }

        if (!this._isSchemaReady(pinSheet)) {
          return {
            success: false,
            retryable: true,
            code: "PIN_RELEASE_FAILED",
            errorType: "TRANSIENT",
            message: "PinStatus schema not ready (5 columns required)"
          };
        }

        const lr = pinSheet.getLastRow();
        if (lr < 2) {
          return { success: true, status: "ALREADY_REMOVED" };
        }

        const owner = String(reqLineUserId || "").trim();
        const incomingLockId = String(lockId || "").trim();
        const rows = pinSheet.getRange(2, 1, lr - 1, 5).getValues();

        for (let i = rows.length - 1; i >= 0; i--) {
          const rRowId = parseInt(rows[i][0], 10);
          if (rRowId !== targetRowId) continue;

          const storedOwner = String(rows[i][2] || "").trim();
          const storedLockId = String(rows[i][3] || "").trim();

          if (!owner || !storedOwner || storedOwner !== owner) {
            return { success: true, status: "OWNER_MISMATCH" };
          }

          if (!storedLockId || !incomingLockId || storedLockId !== incomingLockId) {
            return { success: true, status: "LOCK_MISMATCH" };
          }

          this._deleteSheetRow(pinSheet, i + 2);
          return { success: true, status: "REMOVED" };
        }

        return { success: true, status: "ALREADY_REMOVED" };
      } catch (e) {
        return {
          success: false,
          retryable: true,
          code: "PIN_RELEASE_FAILED",
          errorType: "TRANSIENT",
          message: e.toString()
        };
      }
    }
  }

  PinStatusService.instance = null;
  global.PinStatusService = PinStatusService;
})(this);

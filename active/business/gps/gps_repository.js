/**
 * Business Layer - GPS Repository Module
 *
 * Domain: GPS / Photo Domain
 * Layer: Business Layer
 * Responsibility: Google Drive への写真保存、指定エリアシートへの GPS・写真情報書き込み
 */

if (typeof sanitizeFormula === 'undefined') {
  sanitizeFormula = function(val) {
    if (typeof val !== 'string') return val;
    if (/^[=\+\-@\t\r]/.test(val)) {
      return "'" + val;
    }
    return val;
  };
}

if (typeof GPSRepository === 'undefined') {
  GPSRepository = class GPSRepository {
    constructor() {
      this.driveAdapter = (typeof DriveAdapter !== 'undefined') ? new DriveAdapter() : null;
      this.spreadsheetAdapter = (typeof SpreadsheetAdapter !== 'undefined') ? new SpreadsheetAdapter() : null;
    }

    static getInstance() {
      if (!GPSRepository.instance) {
        GPSRepository.instance = new GPSRepository();
      }
      return GPSRepository.instance;
    }

    savePhotoToDrive(data, rowIdNum, districtId = "") {
      if (!data.photoData || data.photoData.indexOf("data:image") !== 0) {
        return { success: false };
      }
      try {
        const folderId = (typeof getStorageFolderId === 'function') ? getStorageFolderId(districtId) : null;
        if (!folderId) return { success: false };
        const folder = DriveApp.getFolderById(folderId);
        const now = new Date();
        const yyyyMMdd = Utilities.formatDate(now, "JST", "yyyyMMdd");
        const HHmmss = Utilities.formatDate(now, "JST", "HHmmss");

        // Sanitize staffName
        let safeStaffName = data.staffName ? String(data.staffName) : "Unknown";
        safeStaffName = safeStaffName.replace(/[\\/:*?"<>|\s　]/g, "_");

        const fileName = `${rowIdNum}_${safeStaffName}_${yyyyMMdd}_${HHmmss}.jpg`;
        const base64Data = data.photoData.split(",")[1];
        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, "image/jpeg", fileName);
        const file = folder.createFile(blob);
        return { success: true, fileId: file.getId() };
      } catch (driveErr) {
        console.error("Google Drive Save Error:", driveErr);
        return { success: false };
      }
    }

    getDistributionSheet(districtId = "") {
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        return MonthlySheetResolver.getInstance().getCurrentSheet("distribution", districtId);
      }
      return null;
    }

    checkExistingStatus(rowIdNum, districtId = "") {
      try {
        const sheet = this.getDistributionSheet(districtId);
        if (!sheet) return null;

        const finder = sheet.getRange("A:A").createTextFinder(String(rowIdNum)).matchEntireCell(true);
        const cell = finder.findNext();
        if (cell) {
           const row = cell.getRow();
           // D(4)〜Q(17) の 14列を取得
           // [0] D completedAt, [1] E count, [2] F staffId, [3] G staffName,
           // [4] H gpsStatus, [5] I photoStatus, [6] J lat, [7] K lng, [8] L gpsTimestamp,
           // [9] M photoFileId, [10] N photoUrl, [11] O photoTimestamp, [12] P lineUserId, [13] Q requestId
           const rowValues = sheet.getRange(row, 4, 1, 14).getValues()[0];
           const gpsStatus = rowValues[4] === "OK" ? "OK" : "NO";
           const photoStatus = rowValues[5] === "OK" ? "OK" : "NO";
           return {
             found: true,
             rowNum: row,
             existingCompletedAt: rowValues[0] || "",
             existingCount: parseFloat(rowValues[1]) || 0,
             existingStaffId: rowValues[2] || "",
             existingStaffName: rowValues[3] || "",
             gpsStatus,
             photoStatus,
             existingLat: rowValues[6] || "",
             existingLng: rowValues[7] || "",
             existingGpsTime: rowValues[8] || "",
             existingFileId: rowValues[9] || "",
             existingPhotoUrl: rowValues[10] || "",
             existingPhotoTime: rowValues[11] || "",
             existingLineUserId: rowValues[12] || "",
             existingRequestId: rowValues[13] ? String(rowValues[13]).trim() : ""
           };
        }
      } catch (e) {
        console.error("checkExistingStatus error:", e);
      }
      return null;
    }

    updateSheetRecordAndLog(data, rowIdNum, gpsStatus, photoStatus, existing, photoFileId, districtId = "") {
      const isComplete = data.isDone === 'true' || data.isDone === true;
      if (!isComplete) {
        return { success: false, message: "完了実績の取消は許可されていません。" };
      }
      const timestamp = Date.now();
      const completedAt = Utilities.formatDate(new Date(timestamp), "JST", "yyyy/MM/dd HH:mm:ss");

      let finalGpsStatus = gpsStatus;

      let latNum = existing ? existing.existingLat : "";
      let lngNum = existing ? existing.existingLng : "";
      let gpsTimestamp = existing ? existing.existingGpsTime : "";

      let pFileId = existing ? existing.existingFileId : "";
      let pUrl = existing ? existing.existingPhotoUrl : "";
      let pTimestamp = existing ? existing.existingPhotoTime : "";

      if (isComplete && gpsStatus !== "OK") {
         const latTemp = Number(data.latitude);
         const lngTemp = Number(data.longitude);
         const isValidGps = typeof data.latitude !== "undefined" && data.latitude !== null && data.latitude !== "" &&
                            typeof data.longitude !== "undefined" && data.longitude !== null && data.longitude !== "" &&
                            Number.isFinite(latTemp) && Number.isFinite(lngTemp) &&
                            latTemp >= 20.0 && latTemp <= 46.0 &&
                            lngTemp >= 122.0 && lngTemp <= 154.0;

         if (isValidGps) {
           finalGpsStatus = "OK";
           latNum = Number(latTemp);
           lngNum = Number(lngTemp);
           gpsTimestamp = completedAt;
         } else {
           finalGpsStatus = "NO";
         }
      } else if (existing && existing.gpsStatus === "OK") {
         finalGpsStatus = "OK";
      }

      if (isComplete && photoStatus === "OK" && photoFileId) {
         pFileId = photoFileId;
         pUrl = "https://drive.google.com/file/d/" + pFileId + "/view";
         pTimestamp = completedAt;
      }

      const countVal = parseFloat(data.count) || 0;
      let updateSuccess = false;
      let targetRow = existing ? existing.rowNum : null;

      try {
        const sheet = this.getDistributionSheet(districtId);
        if (sheet) {
          if (!targetRow) {
            const finder = sheet.getRange("A:A").createTextFinder(String(rowIdNum)).matchEntireCell(true);
            const cell = finder.findNext();
            if (cell) targetRow = cell.getRow();
          }
          if (targetRow) {
            const cleanLineUserId = String(data.resolvedLineUserId || data.lineUserId || (data.user && data.user.lineUserId) || "").trim();
            const cleanRequestId = data.requestId ? String(data.requestId).trim() : "";
            if (isComplete) {
              sheet.getRange(targetRow, 4, 1, 14).setValues([[
                completedAt,
                countVal,
                data.staffId || "",
                sanitizeFormula(data.staffName || ""),
                finalGpsStatus,
                photoStatus,
                latNum,
                lngNum,
                gpsTimestamp,
                pFileId,
                pUrl,
                pTimestamp,
                cleanLineUserId,
                cleanRequestId
              ]]);
              updateSuccess = true;
            }
          }
        }
      } catch(e) {
        updateSuccess = false;
        console.error("Spreadsheet write error:", e);
      }

      if (!updateSuccess) return { success: false, message: "Spreadsheet record update failed or row not found" };
      return { success: true, rowId: rowIdNum, count: countVal, gpsStatus: finalGpsStatus, photoStatus: photoStatus, photoUrl: pUrl, timestamp: completedAt };
    }
  };
  GPSRepository.instance = null;
}

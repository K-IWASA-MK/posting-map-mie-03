/**
 * Business Layer - GPS Service Module
 *
 * Domain: GPS / Photo Domain
 * Layer: Business Layer
 * Responsibility: GPS・写真保存に関する業務フロー統括、排他制御、およびシステムログ管理
 */

if (typeof GPSService === 'undefined') {
  GPSService = class GPSService {
    constructor() {
      this.repository = GPSRepository.getInstance();
    }

    static getInstance() {
      if (!GPSService.instance) {
        GPSService.instance = new GPSService();
      }
      return GPSService.instance;
    }

    updateRecordWithGPSPhoto(data, districtId = "") {
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(15000);
      } catch (e) {
        console.error("[GPSService] Lock timeout error:", e);
        return { success: false, message: "サーバーが混雑しています。時間をおいて再度お試しください。" };
      }

      try {
        console.log("[GPSService] Start processing GPS/Photo record update for staff:", data ? data.staffName : "Unknown");

        // rowId strict validation (integer >= 1)
        const rowIdNum = Number(data.rowId);
        if (!Number.isInteger(rowIdNum) || rowIdNum < 1 || String(data.rowId).trim() === "") {
           return { success: false, message: "Invalid rowId" };
        }

        const isComplete = data.isDone === 'true' || data.isDone === true;
        if (!isComplete) {
          return {
            success: false,
            code: "INVALID_OPERATION",
            message: "完了実績の取消は許可されていません。"
          };
        }

        // count strict validation (integer 0 <= count <= 10000)
        const countRaw = data ? data.count : undefined;
        const countStr = (countRaw !== undefined && countRaw !== null) ? String(countRaw).trim() : "";
        const countNum = Number(countRaw);
        if (countStr === "" || !Number.isInteger(countNum) || countNum < 0 || countNum > 10000) {
          return {
            success: false,
            code: "INVALID_COUNT",
            message: "配布枚数が不正です (0〜10,000の整数を指定してください)"
          };
        }
        data.count = countNum;

        // Step 1: timestampおよび運用モード判定
        const tsNum = Number(data.timestamp);
        if (Number.isFinite(tsNum) && tsNum > 0) {
          if (typeof SystemInfoService === 'undefined' || !SystemInfoService.getInstance) {
            throw new Error("[GPSService] SystemInfoService unavailable for operation mode resolution");
          }
          const operationMode = SystemInfoService.getInstance().getOperationMode(null, districtId);

          if (operationMode === "ELECTION") {
            // ELECTION: 月跨ぎ STALE_MONTH 判定はバイパス（同一Dataset継続利用）。契約終了遮断は最上位 API Contract Gate へ一本化。
          } else if (operationMode === "SUBSCRIPTION") {
            // SUBSCRIPTION: 既存 STALE_MONTH 契約を完全維持
            if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
              const resolver = MonthlySheetResolver.getInstance();
              const currentMonth = resolver.getCurrentMonth();
              const reqMonth = resolver.getCurrentMonth(new Date(tsNum));
              if (reqMonth !== currentMonth) {
                console.log(`[GPSService] STALE_MONTH detected: reqMonth=${reqMonth}, currentMonth=${currentMonth}`);
                return {
                  success: true,
                  accepted: false,
                  code: "STALE_MONTH",
                  message: "旧月の配布操作は当月シートに反映できません。"
                };
              }
            }
          }
        }

        // 既存行ステータス取得
        const existing = this.repository.checkExistingStatus(rowIdNum, districtId);
        let photoStatus = existing ? existing.photoStatus : "NO";
        let gpsStatus = existing ? existing.gpsStatus : "NO";
        const incomingReqId = data.requestId ? String(data.requestId).trim() : "";
        const existingReqId = existing && existing.existingRequestId ? String(existing.existingRequestId).trim() : "";

        // Step 2: requestId == Q → duplicate
        if (incomingReqId && existingReqId && incomingReqId === existingReqId) {
          console.log(`[GPSService] RowId ${rowIdNum} duplicate requestId: ${incomingReqId}`);
          return {
            success: true,
            accepted: true,
            duplicate: true,
            rowId: rowIdNum,
            count: existing.existingCount || parseFloat(data.count) || 0,
            gpsStatus: existing.gpsStatus,
            photoStatus: existing.photoStatus,
            timestamp: existing.existingCompletedAt || Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm:ss")
          };
        }

        // Step 3: D completedAtあり → alreadyCompleted（同月再配布なし、既存実績保護）
        if (isComplete && existing && existing.existingCompletedAt) {
          console.log(`[GPSService] RowId ${rowIdNum} already completed in current month. Rejecting re-completion.`);
          return {
            success: true,
            accepted: true,
            alreadyCompleted: true,
            rowId: rowIdNum,
            count: existing.existingCount || 0,
            gpsStatus: existing.gpsStatus,
            photoStatus: existing.photoStatus,
            timestamp: existing.existingCompletedAt
          };
        }

        let photoFileId = "";
        const hasValidPhotoData = typeof data.photoData === "string" && data.photoData.startsWith("data:image");

        // photoData check
        if (isComplete && hasValidPhotoData && photoStatus !== "OK") {
          console.log("[GPSService] Uploading photo to Google Drive...");
          let photoRes = null;
          try {
            photoRes = this.repository.savePhotoToDrive(data, rowIdNum, districtId);
          } catch (photoErr) {
            console.error("[GPSService] Photo upload failed:", photoErr);
            return {
              success: false,
              code: "INTERNAL_ERROR",
              errorType: "TRANSIENT",
              retryable: true,
              message: "写真の保存に失敗しました。時間をおいて再送します。"
            };
          }
          if (!photoRes || photoRes.success !== true) {
            console.error("[GPSService] Photo upload failed: savePhotoToDrive returned non-success");
            return {
              success: false,
              code: "INTERNAL_ERROR",
              errorType: "TRANSIENT",
              retryable: true,
              message: "写真の保存に失敗しました。時間をおいて再送します。"
            };
          }
          photoStatus = "OK";
          photoFileId = photoRes.fileId || "";
        }

        console.log("[GPSService] Updating Spreadsheet record...");
        const result = this.repository.updateSheetRecordAndLog(data, rowIdNum, gpsStatus, photoStatus, existing, photoFileId, districtId);

        return result;
      } catch (e) {
        console.error("[GPSService] Error processing updateRecordWithGPSPhoto:", e);
        return { success: false, message: e.toString() };
      } finally {
        lock.releaseLock();
      }
    }
  };
  GPSService.instance = null;
}

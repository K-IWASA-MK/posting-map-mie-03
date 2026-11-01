/**
 * GAS v2 - バッチ処理モジュール
 * - Drive写真自動整理・保管管理
 * - PinStatus 日次クリーンアップ
 * - トリガー管理
 *
 * ※ 旧世代の個別エリアシート生成(forceStartBatch, generateAreaSheetsBatch)および
 *    旧月末全消去方式(checkEndOfMonthAndReset)は、DistrictProvisioner への全面移行に伴い完全撤去されました。
 */

// =============================================
// ① トリガー共通管理
// =============================================

function deleteTriggers(name) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === name) ScriptApp.deleteTrigger(t);
  });
}

// =============================================
// ② Drive写真 自動整理バッチ
// - 90日超: /evidence → /archive へ移動
// - 180日超: /archive 内ファイルをゴミ箱へ
// =============================================

/**
 * Googleドライブの証拠写真を自動整理する（単一地区用コア処理）。
 * @param {string} [districtId=""] - 対象地区コード
 */
function cleanupDrivePhotosForDistrict(districtId = "") {
  let parentFolderId = null;
  try {
    parentFolderId = getStorageFolderId(districtId);
  } catch (eId) {
    console.error(`cleanupDrivePhotos: getStorageFolderId failed for district "${districtId}":`, eId);
    return;
  }
  if (!parentFolderId) {
    console.error(`cleanupDrivePhotos: parent folder ID not found for district "${districtId}".`);
    return;
  }

  let parentFolder;
  try {
    parentFolder = DriveApp.getFolderById(parentFolderId);
  } catch (e) {
    console.error(`cleanupDrivePhotos: parent folder not found for district "${districtId}":`, e);
    return;
  }

  const now = new Date();
  const MS_90_DAYS  = 90  * 24 * 60 * 60 * 1000;
  const MS_180_DAYS = 180 * 24 * 60 * 60 * 1000;

  // --- /evidence フォルダを取得 ---
  const evidenceFolders = parentFolder.getFoldersByName("evidence");
  if (evidenceFolders.hasNext()) {
    const evidenceFolder = evidenceFolders.next();

    // /archive フォルダを取得または作成
    const archiveFolders = parentFolder.getFoldersByName("archive");
    let archiveFolder;
    if (archiveFolders.hasNext()) {
      archiveFolder = archiveFolders.next();
    } else {
      archiveFolder = parentFolder.createFolder("archive");
    }

    // 90日以上経過したファイルを /archive へ移動
    const evidenceFiles = evidenceFolder.getFiles();
    let movedCount = 0;
    while (evidenceFiles.hasNext()) {
      const file = evidenceFiles.next();
      const age = now - file.getDateCreated();
      if (age > MS_90_DAYS) {
        file.moveTo(archiveFolder);
        movedCount++;
      }
    }
    if (movedCount > 0) {
      console.log(`cleanupDrivePhotos [${districtId || "DEFAULT"}]: ${movedCount} files moved to /archive`);
    }
  }

  // --- /archive フォルダを取得 ---
  const archiveFolders2 = parentFolder.getFoldersByName("archive");
  if (archiveFolders2.hasNext()) {
    const archiveFolder = archiveFolders2.next();

    // 180日以上経過したファイルをゴミ箱へ
    const archiveFiles = archiveFolder.getFiles();
    let deletedCount = 0;
    while (archiveFiles.hasNext()) {
      const file = archiveFiles.next();
      const age = now - file.getDateCreated();
      if (age > MS_180_DAYS) {
        file.setTrashed(true);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`cleanupDrivePhotos [${districtId || "DEFAULT"}]: ${deletedCount} files trashed from /archive`);
    }
  }
}

/**
 * Googleドライブの証拠写真を自動整理する（Trigger Entry Point）。
 * setupCleanupTrigger() で毎日深夜2時に自動実行される。
 */
function cleanupDrivePhotos() {
  cleanupDrivePhotosForDistrict("");
}

/**
 * cleanupDrivePhotos の時間主導型トリガーを設定する。
 * GASエディタから手動で1回だけ実行すること。
 * 既存トリガーを削除してから新規作成するため、重複しない。
 */
function setupCleanupTrigger() {
  deleteTriggers("cleanupDrivePhotos");
  ScriptApp.newTrigger("cleanupDrivePhotos")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  console.log("cleanupDrivePhotos trigger set: daily at 2:00 AM JST");
}

/**
 * 30日経過写真の自動削除バッチ（単一地区用コア処理）。
 * @param {string} [districtId=""] - 対象地区コード
 */
function cleanupOldPhotosForDistrict(districtId = "") {
  let folderId = null;
  try {
    folderId = (typeof getStorageFolderId === 'function') ? getStorageFolderId(districtId) : null;
  } catch (eId) {
    console.error(`cleanupOldPhotosBatch: getStorageFolderId failed for district "${districtId}":`, eId);
    return;
  }
  if (!folderId) {
    console.error(`cleanupOldPhotosBatch: Storage folder not found for district "${districtId}".`);
    return;
  }

  try {
    const folder = DriveApp.getFolderById(folderId);
    const now = new Date();
    const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

    // 写真専用フォルダ直下のファイルのみを走査
    const files = folder.getFiles();
    let trashedCount = 0;
    while (files.hasNext()) {
      const file = files.next();
      const age = now - file.getDateCreated();
      if (age > MS_30_DAYS && !file.isTrashed()) {
        file.setTrashed(true);
        trashedCount++;
      }
    }

    console.log(`cleanupOldPhotosBatch [${districtId || "DEFAULT"}]: ${trashedCount} old photos moved to trash.`);
  } catch(e) {
    console.error(`cleanupOldPhotosBatch error for district "${districtId}":`, e);
  }
}

/**
 * C-5 Field Result Sync Foundation
 * 30日経過写真の自動削除バッチ（Trigger Entry Point）。
 */
function cleanupOldPhotosBatch() {
  cleanupOldPhotosForDistrict("");
}

/**
 * 30日削除バッチの時間主導型トリガーを設定する
 */
function setupPhotoCleanupTrigger() {
  // 既存の同名トリガーがあれば削除（二重作成防止）
  deleteTriggers("cleanupOldPhotosBatch");
  ScriptApp.newTrigger("cleanupOldPhotosBatch")
    .timeBased()
    .everyDays(1)
    .atHour(3) // 3 AM JST
    .create();
  console.log("cleanupOldPhotosBatch trigger set: daily at 3:00 AM JST");
}

// =============================================
// ③ PinStatus 日次クリーンアップ
// =============================================

/**
 * PinStatus 日次クリーンアップ（単一地区用コア処理）。
 * 指定地区の当月 PinStatus シートに残存した IN_PROGRESS データを全件クリアする。
 * 配布実績シートを含む他シートには一切アクセス・変更しない。
 * @param {string} [districtId=""] - 対象地区コード
 */
function cleanupPinStatusForDistrict(districtId = "") {
  try {
    let pinSheet = null;
    if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
      pinSheet = MonthlySheetResolver.getInstance().getCurrentSheet("pin", districtId);
    }
    if (!pinSheet) {
      console.log(`cleanupPinStatusDaily [${districtId || "DEFAULT"}]: PinStatus sheet does not exist. Nothing to clear.`);
      return;
    }

    const lr = pinSheet.getLastRow();
    if (lr <= 1) {
      console.log(`cleanupPinStatusDaily [${districtId || "DEFAULT"}]: PinStatus sheet has no data rows. Nothing to clear.`);
      return;
    }

    const lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      try {
        pinSheet.deleteRows(2, lr - 1);
        SpreadsheetApp.flush();
        console.log(`cleanupPinStatusDaily [${districtId || "DEFAULT"}]: PinStatus cleared successfully (${lr - 1} rows cleared, header preserved).`);
      } finally {
        lock.releaseLock();
      }
    } else {
      console.warn(`cleanupPinStatusDaily [${districtId || "DEFAULT"}]: Could not obtain lock.`);
    }
  } catch (e) {
    console.error(`cleanupPinStatusDaily error for district "${districtId}": ` + e.toString());
  }
}

/**
 * PinStatus 日次クリーンアップ（Trigger Entry Point）。
 * 毎日0:00頃の時間主導型トリガーから実行。
 */
function cleanupPinStatusDaily() {
  cleanupPinStatusForDistrict("");
}

/**
 * PinStatus 日次クリーンアップの時間主導型トリガーを設定する
 * 既存の同名トリガーを削除してから新規登録（多重登録防止）
 * 毎日 0:00 (午前0時〜1時) に1回実行
 */
function setupPinStatusCleanupTrigger() {
  deleteTriggers("cleanupPinStatusDaily");
  ScriptApp.newTrigger("cleanupPinStatusDaily")
    .timeBased()
    .everyDays(1)
    .atHour(0) // 0:00 AM JST
    .create();
  console.log("cleanupPinStatusDaily trigger set: daily at 0:00 AM JST");
}

/**
 * 名簿シートのヘッダーおよびスキーマを安全に保証する（既存スタッフ行は完全保全）
 * (原本への依存・原本再生成は完全撤廃)
 * @param {string} [districtId=""] - 対象地区コード
 */
function setupRosterSheet(districtId = "") {
  const cleanDistrictId = String(districtId || "").trim().toUpperCase();
  const ss = (typeof getSS === 'function') ? getSS(cleanDistrictId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (!ss) return "Spreadsheet not available";

  const headers = [["ID", "名前", "LINE_USER_ID", "登録日時"]];
  let sheet = null;
  if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
    sheet = MonthlySheetResolver.getInstance().getCurrentSheet("staff", cleanDistrictId);
  }
  if (!sheet) {
    const resolver = (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) ? MonthlySheetResolver.getInstance() : null;
    const sheetName = resolver ? resolver.getSheetName("staff", new Date(), cleanDistrictId) : "名簿";
    sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, 4).setValues(headers);
      sheet.getRange("A1:D1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
      sheet.setFrozenRows(1);
      return `名簿シート「${sheetName}」を新規作成しました。`;
    }
  }

  // 既存シートのヘッダー確認・補完のみ（既存データ行は絶対に消去しない）
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lc < 4 || lr < 1) {
    sheet.getRange(1, 1, 1, 4).setValues(headers);
    sheet.getRange("A1:D1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return `名簿シート「${sheet.getName()}」のスキーマを検証・保全しました（既存${Math.max(0, lr - 1)}件維持）。`;
}

/**
 * 日次トリガーから実行される月次判定・自動生成関数
 * (M-02: v2_ui.js から移設)
 */
function rolloverMonthlySheetsDailyCheck(nowOverride = null, options = {}, districtId = "") {
  if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
    const provisioner = DistrictProvisioner.getInstance();
    const isDateObj = (v) => Boolean(v && typeof v.getTime === 'function' && !isNaN(v.getTime()));
    const now = isDateObj(nowOverride)
      ? nowOverride
      : (options && isDateObj(options.now) ? options.now : new Date());

    const resolveMonthStr = (d) => {
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        return MonthlySheetResolver.getInstance().getCurrentMonth(d);
      }
      if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
        return Utilities.formatDate(d, "JST", "yyyy-MM");
      }
      const jstDate = new Date(d.getTime() + (9 * 60 * 60 * 1000));
      const y = jstDate.getUTCFullYear();
      const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    };

    const currentMonth = resolveMonthStr(now);
    const currentRes = provisioner.rolloverMonthlySheets(currentMonth, options, districtId);

    // JST基準で翌日(now + 24h)が翌月となる月末日(10/31, 11/30等)は、翌月5シートを先行生成する
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextMonth = resolveMonthStr(tomorrow);
    if (nextMonth !== currentMonth && currentRes && currentRes.success === true) {
      return provisioner.rolloverMonthlySheets(nextMonth, options, districtId);
    }
    return currentRes;
  }
}

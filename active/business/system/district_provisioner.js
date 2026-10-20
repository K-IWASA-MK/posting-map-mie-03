/**
 * POSTING MAP - District Provisioner (Generation 2)
 * 責務: 新地区作成時のDual Lifecycle (ELECTION / SUBSCRIPTION) 運用5シート一括直接生成、および月替わり自動生成
 * 
 * 【厳格な制約】
 * 1. 責務は「運用5シート直接生成」「CSVエリア展開」「月次トリガー管理」のみ。
 * 2. MonthlySheetResolverとは完全に責務分離する（Resolverは参照解決SSOT、Provisionerが生成SSOT）。
 * 3. 前月シートは一切削除せず、履歴として保持する。
 * 4. SYSTEM_INFOは月次化対象外・固定保護。
 * 5. 地区名・自治体名・件数はコードにハードコードせず、CSVおよびSpreadsheetから動的に決定する。
 */
(function(global) {
  class DistrictProvisioner {
    constructor() {
      this.prefixes = {
        distribution: "配布実績",
        staff: "名簿",
        flyer: "保有チラシ枚数",
        transfer: "受渡要請履歴",
        pin: "PinStatus"
      };
    }

    static getInstance() {
      if (!DistrictProvisioner.instance) {
        DistrictProvisioner.instance = new DistrictProvisioner();
      }
      return DistrictProvisioner.instance;
    }

    getSS(districtId = "") {
      const cleanDistrictId = String(districtId || "").trim().toUpperCase();
      if (typeof getSS === 'function') {
        return getSS(cleanDistrictId);
      } else if (typeof SpreadsheetApp !== 'undefined' && typeof SpreadsheetApp.getActiveSpreadsheet === 'function') {
        return SpreadsheetApp.getActiveSpreadsheet();
      }
      throw new Error("SpreadsheetApp is unavailable");
    }

    /**
     * 新地区作成時の一括プロビジョニング
     * address_master.csv のデータを受け取り、運用5種を一括直接生成する
     * 
     * @param {Array<Object>} addresses - CSVからパースしたエリア配列 [{ rowId, cityName, townName }, ...]
     * @param {Object} [options={}] - オプション（provisioningToken, targetSpreadsheetId 等）
     * @param {string} [districtId=""] - 対象地区コード
     * @return {Object} 結果オブジェクト { success: true, count: number, month: string }
     */
    provisionNewDistrict(addresses, options = {}, districtId = "") {
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return {
          success: false,
          code: "INVALID_ARGUMENT",
          message: "addresses must be a non-empty array of address master records."
        };
      }

      // 運用モードの検証（明示Mode SSOT: ELECTION / SUBSCRIPTION のみ許可、未指定・不正は生成前停止）
      const rawMode = options && options.operationMode !== undefined && options.operationMode !== null
        ? String(options.operationMode).trim().toUpperCase()
        : "";
      if (rawMode !== 'ELECTION' && rawMode !== 'SUBSCRIPTION') {
        return {
          success: false,
          code: "INVALID_ARGUMENT",
          message: "operationMode must be explicitly specified as either 'ELECTION' or 'SUBSCRIPTION'."
        };
      }
      const operationMode = rawMode;

      const token = options && options.provisioningToken;
      const tokenCheck = typeof verifyProvisioningToken === 'function'
        ? verifyProvisioningToken(token)
        : { success: false, code: "UNAUTHORIZED", message: "verifyProvisioningToken unavailable" };
      if (!tokenCheck.success) {
        return tokenCheck;
      }

      const cleanDistrictId = String(districtId || (options && options.districtId) || "").trim().toUpperCase();

      let ss = null;
      if (options && options.spreadsheet) {
        ss = options.spreadsheet;
      } else if (options && (options.targetSpreadsheetId || options.spreadsheetId)) {
        const explicitId = String(options.targetSpreadsheetId || options.spreadsheetId).trim();
        if (explicitId && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.openById) {
          ss = SpreadsheetApp.openById(explicitId);
        }
      } else {
        ss = this.getSS(cleanDistrictId);
      }

      if (!ss) {
        throw new Error(`[DistrictProvisioner] Target spreadsheet cannot be resolved for district "${cleanDistrictId}".`);
      }

      const districtName = (ss.getName() || '').trim();
      const invalidNames = [
        '無題のスプレッドシート',
        '無題',
        'untitled spreadsheet',
        'untitled',
        '新規スプレッドシート',
        'スプレッドシート'
      ];
      const lowerName = districtName.toLowerCase();
      const isInvalidName = !districtName ||
        invalidNames.some(inv => lowerName === inv || lowerName.startsWith('copy of') || lowerName.startsWith('のコピー'));

      if (isInvalidName) {
        return {
          success: false,
          code: "INVALID_DISTRICT_NAME",
          message: `Spreadsheet name "${districtName}" is invalid. Please rename your spreadsheet to the target district code (e.g. <TARGET_DISTRICT_CODE>) before provisioning.`
        };
      }

      // Provisioning Integrity Guard: 要求地区コードとスプレッドシート名の照合（指定時）
      if (cleanDistrictId && districtName) {
        const cleanName = districtName.toUpperCase();
        if (!cleanName.includes(cleanDistrictId) && !cleanDistrictId.includes(cleanName)) {
          console.warn(`[DistrictProvisioner] Warning: districtId "${cleanDistrictId}" differs from spreadsheet name "${districtName}".`);
        }
      }

      // 内部伝播用に options.spreadsheet をセット
      options.spreadsheet = ss;

      const lock = LockService.getScriptLock();
      lock.waitLock(30000);

      try {
        const existingSysSheet = ss.getSheetByName("SYSTEM_INFO");
        if (options && options.skipSystemInfo === true && !existingSysSheet) {
          throw new Error(`[DistrictProvisioner] SYSTEM_INFO sheet is required when skipSystemInfo is true (Fail-Closed).`);
        }
        if (existingSysSheet && cleanDistrictId) {
          const sysLr = existingSysSheet.getLastRow();
          const sysLc = existingSysSheet.getLastColumn();
          if (sysLr >= 1 && sysLc >= 2) {
            const sysRows = existingSysSheet.getRange(1, 1, sysLr, 2).getValues();
            for (let i = 0; i < sysRows.length; i++) {
              if (String(sysRows[i][0] || "").trim() === "地区コード") {
                const existingCode = String(sysRows[i][1] || "").trim().toUpperCase();
                if (existingCode && existingCode !== "TEMPLATE" && existingCode !== cleanDistrictId) {
                  throw new Error(`[DistrictProvisioner] DISTRICT_MISMATCH: Spreadsheet district code "${existingCode}" does not match target district "${cleanDistrictId}".`);
                }
                break;
              }
            }
          }
        }

        const provisioningNow = (options && options.provisioningNow instanceof Date) ? options.provisioningNow : new Date();
        let jstIso = "";
        let currentMonthStr = "";
        if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
          jstIso = Utilities.formatDate(provisioningNow, "JST", "yyyy-MM-dd HH:mm:ss");
          currentMonthStr = Utilities.formatDate(provisioningNow, "JST", "yyyy-MM");
        } else {
          const jst = new Date(provisioningNow.getTime() + (9 * 60 * 60 * 1000));
          jstIso = jst.toISOString().replace('T', ' ').slice(0, 19);
          currentMonthStr = jst.toISOString().slice(0, 7);
        }

        // Active Dataset Key / 契約開始日時: 単一 provisioningNow から一意に確定（caller options による上書き禁止）
        // ただし skipSystemInfo === true（既存 SYSTEM_INFO 保護経路）かつ SYSTEM_INFO に既存の Active Dataset Key がある場合はそれを維持
        let activeDatasetKey = currentMonthStr;
        if (options && options.skipSystemInfo === true && existingSysSheet) {
          const sysLr = existingSysSheet.getLastRow();
          const sysLc = existingSysSheet.getLastColumn();
          if (sysLr >= 1 && sysLc >= 2) {
            const sysRows = existingSysSheet.getRange(1, 1, sysLr, 2).getValues();
            for (let i = 0; i < sysRows.length; i++) {
              if (String(sysRows[i][0] || "").trim() === "Active Dataset Key") {
                const rawKey = sysRows[i][1];
                if (rawKey instanceof Date) {
                  activeDatasetKey = (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function')
                    ? Utilities.formatDate(rawKey, "JST", "yyyy-MM")
                    : rawKey.toISOString().slice(0, 7);
                } else {
                  const strKey = String(rawKey || "").trim();
                  if (strKey) activeDatasetKey = strKey;
                }
                break;
              }
            }
          }
        }

        options.operationMode = operationMode;
        options.activeDatasetKey = activeDatasetKey;
        options.contractStartDate = jstIso;

        // 0. 事前ヘッダー契約検証 (非 SYSTEM_INFO シートで Row 2+ にデータがあるのに Row 1 ヘッダーが空欄の場合は mutation 0 で停止)
        this.validateExistingSheetHeaders(ss);

        // 1. 実運用5シートを直接生成 (All-or-Nothing, 5/5 存在時は No-op 維持)
        const datasetResult = this.createOperationalDataset(ss, activeDatasetKey, addresses);

        // 1b. 新地区 District Initialization 一括初期化 (SYSTEM_INFO 対象外、配布実績<Active> A:C同期+D以降&余剰行クリア、他全シート Row 2+ クリア)
        this.initializeDistrictSheets(ss, activeDatasetKey, addresses, datasetResult);

        // 2. SYSTEM_INFO 同期（5シート生成成功後に ACTIVE 化）
        let sysInfoResult = null;
        if (options && options.skipSystemInfo === true) {
          sysInfoResult = {
            success: true,
            sheetName: 'SYSTEM_INFO',
            districtName: cleanDistrictId || districtName,
            skipped: true
          };
        } else {
          sysInfoResult = (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance)
            ? SystemInfoService.getInstance().syncSystemInfo(options, cleanDistrictId)
            : this.createOrSyncSystemInfo(ss, options);
        }

        // 1地区用 Core のみを呼出し、既存他地区の PinStatus に一切触れない（他地区 Pin mutation 0 保証）
        if (typeof cleanupPinStatusForDistrict === 'function') {
          cleanupPinStatusForDistrict(cleanDistrictId);
        } else if (typeof cleanupPinStatusDaily === 'function') {
          cleanupPinStatusDaily();
        }

        if (typeof setupPinStatusCleanupTrigger === 'function') {
          setupPinStatusCleanupTrigger();
        }
        this.setupMonthlyTrigger();

        SpreadsheetApp.flush();

        const types = ['distribution', 'staff', 'flyer', 'transfer', 'pin'];
        const monthlySheets = types.map(t => `${this.prefixes[t]}${activeDatasetKey}`);

        const allSheets = [
          "SYSTEM_INFO",
          ...monthlySheets
        ];

        return {
          success: true,
          message: `District provisioned successfully in ${operationMode} mode.`,
          districtName: (sysInfoResult && sysInfoResult.districtName) || districtName,
          operationMode: operationMode,
          activeDatasetKey: activeDatasetKey,
          sheets: allSheets,
          totalSheetsCount: allSheets.length,
          count: Array.isArray(addresses) ? addresses.length : 0,
          month: activeDatasetKey,
          triggersConfigured: true,
          dailyCleanupExecuted: true,
          skipSystemInfo: !!(options && options.skipSystemInfo === true)
        };
      } finally {
        lock.releaseLock();
      }
    }

    /**
     * 公式空データベーステンプレートの自動生成
     * コピー元Spreadsheetから不要シート削除・データクリア・SYSTEM_INFO初期化を行い、
     * 指定されたマスター保管フォルダへ POSTING_MAP_EMPTY_TEMPLATE を生成する
     *
     * @param {string} sourceSpreadsheetId - コピー元Spreadsheet ID（非ハードコード）
     * @param {string} targetFolderId - 格納先フォルダID
     * @param {Object} options - オプション（provisioningToken等）
     * @return {Object} 結果オブジェクト { success: boolean, templateId: string, templateUrl: string, sheets: Array }
     */
    createEmptyTemplate(sourceSpreadsheetId, targetFolderId, options) {
      if (!sourceSpreadsheetId) {
        return { success: false, code: "INVALID_ARGUMENT", message: "sourceSpreadsheetId is required." };
      }
      if (!targetFolderId) {
        return { success: false, code: "INVALID_ARGUMENT", message: "targetFolderId is required." };
      }

      const token = options && options.provisioningToken;
      const tokenCheck = typeof verifyProvisioningToken === 'function'
        ? verifyProvisioningToken(token)
        : { success: false, code: "UNAUTHORIZED", message: "verifyProvisioningToken unavailable" };
      if (!tokenCheck.success) {
        return tokenCheck;
      }

      const lock = LockService.getScriptLock();
      lock.waitLock(30000);

      try {
        const folder = DriveApp.getFolderById(targetFolderId);
        const sourceFile = DriveApp.getFileById(sourceSpreadsheetId);
        const templateName = "POSTING_MAP_EMPTY_TEMPLATE";

        const existingFiles = folder.getFilesByName(templateName);
        while (existingFiles.hasNext()) {
          const oldFile = existingFiles.next();
          oldFile.setTrashed(true);
        }

        const newFile = sourceFile.makeCopy(templateName, folder);
        const newSS = SpreadsheetApp.openById(newFile.getId());

        const keepSheetNames = [
          "SYSTEM_INFO",
          "端末管理"
        ];

        const allCurrentSheets = newSS.getSheets();
        allCurrentSheets.forEach(sheet => {
          const sName = sheet.getName();
          if (!keepSheetNames.includes(sName)) {
            newSS.deleteSheet(sheet);
          }
        });

        const sysSheet = newSS.getSheetByName("SYSTEM_INFO");
        if (sysSheet) {
          const lr = sysSheet.getLastRow();
          if (lr >= 2) {
            sysSheet.getRange(2, 2, lr - 1, 1).clearContent();
          }
        }

        SpreadsheetApp.flush();

        const finalSheets = newSS.getSheets().map(s => ({
          name: s.getName(),
          lastRow: s.getLastRow(),
          lastColumn: s.getLastColumn(),
          dataRows: Math.max(0, s.getLastRow() - 1)
        }));

        return {
          success: true,
          message: "POSTING_MAP_EMPTY_TEMPLATE created successfully.",
          templateId: newFile.getId(),
          templateUrl: newFile.getUrl(),
          targetFolderId: targetFolderId,
          sourceSpreadsheetId: sourceSpreadsheetId,
          sheetsCount: finalSheets.length,
          sheets: finalSheets
        };
      } finally {
        lock.releaseLock();
      }
    }

    /**
     * 03_BRANCH 配下の地区物理構造を解決または自動生成する (Server-side Deterministic Resolution)
     *
     * @param {string} districtId - 地区コード (例: "SAMPLE_DISTRICT")
     * @return {Object} { districtFolderId, storageFolderId, sourceArchiveFolderId }
     */
    resolveOrCreateDistrictDriveStructure(districtId) {
      const cleanDistrictId = String(districtId || "").trim().toUpperCase();
      if (!cleanDistrictId) {
        throw new Error("[DistrictProvisioner] districtId is required for drive resolution.");
      }

      const props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      const branchRootId = props ? props.getProperty("BRANCH_ROOT_FOLDER_ID") : null;
      if (!branchRootId) {
        throw new Error("[DistrictProvisioner] BRANCH_ROOT_FOLDER_ID is not configured in Script Properties.");
      }

      if (typeof DriveApp === 'undefined' || !DriveApp.getFolderById) {
        throw new Error("[DistrictProvisioner] DriveApp is unavailable for drive resolution.");
      }

      const branchFolder = DriveApp.getFolderById(branchRootId);
      if (!branchFolder) {
        throw new Error(`[DistrictProvisioner] 03_BRANCH root folder "${branchRootId}" cannot be opened.`);
      }

      // 1. 03_BRANCH/{districtId} フォルダの検索または作成
      const districtFolders = branchFolder.getFoldersByName(cleanDistrictId);
      let districtFolder = null;
      let count = 0;
      while (districtFolders.hasNext()) {
        districtFolder = districtFolders.next();
        count++;
      }
      if (count > 1) {
        throw new Error(`[DistrictProvisioner] AMBIGUOUS_DISTRICT_FOLDER: Multiple folders named "${cleanDistrictId}" found in 03_BRANCH.`);
      }
      if (!districtFolder) {
        districtFolder = branchFolder.createFolder(cleanDistrictId);
      }
      const districtFolderId = districtFolder.getId();

      // 2. {districtId} 支部_STORAGE フォルダの検索または作成
      const storageName = `${cleanDistrictId} 支部_STORAGE`;
      const storageFolders = districtFolder.getFoldersByName(storageName);
      let storageFolder = null;
      let sCount = 0;
      while (storageFolders.hasNext()) {
        storageFolder = storageFolders.next();
        sCount++;
      }
      if (sCount > 1) {
        throw new Error(`[DistrictProvisioner] AMBIGUOUS_STORAGE_FOLDER: Multiple folders named "${storageName}" found in district folder.`);
      }
      if (!storageFolder) {
        storageFolder = districtFolder.createFolder(storageName);
      }
      const storageFolderId = storageFolder.getId();

      // 3. SOURCE_ARCHIVE フォルダの検索または作成
      const archiveName = "SOURCE_ARCHIVE";
      const archiveFolders = districtFolder.getFoldersByName(archiveName);
      let archiveFolder = null;
      let aCount = 0;
      while (archiveFolders.hasNext()) {
        archiveFolder = archiveFolders.next();
        aCount++;
      }
      if (aCount > 1) {
        throw new Error(`[DistrictProvisioner] AMBIGUOUS_SOURCE_ARCHIVE: Multiple folders named "${archiveName}" found in district folder.`);
      }
      if (!archiveFolder) {
        archiveFolder = districtFolder.createFolder(archiveName);
      }
      const sourceArchiveFolderId = archiveFolder.getId();

      return {
        districtFolderId: String(districtFolderId).trim(),
        storageFolderId: String(storageFolderId).trim(),
        sourceArchiveFolderId: String(sourceArchiveFolderId).trim()
      };
    }

    /**
     * 公式空テンプレートから新地区スプレッドシートDBを複製・生成
     *
     * @param {string} templateSpreadsheetId - 複製元EMPTY TEMPLATE ID
     * @param {string} [targetDistrictName] - 新地区名 (Optional Assertion: 導出名と検証)
     * @param {string} [targetFolderId] - 格納先フォルダID (Optional Assertion: 導出IDと検証)
     * @param {Object} [options={}] - オプション（provisioningToken, districtId 等）
     * @return {Object} 結果オブジェクト { success, spreadsheetId, spreadsheetUrl, districtName, targetFolderId, sheetsCount, sheets }
     */
    createDistrictDatabase(templateSpreadsheetId, targetDistrictName, targetFolderId, options = {}) {
      if (!templateSpreadsheetId) {
        return { success: false, code: "INVALID_ARGUMENT", message: "templateSpreadsheetId is required." };
      }

      const opts = options || {};
      const rawId = (opts && opts.districtId) || targetDistrictName || '';
      const cleanDistrictId = String(rawId).replace(/^POSTING_MAP_DB_/i, '').trim().toUpperCase();
      if (!cleanDistrictId) {
        return { success: false, code: "INVALID_ARGUMENT", message: "districtId is required." };
      }
      const canonicalDbName = cleanDistrictId;

      const token = opts && opts.provisioningToken;
      const tokenCheck = typeof verifyProvisioningToken === 'function'
        ? verifyProvisioningToken(token)
        : { success: false, code: "UNAUTHORIZED", message: "verifyProvisioningToken unavailable" };
      if (!tokenCheck.success) {
        return tokenCheck;
      }

      // Server-side Deterministic Resolution: 03_BRANCH 配下から districtFolder を解決
      let driveStructure;
      try {
        driveStructure = this.resolveOrCreateDistrictDriveStructure(cleanDistrictId);
      } catch (errDrive) {
        return {
          success: false,
          code: "DRIVE_RESOLUTION_FAILED",
          message: errDrive.message
        };
      }
      const resolvedFolderId = driveStructure.districtFolderId;

      // Legacy parameter assertions (Optional Assertion Only)
      if (targetFolderId && String(targetFolderId).trim() !== resolvedFolderId) {
        return {
          success: false,
          code: "FOLDER_MISMATCH",
          message: `Specified targetFolderId "${targetFolderId}" does not match canonical district folder "${resolvedFolderId}". Caller cannot override drive layout.`
        };
      }

      if (targetDistrictName) {
        const cleanTargetName = String(targetDistrictName).trim();
        if (cleanTargetName !== canonicalDbName && cleanTargetName.toUpperCase() !== cleanDistrictId) {
          return {
            success: false,
            code: "INVALID_DISTRICT_NAME",
            message: `Specified targetDistrictName "${targetDistrictName}" does not match canonical DB name "${canonicalDbName}". Caller cannot choose arbitrary name.`
          };
        }
      }

      const lock = LockService.getScriptLock();
      lock.waitLock(30000);

      try {
        const folder = DriveApp.getFolderById(resolvedFolderId);
        const templateFile = DriveApp.getFileById(templateSpreadsheetId);

        // 既存 DB 自動破壊（trash）の完全抑止 & 重複検査
        const existingFiles = folder.getFilesByName(canonicalDbName);
        let existingCount = 0;
        while (existingFiles.hasNext()) {
          existingFiles.next();
          existingCount++;
        }

        if (existingCount === 1) {
          return {
            success: false,
            code: "DISTRICT_DB_ALREADY_EXISTS",
            message: `Canonical database "${canonicalDbName}" already exists in district folder "${resolvedFolderId}". Automatic overwrite/trash is strictly prohibited.`
          };
        }

        if (existingCount >= 2) {
          return {
            success: false,
            code: "AMBIGUOUS_DISTRICT_DB",
            message: `Multiple databases named "${canonicalDbName}" exist in district folder "${resolvedFolderId}".`
          };
        }

        // EMPTY TEMPLATE から複製し canonicalDbName を設定
        const newFile = templateFile.makeCopy(canonicalDbName, folder);
        const newSS = SpreadsheetApp.openById(newFile.getId());

        SpreadsheetApp.flush();

        const finalSheets = newSS.getSheets().map(s => ({
          name: s.getName(),
          lastRow: s.getLastRow(),
          lastColumn: s.getLastColumn(),
          dataRows: Math.max(0, s.getLastRow() - 1)
        }));

        return {
          success: true,
          message: `District database "${canonicalDbName}" created successfully from template.`,
          spreadsheetId: newFile.getId(),
          spreadsheetUrl: newFile.getUrl(),
          districtName: canonicalDbName,
          targetFolderId: resolvedFolderId,
          canonicalStorageFolderId: driveStructure.storageFolderId,
          canonicalSourceArchiveFolderId: driveStructure.sourceArchiveFolderId,
          templateSpreadsheetId: templateSpreadsheetId,
          sheetsCount: finalSheets.length,
          sheets: finalSheets
        };
      } finally {
        lock.releaseLock();
      }
    }

    createOrSyncSystemInfo(ss, options) {
      if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
        return SystemInfoService.getInstance().syncSystemInfo(options);
      }
      const opts = options || {};
      const sheetName = "SYSTEM_INFO";
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }

      const districtName = ss.getName();
      const baseUrl = String(opts.baseUrl || opts.hAppUrl || "").trim().replace(/\/+$/, '');
      const hAppUrl = baseUrl ? `${baseUrl}/` : "";
      const dashboardUrl = baseUrl ? `${baseUrl}/active/manager/` : "";

      let liffUrl = opts.productionLiffUrl || "";
      let liffId = opts.liffId || "";
      if (!liffId && liffUrl) {
        const match = String(liffUrl).match(/liff\.line\.me\/([^/?#]+)/i);
        if (match && match[1]) {
          liffId = match[1];
        }
      }
      if (!liffId && typeof PropertiesService !== 'undefined') {
        try {
          const props = PropertiesService.getScriptProperties();
          liffId = props.getProperty("LINE_LIFF_ID") || props.getProperty("LIFF_ID") || "";
          if (liffId && !liffUrl) {
            liffUrl = `https://liff.line.me/${liffId}`;
          }
        } catch (e) {}
      }

      let managerPassword = opts.managerPassword || "";
      if (!managerPassword && sheet) {
        try {
          const lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            const data = sheet.getRange(1, 1, lastRow, 2).getValues();
            for (let i = 0; i < data.length; i++) {
              if (data[i][0] === "Manager認証パスワード" && data[i][1]) {
                managerPassword = String(data[i][1]).trim();
                break;
              }
            }
          }
        } catch (e) {}
      }
      if (!managerPassword) {
        managerPassword = String(Math.floor(100000 + Math.random() * 900000));
      }

      let contractEndDate = opts.contractEndDate || "";
      if (!contractEndDate && sheet) {
        try {
          const lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            const data = sheet.getRange(1, 1, lastRow, 2).getValues();
            for (let i = 0; i < data.length; i++) {
              if (data[i][0] === "契約終了日" && data[i][1]) {
                const val = data[i][1];
                if (val instanceof Date) {
                  if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
                    contractEndDate = Utilities.formatDate(val, "JST", "yyyy-MM-dd");
                  } else {
                    const jst = new Date(val.getTime() + (9 * 60 * 60 * 1000));
                    contractEndDate = jst.toISOString().slice(0, 10);
                  }
                } else {
                  contractEndDate = String(val).trim().replace(/\//g, '-');
                }
                break;
              }
            }
          }
        } catch (e) {}
      }

      const headers = [["項目", "内容"]];
      const rows = [
        ["地区コード", districtName],
        ["地区名", districtName],
        ["HアプリURL", hAppUrl],
        ["Dashboard URL", dashboardUrl],
        ["LIFFアプリ名", `POSTING MAP ${districtName}`],
        ["LIFF ID", liffId],
        ["LIFF URL", liffUrl],
        ["Endpoint URL", hAppUrl],
        ["Manager認証パスワード", managerPassword],
        ["状態", "ACTIVE"],
        ["契約終了日", contractEndDate]
      ];

      const currentLr = sheet.getLastRow();
      if (currentLr >= 2) {
        sheet.getRange(2, 1, currentLr - 1, 2).clearContent();
      }

      sheet.getRange(1, 1, 1, 2).setValues(headers);
      sheet.getRange("A1:B1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
      sheet.getRange(2, 1, rows.length, 2).setValues(rows);
      sheet.getRange(`A2:A${rows.length + 1}`).setFontWeight("bold");
      sheet.setFrozenRows(1);

      return {
        success: true,
        sheet: sheetName,
        districtName: districtName,
        rowCount: rows.length
      };
    }

    /**
     * SYSTEM_INFO の「HアプリURL」から address_master.csv を取得してパースする
     * URL推測およびEndpoint URL代替は絶対禁止 (Fail-Closed)
     */
    loadDistrictAddresses(districtId = "", targetSs = null) {
      const cleanDistrictId = String(districtId || "").trim().toUpperCase();
      let ss = targetSs;
      if (!ss) {
        ss = this.getSS(cleanDistrictId);
      }
      if (!ss) {
        throw new Error(`[DistrictProvisioner] Spreadsheet cannot be resolved for loading address_master.csv (district: "${cleanDistrictId}").`);
      }

      const sysSheet = ss.getSheetByName('SYSTEM_INFO');
      if (!sysSheet) {
        throw new Error(`[DistrictProvisioner] SYSTEM_INFO sheet is missing for loading address_master.csv (district: "${cleanDistrictId}").`);
      }

      if (typeof SystemInfoService === 'undefined' || !SystemInfoService.getInstance) {
        throw new Error("[DistrictProvisioner] SystemInfoService unavailable for HアプリURL resolution.");
      }

      // SYSTEM_INFO["HアプリURL"] だけを唯一の Base URL authority とする (Fail-Closed)
      const baseUrl = SystemInfoService.getInstance().getHAppUrl(sysSheet, cleanDistrictId);
      if (!baseUrl) {
        throw new Error(`[DistrictProvisioner] Base URL cannot be determined: HアプリURL is missing in SYSTEM_INFO.`);
      }

      const csvUrl = `${baseUrl.replace(/\/+$/, '')}/data/address_master.csv`;
      console.log(`[DistrictProvisioner] Loading address master from: ${csvUrl}`);

      let csvText = "";
      if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
        const resp = UrlFetchApp.fetch(csvUrl, { muteHttpExceptions: true });
        if (resp.getResponseCode() !== 200) {
          throw new Error(`Failed to fetch address_master.csv from ${csvUrl}: HTTP ${resp.getResponseCode()}`);
        }
        csvText = resp.getContentText();
      } else {
        throw new Error("UrlFetchApp is unavailable to load address_master.csv");
      }

      const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length <= 1) {
        throw new Error(`address_master.csv at ${csvUrl} is empty or contains only header.`);
      }

      const header = lines[0].split(',').map(h => h.trim());
      const rowIdIdx = header.indexOf('rowId');
      const cityIdx = header.indexOf('cityName');
      const townIdx = header.indexOf('townName');

      const addresses = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length >= 3) {
          addresses.push({
            rowId: rowIdIdx >= 0 ? Number(cols[rowIdIdx]) : i,
            cityName: cityIdx >= 0 ? cols[cityIdx] : cols[1],
            townName: townIdx >= 0 ? cols[townIdx] : cols[2]
          });
        }
      }
      return addresses;
    }

    /**
     * 実運用5シート（配布実績, 名簿, 保有チラシ枚数, 受渡要請履歴, PinStatus）を直接生成する
     * All-or-Nothing 物理的補償削除（Compensating Rollback）を保証
     */
    createOperationalDataset(ss, datasetKey, addresses) {
      if (!ss) throw new Error("Spreadsheet is required for createOperationalDataset");
      if (!datasetKey) throw new Error("datasetKey is required for createOperationalDataset");
      if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error("addresses must be a non-empty array for createOperationalDataset");
      }

      const types = ['distribution', 'staff', 'flyer', 'transfer', 'pin'];
      const targetSheetNames = types.map(t => `${this.prefixes[t]}${datasetKey}`);

      // 1. 事前存在検証 (0/5, 5/5, 1〜4/5)
      const existing = [];
      const missing = [];
      targetSheetNames.forEach(name => {
        if (ss.getSheetByName(name)) {
          existing.push(name);
        } else {
          missing.push(name);
        }
      });

      if (existing.length === 5) {
        return {
          success: true,
          datasetKey: datasetKey,
          created: [],
          noop: true
        };
      }

      if (existing.length > 0 && existing.length < 5) {
        throw new Error(`[DistrictProvisioner] Partial dataset sheets detected (${existing.length}/5) for ${datasetKey}: ${existing.join(', ')}. Aborting creation to prevent silent corruption.`);
      }

      // 0/5: 生成開始。生成したシート名を記録し、失敗時に補償削除
      const createdInThisRun = [];
      try {
        // ① 配布実績 (17列)
        const distName = `${this.prefixes.distribution}${datasetKey}`;
        const distSheet = ss.insertSheet(distName);
        createdInThisRun.push(distSheet);

        const distHeaders = [
          ["ID", "市町村", "町域", "配布完了日時", "配布枚数", "担当者ID", "担当者名", "GPS", "写真", "緯度", "経度", "GPS日時", "写真ファイルID", "写真URL", "写真日時", "lineUserId", "requestId"]
        ];
        distSheet.getRange(1, 1, 1, 17).setValues(distHeaders);
        distSheet.getRange("A1:Q1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        distSheet.setFrozenRows(1);

        const distRows = addresses.map((addr, idx) => {
          const rowId = addr.rowId !== undefined ? addr.rowId : (idx + 1);
          const city = addr.cityName || addr.city_name || "";
          const town = addr.townName || addr.town_name || "";
          return [rowId, city, town, "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
        });
        distSheet.getRange(2, 1, distRows.length, 17).setValues(distRows);

        // ② 名簿 (4列)
        const staffName = `${this.prefixes.staff}${datasetKey}`;
        const staffSheet = ss.insertSheet(staffName);
        createdInThisRun.push(staffSheet);
        const staffHeaders = [["ID", "名前", "LINE_USER_ID", "登録日時"]];
        staffSheet.getRange(1, 1, 1, 4).setValues(staffHeaders);
        staffSheet.getRange("A1:D1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        staffSheet.setFrozenRows(1);

        // ③ 保有チラシ枚数 (7列)
        const flyerName = `${this.prefixes.flyer}${datasetKey}`;
        const flyerSheet = ss.insertSheet(flyerName);
        createdInThisRun.push(flyerSheet);
        const flyerHeaders = [["ID", "担当者ID", "担当者名", "保管場所", "保有枚数", "最終更新日時", "lineUserId"]];
        flyerSheet.getRange(1, 1, 1, 7).setValues(flyerHeaders);
        flyerSheet.getRange("A1:G1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        flyerSheet.setFrozenRows(1);

        // ④ 受渡要請履歴 (14列)
        const transferName = `${this.prefixes.transfer}${datasetKey}`;
        const transferSheet = ss.insertSheet(transferName);
        createdInThisRun.push(transferSheet);
        const transferHeaders = [["日時", "要請者", "要請者ID", "保管者", "保管者ID", "連絡方法", "連絡先", "状態", "requestId", "LINE送信状態", "LINE HTTP status", "LINE送信日時", "requesterLineUserId", "holderLineUserId"]];
        transferSheet.getRange(1, 1, 1, 14).setValues(transferHeaders);
        transferSheet.getRange("A1:N1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        transferSheet.setFrozenRows(1);

        // ⑤ PinStatus (2列)
        const pinName = `${this.prefixes.pin}${datasetKey}`;
        const pinSheet = ss.insertSheet(pinName);
        createdInThisRun.push(pinSheet);
        const pinHeaders = [["rowId", "status"]];
        pinSheet.getRange(1, 1, 1, 2).setValues(pinHeaders);
        pinSheet.getRange("A1:B1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        pinSheet.setFrozenRows(1);

        SpreadsheetApp.flush();

        return {
          success: true,
          datasetKey: datasetKey,
          created: targetSheetNames
        };
      } catch (err) {
        // 補償ロールバック: 今回作成したシートのみを削除して 0/5 へ巻き戻す
        console.error(`[DistrictProvisioner] Error during createOperationalDataset for ${datasetKey}. Rolling back newly created sheets:`, err);
        createdInThisRun.forEach(s => {
          try {
            ss.deleteSheet(s);
          } catch (delErr) {
            console.error(`[DistrictProvisioner] Failed to rollback sheet ${s.getName()}:`, delErr);
          }
        });
        SpreadsheetApp.flush();
        throw err;
      }
    }

    /**
     * 非 SYSTEM_INFO シートの Row 1 ヘッダー契約検証 (書込前 Fail-Closed)
     * Row 2+ にデータがあるにもかかわらず Row 1 ヘッダーが全空欄の異常シートが存在する場合は mutation 0 で停止する
     */
    validateExistingSheetHeaders(ss) {
      if (!ss || typeof ss.getSheets !== "function") return;
      const sheets = ss.getSheets();
      for (let i = 0; i < sheets.length; i++) {
        const s = sheets[i];
        const sName = s.getName();
        if (sName === "SYSTEM_INFO") continue;
        const lr = s.getLastRow();
        const lc = s.getLastColumn();
        if (lr >= 2) {
          const headerRow = s.getRange(1, 1, 1, Math.max(lc, 1)).getValues()[0];
          const hasHeader = Array.isArray(headerRow) && headerRow.some(v => v !== "" && v !== null && v !== undefined);
          if (!hasHeader) {
            throw new Error(`[DistrictProvisioner] INVALID_SHEET_HEADER_CONTRACT: Sheet "${sName}" has data in Row 2+ without a valid Row 1 header.`);
          }
        }
      }
    }

    /**
     * 新地区 District Initialization における全シート一括初期化
     * - SYSTEM_INFO: Sanitization 対象外 (mutation = 0)
     * - 配布実績<Active Dataset Key>: Row 1維持 / A:C = 新地区Master / D列以降クリア / N超過余剰行クリア
     * - その他すべての既存シート (非Active過月 配布実績* を含む): Row 1維持 / Row 2+ クリア
     */
    initializeDistrictSheets(ss, activeDatasetKey, addresses, datasetResult) {
      if (!ss || typeof ss.getSheets !== "function") return;
      const activeDistName = `${this.prefixes.distribution}${activeDatasetKey}`;
      const sheets = ss.getSheets();
      const masterRows = addresses.map((addr, idx) => {
        const rowId = addr.rowId !== undefined ? addr.rowId : (idx + 1);
        const city = addr.cityName || addr.city_name || "";
        const town = addr.townName || addr.town_name || "";
        return [rowId, city, town];
      });
      const targetRowCount = masterRows.length;

      for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        const sheetName = sheet.getName();

        // 1. SYSTEM_INFO -> Sanitization 対象外 (mutation = 0)
        if (sheetName === "SYSTEM_INFO") {
          continue;
        }

        // 2. 配布実績<Active Dataset Key>
        if (sheetName === activeDistName) {
          if (datasetResult && datasetResult.noop === true) {
            const oldLastRow = sheet.getLastRow();
            const oldLastCol = sheet.getLastColumn();

            // D列以降 (Col 4..oldLastCol) の既存実績データを clearContent() で全クリア
            if (oldLastRow >= 2 && oldLastCol >= 4) {
              sheet.getRange(2, 4, oldLastRow - 1, oldLastCol - 3).clearContent();
            }

            // 新地区 N 件を超える旧余剰行 (Row N+2..oldLastRow) の A:C を clearContent() で全クリア
            if (oldLastRow > targetRowCount + 1) {
              const surplusRows = oldLastRow - (targetRowCount + 1);
              sheet.getRange(targetRowCount + 2, 1, surplusRows, 3).clearContent();
            }

            // A2:C(N+1) に新地区 address_master を投入
            if (targetRowCount > 0) {
              sheet.getRange(2, 1, targetRowCount, 3).setValues(masterRows);
            }
          }
          continue;
        }

        // 3. その他すべての既存シート (非Active過月 配布実績* を含む): Row 1維持, Row 2+ clearContent()
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        if (lastRow >= 2 && lastCol >= 1) {
          sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
        }
      }
    }

    /**
     * SUBSCRIPTION モードにおける月次ロールオーバー自動生成
     * 過去月シートは履歴として保持し、絶対に削除しない。
     * 
     * 状態機械（State Machine）:
     * - 0/5 存在: CSV共通パイプラインから新規月として直接生成
     * - 5/5 存在: 完全 No-op（書込・クリア・既存ヘッダー補完の全API呼出が0回）
     * - 1〜4/5 存在: Fail-Closed 即時停止（PARTIAL_MONTHLY_SHEETS_CORRUPTION、mutation 0）
     * 
     * @param {string} [targetMonth] - 生成対象年月 (YYYY-MM)。未指定時は現在月。
     * @param {Object} [options] - オプション
     * @param {string} [districtId=""] - 対象地区コード
     * @return {Object} 結果 { success: boolean, month: string, created: string[], noop?: boolean, code?: string, mode?: string }
     */
    rolloverMonthlySheets(targetMonth, options = {}, districtId = "") {
      const cleanDistrictId = String(districtId || (options && options.districtId) || "").trim().toUpperCase();
      let ss = null;
      if (options && options.spreadsheet) {
        ss = options.spreadsheet;
      } else if (options && (options.targetSpreadsheetId || options.spreadsheetId)) {
        const explicitId = String(options.targetSpreadsheetId || options.spreadsheetId).trim();
        if (explicitId && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.openById) {
          ss = SpreadsheetApp.openById(explicitId);
        }
      } else {
        ss = this.getSS(cleanDistrictId);
      }

      if (!ss) {
        throw new Error(`[DistrictProvisioner] Target spreadsheet cannot be resolved for district "${cleanDistrictId}".`);
      }

      // 排他Lock取得（0/5 scan 〜 生成を確実に排他保護）
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);

      try {
        // 0. 運用モードの解決 (Fail-Closed, fallbackなし)
        const sysSheet = ss.getSheetByName("SYSTEM_INFO");
        if (!sysSheet) {
          return {
            success: false,
            code: "SYSTEM_INFO_MISSING",
            message: `SYSTEM_INFO sheet is missing for district "${cleanDistrictId}" (mutation 0 Fail-Closed).`
          };
        }
        if (typeof SystemInfoService === 'undefined' || !SystemInfoService.getInstance) {
          return {
            success: false,
            code: "SYSTEM_INFO_SERVICE_UNAVAILABLE",
            message: "SystemInfoService is unavailable (mutation 0 Fail-Closed)."
          };
        }

        let operationMode = "";
        try {
          operationMode = SystemInfoService.getInstance().getOperationMode(sysSheet);
        } catch (e) {
          return {
            success: false,
            code: "OPERATION_MODE_RESOLUTION_FAILED",
            message: `Failed to resolve operation mode: ${e.message} (mutation 0 Fail-Closed).`
          };
        }

        // ELECTION モード: 月次ロールオーバーは完全 No-op (mutation 0)
        if (operationMode === "ELECTION") {
          console.log(`[DistrictProvisioner] ELECTION mode detected for district "${cleanDistrictId}". Monthly rollover skipped (mutation 0).`);
          return {
            success: true,
            month: targetMonth || "",
            created: [],
            noop: true,
            mode: "ELECTION"
          };
        }

        if (operationMode !== "SUBSCRIPTION") {
          return {
            success: false,
            code: "INVALID_OPERATION_MODE",
            message: `Unsupported operation mode "${operationMode}" for monthly rollover (mutation 0 Fail-Closed).`
          };
        }

        const month = targetMonth || (
          typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance
            ? MonthlySheetResolver.getInstance().getCurrentMonth()
            : (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function' ? Utilities.formatDate(new Date(), "JST", "yyyy-MM") : new Date().toISOString().slice(0, 7))
        );

        const types = ['distribution', 'staff', 'flyer', 'transfer', 'pin'];
        const existingMonthlySheets = [];
        const missingMonthlySheets = [];

        // 1. 事前存在判定（mutation 0 の状態で全5シートを走査）
        types.forEach(type => {
          const monthlyName = `${this.prefixes[type]}${month}`;
          const sheet = ss.getSheetByName(monthlyName);
          if (sheet) {
            existingMonthlySheets.push(monthlyName);
          } else {
            missingMonthlySheets.push(monthlyName);
          }
        });

        const existingCount = existingMonthlySheets.length;

        // 2. 5/5 の場合: 完全 No-op（書込API呼出そのものが0回）
        if (existingCount === 5) {
          return {
            success: true,
            month: month,
            created: [],
            noop: true,
            mode: "SUBSCRIPTION"
          };
        }

        // 3. 1〜4/5 の場合: Fail-Closed で即時停止（mutation 0）
        if (existingCount > 0 && existingCount < 5) {
          return {
            success: false,
            code: "PARTIAL_MONTHLY_SHEETS_CORRUPTION",
            message: `Partial monthly sheets detected (${existingCount}/5) for ${month}. Missing: ${missingMonthlySheets.join(', ')}. Existing: ${existingMonthlySheets.join(', ')}. Provisioning halted to prevent silent corruption.`,
            month: month,
            existingSheets: existingMonthlySheets,
            missingSheets: missingMonthlySheets,
            created: [],
            mode: "SUBSCRIPTION"
          };
        }

        // 4. 0/5 の場合: 新規月として直接生成 (All-or-Nothing, CSV取得失敗時はFail-Closed)
        let addresses = (options && options.addresses) || null;
        if (!Array.isArray(addresses) || addresses.length === 0) {
          try {
            addresses = this.loadDistrictAddresses(cleanDistrictId, ss);
          } catch (eCsv) {
            // CSV取得失敗時は mutation 0 で Fail-Closed
            return {
              success: false,
              code: "CSV_LOAD_FAILED",
              message: `Failed to load address master CSV for rollover: ${eCsv.message} (mutation 0 Fail-Closed).`,
              month: month,
              created: [],
              mode: "SUBSCRIPTION"
            };
          }
        }

        const datasetRes = this.createOperationalDataset(ss, month, addresses);
        return {
          success: true,
          month: month,
          created: datasetRes.created,
          mode: "SUBSCRIPTION"
        };
      } finally {
        lock.releaseLock();
      }
    }

    /**
     * 毎月1日 0:00 JST に rolloverMonthlySheets を実行する時間主導型トリガーを設定
     */
    setupMonthlyTrigger() {
      if (typeof deleteTriggers === 'function') {
        deleteTriggers("rolloverMonthlySheetsDailyCheck");
      }
      ScriptApp.newTrigger("rolloverMonthlySheetsDailyCheck")
        .timeBased()
        .everyDays(1)
        .atHour(0)
        .create();
      console.log("rolloverMonthlySheetsDailyCheck trigger set: daily at 0:00 AM JST");
    }
  }

  DistrictProvisioner.instance = null;
  global.DistrictProvisioner = DistrictProvisioner;
})(this);

/**
 * POSTING MAP - System Info Service
 * SYSTEM_INFO を実態から再生成する SSOT 同期サービス。
 */
(function(global) {
  class SystemInfoService {
    static getInstance() {
      if (!SystemInfoService.instance) {
        SystemInfoService.instance = new SystemInfoService();
      }
      return SystemInfoService.instance;
    }

    getSS(districtId = "") {
      if (typeof getSS === 'function') return getSS(districtId);
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
        return SpreadsheetApp.getActiveSpreadsheet();
      }
      throw new Error('Active spreadsheet unavailable');
    }

    getConfigProperty(key) {
      try {
        return PropertiesService.getScriptProperties().getProperty(key) || '';
      } catch (e) {
        return '';
      }
    }

    getLiffConfig(options, existingSheet) {
      const opts = options || {};
      let liffUrl = opts.productionLiffUrl || opts.liffUrl || this.getConfigProperty('PRODUCTION_LIFF_URL') || this.getConfigProperty('LINE_LIFF_URL') || '';
      let liffId = opts.liffId || this.getConfigProperty('LINE_LIFF_ID') || this.getConfigProperty('LIFF_ID') || '';

      if ((!liffUrl || !liffId) && existingSheet) {
        try {
          const lastRow = existingSheet.getLastRow();
          if (lastRow > 1) {
            const data = existingSheet.getRange(1, 1, lastRow, 2).getValues();
            for (let i = 0; i < data.length; i++) {
              const row = data[i];
              if (row[0] === 'LIFF URL' && row[1] && !liffUrl) liffUrl = String(row[1]).trim();
              if (row[0] === 'LIFF ID' && row[1] && !liffId) liffId = String(row[1]).trim();
            }
          }
        } catch (e) {}
      }

      if (!liffId && liffUrl) {
        const match = String(liffUrl).match(/liff\.line\.me\/([^/?#]+)/i);
        if (match && match[1]) {
          liffId = match[1];
        }
      }

      if (opts.productionLiffUrl || opts.liffUrl) {
        try {
          const props = PropertiesService.getScriptProperties();
          if (props) {
            if (liffUrl) props.setProperty('PRODUCTION_LIFF_URL', liffUrl);
            if (liffId) props.setProperty('LINE_LIFF_ID', liffId);
          }
        } catch (e) {}
      }

      return { url: liffUrl, id: liffId };
    }

    generateRandomPin() {
      return String(Math.floor(100000 + Math.random() * 900000));
    }

    getManagerPassword(existingSheet) {
      if (!existingSheet) return this.generateRandomPin();
      try {
        const lastRow = existingSheet.getLastRow();
        if (lastRow > 1) {
          const data = existingSheet.getRange(1, 1, lastRow, 2).getValues();
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row[0] === 'Manager認証パスワード' && row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '') {
              return String(row[1]).trim();
            }
          }
        }
      } catch (e) {}
      return this.generateRandomPin();
    }

    verifyManagerPassword(inputPassword, districtId = "") {
      if (!inputPassword || typeof inputPassword !== 'string' || !inputPassword.trim()) {
        return { success: false, message: '認証コードを入力してください' };
      }
      if (typeof LockService === 'undefined' || typeof LockService.getScriptLock !== 'function' ||
          typeof PropertiesService === 'undefined' || typeof PropertiesService.getScriptProperties !== 'function') {
        return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証保護サービスが利用できません' };
      }
      let lock = null;
      let lockAcquired = false;
      try {
        lock = LockService.getScriptLock();
        if (!lock || typeof lock.waitLock !== 'function') {
          return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証ロックを取得できません' };
        }
        const waitRes = lock.waitLock(10000);
        if (waitRes === false) {
          return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証処理が混雑しています。しばらく待ってから再試行してください' };
        }
        lockAcquired = true;
      } catch (lockErr) {
        return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証ロックの取得に失敗しました' };
      }

      try {
        const props = PropertiesService.getScriptProperties();
        if (!props || typeof props.getProperty !== 'function' || typeof props.setProperty !== 'function') {
          return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証状態ストレージが利用できません' };
        }

        const ss = this.getSS(districtId);
        const districtName = ss.getName();
        const sheet = ss.getSheetByName('SYSTEM_INFO');
        if (!sheet) {
          return { success: false, message: 'SYSTEM_INFO が初期化されていません' };
        }
        let storedPassword = '';
        let sheetDistrictCode = '';
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          const data = sheet.getRange(1, 1, lastRow, 2).getValues();
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const key = String(row[0] || '').trim();
            if (key === 'Manager認証パスワード') {
              storedPassword = String(row[1] || '').trim();
            } else if (key === '地区コード') {
              sheetDistrictCode = String(row[1] || '').trim();
            }
          }
        }

        const cleanDistrictId = String(districtId || sheetDistrictCode || this.getConfigProperty('DISTRICT_ID') || '').trim().toUpperCase();
        if (!cleanDistrictId) {
          return { success: false, code: 'MISSING_DISTRICT_ID', message: '地区識別子が特定できません' };
        }
        const guardKey = `PIN_AUTH_GUARD_${cleanDistrictId}`;
        const now = Date.now();
        const WINDOW_MS = 15 * 60 * 1000;

        let guardState = { failCount: 0, lastFailedAt: 0, cooldownUntil: 0 };
        const rawState = props.getProperty(guardKey);
        if (rawState) {
          try {
            const parsed = JSON.parse(rawState);
            if (parsed && typeof parsed === 'object') {
              guardState = {
                failCount: Number(parsed.failCount) || 0,
                lastFailedAt: Number(parsed.lastFailedAt) || 0,
                cooldownUntil: Number(parsed.cooldownUntil) || 0
              };
            }
          } catch (parseErr) {
            return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証保護状態の検証に失敗しました' };
          }
        }

        if (guardState.cooldownUntil > now) {
          const retryAfterSeconds = Math.max(1, Math.ceil((guardState.cooldownUntil - now) / 1000));
          return {
            success: false,
            code: 'PIN_COOLDOWN',
            retryAfterSeconds: retryAfterSeconds,
            message: `試行回数が上限を超えました。${retryAfterSeconds}秒後に再試行してください`
          };
        }

        if (!storedPassword) {
          return {
            success: false,
            code: 'PIN_NOT_CONFIGURED',
            message: 'Manager認証パスワードが設定されていません'
          };
        }

        if (inputPassword.trim() === storedPassword) {
          if (rawState) {
            props.setProperty(guardKey, '');
            if (typeof props.deleteProperty === 'function') {
              props.deleteProperty(guardKey);
            }
          }
          const session = (typeof createDashboardSession === 'function')
            ? createDashboardSession(districtName)
            : { token: 'pms_dash_' + Date.now(), expiresAt: Date.now() + 21600000, districtId: districtName };
          return {
            success: true,
            districtCode: districtName,
            dashboardSessionToken: session.token,
            expiresAt: session.expiresAt
          };
        } else {
          const isWindowExpired = !guardState.lastFailedAt || (now - guardState.lastFailedAt > WINDOW_MS);
          const baseFailCount = isWindowExpired ? 0 : guardState.failCount;
          const nextFailCount = baseFailCount + 1;
          let cooldownMs = 0;
          if (nextFailCount === 4) {
            cooldownMs = 5000;
          } else if (nextFailCount === 5) {
            cooldownMs = 15000;
          } else if (nextFailCount === 6) {
            cooldownMs = 30000;
          } else if (nextFailCount >= 7) {
            cooldownMs = 60000;
          }
          const nextState = {
            failCount: nextFailCount,
            lastFailedAt: now,
            cooldownUntil: cooldownMs > 0 ? (now + cooldownMs) : 0
          };
          props.setProperty(guardKey, JSON.stringify(nextState));
          return { success: false, code: "UNAUTHORIZED", message: '認証コードが正しくありません' };
        }
      } catch (err) {
        return { success: false, code: 'AUTH_GUARD_UNAVAILABLE', message: '認証処理中にエラーが発生しました: ' + err.message };
      } finally {
        if (lockAcquired && lock && typeof lock.releaseLock === 'function') {
          try {
            lock.releaseLock();
          } catch (releaseErr) {}
        }
      }
    }

    getContractCacheKey(districtId = "") {
      const cleanDistrict = String(districtId || "").trim().toUpperCase() || "__DEFAULT__";
      return `CONTRACT_STATUS_${cleanDistrict}`;
    }

    invalidateContractCache(districtId = "") {
      try {
        if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
          const cache = CacheService.getScriptCache();
          if (cache) {
            cache.remove(this.getContractCacheKey(districtId));
            cache.remove(this.getContractCacheKey(""));
            cache.remove("CONTRACT_STATUS___DEFAULT__");
          }
        }
      } catch (e) {
        console.warn("[SystemInfoService] Cache invalidation warning:", e);
      }
    }

    getContractEndDate(existingSheet, districtId = "") {
      const s = existingSheet || (this.getSS(districtId) ? this.getSS(districtId).getSheetByName('SYSTEM_INFO') : null);
      if (!s) {
        throw new Error('SYSTEM_INFO sheet unavailable');
      }
      const lr = s.getLastRow();
      if (lr < 2) {
        throw new Error('SYSTEM_INFO sheet has no data rows');
      }
      const data = s.getRange(1, 1, lr, 2).getValues();
      let foundRow = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === '契約終了日') {
          foundRow = true;
          const val = data[i][1];
          if (val instanceof Date) {
            if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
              return Utilities.formatDate(val, "JST", "yyyy-MM-dd");
            }
            const jst = new Date(val.getTime() + (9 * 60 * 60 * 1000));
            return jst.toISOString().slice(0, 10);
          }
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return String(val).trim().replace(/\//g, '-');
          }
          return '';
        }
      }
      if (!foundRow) {
        throw new Error('契約終了日 row missing in SYSTEM_INFO');
      }
      return '';
    }

    getContractEndDateFromData(data) {
      if (!Array.isArray(data) || data.length < 2) {
        throw new Error('SYSTEM_INFO data has no data rows or invalid format');
      }
      let foundRow = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === '契約終了日') {
          foundRow = true;
          const val = data[i][1];
          if (val instanceof Date) {
            if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
              return Utilities.formatDate(val, "JST", "yyyy-MM-dd");
            }
            const jst = new Date(val.getTime() + (9 * 60 * 60 * 1000));
            return jst.toISOString().slice(0, 10);
          }
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return String(val).trim().replace(/\//g, '-');
          }
          return '';
        }
      }
      if (!foundRow) {
        throw new Error('契約終了日 row missing in SYSTEM_INFO');
      }
      return '';
    }

    getOperationMode(existingSheet, districtId = "") {
      const s = existingSheet || (this.getSS(districtId) ? this.getSS(districtId).getSheetByName('SYSTEM_INFO') : null);
      if (!s) {
        throw new Error('SYSTEM_INFO sheet unavailable for operation mode resolution');
      }
      const lr = s.getLastRow();
      if (lr < 2) {
        throw new Error('SYSTEM_INFO sheet has no data rows for operation mode resolution');
      }
      const data = s.getRange(1, 1, lr, 2).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === '運用モード') {
          const val = String(data[i][1] || '').trim().toUpperCase();
          if (val === 'ELECTION' || val === 'SUBSCRIPTION') {
            return val;
          }
          throw new Error(`Invalid 運用モード "${data[i][1]}" in SYSTEM_INFO. Must be ELECTION or SUBSCRIPTION.`);
        }
      }
      throw new Error('運用モード row missing in SYSTEM_INFO');
    }

    getActiveDatasetKey(existingSheet, districtId = "") {
      const s = existingSheet || (this.getSS(districtId) ? this.getSS(districtId).getSheetByName('SYSTEM_INFO') : null);
      if (!s) {
        throw new Error('SYSTEM_INFO sheet unavailable for Active Dataset Key resolution');
      }
      const lr = s.getLastRow();
      if (lr < 2) {
        throw new Error('SYSTEM_INFO sheet has no data rows for Active Dataset Key resolution');
      }
      const data = s.getRange(1, 1, lr, 2).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === 'Active Dataset Key') {
          return String(data[i][1] || '').trim();
        }
      }
      return '';
    }

    getHAppUrl(existingSheet, districtId = "") {
      const s = existingSheet || (this.getSS(districtId) ? this.getSS(districtId).getSheetByName('SYSTEM_INFO') : null);
      if (!s) {
        throw new Error('SYSTEM_INFO sheet unavailable for HアプリURL resolution');
      }
      const lr = s.getLastRow();
      if (lr < 2) {
        throw new Error('SYSTEM_INFO sheet has no data rows for HアプリURL resolution');
      }
      const data = s.getRange(1, 1, lr, 2).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === 'HアプリURL') {
          const val = String(data[i][1] || '').trim();
          if (val) {
            return val;
          }
          throw new Error('HアプリURL is empty in SYSTEM_INFO');
        }
      }
      throw new Error('HアプリURL row missing in SYSTEM_INFO');
    }

    getContractStartDate(existingSheet, districtId = "") {
      const s = existingSheet || (this.getSS(districtId) ? this.getSS(districtId).getSheetByName('SYSTEM_INFO') : null);
      if (!s) {
        throw new Error('SYSTEM_INFO sheet unavailable for 契約開始日時 resolution');
      }
      const lr = s.getLastRow();
      if (lr < 2) {
        throw new Error('SYSTEM_INFO sheet has no data rows for 契約開始日時 resolution');
      }
      const data = s.getRange(1, 1, lr, 2).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === '契約開始日時') {
          const val = data[i][1];
          if (val instanceof Date) {
            if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
              return Utilities.formatDate(val, "JST", "yyyy-MM-dd HH:mm:ss");
            }
            const jst = new Date(val.getTime() + (9 * 60 * 60 * 1000));
            return jst.toISOString().replace('T', ' ').slice(0, 19);
          }
          return String(val || '').trim();
        }
      }
      return '';
    }

    ensureContractEndDateRow(existingSheet) {
      try {
        const s = existingSheet || (this.getSS() ? this.getSS().getSheetByName('SYSTEM_INFO') : null);
        if (!s) return;
        const lr = s.getLastRow();
        if (lr < 1) return;
        const data = s.getRange(1, 1, lr, 1).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0] === '契約終了日') {
            return;
          }
        }
        s.appendRow(['契約終了日', '']);
        if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
          SpreadsheetApp.flush();
        }
      } catch (e) {}
    }

    setContractEndDate(dateStr, districtId = "") {
      const ss = this.getSS(districtId);
      const districtName = (ss && ss.getName) ? ss.getName() : "";
      let sheet = ss.getSheetByName('SYSTEM_INFO');
      if (!sheet) sheet = ss.insertSheet('SYSTEM_INFO');

      let cleanDate = '';
      if (dateStr !== undefined && dateStr !== null) {
        cleanDate = String(dateStr).trim().replace(/\//g, '-');
      }

      const lr = sheet.getLastRow();
      let found = false;
      if (lr >= 2) {
        const data = sheet.getRange(1, 1, lr, 2).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0] === '契約終了日') {
            sheet.getRange(i + 1, 2).setValue(cleanDate);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        sheet.appendRow(['契約終了日', cleanDate]);
      }
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
        SpreadsheetApp.flush();
      }
      this.invalidateContractCache(districtName || districtId);
      return { success: true, contractEndDate: cleanDate };
    }

    getContractStatus(existingSheet, now = new Date(), districtId = "") {
      let todayStr = '';
      if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
        todayStr = Utilities.formatDate(now, "JST", "yyyy-MM-dd");
      } else {
        const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        todayStr = jst.toISOString().slice(0, 10);
      }

      // 1. existingSheet が指定されていない場合、Level 2 Cache (CacheService) を照会
      if (!existingSheet) {
        try {
          if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
            const cache = CacheService.getScriptCache();
            if (cache) {
              const cached = cache.get(this.getContractCacheKey(districtId));
              if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && typeof parsed.endDate === 'string') {
                  const isExpired = parsed.endDate ? (todayStr > parsed.endDate) : false;
                  return {
                    status: isExpired ? 'EXPIRED' : 'ACTIVE',
                    isExpired: isExpired,
                    endDate: parsed.endDate,
                    today: todayStr,
                    code: isExpired ? 'CONTRACT_EXPIRED' : 'ACTIVE',
                    fromCache: true
                  };
                }
              }
            }
          }
        } catch (cacheErr) {
          console.warn("[SystemInfoService] Contract cache read error, falling back to sheet:", cacheErr);
        }
      }

      // 2. Cache MISS または existingSheet 直接指定時: 実読込
      try {
        const endDateStr = this.getContractEndDate(existingSheet, districtId);
        const isExpired = endDateStr ? (todayStr > endDateStr) : false;
        const result = {
          status: isExpired ? 'EXPIRED' : 'ACTIVE',
          isExpired: isExpired,
          endDate: endDateStr,
          today: todayStr,
          code: isExpired ? 'CONTRACT_EXPIRED' : 'ACTIVE'
        };

        // 3. 実読込成功時: Cache 再構築 (Level 2, TTL: 6時間 = 21600秒)
        if (!existingSheet) {
          try {
            if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
              const cache = CacheService.getScriptCache();
              if (cache) {
                cache.put(this.getContractCacheKey(districtId), JSON.stringify({ endDate: endDateStr }), 21600);
              }
            }
          } catch (putErr) {
            console.warn("[SystemInfoService] Contract cache put warning:", putErr);
          }
        }

        return result;
      } catch (readErr) {
        // 4. SYSTEM_INFO 読込失敗 / シート不在 / 例外: fail-closed (安全側遮断)
        // 【ACTIVEを推定して返すfail-openは禁止】
        console.error("[SystemInfoService] FAIL-CLOSED: Contract status check failed:", readErr);
        return {
          status: 'EXPIRED',
          isExpired: true,
          endDate: '',
          today: todayStr,
          code: 'CONTRACT_CHECK_FAILED',
          message: '契約情報の検証に失敗したため安全のためアクセスを遮断しました。'
        };
      }
    }

    getContractStatusFromData(data, now = new Date(), districtId = "") {
      let todayStr = '';
      if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
        todayStr = Utilities.formatDate(now, "JST", "yyyy-MM-dd");
      } else {
        const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        todayStr = jst.toISOString().slice(0, 10);
      }

      try {
        const endDateStr = this.getContractEndDateFromData(data);
        const isExpired = endDateStr ? (todayStr > endDateStr) : false;
        return {
          status: isExpired ? 'EXPIRED' : 'ACTIVE',
          isExpired: isExpired,
          endDate: endDateStr,
          today: todayStr,
          code: isExpired ? 'CONTRACT_EXPIRED' : 'ACTIVE'
        };
      } catch (readErr) {
        console.error("[SystemInfoService] FAIL-CLOSED: Contract status check failed:", readErr);
        return {
          status: 'EXPIRED',
          isExpired: true,
          endDate: '',
          today: todayStr,
          code: 'CONTRACT_CHECK_FAILED',
          message: '契約情報の検証に失敗したため安全のためアクセスを遮断しました。'
        };
      }
    }

    syncSystemInfo(options, districtId = "") {
      const opts = options || {};
      const token = opts.provisioningToken;
      const tokenCheck = typeof verifyProvisioningToken === 'function'
        ? verifyProvisioningToken(token)
        : { success: false, code: "UNAUTHORIZED", message: "verifyProvisioningToken unavailable" };
      if (!tokenCheck.success) {
        return tokenCheck;
      }

      const cleanDistrictId = String(districtId || (opts && opts.districtId) || "").trim().toUpperCase();

      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        let ss = null;
        if (opts && opts.spreadsheet) {
          ss = opts.spreadsheet;
        } else if (opts && (opts.targetSpreadsheetId || opts.spreadsheetId)) {
          const explicitId = String(opts.targetSpreadsheetId || opts.spreadsheetId).trim();
          if (explicitId && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.openById) {
            ss = SpreadsheetApp.openById(explicitId);
          }
        } else {
          ss = this.getSS(cleanDistrictId);
        }

        if (!ss) {
          throw new Error(`[SystemInfoService] Spreadsheet cannot be resolved for district "${cleanDistrictId}".`);
        }

        const existingSheet = ss.getSheetByName('SYSTEM_INFO');

        const districtName = cleanDistrictId || ss.getName();

        // 運用モード厳格解決 (1. opts.operationMode -> 2. 既存SYSTEM_INFO -> 3. Fail-Closed)
        let operationMode = opts.operationMode;
        if (operationMode !== undefined && operationMode !== null && String(operationMode).trim() !== '') {
          operationMode = String(operationMode).trim().toUpperCase();
        } else {
          operationMode = '';
          if (existingSheet) {
            try {
              operationMode = this.getOperationMode(existingSheet, cleanDistrictId);
            } catch (e) {
              operationMode = '';
            }
          }
        }

        if (!operationMode || (operationMode !== 'ELECTION' && operationMode !== 'SUBSCRIPTION')) {
          return {
            success: false,
            code: 'INVALID_ARGUMENT',
            message: `Invalid or missing operationMode "${opts.operationMode || ''}". Must be ELECTION or SUBSCRIPTION.`
          };
        }

        // H-App URL 厳格解決 (1. opts.hAppUrl / opts.baseUrl -> 2. 既存SYSTEM_INFO -> 3. Fail-Closed)
        let rawUrl = '';
        if (opts.hAppUrl && String(opts.hAppUrl).trim()) {
          rawUrl = String(opts.hAppUrl).trim();
        } else if (opts.baseUrl && String(opts.baseUrl).trim() && opts.baseUrl !== 'https://postingmap.jp') {
          rawUrl = String(opts.baseUrl).trim();
        } else if (existingSheet) {
          try {
            rawUrl = this.getHAppUrl(existingSheet, cleanDistrictId);
          } catch (e) {
            rawUrl = '';
          }
        }

        if (!rawUrl) {
          return {
            success: false,
            code: 'INVALID_ARGUMENT',
            message: 'H-App URL must be explicitly provided via hAppUrl/baseUrl or present in SYSTEM_INFO.'
          };
        }

        const cleanBaseUrl = rawUrl.replace(/\/+$/, '');
        const hAppUrl = `${cleanBaseUrl}/`;
        const dashboardUrl = `${cleanBaseUrl}/active/manager/`;

        let contractEndDate = opts.contractEndDate !== undefined ? opts.contractEndDate : '';
        if (!contractEndDate && existingSheet) {
          try {
            contractEndDate = this.getContractEndDate(existingSheet);
          } catch (e) {
            contractEndDate = '';
          }
        }

        let activeDatasetKey = opts.activeDatasetKey !== undefined ? opts.activeDatasetKey : '';
        if (!activeDatasetKey && existingSheet) {
          try {
            activeDatasetKey = this.getActiveDatasetKey(existingSheet);
          } catch (e) {
            activeDatasetKey = '';
          }
        }

        let contractStartDate = opts.contractStartDate !== undefined ? opts.contractStartDate : '';
        if (!contractStartDate && existingSheet) {
          try {
            contractStartDate = this.getContractStartDate(existingSheet);
          } catch (e) {
            contractStartDate = '';
          }
        }

        let sheet = existingSheet;
        if (!sheet) {
          sheet = ss.insertSheet('SYSTEM_INFO');
        }

        const liff = this.getLiffConfig(opts, sheet);
        const managerPassword = opts.managerPassword || this.getManagerPassword(sheet);

        const values = [
          ['項目', '内容'],
          ['地区コード', districtName],
          ['地区名', districtName],
          ['HアプリURL', hAppUrl],
          ['Dashboard URL', dashboardUrl],
          ['LIFFアプリ名', `POSTING MAP ${districtName}`],
          ['LIFF ID', liff.id],
          ['LIFF URL', liff.url],
          ['Endpoint URL', hAppUrl],
          ['Manager認証パスワード', managerPassword],
          ['状態', 'ACTIVE'],
          ['契約終了日', contractEndDate],
          ['運用モード', operationMode],
          ['Active Dataset Key', activeDatasetKey],
          ['契約開始日時', contractStartDate]
        ];

        sheet.clear();
        const activeKeyRange = sheet.getRange(14, 2);
        if (typeof activeKeyRange.setNumberFormat === 'function') {
          activeKeyRange.setNumberFormat('@');
        }
        sheet.getRange(1, 1, values.length, 2).setValues(values);
        sheet.getRange('A1:B1').setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
        sheet.getRange(`A2:A${values.length}`).setFontWeight('bold');
        sheet.setFrozenRows(1);
        SpreadsheetApp.flush();
        this.invalidateContractCache(districtName);

        if (opts.lineChannelAccessToken && typeof opts.lineChannelAccessToken === 'string') {
          try {
            const props = PropertiesService.getScriptProperties();
            if (props) {
              props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', opts.lineChannelAccessToken.trim());
            }
          } catch (e) {}
        }
        if (opts.lineChannelId && typeof opts.lineChannelId === 'string') {
          try {
            const props = PropertiesService.getScriptProperties();
            if (props) {
              props.setProperty('LINE_CHANNEL_ID', opts.lineChannelId.trim());
            }
          } catch (e) {}
        }
        if ((opts.mapsApiKey || opts.googleMapsApiKey) && typeof (opts.mapsApiKey || opts.googleMapsApiKey) === 'string') {
          try {
            const props = PropertiesService.getScriptProperties();
            if (props) {
              const keyVal = (opts.mapsApiKey || opts.googleMapsApiKey).trim();
              if (keyVal) {
                const cleanDistrictCode = String(opts.districtId || districtName || '')
                  .replace(/^POSTING_MAP_/i, '')
                  .trim()
                  .toUpperCase();
                if (cleanDistrictCode) {
                  props.setProperty('GOOGLE_MAPS_API_KEY_' + cleanDistrictCode, keyVal);
                }
                props.setProperty('GOOGLE_MAPS_API_KEY', keyVal);
              }
            }
          } catch (e) {}
        }

        const lineConfigured = !!this.getConfigProperty('LINE_CHANNEL_ACCESS_TOKEN');

        return {
          success: true,
          sheetName: 'SYSTEM_INFO',
          districtName: districtName,
          dashboardUrl: dashboardUrl,
          hAppUrl: hAppUrl,
          endpointUrl: hAppUrl,
          liffUrl: liff.url,
          liffId: liff.id,
          lineConfigured: lineConfigured,
          status: 'ACTIVE',
          operationMode: operationMode,
          activeDatasetKey: activeDatasetKey,
          contractStartDate: contractStartDate,
          contractEndDate: contractEndDate
        };
      } finally {
        lock.releaseLock();
      }
    }

    /**
     * 新地区プロビジョニング時のMaps API Key検証ゲート (SEC-007)
     * 新規地区は地区別Key (GOOGLE_MAPS_API_KEY_<DISTRICT_ID>) が必須であり、
     * 旧共通Keyへのフォールバックを許可しない (Provisioning Gate FAIL)。
     * @param {string} districtId
     * @return {{ success: boolean, code?: string, message?: string }}
     */
    verifyProvisioningMapsKey(districtId) {
      const cleanDistrictId = String(districtId || '').trim().toUpperCase();
      if (!cleanDistrictId) {
        return {
          success: false,
          code: 'MISSING_DISTRICT_ID',
          message: 'districtId is required for provisioning Maps API key verification.'
        };
      }
      const props = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties)
        ? PropertiesService.getScriptProperties()
        : null;
      const districtKey = props ? props.getProperty('GOOGLE_MAPS_API_KEY_' + cleanDistrictId) : null;
      if (!districtKey || !districtKey.trim()) {
        return {
          success: false,
          code: 'PROVISIONING_MAPS_KEY_MISSING',
          message: `District-specific Google Maps API key "GOOGLE_MAPS_API_KEY_${cleanDistrictId}" is required for provisioning.`
        };
      }
      return {
        success: true,
        districtId: cleanDistrictId,
        mapsApiKey: districtKey.trim()
      };
    }
  }

  SystemInfoService.instance = null;
  global.SystemInfoService = SystemInfoService;
})(this);

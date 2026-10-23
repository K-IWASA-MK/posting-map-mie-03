/**
 * GAS v2 - 純粋 JSON API エンジン
 * UI(HTML)は一切返却せず、ContentService を通じて JSON のみを応答する。
 * Version: 2.2.0-modular
 */


// =============================
// ① 基本設定
// =============================

function getMonthlySheet(type) {
  if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
    return MonthlySheetResolver.getInstance().getCurrentSheet(type);
  }
  return null;
}

function computeSha256(str) {
  if (!str || typeof str !== 'string') return '';
  try {
    const rawDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
    let hexHash = '';
    for (let i = 0; i < rawDigest.length; i++) {
      let byte = rawDigest[i];
      if (byte < 0) byte += 256;
      let hex = byte.toString(16);
      if (hex.length === 1) hex = '0' + hex;
      hexHash += hex;
    }
    return hexHash;
  } catch (e) {
    return '';
  }
}

function verifyProvisioningToken(token) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, code: "UNAUTHORIZED", message: "Provisioning token is missing." };
  }
  const props = PropertiesService.getScriptProperties();
  const storedHash = (props.getProperty('PROVISIONING_TOKEN_HASH') || '').trim().toLowerCase();

  // Fail-Closed: PROVISIONING_TOKEN_HASH が Script Properties に設定されていない場合は即座に遮断
  if (!storedHash) {
    return { success: false, code: "UNAUTHORIZED", message: "PROVISIONING_TOKEN_HASH is not configured in Script Properties (Fail-Closed)." };
  }

  const clientHash = computeSha256(token.trim()).toLowerCase();

  if (clientHash === storedHash) {
    return { success: true };
  }

  return { success: false, code: "UNAUTHORIZED", message: "Invalid provisioning token for configured district." };
}

/**
 * SEC-007: 地区別 Google Maps API Key 解決ハンドラ
 * @param {string} districtId - 対象地区コード (任意・推奨)
 * @param {string} sessionToken - Dashboardセッショントークン (任意)
 * @return {Object} レスポンスオブジェクト
 */
function handleGetMapsApiKey(districtId, sessionToken) {
  const cleanDistrictId = String(districtId || '').trim().toUpperCase();
  const props = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties)
    ? PropertiesService.getScriptProperties()
    : null;

  // 1. cleanDistrictId が指定されている場合の検証
  if (cleanDistrictId) {
    // Gate 1: 明示的未知地区IDの遮断
    if (cleanDistrictId === 'UNKNOWN' || cleanDistrictId.startsWith('UNKNOWN')) {
      return {
        success: false,
        code: "DISTRICT_NOT_FOUND",
        message: `District '${cleanDistrictId}' is not valid for this district environment.`
      };
    }

    // Gate 2: Dashboard Session Binding (tokenが存在する場合)
    if (sessionToken && typeof verifyDashboardSession === 'function') {
      const dashCheck = verifyDashboardSession(sessionToken, cleanDistrictId);
      if (!dashCheck.success) {
        return {
          success: false,
          code: "UNAUTHORIZED",
          message: "Session district mismatch. Cross-district key access denied."
        };
      }
    }

    // Gate 3: Integrity Guard (DISTRICT_MISMATCH 照合)
    if (typeof SpreadsheetResolver !== 'undefined' && SpreadsheetResolver.getInstance) {
      try {
        SpreadsheetResolver.getInstance().getSpreadsheet(cleanDistrictId);
      } catch (eResolver) {
        const errStr = eResolver.toString();
        if (errStr.includes("DISTRICT_MISMATCH")) {
          return {
            success: false,
            code: "DISTRICT_MISMATCH",
            message: eResolver.message
          };
        }
      }
    }

    // Gate 4: Contract Gate (契約状態確認)
    if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
      try {
        const contract = SystemInfoService.getInstance().getContractStatus(null, new Date(), cleanDistrictId);
        if (contract && (contract.isExpired || contract.code === 'CONTRACT_EXPIRED')) {
          return {
            success: false,
            code: "CONTRACT_EXPIRED",
            message: contract.message || "契約期間が終了しているため利用できません。"
          };
        }
      } catch (eContract) {}
    }

    // Layer 2: 地区別Key探索 (最優先)
    const districtKeyProp = 'GOOGLE_MAPS_API_KEY_' + cleanDistrictId;
    const districtKey = props ? props.getProperty(districtKeyProp) : null;
    if (districtKey && districtKey.trim()) {
      return {
        success: true,
        districtId: cleanDistrictId,
        mapsApiKey: districtKey.trim(),
        isFallback: false
      };
    }
  }

  // 2. districtId 未指定時 or 地区別Key未設定時の Phase 1 Legacy Fallback
  const legacyKey = props ? props.getProperty('GOOGLE_MAPS_API_KEY') : null;
  if (legacyKey && legacyKey.trim()) {
    return {
      success: true,
      districtId: cleanDistrictId || '',
      mapsApiKey: legacyKey.trim(),
      isFallback: true
    };
  }

  // 3. Key未設定 (地区別Keyも旧Keyも存在しない)
  return {
    success: false,
    code: cleanDistrictId ? "MAPS_KEY_NOT_CONFIGURED" : "MISSING_DISTRICT_ID",
    message: cleanDistrictId
      ? `Google Maps API Key is not configured for district '${cleanDistrictId}'.`
      : "districtId is required to resolve Google Maps API Key."
  };
}





/**
 * GETリクエスト：JSONデータの取得
 */
function doGet(e) {
  isWebAppCall = true;
  let params = (e && e.parameter) ? Object.assign({}, e.parameter) : {};

  if (params.json) {
    try {
      const parsed = typeof params.json === 'string' ? JSON.parse(params.json) : params.json;
      if (parsed && typeof parsed === 'object') {
        Object.assign(params, parsed);
      }
    } catch (errJ) {}
  }
  if (e) {
    e.parameter = params;
  }

  if (params.liffToken || params.dashboardSessionToken || params.managerSessionToken) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Token transmission via GET is prohibited."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const action = params.action || "";

  if (action === 'healSchemaHeaders' || action === 'runIdentityMigration' || action === 'syncSystemInfo' || action === 'resetRoster') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "METHOD_NOT_ALLOWED",
      message: `${action} requires POST request.`
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const isPublicAction = [
    'getMapsApiKey',
    'getTier1',
    'registerOrValidateDevice',
    'getDeviceStatus',
    'verifyManagerPassword'
  ].includes(action);

  const isDashboardOnlyAction = [
    'getRoster',
    'getTransferRequests',
    'getDashboardSnapshot',
    'getSystemInfo'
  ].includes(action);

  const isDualAuthAction = [
    'getSystemSummary',
    'getDashboardData',
    'getRanking',
    'getFlyerStock',
    'getLatestDistribution',
    'getDeliveryStats',
    'getAreaDetails',
    'getGlobalPinStatus',
    'getBulletinPosts'
  ].includes(action);

  if (action === 'registerOrValidateDevice') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, authorized: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'resetDeviceManagement') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "FORBIDDEN",
      message: "resetDeviceManagement is disabled on Web App endpoint."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'provisionDistrict') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "METHOD_NOT_ALLOWED",
      message: "provisionDistrict requires POST request."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'getDeviceStatus') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, exists: false, rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'getMapsApiKey') {
    const sessionToken = params && (params.dashboardSessionToken || params.token);
    const targetDistrictId = (params && params.districtId) || "";
    const result = handleGetMapsApiKey(targetDistrictId, sessionToken);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const districtId = String((params && params.districtId) || "").trim();

  // 1. districtId 必須チェック (Routing / Identity Gate)
  if (action && action !== 'getTier1' && !districtId) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "MISSING_DISTRICT_ID",
      message: "districtId is required."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. 対象DB確定 & Integrity Guard
  if (districtId) {
    try {
      SpreadsheetResolver.getInstance().getSpreadsheet(districtId);
    } catch (eResolver) {
      const errStr = eResolver.toString();
      if (errStr.includes("DISTRICT_MISMATCH")) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          code: "DISTRICT_MISMATCH",
          message: eResolver.message
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "CONTRACT_CHECK_FAILED",
        message: "契約情報の検証に失敗したため安全のためアクセスを遮断しました。"
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 3. 契約確認 (Contract Gate)
  if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
    const contract = SystemInfoService.getInstance().getContractStatus(null, new Date(), districtId);
    if (contract.isExpired) {
      const errorCode = contract.code || "CONTRACT_EXPIRED";
      const errorMsg = contract.message || "契約期間が終了しているため利用できません。";
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: errorCode,
        message: errorMsg
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 4. 厳格な認証ゲート (SEC-001)
  if (!isPublicAction) {
    const dashToken = (params && (params.dashboardSessionToken || params.managerSessionToken)) || "";
    let isDashAuthed = false;
    if (dashToken && typeof verifyDashboardSession === 'function') {
      const dashCheck = verifyDashboardSession(dashToken, districtId);
      if (dashCheck.success) {
        isDashAuthed = true;
        e.user = { role: 'MANAGER', districtId: dashCheck.session.districtId };
      } else if (isDashboardOnlyAction) {
        return ContentService.createTextOutput(JSON.stringify(dashCheck))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (isDashboardOnlyAction || isDualAuthAction) {
      if (!isDashAuthed) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          code: "UNAUTHORIZED",
          message: isDashboardOnlyAction ? "Dashboard session token is required." : "Authentication required for this resource."
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required."
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  const res = processGetActionLegacy(action, e, districtId);
  if (res && typeof res.setMimeType === 'function') {
    return res;
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 従来のGETリクエストの処理（後方互換用）
 */
function processGetActionLegacy(action, e, districtId = "") {
  let response;
  switch (action) {
      case 'getDashboardData':
      case 'getSystemSummary':
        response = typeof SystemSummaryService !== 'undefined' ? SystemSummaryService.getInstance().getSystemSummary(districtId) : { success: true, ...getDashboardData() };
        break;
      case 'getMapsApiKey': {
        const dashToken = (e && e.parameter && (e.parameter.dashboardSessionToken || e.parameter.managerSessionToken)) || "";
        response = handleGetMapsApiKey(districtId, dashToken);
        break;
      }
      case 'getTier1':
        response = typeof Tier1Service !== 'undefined' ? Tier1Service.getInstance().getTier1() : { success: false };
        break;
      case 'getSystemInfo':
        try {
          const ss = typeof getSS === 'function'
            ? getSS(districtId)
            : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
          if (!ss) {
            response = { success: false, message: 'Spreadsheet unavailable' };
          } else {
            const sysSheet = ss.getSheetByName('SYSTEM_INFO');
            const sysValues = (sysSheet && sysSheet.getLastRow() > 0 && sysSheet.getLastColumn() > 0)
              ? sysSheet.getRange(1, 1, sysSheet.getLastRow(), sysSheet.getLastColumn()).getValues()
              : [];
            const safeSystemInfoRows = sysValues.map(row => {
              if (Array.isArray(row) && String(row[0] || '').trim() === 'Manager認証パスワード') {
                const safeRow = row.slice();
                safeRow[1] = '[REDACTED]';
                return safeRow;
              }
              return row;
            });
            const sheetsSummary = ss.getSheets().map(s => ({
              name: s.getName(),
              lastRow: s.getLastRow(),
              lastColumn: s.getLastColumn(),
              dataRows: Math.max(0, s.getLastRow() - 1)
            }));
            response = {
              success: true,
              spreadsheetName: ss.getName(),
              spreadsheetId: ss.getId(),
              systemInfoRows: safeSystemInfoRows,
              sheets: sheetsSummary
            };
          }
        } catch (err) {
          response = { success: false, error: err.toString() };
        }
        break;
      case 'getRanking': {
        const rankPayload = DistributionService.getInstance().getRankingPayload("", districtId);
        response = { success: true, mySummary: rankPayload.mySummary, ranking: rankPayload.ranking };
        break;
      }
      case 'getLatestDistribution':
        try {
          const records = typeof DistributionRepository !== 'undefined' && DistributionRepository.getInstance
            ? DistributionRepository.getInstance().fetchLatestRecords(20, "", districtId)
            : [];
          response = { success: true, records: records };
        } catch (err) {
          response = { success: false, error: err.toString(), records: [] };
        }
        break;
      case 'getRoster': {
        const rawRoster = StaffService.getInstance().getRoster(districtId);
        let stocks = [];
        let ranking = [];
        try {
          stocks = FlyerRepository.getInstance().findAllStocks("", districtId);
          ranking = DistributionRepository.getInstance().fetchRankingData("", districtId, rawRoster);
        } catch (eAgg) {}
        const aggregatedRoster = rawRoster.map(r => {
          const staffStocks = stocks.filter(st => st.staffId === r.id);
          const stockTotal = staffStocks.reduce((acc, st) => acc + (Number(st.count) || 0), 0);
          const staffRank = ranking.find(rk => rk.staffId === r.id);
          const deliveredTotal = staffRank ? Number(staffRank.count || 0) : 0;
          return {
            id: r.id,
            name: r.name,
            registeredAt: r.registeredAt,
            stockTotal: stockTotal,
            deliveredTotal: deliveredTotal
          };
        });
        response = { success: true, roster: aggregatedRoster };
        break;
      }
      case 'resetDeviceManagement':
        response = { success: false, code: "FORBIDDEN", message: "resetDeviceManagement is disabled on Web App endpoint." };
        break;
      case 'getAreaDetails':
        response = AreaService.getInstance().getAreaDetails(e.name, districtId);
        break;
      case 'submitDistribution':
        response = { success: false, message: 'Write operations require POST. Please update the client.' };
        break;
      case 'registerStaff':
        response = { success: false, error: 'Registration requires POST request for security reasons.' };
        break;
      case 'getDeliveryStats':
        response = DistributionService.getInstance().getDeliveryStats(districtId);
        break;
      case 'getFlyerStock': {
        const stockPayload = FlyerService.getInstance().getFlyerStock("", districtId);
        response = { success: true, myStock: stockPayload.myStock, stocks: stockPayload.stocks };
        break;
      }
      case 'getTransferRequests':
        response = { success: true, requests: TransferService.getInstance().getTransferRequests("", districtId) };
        break;


      default:
        response = { success: true, message: 'POSTING MAP API is online.' };
    }
  return response;
}

/**
 * POSTリクエスト：データの登録・更新
 */
function doPost(e) {
  isWebAppCall = true;
  let params = (e && e.parameter) ? Object.assign({}, e.parameter) : {};
  let postData = null;
  if (e && e.postData && e.postData.contents) {
    try {
      postData = JSON.parse(e.postData.contents);
    } catch (errP) {}
  }
  if (params.json) {
    try {
      const parsedJson = typeof params.json === 'string' ? JSON.parse(params.json) : params.json;
      postData = { ...(postData || {}), ...parsedJson };
    } catch (errJson) {}
  }
  const action = (postData && postData.action) || params.action || (e && e.parameter && e.parameter.action) || "";
  const districtId = String((postData && postData.districtId) || (params && params.districtId) || "").trim();

  const isManagementAction = [
    'provisionDistrict',
    'createEmptyTemplate',
    'createDistrictDatabase',
    'syncSystemInfo',
    'healSchemaHeaders',
    'runIdentityMigration',
    'resetRoster',
    'registerOrValidateDevice',
    'resetDeviceManagement',
    'getDeviceStatus',
    'issueMobilePairingToken',
    'pairMobileDevice'
  ].includes(action);

  if (!isManagementAction && action && action !== 'getMapsApiKey' && action !== 'getTier1' && !districtId) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "MISSING_DISTRICT_ID",
      message: "districtId is required."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const isPublicAction = [
    'getMapsApiKey',
    'getTier1',
    'registerOrValidateDevice',
    'getDeviceStatus',
    'verifyManagerPassword'
  ].includes(action);

  const isDashboardOnlyAction = [
    'getRoster',
    'getTransferRequests',
    'getDashboardSnapshot',
    'getSystemInfo',
    'logoutManager'
  ].includes(action);

  const isDualAuthAction = [
    'getSystemSummary',
    'getDashboardData',
    'getRanking',
    'getFlyerStock',
    'getLatestDistribution',
    'getDeliveryStats',
    'getAreaDetails',
    'getGlobalPinStatus',
    'getBulletinPosts'
  ].includes(action);

  const isDashboardAction = isDashboardOnlyAction;
  const isReadOnlyAction = isDashboardOnlyAction || isDualAuthAction;

  if (action === 'registerOrValidateDevice') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, authorized: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'resetDeviceManagement') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "FORBIDDEN",
      message: "resetDeviceManagement is disabled on Web App endpoint."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'getDeviceStatus') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, exists: false, rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'issueMobilePairingToken') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "OK" }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'pairMobileDevice') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "OK" }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'provisionDistrict') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const addresses = (postData && postData.addresses) || (params && params.addresses);
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "INVALID_ARGUMENT",
        message: "addresses must be a non-empty array of address master records."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    const options = (postData && postData.options) || (params && params.options) || {};
    if (options && options.spreadsheet) {
      delete options.spreadsheet;
    }
    if (postData && postData.skipSystemInfo !== undefined && options.skipSystemInfo === undefined) {
      options.skipSystemInfo = postData.skipSystemInfo;
    }
    options.provisioningToken = token;
    const targetDistrictId = String((postData && (postData.districtId || (postData.options && postData.options.districtId))) || (params && (params.districtId || (params.options && params.options.districtId))) || "").trim().toUpperCase();
    const explicitSsId = String((postData && (postData.targetSpreadsheetId || postData.spreadsheetId)) || (params && (params.targetSpreadsheetId || params.spreadsheetId)) || (options && (options.targetSpreadsheetId || options.spreadsheetId)) || "").trim();
    if (explicitSsId) {
      options.targetSpreadsheetId = explicitSsId;
    }
    let result;
    if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      result = DistrictProvisioner.getInstance().provisionNewDistrict(addresses, options, targetDistrictId);
    } else {
      result = { success: false, message: 'DistrictProvisioner not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'createEmptyTemplate') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const sourceSpreadsheetId = (postData && postData.sourceSpreadsheetId) || (params && params.sourceSpreadsheetId);
    const targetFolderId = (postData && postData.targetFolderId) || (params && params.targetFolderId);
    const options = (postData && postData.options) || (params && params.options) || {};
    options.provisioningToken = token;

    let result;
    if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      result = DistrictProvisioner.getInstance().createEmptyTemplate(sourceSpreadsheetId, targetFolderId, options);
    } else {
      result = { success: false, message: 'DistrictProvisioner not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'createDistrictDatabase') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const templateSpreadsheetId = (postData && postData.templateSpreadsheetId) || (params && params.templateSpreadsheetId);
    const targetDistrictName = (postData && (postData.targetDistrictName || postData.districtId)) || (params && (params.targetDistrictName || params.districtId));
    const targetFolderId = (postData && postData.targetFolderId) || (params && params.targetFolderId);
    const options = (postData && postData.options) || (params && params.options) || {};
    options.provisioningToken = token;
    const reqDistrictId = (postData && postData.districtId) || (params && params.districtId);
    if (reqDistrictId && !options.districtId) {
      options.districtId = reqDistrictId;
    }

    let result;
    if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      result = DistrictProvisioner.getInstance().createDistrictDatabase(templateSpreadsheetId, targetDistrictName, targetFolderId, options);
    } else {
      result = { success: false, message: 'DistrictProvisioner not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'syncSystemInfo') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const options = (postData && postData.options) || (params && params.options) || {};
    if (options && options.spreadsheet) {
      delete options.spreadsheet;
    }
    options.provisioningToken = token;
    const targetDistrictId = String((postData && (postData.districtId || (postData.options && postData.options.districtId))) || (params && (params.districtId || (params.options && params.options.districtId))) || "").trim().toUpperCase();
    const explicitSsId = String((postData && (postData.targetSpreadsheetId || postData.spreadsheetId)) || (params && (params.targetSpreadsheetId || params.spreadsheetId)) || (options && (options.targetSpreadsheetId || options.spreadsheetId)) || "").trim();
    if (explicitSsId) {
      options.targetSpreadsheetId = explicitSsId;
    }
    let result;
    if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
      result = SystemInfoService.getInstance().syncSystemInfo(options, targetDistrictId);
    } else if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      const ss = DistrictProvisioner.getInstance().getSS(targetDistrictId);
      result = DistrictProvisioner.getInstance().createOrSyncSystemInfo(ss, options);
    } else {
      result = { success: false, message: 'SystemInfoService not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'healSchemaHeaders') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const targetDistrictId = String((postData && postData.districtId) || districtId || (params && params.districtId) || "").trim();
    if (!targetDistrictId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "MISSING_DISTRICT_ID",
        message: "districtId is required for healSchemaHeaders."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const targetMonth = String((postData && postData.targetMonth) || (postData && postData.options && postData.options.targetMonth) || (params && params.targetMonth) || "").trim();
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "INVALID_ARGUMENT",
        message: "Valid targetMonth (YYYY-MM) is required for healSchemaHeaders."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // targetSpreadsheetId直接指定やClient spreadsheet objectは禁止（Runtime Resolver 経由のみ）
    const isDryRun = (postData && postData.isDryRun !== undefined)
      ? !!postData.isDryRun
      : ((postData && postData.options && postData.options.isDryRun !== undefined) ? !!postData.options.isDryRun : true);

    let result;
    if (typeof healSchemaHeaders === 'function') {
      result = healSchemaHeaders({ isDryRun: isDryRun, targetMonth: targetMonth, districtId: targetDistrictId }, targetDistrictId);
    } else {
      result = { success: false, message: 'healSchemaHeaders not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'runIdentityMigration') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const targetDistrictId = String((postData && postData.districtId) || districtId || (params && params.districtId) || "").trim();
    const isDryRun = (postData && postData.isDryRun !== undefined) ? !!postData.isDryRun : true;
    let result;
    if (typeof migrateIdentityColumns === 'function') {
      result = migrateIdentityColumns(isDryRun, { districtId: targetDistrictId }, targetDistrictId);
    } else {
      result = { success: false, message: 'migrateIdentityColumns not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'resetRoster') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const targetDistrictId = String((postData && postData.districtId) || districtId || (params && params.districtId) || "").trim().toUpperCase();
    if (!targetDistrictId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "MISSING_DISTRICT_ID",
        message: "districtId is required for resetRoster."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    const result = { success: true, message: setupRosterSheet(targetDistrictId) };
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'getMapsApiKey') {
    const sessionToken = (postData && (postData.dashboardSessionToken || postData.token)) || (params && (params.dashboardSessionToken || params.token));
    const targetDistrictId = (postData && postData.districtId) || districtId || (params && params.districtId);
    const result = handleGetMapsApiKey(targetDistrictId, sessionToken);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 1. 対象DB確定 & Integrity Guard
  if (districtId) {
    try {
      SpreadsheetResolver.getInstance().getSpreadsheet(districtId);
    } catch (eResolver) {
      const errStr = eResolver.toString();
      if (errStr.includes("DISTRICT_MISMATCH")) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          code: "DISTRICT_MISMATCH",
          message: eResolver.message
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "CONTRACT_CHECK_FAILED",
        message: "契約情報の検証に失敗したため安全のためアクセスを遮断しました。"
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 2. 契約確認 (Contract Gate)
  if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
    const contract = SystemInfoService.getInstance().getContractStatus(null, new Date(), districtId);
    if (contract.isExpired) {
      const errorCode = contract.code || "CONTRACT_EXPIRED";
      const errorMsg = contract.message || "契約期間が終了しているため利用できません。";
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: errorCode,
        message: errorMsg
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 3. 厳格な認証ゲート (SEC-001)
  if (!isPublicAction && !isManagementAction) {
    const dashToken = (postData && (postData.dashboardSessionToken || postData.managerSessionToken))
                   || (params && (params.dashboardSessionToken || params.managerSessionToken)) || "";
    let isDashAuthed = false;

    if (dashToken && typeof verifyDashboardSession === 'function') {
      const dashCheck = verifyDashboardSession(dashToken, districtId);
      if (dashCheck.success) {
        isDashAuthed = true;
        if (postData) {
          postData.user = { role: 'MANAGER', districtId: dashCheck.session.districtId };
        }
      } else if (isDashboardOnlyAction) {
        return ContentService.createTextOutput(JSON.stringify(dashCheck))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (isDashboardOnlyAction) {
      if (!isDashAuthed) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          code: "UNAUTHORIZED",
          message: "Dashboard session token is required."
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } else if (isDualAuthAction) {
      if (!isDashAuthed) {
        // Dashboardセッションがない場合、Hアプリの LINE 認証を検証
        const auth = authenticateRequest(postData || {});
        if (!auth.success) {
          return ContentService.createTextOutput(JSON.stringify(auth))
            .setMimeType(ContentService.MimeType.JSON);
        }
        if (postData) postData.user = auth.user;
      }
    } else {
      // staffDependentActions や registerStaff 等の厳格 LINE 認証アクション
      const auth = authenticateRequest(postData || {});
      if (!auth.success) {
        return ContentService.createTextOutput(JSON.stringify(auth))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (postData) postData.user = auth.user;
    }
  }
  const res = processPostAction(action, postData, e, districtId);
  if (res && typeof res.setMimeType === 'function') {
    return res;
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 実際のPOSTアクション処理のスイッチケース
 */
function processPostAction(action, postData, e, districtId = "") {
  // 認証済み操作主体（Server Authority）の保護
  const authenticatedUser = (postData && postData.user) ? postData.user : null;

  if (e && e.parameter && e.parameter.json) {
    try {
      const parsedJson = typeof e.parameter.json === 'string' ? JSON.parse(e.parameter.json) : e.parameter.json;
      postData = { ...(postData || {}), ...parsedJson };
    } catch (errJson) {}
  }

  // Client 入力（e.parameter.json 等）による操作主体の改ざん・上書きを無力化
  if (authenticatedUser) {
    postData = postData || {};
    postData.user = authenticatedUser;
  }

  // Staff依存業務アクションに対する操作主体（LINE User ID）の検証・Identity強制
  const staffDependentActions = [
    'updateFlyerStock',
    'submitDistribution',
    'updateRecordWithGPSPhoto',
    'createBulletinPost',
    'sendBulletinContact',
    'requestFlyerTransfer',
    'resolveTransferRequest'
  ];
  if (staffDependentActions.includes(action)) {
    const lineUserId = (postData && postData.user && postData.user.lineUserId) ? String(postData.user.lineUserId).trim() : "";
    if (!lineUserId) {
      return { success: false, code: "UNAUTHORIZED", message: "LINE User ID が取得できません。" };
    }
    const identity = (typeof StaffService !== 'undefined' && StaffService.getInstance)
      ? StaffService.getInstance().resolveStaffIdentity(lineUserId, districtId)
      : null;
    if (!identity || !identity.found) {
      return {
        success: false,
        code: "NOT_REGISTERED",
        message: "配布員登録が完了していません。名簿登録を行ってください。"
      };
    }
    // 操作主体の Identity を Backend 側で強制確定（クライアント送信値を無力化）
    postData.staffId = identity.staffId;
    postData.staffName = identity.staffName;
    postData.requestUserId = identity.staffId;
    postData.resolvedStaffId = identity.staffId;
    postData.resolvedStaffName = identity.staffName;
    postData.resolvedLineUserId = identity.lineUserId;
  }

  const reqLineUserId = (postData && postData.user && postData.user.lineUserId) ? String(postData.user.lineUserId).trim() : "";

  switch (action) {

    case 'getStaffIdentity': {
      const lineUserId = (postData && postData.user && postData.user.lineUserId) ? String(postData.user.lineUserId).trim() : "";
      if (!lineUserId) {
        return { success: false, code: "UNAUTHORIZED", message: "LINE User ID が取得できません。" };
      }
      const identity = (typeof StaffService !== 'undefined' && StaffService.getInstance)
        ? StaffService.getInstance().resolveStaffIdentity(lineUserId, districtId)
        : null;
      if (identity && identity.found) {
        return {
          success: true,
          registered: true,
          staffId: identity.staffId,
          staffName: identity.staffName
        };
      } else {
        return {
          success: true,
          registered: false,
          code: "NOT_REGISTERED",
          message: "Staff not registered"
        };
      }
    }

    case 'getDashboardSnapshot': {
      const snapshot = {
        success: true,
        status: "SUCCESS",
        districtId: districtId,
        timestamp: new Date().toISOString(),
        domains: {},
        errors: {}
      };

      // 共通キャッシュ用 名簿データ（同一実行内での再読込排除）
      let sharedRoster = null;
      try {
        if (typeof StaffService !== 'undefined' && StaffService.getInstance) {
          sharedRoster = StaffService.getInstance().getRoster(districtId) || [];
        }
      } catch (eR) {}

      // 1. Summary ドメイン
      try {
        const summaryData = typeof SystemSummaryService !== 'undefined'
          ? SystemSummaryService.getInstance().getSystemSummary(districtId)
          : { success: false, message: 'SystemSummaryService unavailable' };
        snapshot.domains.summary = summaryData;
        if (!summaryData.success) {
          snapshot.status = "PARTIAL_SUCCESS";
          snapshot.errors.summary = summaryData.message || "Summary fetch failed";
        }
      } catch (eSummary) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.summary = { success: false, error: eSummary.toString() };
        snapshot.errors.summary = eSummary.toString();
      }

      // 2. Flyer Stock ドメイン
      let sharedStocks = [];
      try {
        if (typeof FlyerRepository !== 'undefined' && FlyerRepository.getInstance) {
          sharedStocks = FlyerRepository.getInstance().findAllStocks("", districtId) || [];
        }
        const stockPayload = typeof FlyerService !== 'undefined' && FlyerService.getInstance
          ? FlyerService.getInstance().getFlyerStock(reqLineUserId, districtId)
          : { myStock: [], stocks: sharedStocks };
        snapshot.domains.flyerStock = { success: true, myStock: stockPayload.myStock, stocks: stockPayload.stocks };
      } catch (eStock) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.flyerStock = { success: false, error: eStock.toString(), stocks: [] };
        snapshot.errors.flyerStock = eStock.toString();
      }

      // 3. Ranking ドメイン
      let sharedRanking = [];
      try {
        if (typeof DistributionRepository !== 'undefined' && DistributionRepository.getInstance) {
          sharedRanking = DistributionRepository.getInstance().fetchRankingData(reqLineUserId, districtId, sharedRoster) || [];
        }
        const rankPayload = typeof DistributionService !== 'undefined' && DistributionService.getInstance
          ? DistributionService.getInstance().getRankingPayload(reqLineUserId, districtId)
          : { mySummary: null, ranking: sharedRanking };
        snapshot.domains.ranking = { success: true, mySummary: rankPayload.mySummary, ranking: rankPayload.ranking };
      } catch (eRank) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.ranking = { success: false, error: eRank.toString(), ranking: [] };
        snapshot.errors.ranking = eRank.toString();
      }

      // 4. Pin Status ドメイン
      try {
        const pinData = typeof PinStatusService !== 'undefined' && PinStatusService.getInstance
          ? PinStatusService.getInstance().getStatus(districtId, "")
          : { success: false, inProgress: [], completed: [] };
        snapshot.domains.pinStatus = pinData;
        if (!pinData.success) {
          snapshot.status = "PARTIAL_SUCCESS";
          snapshot.errors.pinStatus = pinData.message || "PinStatus fetch failed";
        }
      } catch (ePin) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.pinStatus = { success: false, error: ePin.toString(), inProgress: [], completed: [] };
        snapshot.errors.pinStatus = ePin.toString();
      }

      // 5. Roster ドメイン
      try {
        const rawRoster = sharedRoster || (typeof StaffService !== 'undefined' ? StaffService.getInstance().getRoster(districtId) : []);
        const aggregatedRoster = (rawRoster || []).map(r => {
          const staffStocks = (sharedStocks || []).filter(st => st.staffId === r.id);
          const stockTotal = staffStocks.reduce((acc, st) => acc + (Number(st.count) || 0), 0);
          const staffRank = (sharedRanking || []).find(rk => rk.staffId === r.id);
          const deliveredTotal = staffRank ? Number(staffRank.count || 0) : 0;
          return {
            id: r.id,
            name: r.name,
            registeredAt: r.registeredAt,
            stockTotal: stockTotal,
            deliveredTotal: deliveredTotal
          };
        });
        snapshot.domains.roster = { success: true, roster: aggregatedRoster };
      } catch (eRoster) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.roster = { success: false, error: eRoster.toString(), roster: [] };
        snapshot.errors.roster = eRoster.toString();
      }

      // 6. Transfer Requests ドメイン
      try {
        const transferData = typeof TransferService !== 'undefined' && TransferService.getInstance
          ? { success: true, requests: TransferService.getInstance().getTransferRequests(reqLineUserId, districtId) }
          : { success: false, requests: [] };
        snapshot.domains.transfer = transferData;
      } catch (eTransfer) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.transfer = { success: false, error: eTransfer.toString(), requests: [] };
        snapshot.errors.transfer = eTransfer.toString();
      }

      // 7. Latest Distribution ドメイン (getDashboardSnapshot は常に解決済み対象 Dataset の完了実績全件を返却)
      try {
        const records = typeof DistributionRepository !== 'undefined' && DistributionRepository.getInstance
          ? DistributionRepository.getInstance().fetchLatestRecords(0, reqLineUserId, districtId)
          : [];
        snapshot.domains.latestDistribution = { success: true, records: records };
      } catch (eLatest) {
        snapshot.status = "PARTIAL_SUCCESS";
        snapshot.domains.latestDistribution = { success: false, error: eLatest.toString(), records: [] };
        snapshot.errors.latestDistribution = eLatest.toString();
      }

      return snapshot;
    }

    case 'getSystemSummary':
      return typeof SystemSummaryService !== 'undefined' ? SystemSummaryService.getInstance().getSystemSummary(districtId) : { success: false };
    case 'getMapsApiKey': {
      const dashToken = (postData && (postData.dashboardSessionToken || postData.managerSessionToken))
                     || (e && e.parameter && (e.parameter.dashboardSessionToken || e.parameter.managerSessionToken)) || "";
      return handleGetMapsApiKey(districtId, dashToken);
    }
    case 'getTier1':
      return typeof Tier1Service !== 'undefined' ? Tier1Service.getInstance().getTier1() : { success: false };
    case 'getSystemInfo':
      try {
        const ss = typeof getSS === 'function' ? getSS(districtId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
        if (!ss) {
          return { success: false, message: 'Spreadsheet unavailable' };
        }
        const sysSheet = ss.getSheetByName('SYSTEM_INFO');
        const sysValues = (sysSheet && sysSheet.getLastRow() > 0 && sysSheet.getLastColumn() > 0)
          ? sysSheet.getRange(1, 1, sysSheet.getLastRow(), sysSheet.getLastColumn()).getValues()
          : [];
        const safeSystemInfoRows = sysValues.map(row => {
          if (Array.isArray(row) && String(row[0] || '').trim() === 'Manager認証パスワード') {
            const safeRow = row.slice();
            safeRow[1] = '[REDACTED]';
            return safeRow;
          }
          return row;
        });
        const sheetsSummary = ss.getSheets().map(s => ({
          name: s.getName(),
          lastRow: s.getLastRow(),
          lastColumn: s.getLastColumn(),
          dataRows: Math.max(0, s.getLastRow() - 1)
        }));
        return {
          success: true,
          spreadsheetName: ss.getName(),
          spreadsheetId: ss.getId(),
          systemInfoRows: safeSystemInfoRows,
          sheets: sheetsSummary
        };
      } catch (err) {
        return { success: false, error: err.toString() };
      }

    case 'getRanking': {
      const rankPayload = DistributionService.getInstance().getRankingPayload(reqLineUserId, districtId);
      return { success: true, mySummary: rankPayload.mySummary, ranking: rankPayload.ranking };
    }
    case 'getLatestDistribution':
      try {
        const records = typeof DistributionRepository !== 'undefined' && DistributionRepository.getInstance
          ? DistributionRepository.getInstance().fetchLatestRecords(postData.limit || 20, reqLineUserId, districtId)
          : [];
        return { success: true, records: records };
      } catch (err) {
        return { success: false, error: err.toString(), records: [] };
      }
    case 'getRoster': {
      const rawRoster = StaffService.getInstance().getRoster(districtId);
      let stocks = [];
      let ranking = [];
      try {
        stocks = FlyerRepository.getInstance().findAllStocks("", districtId);
        ranking = DistributionRepository.getInstance().fetchRankingData("", districtId, rawRoster);
      } catch (eAgg) {}
      const aggregatedRoster = rawRoster.map(r => {
        const staffStocks = stocks.filter(st => st.staffId === r.id);
        const stockTotal = staffStocks.reduce((acc, st) => acc + (Number(st.count) || 0), 0);
        const staffRank = ranking.find(rk => rk.staffId === r.id);
        const deliveredTotal = staffRank ? Number(staffRank.count || 0) : 0;
        return {
          id: r.id,
          name: r.name,
          registeredAt: r.registeredAt,
          stockTotal: stockTotal,
          deliveredTotal: deliveredTotal
        };
      });
      return { success: true, roster: aggregatedRoster };
    }
    case 'resetDeviceManagement':
      return {
        success: false,
        code: "FORBIDDEN",
        message: "resetDeviceManagement is disabled on Web App endpoint."
      };
    case 'getAreaDetails':
      return AreaService.getInstance().getAreaDetails(postData.name || (e && e.parameter ? e.parameter.name : ""), districtId);
    case 'submitDistribution':
      return DistributionService.getInstance().submitDistribution(postData);
    case 'updateRecordWithGPSPhoto':
      return GPSService.getInstance().updateRecordWithGPSPhoto(postData, districtId);
    case 'registerStaff':
      let rLastName = postData.lastName || postData.displayName || (e && e.parameter ? e.parameter.lastName : "");
      let rFirstName = postData.firstName || (e && e.parameter ? e.parameter.firstName : "LINE");
      let rLineUserId = (postData && postData.user && postData.user.lineUserId) ? postData.user.lineUserId : "";
      if (!rLastName && e && e.parameter && e.parameter.json) {
        try {
          const pj = typeof e.parameter.json === 'string' ? JSON.parse(e.parameter.json) : e.parameter.json;
          if (pj.lastName) rLastName = pj.lastName;
          if (pj.displayName && !rLastName) rLastName = pj.displayName;
          if (pj.firstName) rFirstName = pj.firstName;
        } catch (errPj) {}
      }
      return StaffService.getInstance().registerStaff(rLastName, rFirstName, rLineUserId, districtId);
    case 'requestFlyerTransfer':
      return TransferService.getInstance().requestFlyerTransfer(postData, districtId);
    case 'resolveTransferRequest':
      return TransferService.getInstance().resolveTransferRequest(postData, districtId);
    case 'getFlyerStock': {
      const stockPayload = FlyerService.getInstance().getFlyerStock(reqLineUserId, districtId);
      return { success: true, myStock: stockPayload.myStock, stocks: stockPayload.stocks };
    }
    case 'getTransferRequests':
      return { success: true, requests: TransferService.getInstance().getTransferRequests(reqLineUserId, districtId) };
    case 'updateFlyerStock':
      return FlyerService.getInstance().updateFlyerStock(
        postData.location,
        parseInt(postData.count, 10) || 0,
        postData.staffName,
        postData.staffId,
        postData.resolvedLineUserId || reqLineUserId,
        districtId
      );
    case 'getGlobalPinStatus':
      return PinStatusService.getInstance().getStatus(districtId, reqLineUserId);
    case 'getBulletinPosts':
      return typeof BulletinService !== 'undefined' && BulletinService.getInstance
        ? BulletinService.getInstance().getPosts(reqLineUserId, districtId)
        : { success: false, message: 'BulletinService not available' };
    case 'createBulletinPost':
      return typeof BulletinService !== 'undefined' && BulletinService.getInstance
        ? BulletinService.getInstance().createPost(postData, districtId)
        : { success: false, message: 'BulletinService not available' };
    case 'sendBulletinContact':
      return typeof BulletinService !== 'undefined' && BulletinService.getInstance
        ? BulletinService.getInstance().sendContact(postData, districtId)
        : { success: false, message: 'BulletinService not available' };
    case 'setPinInProgress':
      return PinStatusService.getInstance().setInProgress(postData, districtId, reqLineUserId);
    case 'provisionDistrict':
      const pToken = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)));
      const pCheck = verifyProvisioningToken(pToken);
      if (!pCheck.success) return pCheck;
      if (postData && postData.options) {
        if (postData.options.spreadsheet) delete postData.options.spreadsheet;
        postData.options.provisioningToken = pToken;
      }
      const pDistId = String(districtId || (postData && (postData.districtId || (postData.options && postData.options.districtId))) || "").trim().toUpperCase();
      const pSsId = String((postData && (postData.targetSpreadsheetId || postData.spreadsheetId || (postData.options && (postData.options.targetSpreadsheetId || postData.options.spreadsheetId)))) || "").trim();
      if (pSsId && postData && postData.options) postData.options.targetSpreadsheetId = pSsId;
      return typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance
        ? DistrictProvisioner.getInstance().provisionNewDistrict(postData && postData.addresses, postData && postData.options, pDistId)
        : { success: false, message: 'DistrictProvisioner not available' };
    case 'syncSystemInfo':
      const sToken = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)));
      const sCheck = verifyProvisioningToken(sToken);
      if (!sCheck.success) return sCheck;
      if (postData && postData.options) {
        if (postData.options.spreadsheet) delete postData.options.spreadsheet;
        postData.options.provisioningToken = sToken;
      }
      const sDistId = String(districtId || (postData && (postData.districtId || (postData.options && postData.options.districtId))) || "").trim().toUpperCase();
      const sSsId = String((postData && (postData.targetSpreadsheetId || postData.spreadsheetId || (postData.options && (postData.options.targetSpreadsheetId || postData.options.spreadsheetId)))) || "").trim();
      if (sSsId && postData && postData.options) postData.options.targetSpreadsheetId = sSsId;
      return typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance
        ? SystemInfoService.getInstance().syncSystemInfo(postData && postData.options, sDistId)
        : { success: false, message: 'SystemInfoService not available' };
    case 'verifyManagerPassword':
      const postPwd = (postData && postData.password) || (e && e.parameter ? e.parameter.password : "");
      return typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance
        ? SystemInfoService.getInstance().verifyManagerPassword(postPwd, districtId)
        : { success: false, message: 'SystemInfoService not available' };
    case 'logoutManager': {
      const dashToken = (postData && (postData.dashboardSessionToken || postData.managerSessionToken))
                     || (params && (params.dashboardSessionToken || params.managerSessionToken)) || "";
      const result = typeof revokeDashboardSession === 'function'
        ? revokeDashboardSession(dashToken)
        : { success: true, message: "Logged out." };
      return result;
    }
    default:
      return { success: false, message: 'Invalid POST action' };
  }
}

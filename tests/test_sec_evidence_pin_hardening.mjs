/**
 * Security Hardening Verification Suite (SECURITY-HARDENING-EVIDENCE-PIN-001)
 *
 * Verifies:
 * 1. Complete removal of `getEvidence` from production API (`active/api/v2_api.js`):
 *    - Authenticated requests (LIFF / Dashboard Session) do not succeed
 *    - `rosterLatest` is never returned
 *    - `lineUserId` and raw roster rows are never exposed
 * 2. Hardening of `verifyManagerPassword` (`active/business/system/system_info_service.js`):
 *    - Authoritative SSOT in `PropertiesService.getScriptProperties()` keyed by normalized `districtId`
 *    - Atomic protection via `LockService.getScriptLock()`
 *    - Fail-Closed (`AUTH_GUARD_UNAVAILABLE`) if LockService or PropertiesService is unavailable
 *    - Progressive cooldown (1-3: 0s, 4: 5s, 5: 15s, 6: 30s, 7+: 60s cap)
 *    - DoS resilience: requests during cooldown do NOT increment `failCount` or extend `cooldownUntil`
 *    - Self-evaluated 15-minute window from `lastFailedAt` timestamp
 *    - Reset of guard state upon successful login
 *    - Fail-Closed (`PIN_NOT_CONFIGURED`) when PIN is missing/empty in `SYSTEM_INFO` (zero sheet writes)
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('🛡️ Running Security Hardening Suite (EVIDENCE & PIN)');
console.log('====================================================');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// --- Mock Infrastructure ---
class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
    const res = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowData = this.sheet.data[this.row - 1 + r] || [];
      const cols = [];
      for (let c = 0; c < this.numCols; c++) {
        cols.push(rowData[this.col - 1 + c] !== undefined ? rowData[this.col - 1 + c] : '');
      }
      res.push(cols);
    }
    return res;
  }
  setValue(val) {
    if (!this.sheet.data[this.row - 1]) this.sheet.data[this.row - 1] = [];
    this.sheet.data[this.row - 1][this.col - 1] = val;
    return this;
  }
  setValues(vals) {
    for (let r = 0; r < vals.length; r++) {
      if (!this.sheet.data[this.row - 1 + r]) this.sheet.data[this.row - 1 + r] = [];
      for (let c = 0; c < vals[r].length; c++) {
        this.sheet.data[this.row - 1 + r][this.col - 1 + c] = vals[r][c];
      }
    }
    return this;
  }
}

class MockSheet {
  constructor(name, initialData = []) {
    this.name = name;
    this.data = initialData.map(r => [...r]);
    this.appendRowCount = 0;
  }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data[0] ? this.data[0].length : 2; }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }
  appendRow(rowArr) {
    this.appendRowCount++;
    this.data.push([...rowArr]);
    return this;
  }
}

class MockSpreadsheet {
  constructor(id, name, sheetsMap) {
    this.id = id;
    this.name = name;
    this.sheets = sheetsMap || {};
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(name) { return this.sheets[name] || null; }
  getSheets() { return Object.values(this.sheets); }
}

const cacheStore = new Map();
const scriptPropertiesStore = {};
const mockSpreadsheets = {};

let simulatedNow = 1760000000000;
const RealDate = Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(simulatedNow);
    } else {
      super(...args);
    }
  }
  static now() {
    return simulatedNow;
  }
}

let lockWaitBehavior = () => true;
let lockReleaseCount = 0;

function installDefaultGlobals() {
  global.Date = MockDate;
  global.CacheService = {
    getScriptCache: () => ({
      get: (key) => {
        const entry = cacheStore.get(key);
        if (!entry) return null;
        if (MockDate.now() > entry.expiresAt) {
          cacheStore.delete(key);
          return null;
        }
        return entry.value;
      },
      put: (key, value, ttlSec = 600) => {
        cacheStore.set(key, { value: String(value), expiresAt: MockDate.now() + ttlSec * 1000 });
      },
      remove: (key) => cacheStore.delete(key)
    })
  };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(scriptPropertiesStore, k) ? scriptPropertiesStore[k] : null),
      setProperty: (k, v) => { scriptPropertiesStore[k] = String(v); },
      deleteProperty: (k) => { delete scriptPropertiesStore[k]; },
      setProperties: (obj) => { Object.assign(scriptPropertiesStore, obj); }
    })
  };

  global.LockService = {
    getScriptLock: () => ({
      waitLock: (ms) => lockWaitBehavior(ms),
      releaseLock: () => { lockReleaseCount++; }
    })
  };

  global.SpreadsheetApp = {
    openById: (id) => {
      if (mockSpreadsheets[id]) return mockSpreadsheets[id];
      throw new Error('Spreadsheet not found: ' + id);
    },
    getActiveSpreadsheet: () => mockSpreadsheets['ss-alpha-id'] || null,
    flush: () => {}
  };

  global.ContentService = {
    createTextOutput: (str) => ({
      text: str,
      mimeType: 'JSON',
      setMimeType: function(m) { this.mimeType = m; return this; }
    }),
    MimeType: { JSON: 'JSON' }
  };

  global.Utilities = {
    computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str).digest()),
    formatDate: (d, tz, fmt) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      if (fmt === 'yyyy-MM') return `${year}-${month}`;
      if (fmt === 'yyyy/MM/dd HH:mm:ss') return `${year}/${month}/${day} 12:00:00`;
      return `${year}-${month}-${day}`;
    },
    getUuid: () => 'uuid_' + Math.random().toString(36).substring(2, 10)
  };

  global.UrlFetchApp = {
    fetch: (url, options) => {
      if (url.includes('oauth2/v2.1/verify')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ client_id: '2009640042', expires_in: 3600 }) };
      }
      if (url.includes('v2/profile')) {
        const auth = (options && options.headers && (options.headers.Authorization || options.headers.authorization)) || '';
        if (auth === 'Bearer token_alpha_001') {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ userId: 'U_ALPHA_001', displayName: 'テスト 太郎' }) };
        }
      }
      return { getResponseCode: () => 401, getContentText: () => 'Unauthorized' };
    }
  };
}

installDefaultGlobals();

// Spreadsheets setup (Note: spreadsheet display name differs from districtId to prove guardKey uses districtId)
const alphaSS = new MockSpreadsheet('ss-alpha-id', 'ALPHA_DISPLAY_SPREADSHEET_NAME', {
  'SYSTEM_INFO': new MockSheet('SYSTEM_INFO', [
    ['項目', '内容'],
    ['地区コード', 'DIST_ALPHA'],
    ['地区名', 'Alpha District'],
    ['運用モード', 'SUBSCRIPTION'],
    ['HアプリURL', 'https://alpha.postingmap.jp/'],
    ['Dashboard URL', 'https://alpha.postingmap.jp/active/manager/'],
    ['Manager認証パスワード', '884219'],
    ['状態', 'ACTIVE'],
    ['契約終了日', '2029-12-31']
  ]),
  '名簿2026-09': new MockSheet('名簿2026-09', [
    ['ID', '氏名', 'LINE_USER_ID', '登録日時'],
    ['S001', 'テスト 太郎', 'U_ALPHA_001', '2026-09-01 10:00:00']
  ])
});

const betaSS = new MockSpreadsheet('ss-beta-id', 'BETA_DISPLAY_SPREADSHEET_NAME', {
  'SYSTEM_INFO': new MockSheet('SYSTEM_INFO', [
    ['項目', '内容'],
    ['地区コード', 'DIST_BETA'],
    ['地区名', 'Beta District'],
    ['運用モード', 'SUBSCRIPTION'],
    ['HアプリURL', 'https://beta.postingmap.jp/'],
    ['Dashboard URL', 'https://beta.postingmap.jp/active/manager/'],
    ['Manager認証パスワード', '112233'],
    ['状態', 'ACTIVE'],
    ['契約終了日', '2029-12-31']
  ])
});

const unconfiguredSS = new MockSpreadsheet('ss-unconf-id', 'UNCONFIGURED_DISPLAY_NAME', {
  'SYSTEM_INFO': new MockSheet('SYSTEM_INFO', [
    ['項目', '内容'],
    ['地区コード', 'UNCONF-01'],
    ['地区名', 'Unconfigured District'],
    ['運用モード', 'SUBSCRIPTION'],
    ['HアプリURL', 'https://unconf.postingmap.jp/'],
    ['Dashboard URL', 'https://unconf.postingmap.jp/active/manager/'],
    ['状態', 'ACTIVE'],
    ['契約終了日', '2029-12-31']
  ])
});

mockSpreadsheets['ss-alpha-id'] = alphaSS;
mockSpreadsheets['ss-beta-id'] = betaSS;
mockSpreadsheets['ss-unconf-id'] = unconfiguredSS;

scriptPropertiesStore['DISTRICT_ID'] = 'DIST_ALPHA';
scriptPropertiesStore['TARGET_SPREADSHEET_ID'] = 'ss-alpha-id';
scriptPropertiesStore['LINE_LIFF_ID'] = '2009640042-dummy';

// Load production modules
const sessionCode = fs.readFileSync(path.join(REPO_ROOT, 'active/api/auth/session.js'), 'utf8');
const adapterCode = fs.readFileSync(path.join(REPO_ROOT, 'active/infrastructure/spreadsheet/spreadsheet_adapter.js'), 'utf8');
const systemInfoCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/system/system_info_service.js'), 'utf8');
const v2ApiCode = fs.readFileSync(path.join(REPO_ROOT, 'active/api/v2_api.js'), 'utf8');
vm.runInThisContext(sessionCode);
vm.runInThisContext(adapterCode);
vm.runInThisContext(systemInfoCode);

global.authenticateRequest = (payload) => {
  if (payload && payload.liffToken === 'token_alpha_001') {
    return { success: true, user: { lineUserId: 'U_ALPHA_001' } };
  }
  return { success: false, code: 'UNAUTHORIZED', message: 'Missing or invalid liffToken' };
};

vm.runInThisContext(v2ApiCode);

function bindDistrict(districtId, ssId) {
  scriptPropertiesStore['DISTRICT_ID'] = districtId;
  scriptPropertiesStore['TARGET_SPREADSHEET_ID'] = ssId;
  scriptPropertiesStore['SPREADSHEET_ID'] = ssId;
  if (typeof CONFIG !== 'undefined') {
    CONFIG.DISTRICT_ID = districtId;
    CONFIG.TARGET_SPREADSHEET_ID = ssId;
    CONFIG.SPREADSHEET_ID = ssId;
  }
}

function callDoPost(payload) {
  const res = doPost({
    parameter: {},
    postData: { contents: JSON.stringify(payload) }
  });
  return JSON.parse(res.text);
}

// ====================================================
// 1. getEvidence Abolition Gate
// ====================================================
console.log('\n--- [1] getEvidence Abolition Gate ---');

runTest('getEvidence is completely removed from active/api/v2_api.js source', () => {
  assert.strictEqual(v2ApiCode.includes("case 'getEvidence'"), false, 'case getEvidence must not exist in v2_api.js');
  assert.strictEqual(v2ApiCode.includes('rosterLatest'), false, 'rosterLatest must not exist in v2_api.js');
});

runTest('Authenticated LINE staff request to getEvidence fails and never exposes rosterLatest or lineUserId', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  const res = callDoPost({
    action: 'getEvidence',
    districtId: 'DIST_ALPHA',
    liffToken: 'token_alpha_001'
  });
  const rawJson = JSON.stringify(res);
  assert.strictEqual(res.success, false, 'getEvidence must not succeed even with valid liffToken');
  assert.strictEqual(res.rosterLatest, undefined, 'rosterLatest must not be returned');
  assert.strictEqual(rawJson.includes('U_ALPHA_001'), false, 'lineUserId must not be exposed');
  assert.strictEqual(rawJson.includes('テスト 太郎'), false, 'raw roster data must not be exposed');
});

runTest('Authenticated Dashboard Session request to getEvidence fails and never exposes rosterLatest or lineUserId', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  const loginRes = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_ALPHA',
    password: '884219'
  });
  assert.strictEqual(loginRes.success, true, 'Manager login should succeed');
  const res = callDoPost({
    action: 'getEvidence',
    districtId: 'DIST_ALPHA',
    dashboardSessionToken: loginRes.dashboardSessionToken
  });
  const rawJson = JSON.stringify(res);
  assert.strictEqual(res.success, false, 'getEvidence must not succeed even with valid dashboardSessionToken');
  assert.strictEqual(res.rosterLatest, undefined, 'rosterLatest must not be returned');
  assert.strictEqual(rawJson.includes('U_ALPHA_001'), false, 'lineUserId must not be exposed');
  assert.strictEqual(rawJson.includes('テスト 太郎'), false, 'raw roster data must not be exposed');
});

// ====================================================
// 2. verifyManagerPassword Rate-Limit & Cooldown Gate
// ====================================================
console.log('\n--- [2] verifyManagerPassword Rate-Limit & DoS Resilience Gate ---');

runTest('Failures 1-3 return UNAUTHORIZED with 0ms cooldown and store state in ScriptProperties under normalized districtId', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  delete scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA'];

  for (let i = 1; i <= 3; i++) {
    const res = callDoPost({
      action: 'verifyManagerPassword',
      districtId: '  dist_alpha ',
      password: '000000'
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'UNAUTHORIZED');
    const saved = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
    assert.strictEqual(saved.failCount, i, `failCount should be ${i}`);
    assert.strictEqual(saved.cooldownUntil, 0, 'cooldownUntil should be 0 for failures 1..3');
    assert.strictEqual(saved.lastFailedAt, simulatedNow);
    // Ensure ss.getName() was NOT used as guard key
    assert.strictEqual(scriptPropertiesStore['PIN_AUTH_GUARD_ALPHA_DISPLAY_SPREADSHEET_NAME'], undefined);
  }
});

runTest('Failure 4 triggers 5s cooldown in ScriptProperties; clearing CacheService does NOT bypass cooldown', () => {
  const res4 = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_ALPHA',
    password: '000000'
  });
  assert.strictEqual(res4.success, false);
  assert.strictEqual(res4.code, 'UNAUTHORIZED');

  const saved = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(saved.failCount, 4);
  assert.strictEqual(saved.cooldownUntil, simulatedNow + 5000);

  // Clear CacheService completely to prove ScriptProperties is the Authoritative SSOT
  cacheStore.clear();

  simulatedNow += 1000; // 1s into 5s cooldown
  const blockedRes = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_ALPHA',
    password: '884219' // Even correct PIN must be rejected during active cooldown
  });
  assert.strictEqual(blockedRes.success, false);
  assert.strictEqual(blockedRes.code, 'PIN_COOLDOWN');
  assert.strictEqual(blockedRes.retryAfterSeconds, 4);
});

runTest('DoS Resilience: Blocked requests during cooldown do NOT increment failCount or extend cooldownUntil', () => {
  const beforeState = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = callDoPost({
      action: 'verifyManagerPassword',
      districtId: 'DIST_ALPHA',
      password: '999999'
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'PIN_COOLDOWN');
  }
  const afterState = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(afterState.failCount, beforeState.failCount, 'failCount must NOT increment during cooldown');
  assert.strictEqual(afterState.cooldownUntil, beforeState.cooldownUntil, 'cooldownUntil must NOT be extended during cooldown');
  assert.strictEqual(afterState.lastFailedAt, beforeState.lastFailedAt, 'lastFailedAt must NOT change during cooldown');
});

runTest('Progressive cooldown escalates: 5th -> 15s, 6th -> 30s, 7th -> 60s, 8th -> 60s cap', () => {
  // Advance past 4th failure cooldown (remaining 4s + 1ms)
  simulatedNow += 4001;

  // 5th failure -> 15s (15000ms)
  const res5 = callDoPost({ action: 'verifyManagerPassword', districtId: 'DIST_ALPHA', password: '000000' });
  assert.strictEqual(res5.code, 'UNAUTHORIZED');
  let state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 5);
  assert.strictEqual(state.cooldownUntil, simulatedNow + 15000);

  // Advance past 15s
  simulatedNow += 15001;

  // 6th failure -> 30s (30000ms)
  const res6 = callDoPost({ action: 'verifyManagerPassword', districtId: 'DIST_ALPHA', password: '000000' });
  assert.strictEqual(res6.code, 'UNAUTHORIZED');
  state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 6);
  assert.strictEqual(state.cooldownUntil, simulatedNow + 30000);

  // Advance past 30s
  simulatedNow += 30001;

  // 7th failure -> 60s (60000ms)
  const res7 = callDoPost({ action: 'verifyManagerPassword', districtId: 'DIST_ALPHA', password: '000000' });
  assert.strictEqual(res7.code, 'UNAUTHORIZED');
  state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 7);
  assert.strictEqual(state.cooldownUntil, simulatedNow + 60000);

  // Advance past 60s
  simulatedNow += 60001;

  // 8th failure -> capped at 60s (60000ms)
  const res8 = callDoPost({ action: 'verifyManagerPassword', districtId: 'DIST_ALPHA', password: '000000' });
  assert.strictEqual(res8.code, 'UNAUTHORIZED');
  state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 8);
  assert.strictEqual(state.cooldownUntil, simulatedNow + 60000);
});

runTest('District isolation: Cooldown in DIST_ALPHA does NOT block DIST_BETA', () => {
  // DIST_ALPHA is currently in 60s cooldown
  bindDistrict('DIST_BETA', 'ss-beta-id');
  const okRes = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_BETA',
    password: '112233'
  });
  assert.strictEqual(okRes.success, true, 'DIST_BETA login must succeed while DIST_ALPHA is in cooldown');
  assert.ok(okRes.dashboardSessionToken, 'DIST_BETA session token must be issued');
});

runTest('Successful login after cooldown expiry resets guard state in ScriptProperties', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  simulatedNow += 60001; // Expire DIST_ALPHA 60s cooldown

  const okRes = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_ALPHA',
    password: '884219'
  });
  assert.strictEqual(okRes.success, true, 'Legitimate manager login must succeed after cooldown expires');
  assert.ok(okRes.dashboardSessionToken, 'Session token must be issued');
  assert.ok(!scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA'], 'Guard state in ScriptProperties must be cleared on success');

  // Next failure starts back at failCount = 1 with 0 cooldown
  const nextFail = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_ALPHA',
    password: '000000'
  });
  assert.strictEqual(nextFail.code, 'UNAUTHORIZED');
  const state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 1);
  assert.strictEqual(state.cooldownUntil, 0);
});

runTest('15-minute window expiration resets failCount based on lastFailedAt timestamp', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  // Currently at failCount = 1. Add 2 more failures -> failCount = 3
  callDoPost({ action: 'verifyManagerPassword', districtId: 'DIST_ALPHA', password: '000000' });
  callDoPost({ action: 'verifyManagerPassword', districtId: 'DIST_ALPHA', password: '000000' });
  let state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 3);

  // Advance clock by 15 minutes + 1ms (900,001 ms)
  simulatedNow += 15 * 60 * 1000 + 1;

  // Next failure must reset failCount to 1 (NOT 4 / no cooldown)
  const resAfterWindow = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'DIST_ALPHA',
    password: '000000'
  });
  assert.strictEqual(resAfterWindow.code, 'UNAUTHORIZED');
  state = JSON.parse(scriptPropertiesStore['PIN_AUTH_GUARD_DIST_ALPHA']);
  assert.strictEqual(state.failCount, 1, 'failCount must reset to 1 after 15-minute window');
  assert.strictEqual(state.cooldownUntil, 0, 'cooldownUntil must be 0');
});

// ====================================================
// 3. PIN Unconfigured Fail-Closed & Provisioning Separation
// ====================================================
console.log('\n--- [3] PIN Unconfigured Fail-Closed & Provisioning Separation Gate ---');

runTest('verifyManagerPassword returns PIN_NOT_CONFIGURED and performs zero sheet writes when PIN is missing', () => {
  bindDistrict('UNCONF-01', 'ss-unconf-id');
  const sysSheet = unconfiguredSS.getSheetByName('SYSTEM_INFO');
  const rowsBefore = sysSheet.getLastRow();
  sysSheet.appendRowCount = 0;

  const res = callDoPost({
    action: 'verifyManagerPassword',
    districtId: 'UNCONF-01',
    password: '123456'
  });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'PIN_NOT_CONFIGURED');
  assert.strictEqual(sysSheet.appendRowCount, 0, 'verifyManagerPassword must NOT append rows to SYSTEM_INFO');
  assert.strictEqual(sysSheet.getLastRow(), rowsBefore, 'SYSTEM_INFO row count must remain unchanged');
});

runTest('Provisioning / Initial Setup (getManagerPassword) retains PIN generation responsibility', () => {
  const sysSheet = unconfiguredSS.getSheetByName('SYSTEM_INFO');
  const generatedPin = SystemInfoService.getInstance().getManagerPassword(sysSheet);
  assert.match(generatedPin, /^\d{6}$/, 'getManagerPassword must still generate a 6-digit PIN for provisioning');
});

// ====================================================
// 4. LockService / PropertiesService Fail-Closed Gate
// ====================================================
console.log('\n--- [4] LockService / PropertiesService Fail-Closed Gate ---');

runTest('Fails closed (AUTH_GUARD_UNAVAILABLE) when LockService.waitLock fails or throws', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  lockWaitBehavior = () => { throw new Error('Lock timeout'); };
  try {
    const res = callDoPost({
      action: 'verifyManagerPassword',
      districtId: 'DIST_ALPHA',
      password: '884219' // Even valid password must not bypass when lock fails
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'AUTH_GUARD_UNAVAILABLE');
    assert.strictEqual(res.dashboardSessionToken, undefined);
  } finally {
    lockWaitBehavior = () => true;
  }
});

runTest('Fails closed (AUTH_GUARD_UNAVAILABLE) when PropertiesService is unavailable', () => {
  bindDistrict('DIST_ALPHA', 'ss-alpha-id');
  const savedPropsService = global.PropertiesService;
  global.PropertiesService = { getScriptProperties: () => null };
  try {
    const res = SystemInfoService.getInstance().verifyManagerPassword('884219', 'DIST_ALPHA');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'AUTH_GUARD_UNAVAILABLE');
    assert.strictEqual(res.dashboardSessionToken, undefined);
  } finally {
    global.PropertiesService = savedPropsService;
  }
});

console.log('\n====================================================');
console.log(`📊 Summary: ${passed} passed, ${failed} failed`);
console.log('====================================================');
if (failed > 0) {
  process.exit(1);
}

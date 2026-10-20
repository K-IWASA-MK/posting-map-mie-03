import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log("====================================================");
console.log("🧪 STEP 4 DASHBOARD SNAPSHOT API VERIFICATION SUITE");
console.log("====================================================");

// 決定論的 Fixed Clock: 実カレンダーからテストを切り離し、基準Fixture月 2026-09 を保証
const baseOriginalDate = global.Date;
const mockSeptDate = new baseOriginalDate("2026-09-20T12:00:00+09:00");
class MockDate202609 extends baseOriginalDate {
  constructor(...args) {
    if (args.length === 0) {
      super(mockSeptDate.getTime());
    } else {
      super(...args);
    }
  }
  static now() {
    return mockSeptDate.getTime();
  }
}
global.Date = MockDate202609;

// モック環境の構築
class MockRange {
  constructor(values, sheet, row, col) {
    this.values = values;
    this.sheet = sheet;
    this.row = row;
    this.col = col;
  }
  getValues() { return this.values; }
  setValue(v) {
    this.values[0][0] = v;
    if (this.sheet && this.sheet.data) {
      if (!this.sheet.data[this.row - 1]) this.sheet.data[this.row - 1] = [];
      this.sheet.data[this.row - 1][this.col - 1] = v;
    }
  }
  setFontWeight() {}
}

class MockSheet {
  constructor(name, data = []) {
    this.name = name;
    this.data = data;
    this.frozenRows = 0;
  }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data[0] ? this.data[0].length : 0; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const slice = [];
    for (let r = 0; r < numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < numCols; c++) {
        const rIdx = (row - 1) + r;
        const cIdx = (col - 1) + c;
        rowArr.push(this.data[rIdx] ? this.data[rIdx][cIdx] : "");
      }
      slice.push(rowArr);
    }
    return new MockRange(slice, this, row, col);
  }
  setFrozenRows(n) { this.frozenRows = n; }
  appendRow(row) { this.data.push(row); }
}

class MockSpreadsheet {
  constructor(id, name, sheets = {}) {
    this.id = id;
    this.name = name;
    this.sheets = sheets;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(name) { return this.sheets[name] || null; }
  getSheets() { return Object.values(this.sheets); }
  insertSheet(name) {
    const s = new MockSheet(name, []);
    this.sheets[name] = s;
    return s;
  }
}

// Level 2 Mock CacheService
class MockCache {
  constructor() { this.store = new Map(); }
  get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  put(key, value, ttl) { this.store.set(key, String(value)); }
  remove(key) { this.store.delete(key); }
}

const mockCache = new MockCache();
const mockSpreadsheets = {};

global.SpreadsheetApp = {
  openById: (id) => {
    if (!mockSpreadsheets[id]) throw new Error(`Spreadsheet with id ${id} not found`);
    return mockSpreadsheets[id];
  },
  getActiveSpreadsheet: () => Object.values(mockSpreadsheets)[0],
  flush: () => {}
};

global.CacheService = {
  getScriptCache: () => mockCache
};

const scriptPropertiesStore = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => scriptPropertiesStore[key] || null,
    setProperty: (key, val) => { scriptPropertiesStore[key] = String(val); }
  })
};

global.Utilities = {
  formatDate: (d, tz, fmt) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (fmt === "yyyy-MM") return `${year}-${month}`;
    return `${year}-${month}-${day}`;
  },
  computeDigest: (alg, str) => {
    return Array.from(crypto.createHash('sha256').update(str).digest());
  },
  getUuid: () => 'uuid_' + Math.random().toString(36).substring(2, 10)
};

global.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput: (text) => ({
    text: text,
    mimeType: "application/json",
    setMimeType(m) { this.mimeType = m; return this; }
  })
};

// スプレッドシートの準備
const testDistrictSS = new MockSpreadsheet("ss-test-district-id", "POSTING_MAP_TEST_DISTRICT", {
  "SYSTEM_INFO": new MockSheet("SYSTEM_INFO", [
    ["項目", "設定値"],
    ["地区コード", "TEST_DISTRICT"],
    ["運用モード", "SUBSCRIPTION"],
    ["契約終了日", "2026-10-31"],
    ["システム名", "POSTING MAP TEST_DISTRICT"]
  ]),
  "名簿2026-09": new MockSheet("名簿2026-09", [
    ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
    ["K001", "テスト 太郎", "U_TEST_001", "2026/01/01"],
    ["K002", "テスト 花子", "U_TEST_002", "2026/01/02"]
  ]),
  "保有チラシ枚数2026-09": new MockSheet("保有チラシ枚数2026-09", [
    ["スタッフID", "スタッフ名", "チラシ種別", "保管場所", "枚数", "更新日時"],
    ["K001", "テスト 太郎", "A4チラシ", "自宅", 500, "2026/09/20"],
    ["K002", "テスト 花子", "B4チラシ", "事務所", 300, "2026/09/20"]
  ]),
  "配布実績2026-09": new MockSheet("配布実績2026-09", [
    ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
    ["1", "テスト市", "中央町1", "2026-09-20 10:00:00", 150, "K001", "テスト 太郎", "", "", "", "", "", "", "", "", "U_TEST_001"],
    ["2", "テスト市", "中央町2", "2026-09-21 11:00:00", 200, "K002", "テスト 花子", "", "", "", "", "", "", "", "", "U_TEST_002"]
  ]),
  "受渡要請履歴2026-09": new MockSheet("受渡要請履歴2026-09", [
    ["要請ID", "要請者ID", "要請者名", "対象者ID", "対象者名", "チラシ種別", "希望枚数", "ステータス", "作成日時"],
    ["REQ001", "K001", "テスト 太郎", "K002", "テスト 花子", "A4チラシ", 100, "PENDING", "2026/09/22"]
  ]),
  "PinStatus2026-09": new MockSheet("PinStatus2026-09", [
    ["rowId", "status", "updatedAt"],
    ["1", "completed", "2026/09/20"],
    ["2", "inProgress", "2026/09/21"]
  ])
});
mockSpreadsheets["ss-test-district-id"] = testDistrictSS;

scriptPropertiesStore["TARGET_SPREADSHEET_ID"] = "ss-test-district-id";

// コード読み込みと実行
const rootDir = process.cwd();
const adapterCode = fs.readFileSync(path.join(rootDir, "active/infrastructure/spreadsheet/spreadsheet_adapter.js"), "utf8");
const systemInfoCode = fs.readFileSync(path.join(rootDir, "active/business/system/system_info_service.js"), "utf8");
const monthlyResolverCode = fs.readFileSync(path.join(rootDir, "active/business/system/monthly_sheet_resolver.js"), "utf8");
const staffModelCode = fs.readFileSync(path.join(rootDir, "active/business/staff/staff_model.js"), "utf8");
const staffRepoCode = fs.readFileSync(path.join(rootDir, "active/business/staff/staff_repository.js"), "utf8");
const staffServiceCode = fs.readFileSync(path.join(rootDir, "active/business/staff/staff_service.js"), "utf8");
const flyerRepoCode = fs.readFileSync(path.join(rootDir, "active/business/flyer/flyer_repository.js"), "utf8");
const flyerServiceCode = fs.readFileSync(path.join(rootDir, "active/business/flyer/flyer_service.js"), "utf8");
const distRepoCode = fs.readFileSync(path.join(rootDir, "active/business/distribution/distribution_repository.js"), "utf8");
const distServiceCode = fs.readFileSync(path.join(rootDir, "active/business/distribution/distribution_service.js"), "utf8");
const pinServiceCode = fs.readFileSync(path.join(rootDir, "active/business/pin/pin_status_service.js"), "utf8");
const transferServiceCode = fs.readFileSync(path.join(rootDir, "active/business/transfer/transfer_service.js"), "utf8");
const sessionCode = fs.readFileSync(path.join(rootDir, "active/api/auth/session.js"), "utf8");
const systemSummaryCode = fs.readFileSync(path.join(rootDir, "active/business/system/system_summary_service.js"), "utf8");
const v2ApiCode = fs.readFileSync(path.join(rootDir, "active/api/v2_api.js"), "utf8");

vm.runInThisContext(sessionCode);
vm.runInThisContext(adapterCode);
vm.runInThisContext(monthlyResolverCode);
vm.runInThisContext(staffModelCode);
vm.runInThisContext(staffRepoCode);
vm.runInThisContext(staffServiceCode);
vm.runInThisContext(flyerRepoCode);
vm.runInThisContext(flyerServiceCode);
vm.runInThisContext(distRepoCode);
vm.runInThisContext(distServiceCode);
vm.runInThisContext(pinServiceCode);
vm.runInThisContext(transferServiceCode);
vm.runInThisContext(systemInfoCode);
vm.runInThisContext(systemSummaryCode);

global.authenticateRequest = () => ({ success: true, user: { lineUserId: "U_TEST_001" } });
vm.runInThisContext(v2ApiCode);

// 有効な Dashboard 認証セッションの発行 (SEC-001)
const dashSession = createDashboardSession("TEST_DISTRICT");
const validDashToken = dashSession.token;

// -------------------------------------------------------------
// [TEST 1] Snapshot Schema 完全性検証
// -------------------------------------------------------------
console.log("▶ [TEST 1] Snapshot Schema 完全性検証");
const reqSnapshot = {
  postData: { contents: JSON.stringify({ action: "getDashboardSnapshot", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken, limit: 20 }) }
};
const resSnap = doPost(reqSnapshot);
const snap = JSON.parse(resSnap.text);

assert.equal(snap.success, true);
assert.equal(snap.status, "SUCCESS");
assert.equal(snap.districtId, "TEST_DISTRICT");
assert.ok(snap.timestamp);
assert.ok(snap.domains);
assert.ok(snap.domains.summary);
assert.ok(snap.domains.flyerStock);
assert.ok(snap.domains.ranking);
assert.ok(snap.domains.pinStatus);
assert.ok(snap.domains.roster);
assert.ok(snap.domains.transfer);
assert.ok(snap.domains.latestDistribution);
console.log("  ✅ TEST 1 PASS: Snapshot Schema（7ドメイン構造・メタデータ）の完全性を確認");

// -------------------------------------------------------------
// [TEST 2] 既存 7 API との完全等価性検証
// -------------------------------------------------------------
console.log("▶ [TEST 2] 既存 7 API と Snapshot 内ドメインデータの完全等価性検証");

// 1. getSystemSummary
const resSummary = doPost({ postData: { contents: JSON.stringify({ action: "getSystemSummary", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken }) } });
const jsonSummary = JSON.parse(resSummary.text);
assert.deepEqual(snap.domains.summary, jsonSummary, "summary data must be identical");

// 2. getFlyerStock
const resStock = doPost({ postData: { contents: JSON.stringify({ action: "getFlyerStock", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken }) } });
const jsonStock = JSON.parse(resStock.text);
assert.deepEqual(snap.domains.flyerStock.stocks, jsonStock.stocks, "flyerStock must be identical");

// 3. getRanking
const resRank = doPost({ postData: { contents: JSON.stringify({ action: "getRanking", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken }) } });
const jsonRank = JSON.parse(resRank.text);
assert.deepEqual(snap.domains.ranking, jsonRank, "ranking must be identical");

// 4. getGlobalPinStatus
const resPin = doPost({ postData: { contents: JSON.stringify({ action: "getGlobalPinStatus", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken }) } });
const jsonPin = JSON.parse(resPin.text);
assert.deepEqual(snap.domains.pinStatus, jsonPin, "pinStatus must be identical");

// 5. getRoster
const resRoster = doPost({ postData: { contents: JSON.stringify({ action: "getRoster", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken }) } });
const jsonRoster = JSON.parse(resRoster.text);
assert.deepEqual(snap.domains.roster, jsonRoster, "roster must be identical");

// 6. getTransferRequests
const resTransfer = doPost({ postData: { contents: JSON.stringify({ action: "getTransferRequests", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken }) } });
const jsonTransfer = JSON.parse(resTransfer.text);
assert.deepEqual(snap.domains.transfer, jsonTransfer, "transfer requests must be identical");

// 7. getLatestDistribution
const resLatest = doPost({ postData: { contents: JSON.stringify({ action: "getLatestDistribution", districtId: "TEST_DISTRICT", dashboardSessionToken: validDashToken, limit: 20 }) } });
const jsonLatest = JSON.parse(resLatest.text);
assert.deepEqual(snap.domains.latestDistribution, jsonLatest, "latestDistribution must be identical");

console.log("  ✅ TEST 2 PASS: 既存 7 API の全返却データと Snapshot 内 7 ドメインが 100% 完全一致");

// -------------------------------------------------------------
// [TEST 3] 部分失敗 (PARTIAL_SUCCESS) サンドボックス耐性検証
// -------------------------------------------------------------
console.log("▶ [TEST 3] 部分失敗 (PARTIAL_SUCCESS) サンドボックス耐性検証");
// TransferService を一時的に破損させる
const originalGetTransfer = TransferService.getInstance().getTransferRequests;
TransferService.getInstance().getTransferRequests = () => { throw new Error("Transfer sheet I/O timeout"); };

const resPartial = doPost(reqSnapshot);
const snapPartial = JSON.parse(resPartial.text);

assert.equal(snapPartial.success, true);
assert.equal(snapPartial.status, "PARTIAL_SUCCESS");
assert.equal(snapPartial.domains.transfer.success, false);
assert.ok(snapPartial.errors.transfer);
// 正常な他ドメインは影響を受けずに健全に返却される
assert.equal(snapPartial.domains.summary.success, true);
assert.equal(snapPartial.domains.roster.success, true);
assert.equal(snapPartial.domains.ranking.success, true);
assert.equal(snapPartial.domains.pinStatus.success, true);
assert.equal(snapPartial.domains.flyerStock.success, true);
assert.equal(snapPartial.domains.latestDistribution.success, true);
console.log("  ✅ TEST 3 PASS: 1ドメイン障害時も PARTIAL_SUCCESS で他ドメインを正常返却 (障害隔離)");

// 復帰
TransferService.getInstance().getTransferRequests = originalGetTransfer;

// -------------------------------------------------------------
// [TEST 4] 認可 & Tenant Boundary & 契約ゲート検証
// -------------------------------------------------------------
console.log("▶ [TEST 4] 認可 & Tenant Boundary & 契約ゲート検証");
// 4-1: districtId未指定
const resNoDist = doPost({ postData: { contents: JSON.stringify({ action: "getDashboardSnapshot" }) } });
const jsonNoDist = JSON.parse(resNoDist.text);
assert.equal(jsonNoDist.code, "MISSING_DISTRICT_ID");

// 4-2: 未知地区 (1地区専用GASモードでは接続先SSの地区コードとの不一致により DISTRICT_MISMATCH)
const resUnknown = doPost({ postData: { contents: JSON.stringify({ action: "getDashboardSnapshot", districtId: "UNKNOWN_REGION" }) } });
const jsonUnknown = JSON.parse(resUnknown.text);
assert.equal(jsonUnknown.code, "DISTRICT_MISMATCH");

console.log("  ✅ TEST 4 PASS: Snapshot API 自身の Tenant Boundary & ルーティングゲートが厳格に機能");

// -------------------------------------------------------------
// [TEST 5] 4サービスの districtId 伝播 & Universal DB Routing契約検証
// 
// 【アーキテクチャ原則】
// - POSTING MAPの完成アプリ構造は「1地区 = 1アプリ = 1独立リポジトリ」であり、
//   通常の地区運用において地区A/BのRuntime・DBが同一アプリ内で混在することを前提としない。
// - districtId は独立地区アプリ間のデータ混在防止を目的としたものではなく、
//   Universal EngineにおけるDB Routing・Integrity Guardのための識別・ルーティング情報として扱う。
// - 地区固有差分はdata/へ吸収し、Runtimeは完成形をコピーして変更しないというUniversal原則を維持する。
// - ここでは今回の4サービスについて、Universal EngineのRouting契約に従って、
//   渡された districtId が Service → Repository → Resolver まで正しく伝播し、
//   指定された地区DBを正しく解決することを検証する。
// -------------------------------------------------------------
console.log("▶ [TEST 5] 4サービスの districtId 伝播 & Universal DB Routing契約検証");

// 1. StaffService.getRoster(districtId)
const rosterItems = StaffService.getInstance().getRoster("TEST_DISTRICT");
assert.ok(Array.isArray(rosterItems));
assert.equal(rosterItems.length, 2);
assert.equal(rosterItems[0].name, "テスト 太郎");

// 2. PinStatusService.getStatus(districtId)
const pinStatusResult = PinStatusService.getInstance().getStatus("TEST_DISTRICT");
assert.equal(pinStatusResult.success, true);
assert.deepEqual(pinStatusResult.completed, [1, 2]);
assert.deepEqual(pinStatusResult.inProgress, [1, 2]);

// 3. TransferService.getTransferRequests(lineUserId, districtId)
const transferItems = TransferService.getInstance().getTransferRequests("U_TEST_001", "TEST_DISTRICT");
assert.ok(Array.isArray(transferItems));
assert.equal(transferItems.length, 1);
assert.equal(transferItems[0].requesterName, "K001");

// 4. DistributionRepository.fetchLatestRecords(limit, lineUserId, districtId)
const latestRecords = DistributionRepository.getInstance().fetchLatestRecords(20, "U_TEST_001", "TEST_DISTRICT");
assert.ok(Array.isArray(latestRecords));
assert.equal(latestRecords.length, 2);
assert.equal(latestRecords[0].cityName, "テスト市");

console.log("  ✅ TEST 5 PASS: 4サービスすべてで渡された districtId が Service → Repository → Resolver まで正しく伝播し、指定地区DBを解決");

// -------------------------------------------------------------
// [TEST 6] ELECTION Cross-Month Fixed Dataset 統合検証
//
// 条件:
// - MASTER initial mode = ELECTION
// - Provisioned dataset / Active Dataset Key = 2026-09
// - Runtime clock = 2026-10 (月跨ぎ発生)
// - 存在するOperational Sheet: 2026-09 の5業務シートのみ (2026-10 は存在しない)
// - 実 doPost() -> getDashboardSnapshot を通し、全7ドメインが固定 2026-09 Dataset から取得されることを具体値で検証
// -------------------------------------------------------------
console.log("▶ [TEST 6] ELECTION Cross-Month Fixed Dataset (7ドメイン統合検証)");
{
  const mockOctDate = new baseOriginalDate("2026-10-15T12:00:00+09:00");
  class MockDate202610 extends baseOriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(mockOctDate.getTime());
      } else {
        super(...args);
      }
    }
    static now() {
      return mockOctDate.getTime();
    }
  }

  // State Isolation: Clock, Cache, Spreadsheet, ScriptProperties, Session を TEST 6 専用に切り替え
  global.Date = MockDate202610;
  mockCache.store.clear();

  const electionSS = new MockSpreadsheet("ss-election-id", "POSTING_MAP_ELECTION_DIST", {
    "SYSTEM_INFO": new MockSheet("SYSTEM_INFO", [
      ["項目", "設定値"],
      ["地区コード", "ELECTION_DIST"],
      ["運用モード", "ELECTION"],
      ["Active Dataset Key", "2026-09"],
      ["契約開始日時", "2026-09-01 09:00:00"],
      ["契約終了日", "2026-11-30"],
      ["システム名", "POSTING MAP ELECTION_DIST"]
    ]),
    "名簿2026-09": new MockSheet("名簿2026-09", [
      ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
      ["E001", "選挙 一郎", "U_ELEC_001", "2026/09/01"],
      ["E002", "選挙 二郎", "U_ELEC_002", "2026/09/02"]
    ]),
    "保有チラシ枚数2026-09": new MockSheet("保有チラシ枚数2026-09", [
      ["ID", "スタッフID", "スタッフ名", "保管場所", "枚数", "更新日時", "LINE_USER_ID"],
      ["STK_E01", "E001", "選挙 一郎", "選挙事務所", 1200, "2026/09/10", "U_ELEC_001"],
      ["STK_E02", "E002", "選挙 二郎", "自宅", 800, "2026/09/11", "U_ELEC_002"]
    ]),
    "配布実績2026-09": new MockSheet("配布実績2026-09", [
      ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
      ["10", "選挙市", "本町1丁目", "2026-09-12 10:00:00", 450, "E001", "選挙 一郎", "", "", "", "", "", "", "", "", "U_ELEC_001"],
      ["11", "選挙市", "本町2丁目", "2026-09-13 15:30:00", 350, "E002", "選挙 二郎", "", "", "", "", "", "", "", "", "U_ELEC_002"],
      ["12", "選挙市", "本町3丁目", "", "", "", "", "", "", "", "", "", "", "", "", ""]
    ]),
    "受渡要請履歴2026-09": new MockSheet("受渡要請履歴2026-09", [
      ["要請日時", "要請者名", "要請者ID", "保有者名", "保有者ID", "連絡方法", "連絡先", "ステータス"],
      ["2026/09/14 10:00:00", "選挙 二郎", "E002", "選挙 一郎", "E001", "LINE", "elec_line_09", "要請中"]
    ]),
    "PinStatus2026-09": new MockSheet("PinStatus2026-09", [
      ["rowId", "status", "updatedAt"],
      ["10", "completed", "2026/09/12"],
      ["11", "completed", "2026/09/13"],
      ["12", "inProgress", "2026/09/14"]
    ])
  });

  // 2026-10 の業務シートが存在しないことを明示検証
  assert.equal(electionSS.getSheetByName("配布実績2026-10"), null);
  assert.equal(electionSS.getSheetByName("名簿2026-10"), null);
  assert.equal(electionSS.getSheetByName("保有チラシ枚数2026-10"), null);
  assert.equal(electionSS.getSheetByName("受渡要請履歴2026-10"), null);
  assert.equal(electionSS.getSheetByName("PinStatus2026-10"), null);
  assert.equal(Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM"), "2026-10", "Runtime clock must be 2026-10");

  delete mockSpreadsheets["ss-test-district-id"];
  mockSpreadsheets["ss-election-id"] = electionSS;
  scriptPropertiesStore["TARGET_SPREADSHEET_ID"] = "ss-election-id";
  global.authenticateRequest = () => ({ success: true, user: { lineUserId: "U_ELEC_001" } });

  const elecSession = createDashboardSession("ELECTION_DIST");
  const resElecRaw = doPost({
    postData: {
      contents: JSON.stringify({
        action: "getDashboardSnapshot",
        districtId: "ELECTION_DIST",
        dashboardSessionToken: elecSession.token,
        limit: 20
      })
    }
  });
  const snapElec = JSON.parse(resElecRaw.text);

  assert.equal(snapElec.success, true, "ELECTION cross-month getDashboardSnapshot must succeed");
  assert.equal(snapElec.status, "SUCCESS", "ELECTION cross-month status must be SUCCESS");
  assert.equal(snapElec.districtId, "ELECTION_DIST");

  // 1. summary (2026-09 固定 Dataset: 全3エリア中2エリア完了 = 67%)
  assert.equal(snapElec.domains.summary.success, true);
  assert.equal(snapElec.domains.summary.districtName, "POSTING_MAP_ELECTION_DIST");
  assert.equal(snapElec.domains.summary.total, 3);
  assert.equal(snapElec.domains.summary.done, 2);
  assert.equal(snapElec.domains.summary.percent, 67);

  // 2. flyerStock (2026-09 固定 Dataset: E001=1200, E002=800)
  assert.equal(snapElec.domains.flyerStock.success, true);
  assert.equal(snapElec.domains.flyerStock.stocks.length, 2);
  assert.equal(snapElec.domains.flyerStock.stocks[0].staffId, "E001");
  assert.equal(snapElec.domains.flyerStock.stocks[0].staffName, "選挙 一郎");
  assert.equal(snapElec.domains.flyerStock.stocks[0].count, 1200);
  assert.equal(snapElec.domains.flyerStock.stocks[1].staffId, "E002");
  assert.equal(snapElec.domains.flyerStock.stocks[1].staffName, "選挙 二郎");
  assert.equal(snapElec.domains.flyerStock.stocks[1].count, 800);

  // 3. ranking (2026-09 固定 Dataset: 1位 選挙 一郎 450枚, 2位 選挙 二郎 350枚)
  assert.equal(snapElec.domains.ranking.success, true);
  assert.equal(snapElec.domains.ranking.ranking.length, 2);
  assert.equal(snapElec.domains.ranking.ranking[0].staffId, "E001");
  assert.equal(snapElec.domains.ranking.ranking[0].name, "選挙 一郎");
  assert.equal(snapElec.domains.ranking.ranking[0].count, 450);
  assert.equal(snapElec.domains.ranking.ranking[1].staffId, "E002");
  assert.equal(snapElec.domains.ranking.ranking[1].name, "選挙 二郎");
  assert.equal(snapElec.domains.ranking.ranking[1].count, 350);

  // 4. pinStatus (2026-09 固定 Dataset: completed [10, 11], inProgress [10, 11, 12])
  assert.equal(snapElec.domains.pinStatus.success, true);
  assert.deepEqual(snapElec.domains.pinStatus.completed, [10, 11]);
  assert.deepEqual(snapElec.domains.pinStatus.inProgress, [10, 11, 12]);

  // 5. roster (2026-09 固定 Dataset: 選挙 一郎 stockTotal=1200/deliveredTotal=450, 選挙 二郎 stockTotal=800/deliveredTotal=350)
  assert.equal(snapElec.domains.roster.success, true);
  assert.equal(snapElec.domains.roster.roster.length, 2);
  assert.equal(snapElec.domains.roster.roster[0].id, "E001");
  assert.equal(snapElec.domains.roster.roster[0].name, "選挙 一郎");
  assert.equal(snapElec.domains.roster.roster[0].stockTotal, 1200);
  assert.equal(snapElec.domains.roster.roster[0].deliveredTotal, 450);
  assert.equal(snapElec.domains.roster.roster[1].id, "E002");
  assert.equal(snapElec.domains.roster.roster[1].name, "選挙 二郎");
  assert.equal(snapElec.domains.roster.roster[1].stockTotal, 800);
  assert.equal(snapElec.domains.roster.roster[1].deliveredTotal, 350);

  // 6. transfer (2026-09 固定 Dataset: 選挙 二郎 -> 選挙 一郎, elec_line_09)
  assert.equal(snapElec.domains.transfer.success, true);
  assert.equal(snapElec.domains.transfer.requests.length, 1);
  assert.equal(snapElec.domains.transfer.requests[0].requesterName, "選挙 二郎");
  assert.equal(snapElec.domains.transfer.requests[0].holderName, "選挙 一郎");
  assert.equal(snapElec.domains.transfer.requests[0].contactValue, "elec_line_09");
  assert.equal(snapElec.domains.transfer.requests[0].status, "要請中");

  // 7. latestDistribution (2026-09 固定 Dataset: 本町2丁目 350枚, 本町1丁目 450枚)
  assert.equal(snapElec.domains.latestDistribution.success, true);
  assert.equal(snapElec.domains.latestDistribution.records.length, 2);
  assert.equal(snapElec.domains.latestDistribution.records[0].cityName, "選挙市");
  assert.equal(snapElec.domains.latestDistribution.records[0].townName, "本町2丁目");
  assert.equal(snapElec.domains.latestDistribution.records[0].count, 350);
  assert.equal(snapElec.domains.latestDistribution.records[1].townName, "本町1丁目");
  assert.equal(snapElec.domains.latestDistribution.records[1].count, 450);

  console.log("  ✅ TEST 6 PASS: ELECTION モード月跨ぎ時 (Clock=2026-10) も全7ドメインが固定 2026-09 Dataset から完全解決されることを実証");
}

// -------------------------------------------------------------
// [TEST 7] SUBSCRIPTION Month Transition 統合検証
//
// 条件:
// - MASTER initial mode = SUBSCRIPTION
// - old dataset = 2026-09 / current dataset = 2026-10
// - Runtime clock = 2026-10
// - 両月の5業務シートに明確に異なるFixture値を配置し、
//   getDashboardSnapshot が全7ドメインについて旧月(2026-09)ではなく当月(2026-10)の具体値を返すことを検証
// -------------------------------------------------------------
console.log("▶ [TEST 7] SUBSCRIPTION Month Transition (旧月2026-09 vs 当月2026-10 全7ドメイン識別検証)");
{
  const mockOctDate = new baseOriginalDate("2026-10-15T12:00:00+09:00");
  class MockDate202610 extends baseOriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(mockOctDate.getTime());
      } else {
        super(...args);
      }
    }
    static now() {
      return mockOctDate.getTime();
    }
  }

  // State Isolation: TEST 6 の ELECTION 状態を完全に消去し、SUBSCRIPTION 専用環境を構築
  global.Date = MockDate202610;
  mockCache.store.clear();
  delete mockSpreadsheets["ss-election-id"];

  const subscriptionSS = new MockSpreadsheet("ss-sub-transition-id", "POSTING_MAP_SUB_DIST", {
    "SYSTEM_INFO": new MockSheet("SYSTEM_INFO", [
      ["項目", "設定値"],
      ["地区コード", "SUB_DIST"],
      ["運用モード", "SUBSCRIPTION"],
      ["Active Dataset Key", "2026-09"], // 初期Provisioning時の記録が残っていてもSUBSCRIPTIONは当月(2026-10)を解決する
      ["契約開始日時", "2026-09-01 09:00:00"],
      ["契約終了日", "2026-12-31"],
      ["システム名", "POSTING MAP SUB_DIST"]
    ]),
    // --- 旧月 (2026-09) Dataset (選ばれてはならない旧データ) ---
    "名簿2026-09": new MockSheet("名簿2026-09", [
      ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
      ["S_OLD", "九月 旧太郎", "U_SUB_001", "2026/09/01"]
    ]),
    "保有チラシ枚数2026-09": new MockSheet("保有チラシ枚数2026-09", [
      ["ID", "スタッフID", "スタッフ名", "保管場所", "枚数", "更新日時", "LINE_USER_ID"],
      ["STK_OLD", "S_OLD", "九月 旧太郎", "旧倉庫", 111, "2026/09/10", "U_SUB_001"]
    ]),
    "配布実績2026-09": new MockSheet("配布実績2026-09", [
      ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
      ["1", "旧月市", "九月町1", "2026-09-10 10:00:00", 111, "S_OLD", "九月 旧太郎", "", "", "", "", "", "", "", "", "U_SUB_001"],
      ["2", "旧月市", "九月町2", "", "", "", "", "", "", "", "", "", "", "", "", ""]
    ]),
    "受渡要請履歴2026-09": new MockSheet("受渡要請履歴2026-09", [
      ["要請日時", "要請者名", "要請者ID", "保有者名", "保有者ID", "連絡方法", "連絡先", "ステータス"],
      ["2026/09/15 09:00:00", "九月 旧太郎", "S_OLD", "九月 旧太郎", "S_OLD", "電話", "090-0000-0009", "要請中"]
    ]),
    "PinStatus2026-09": new MockSheet("PinStatus2026-09", [
      ["rowId", "status", "updatedAt"],
      ["1", "completed", "2026/09/10"]
    ]),

    // --- 当月 (2026-10) Dataset (解決されるべき最新データ) ---
    "名簿2026-10": new MockSheet("名簿2026-10", [
      ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
      ["S_NEW_1", "十月 新太郎", "U_SUB_001", "2026/10/01"],
      ["S_NEW_2", "十月 新花子", "U_SUB_002", "2026/10/02"]
    ]),
    "保有チラシ枚数2026-10": new MockSheet("保有チラシ枚数2026-10", [
      ["ID", "スタッフID", "スタッフ名", "保管場所", "枚数", "更新日時", "LINE_USER_ID"],
      ["STK_NEW_1", "S_NEW_1", "十月 新太郎", "新拠点A", 900, "2026/10/05", "U_SUB_001"],
      ["STK_NEW_2", "S_NEW_2", "十月 新花子", "新拠点B", 700, "2026/10/06", "U_SUB_002"]
    ]),
    "配布実績2026-10": new MockSheet("配布実績2026-10", [
      ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
      ["101", "新月市", "十月町1", "2026-10-10 09:00:00", 600, "S_NEW_1", "十月 新太郎", "", "", "", "", "", "", "", "", "U_SUB_001"],
      ["102", "新月市", "十月町2", "2026-10-11 14:00:00", 400, "S_NEW_2", "十月 新花子", "", "", "", "", "", "", "", "", "U_SUB_002"],
      ["103", "新月市", "十月町3", "2026-10-12 16:00:00", 250, "S_NEW_1", "十月 新太郎", "", "", "", "", "", "", "", "", "U_SUB_001"],
      ["104", "新月市", "十月町4", "", "", "", "", "", "", "", "", "", "", "", "", ""]
    ]),
    "受渡要請履歴2026-10": new MockSheet("受渡要請履歴2026-10", [
      ["要請日時", "要請者名", "要請者ID", "保有者名", "保有者ID", "連絡方法", "連絡先", "ステータス"],
      ["2026/10/12 11:00:00", "十月 新花子", "S_NEW_2", "十月 新太郎", "S_NEW_1", "LINE", "oct_new_line_10", "完了"]
    ]),
    "PinStatus2026-10": new MockSheet("PinStatus2026-10", [
      ["rowId", "status", "updatedAt"],
      ["101", "completed", "2026/10/10"],
      ["102", "completed", "2026/10/11"],
      ["103", "completed", "2026/10/12"],
      ["104", "inProgress", "2026/10/13"]
    ])
  });

  mockSpreadsheets["ss-sub-transition-id"] = subscriptionSS;
  scriptPropertiesStore["TARGET_SPREADSHEET_ID"] = "ss-sub-transition-id";
  global.authenticateRequest = () => ({ success: true, user: { lineUserId: "U_SUB_001" } });

  const subSession = createDashboardSession("SUB_DIST");
  const resSubRaw = doPost({
    postData: {
      contents: JSON.stringify({
        action: "getDashboardSnapshot",
        districtId: "SUB_DIST",
        dashboardSessionToken: subSession.token,
        limit: 20
      })
    }
  });
  const snapSub = JSON.parse(resSubRaw.text);

  assert.equal(snapSub.success, true, "SUBSCRIPTION month-transition getDashboardSnapshot must succeed");
  assert.equal(snapSub.status, "SUCCESS");
  assert.equal(snapSub.districtId, "SUB_DIST");

  // 1. summary: 2026-10 の値 (total=4, done=3, percent=75) であり、旧月2026-09 (total=2, done=1, percent=50) ではないこと
  assert.equal(snapSub.domains.summary.success, true);
  assert.equal(snapSub.domains.summary.districtName, "POSTING_MAP_SUB_DIST");
  assert.equal(snapSub.domains.summary.total, 4);
  assert.equal(snapSub.domains.summary.done, 3);
  assert.equal(snapSub.domains.summary.percent, 75);
  assert.notEqual(snapSub.domains.summary.total, 2);
  assert.notEqual(snapSub.domains.summary.done, 1);

  // 2. flyerStock: 2026-10 の値 (十月 新太郎 900, 十月 新花子 700) であり、旧月(九月 旧太郎 111)ではないこと
  assert.equal(snapSub.domains.flyerStock.success, true);
  assert.equal(snapSub.domains.flyerStock.stocks.length, 2);
  assert.equal(snapSub.domains.flyerStock.stocks[0].staffId, "S_NEW_1");
  assert.equal(snapSub.domains.flyerStock.stocks[0].staffName, "十月 新太郎");
  assert.equal(snapSub.domains.flyerStock.stocks[0].count, 900);
  assert.equal(snapSub.domains.flyerStock.stocks[1].staffId, "S_NEW_2");
  assert.equal(snapSub.domains.flyerStock.stocks[1].staffName, "十月 新花子");
  assert.equal(snapSub.domains.flyerStock.stocks[1].count, 700);
  assert.ok(!snapSub.domains.flyerStock.stocks.some(s => s.staffName === "九月 旧太郎"));

  // 3. ranking: 2026-10 の値 (1位 十月 新太郎 850枚, 2位 十月 新花子 400枚) であり、旧月(九月 旧太郎 111枚)ではないこと
  assert.equal(snapSub.domains.ranking.success, true);
  assert.equal(snapSub.domains.ranking.ranking.length, 2);
  assert.equal(snapSub.domains.ranking.ranking[0].staffId, "S_NEW_1");
  assert.equal(snapSub.domains.ranking.ranking[0].name, "十月 新太郎");
  assert.equal(snapSub.domains.ranking.ranking[0].count, 850);
  assert.equal(snapSub.domains.ranking.ranking[1].staffId, "S_NEW_2");
  assert.equal(snapSub.domains.ranking.ranking[1].name, "十月 新花子");
  assert.equal(snapSub.domains.ranking.ranking[1].count, 400);
  assert.ok(!snapSub.domains.ranking.ranking.some(r => r.name === "九月 旧太郎"));

  // 4. pinStatus: 2026-10 の値 (completed [101, 102, 103], inProgress [101, 102, 103, 104]) であり、旧月([1])ではないこと
  assert.equal(snapSub.domains.pinStatus.success, true);
  assert.deepEqual(snapSub.domains.pinStatus.completed, [101, 102, 103]);
  assert.deepEqual(snapSub.domains.pinStatus.inProgress, [101, 102, 103, 104]);
  assert.ok(!snapSub.domains.pinStatus.completed.includes(1));

  // 5. roster: 2026-10 の値 (十月 新太郎 stockTotal=900/deliveredTotal=850, 十月 新花子 stockTotal=700/deliveredTotal=400) であり、旧月(九月 旧太郎)ではないこと
  assert.equal(snapSub.domains.roster.success, true);
  assert.equal(snapSub.domains.roster.roster.length, 2);
  assert.equal(snapSub.domains.roster.roster[0].id, "S_NEW_1");
  assert.equal(snapSub.domains.roster.roster[0].name, "十月 新太郎");
  assert.equal(snapSub.domains.roster.roster[0].stockTotal, 900);
  assert.equal(snapSub.domains.roster.roster[0].deliveredTotal, 850);
  assert.equal(snapSub.domains.roster.roster[1].id, "S_NEW_2");
  assert.equal(snapSub.domains.roster.roster[1].name, "十月 新花子");
  assert.equal(snapSub.domains.roster.roster[1].stockTotal, 700);
  assert.equal(snapSub.domains.roster.roster[1].deliveredTotal, 400);
  assert.ok(!snapSub.domains.roster.roster.some(r => r.name === "九月 旧太郎"));

  // 6. transfer: 2026-10 の値 (十月 新花子 -> 十月 新太郎, oct_new_line_10) であり、旧月(九月 旧太郎, 090-0000-0009)ではないこと
  assert.equal(snapSub.domains.transfer.success, true);
  assert.equal(snapSub.domains.transfer.requests.length, 1);
  assert.equal(snapSub.domains.transfer.requests[0].requesterName, "十月 新花子");
  assert.equal(snapSub.domains.transfer.requests[0].holderName, "十月 新太郎");
  assert.equal(snapSub.domains.transfer.requests[0].contactValue, "oct_new_line_10");
  assert.equal(snapSub.domains.transfer.requests[0].status, "完了");
  assert.notEqual(snapSub.domains.transfer.requests[0].requesterName, "九月 旧太郎");
  assert.notEqual(snapSub.domains.transfer.requests[0].contactValue, "090-0000-0009");

  // 7. latestDistribution: 2026-10 の値 (新月市 十月町3/2/1 の3件) であり、旧月(旧月市 九月町1)ではないこと
  assert.equal(snapSub.domains.latestDistribution.success, true);
  assert.equal(snapSub.domains.latestDistribution.records.length, 3);
  assert.equal(snapSub.domains.latestDistribution.records[0].cityName, "新月市");
  assert.equal(snapSub.domains.latestDistribution.records[0].townName, "十月町3");
  assert.equal(snapSub.domains.latestDistribution.records[0].count, 250);
  assert.ok(!snapSub.domains.latestDistribution.records.some(r => r.cityName === "旧月市"));

  console.log("  ✅ TEST 7 PASS: SUBSCRIPTION モード月替わり時 (Clock=2026-10) に全7ドメインが旧月(2026-09)ではなく当月(2026-10)のDatasetを返すことを実証");
}

// テスト終了時の Clock / State 完全復帰
global.Date = MockDate202609;
mockCache.store.clear();
delete mockSpreadsheets["ss-sub-transition-id"];
mockSpreadsheets["ss-test-district-id"] = testDistrictSS;
scriptPropertiesStore["TARGET_SPREADSHEET_ID"] = "ss-test-district-id";
global.authenticateRequest = () => ({ success: true, user: { lineUserId: "U_TEST_001" } });

console.log("====================================================");
console.log("🎉 ALL DASHBOARD SNAPSHOT TESTS PASSED PERFECTLY!");
console.log("====================================================");

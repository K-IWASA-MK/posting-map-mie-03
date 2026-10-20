import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log("====================================================");
console.log("🖥️ STEP 4 MANAGER UI INTERACTION & RENDERING RIGOROUS TEST");
console.log("====================================================");

// ブラウザ環境モックの構築
const mockWindow = {
  location: { search: "" },
  PMS_CLIENT_CONFIG: {
    districtId: "KUWANA",
    api: { gasWebAppUrl: "https://script.google.com/test" },
    staticMaster: {
      addressCsvFilename: "address_master.csv",
      boundariesGeojsonFilename: "boundaries.geojson",
      electionHistoryFilename: "election_history.json"
    }
  },
  addEventListener: () => {},
  removeEventListener: () => {}
};
const createMockElement = () => ({
  style: {},
  classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
  innerHTML: '',
  textContent: '',
  className: '',
  value: '',
  focus: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  getAttribute: () => '',
  appendChild: () => {},
  cloneNode: () => createMockElement()
});

const mockDocument = {
  getElementById: (id) => createMockElement(),
  querySelectorAll: () => [],
  querySelector: () => createMockElement(),
  createElement: () => createMockElement(),
  addEventListener: () => {},
  removeEventListener: () => {}
};

let layerClearCount = 0;
let renderCurrentViewCount = 0;
let renderMainStageMailCount = 0;
let mapSetViewCount = 0;

const mockMap = {
  setView: () => { mapSetViewCount++; },
  getZoom: () => 14,
  getCenter: () => ({ lat: 35.06, lng: 136.68 }),
  hasLayer: () => true,
  getPane: () => null,
  createPane: () => createMockElement(),
  on: () => {},
  invalidateSize: () => {}
};
const mockLayer = {
  clearLayers: () => { layerClearCount++; },
  addLayer: () => {},
  addTo: () => mockLayer
};

// Node VM 内で manager.js を評価
const managerCode = fs.readFileSync(path.join(process.cwd(), "active/manager/manager.js"), 'utf8');

let mockApiResponseHandler = null;

const sandbox = {
  window: mockWindow,
  document: mockDocument,
  navigator: { onLine: true },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  URLSearchParams: URLSearchParams,
  AbortController: class {
    constructor() { this.signal = {}; }
    abort() {}
  },
  fetch: async (url, options) => {
    if (!options || !options.body) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({})
      };
    }
    const bodyObj = JSON.parse(options.body);
    const result = mockApiResponseHandler ? await mockApiResponseHandler(bodyObj.action, bodyObj) : { success: false };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(result),
      json: async () => result
    };
  },
  getApiUrl: () => "https://script.google.com/test",
  L: {
    map: () => mockMap,
    layerGroup: () => mockLayer,
    circleMarker: () => ({ bindPopup: () => {}, on: () => {}, addTo: () => {} }),
    marker: () => ({ bindPopup: () => {}, on: () => {} }),
    icon: () => ({}),
    divIcon: () => ({}),
    geoJSON: () => ({ addTo: () => {} })
  },
  _isSyncing: false,
  _isDashboardInitialized: true,
  _hasAppliedPinStatus: false
};

vm.createContext(sandbox);

// 補助関数のスタブ注入
sandbox.setSyncStatus = (status) => {};
sandbox.showManagerPinGate = () => {};

// manager.js をサンドボックスに読み込む
vm.runInContext(managerCode, sandbox);

// -------------------------------------------------------------
// [UI TEST 1] マーカー差分更新検知: ピン状態不変時の再描画ゼロ検証
// -------------------------------------------------------------
console.log("▶ [UI TEST 1] ピン状態不変時の Leaflet マーカー再描画スキップ検証");
Object.assign(sandbox.window.DashboardState, {
  districtId: "KUWANA",
  selectedCity: 'ALL',
  summary: { total: 100, done: 20 },
  stocks: [{ staffId: "K001", count: 500 }],
  roster: [{ id: "K001", name: "桑名 太郎" }],
  requests: [{ requestId: "REQ001" }],
  ranking: [{ staffId: "K001", count: 150 }],
  liveRecords: [],
  globalPinStatus: { inProgress: [2], completed: [1] },
  currentFocus: 'map',
  map: mockMap,
  markersLayer: mockLayer,
  masterPins: [{ rowId: 1, cityName: 'サンプル市', lat: 35.0, lng: 136.0 }, { rowId: 2, cityName: 'サンプル市', lat: 35.1, lng: 136.1 }]
});
sandbox._hasAppliedPinStatus = true; // 初回適用済み

layerClearCount = 0;

// 同期レスポンス: ピン状態に変更なし
mockApiResponseHandler = (action, params) => {
  return {
    success: true,
    status: "SUCCESS",
    domains: {
      summary: { success: true, total: 100, done: 20 },
      flyerStock: { success: true, stocks: [{ staffId: "K001", count: 500 }] },
      ranking: { success: true, ranking: [{ staffId: "K001", count: 150 }] },
      pinStatus: { success: true, inProgress: [2], completed: [1] }, // 変更なし
      roster: { success: true, roster: [{ id: "K001", name: "桑名 太郎" }] },
      transfer: { success: true, requests: [{ requestId: "REQ001" }] },
      latestDistribution: { success: true, records: [] }
    }
  };
};

// 1回目 (初回同期): 初回適用フラグが立っていないためマーカーが初期描画される
await sandbox.syncDashboardData();
assert.equal(layerClearCount, 1, "初回同期時はマーカーが 1 回初期描画されること");

// カウンターリセット
layerClearCount = 0;

// 2回目 (ピン状態不変の定期同期): マーカー再描画が完全にスキップされること
await sandbox.syncDashboardData();

assert.equal(layerClearCount, 0, "ピン状態が変化していない場合、マーカーレイヤーのクリア・再生成は行われてはならない (0回)");
assert.equal(mapSetViewCount, 0, "地図の視点 (setView/ズーム/センター) はリセットされてはならない (0回)");
console.log("  ✅ UI TEST 1 PASS: ピン不変時、マーカー再描画回数 = 0 回 (地図のパン・ズーム・選択ピンが完全維持)");

// -------------------------------------------------------------
// [UI TEST 2] マーカー差分検知: ピン状態変更時のみ差分再描画される検証
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 2] ピン状態変化時の差分再描画検知");
layerClearCount = 0;

// 同期レスポンス: ピン状態に変化あり (completed に 2 が追加)
mockApiResponseHandler = (action, params) => {
  return {
    success: true,
    status: "SUCCESS",
    domains: {
      summary: { success: true, total: 100, done: 21 },
      flyerStock: { success: true, stocks: [] },
      ranking: { success: true, ranking: [] },
      pinStatus: { success: true, inProgress: [], completed: [1, 2] }, // 変化あり
      roster: { success: true, roster: [] },
      transfer: { success: true, requests: [] },
      latestDistribution: { success: true, records: [] }
    }
  };
};

await sandbox.syncDashboardData();

assert.equal(layerClearCount, 1, "ピン状態が変化した場合、マーカーレイヤーが的確に 1 回クリア・再描画されること");
console.log("  ✅ UI TEST 2 PASS: ピン状態変化時のみ的確に 1 回マーカー更新が実行される");

// -------------------------------------------------------------
// [UI TEST 3] 人間操作状態保持: タブ選択・画面切替・スクロール位置の維持
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 3] 人間操作状態保持 (タブ選択・画面フォーカス・スクロール)");
sandbox.window.DashboardState.currentFocus = 'mail';
sandbox.window.DashboardState.selectedMailTabIndex = 2; // 管理者が「受渡要請」タブを選択中

// 同期実行
await sandbox.syncDashboardData();

assert.equal(sandbox.window.DashboardState.currentFocus, 'mail', "画面フォーカスは維持されること");
assert.equal(sandbox.window.DashboardState.selectedMailTabIndex, 2, "タブインデックス (2) が同期でリセットされないこと");
console.log("  ✅ UI TEST 3 PASS: 同期実行中も管理者のタブ選択状態 (Index 2) およびフォーカスが完全保持");

// -------------------------------------------------------------
// [UI TEST 4] 部分失敗 (PARTIAL_SUCCESS) 時の既存表示保持
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 4] 部分失敗時の既存データ保持 (No Blanking / No Reset)");
// 既存データ設定
sandbox.window.DashboardState.stocks = [{ staffId: "K001", count: 500 }];
sandbox.window.DashboardState.requests = [{ requestId: "REQ001" }];

// 一部ドメイン (flyerStock, transfer) が失敗したレスポンス
mockApiResponseHandler = (action, params) => {
  return {
    success: true,
    status: "PARTIAL_SUCCESS",
    domains: {
      summary: { success: true, total: 100, done: 20 },
      flyerStock: { success: false, error: "Sheet lock timeout" }, // 失敗
      ranking: { success: true, ranking: [] },
      pinStatus: { success: true, inProgress: [], completed: [1] },
      roster: { success: true, roster: [] },
      transfer: { success: false, error: "Network timeout" }, // 失敗
      latestDistribution: { success: true, records: [] }
    },
    errors: { flyerStock: "Sheet lock timeout", transfer: "Network timeout" }
  };
};

await sandbox.syncDashboardData();

// 失敗ドメインのデータが空配列にリセットされず、直前状態が保持されていること
assert.equal(sandbox.window.DashboardState.stocks.length, 1, "失敗した在庫ドメインは空クリアされず既存表示を保持");
assert.equal(sandbox.window.DashboardState.requests.length, 1, "失敗した受渡要請ドメインは空クリアされず既存表示を保持");
console.log("  ✅ UI TEST 4 PASS: ドメイン障害時も既存表示データが完全保持され、画面のブランク・点滅がゼロ");

// -------------------------------------------------------------
// [UI TEST 5] 掲示板初期バックグラウンドプリフェッチ・ライフサイクル契約 (Gates A - H)
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 5] Bulletin Initial Background Prefetch Lifecycle Contract (Gates A - H)");

const apiCallLog = [];
mockApiResponseHandler = (action, params) => {
  apiCallLog.push({ action, params, timestamp: Date.now() });
  if (action === 'getDashboardSnapshot') {
    return {
      success: true,
      domains: {
        summary: { success: true, total: 100, done: 20 },
        flyerStock: { success: true, stocks: [] },
        ranking: { success: true, ranking: [] },
        pinStatus: { success: true, inProgress: [], completed: [1] },
        roster: { success: true, roster: [] },
        transfer: { success: true, requests: [] },
        latestDistribution: { success: true, records: [] }
      }
    };
  }
  if (action === 'getBulletinPosts') {
    return {
      success: true,
      posts: [
        { rowId: 1, staffId: 'S001', staffName: 'スタッフA', message: 'テスト投稿', createdAt: '2026-10-09 10:00:00' }
      ]
    };
  }
  return { success: true };
};

// [Gate A & B] Initial Lifecycle Order & Task Execution
sandbox._isDashboardInitialized = false;
sandbox.window.DashboardState.bulletinPosts = null;
sandbox._activeBulletinPromise = null;
sandbox._lastBulletinFetchTime = 0;
apiCallLog.length = 0;

const lifecyclePromise = sandbox.startDashboardLifecycle();
await lifecyclePromise;

// Gate A: getDashboardSnapshot は getBulletinPosts より厳密に先に開始・実行される (Snapshot settled, Bulletin not yet started in timer task)
assert.ok(apiCallLog.length >= 1, "getDashboardSnapshot が実行されること");
assert.equal(apiCallLog[0].action, 'getDashboardSnapshot', "初回の最優先 API は getDashboardSnapshot であること");
const bulletinBeforeTimer = apiCallLog.find(c => c.action === 'getBulletinPosts');
assert.equal(bulletinBeforeTimer, undefined, "Dashboard 起動・初期同期完了時点では getBulletinPosts はまだ発火していないこと (setTimeout(0) タスク前)");
console.log("  ✅ Gate A PASS: Initial lifecycle: getDashboardSnapshot occurs before getBulletinPosts");

// Gate B: Snapshot settle 後、setTimeout(0) タスクの消化により getBulletinPosts が厳密に 1 回実行される
await new Promise(resolve => setTimeout(resolve, 50));

const bulletinCalls = apiCallLog.filter(c => c.action === 'getBulletinPosts');
assert.equal(bulletinCalls.length, 1, "Snapshot settle 後のマクロタスクで getBulletinPosts が厳密に 1 回だけ先読みされること");
assert.ok(sandbox.window.DashboardState.bulletinPosts !== null, "DashboardState.bulletinPosts にキャッシュが格納されること");
assert.equal(sandbox.window.DashboardState.bulletinPosts.length, 1, "キャッシュされた投稿データが保持されていること");
assert.ok(apiCallLog[0].timestamp <= bulletinCalls[0].timestamp, "Snapshot 通信が Bulletin 先読み通信より時系列上先に行われていること");
console.log("  ✅ Gate B PASS: After Snapshot settles + timer task executes: getBulletinPosts exactly once");

// [Gate C] 30-Second Style Standalone Sync Isolation
apiCallLog.length = 0;
await sandbox.syncDashboardData();

const snapCallsC = apiCallLog.filter(c => c.action === 'getDashboardSnapshot');
const bulletinCallsC = apiCallLog.filter(c => c.action === 'getBulletinPosts');
assert.equal(snapCallsC.length, 1, "30秒定期同期で getDashboardSnapshot は実行されること");
assert.equal(bulletinCallsC.length, 0, "30秒定期同期で getBulletinPosts は決して再実行されないこと");
console.log("  ✅ Gate C PASS: 30-second sync: getDashboardSnapshot runs, getBulletinPosts does NOT run again");

// [Gate D] Visibility-Style Sync Isolation
apiCallLog.length = 0;
await sandbox.syncDashboardData();
const bulletinCallsD = apiCallLog.filter(c => c.action === 'getBulletinPosts');
assert.equal(bulletinCallsD.length, 0, "タブ復帰同期で getBulletinPosts は決して再実行されないこと");
console.log("  ✅ Gate D PASS: visibility sync: getBulletinPosts does NOT run again");

// [Gate E] Prefetch in-flight + Bulletin Open (In-Flight Dedup)
sandbox.window.DashboardState.bulletinPosts = null;
sandbox._activeBulletinPromise = null;
sandbox._lastBulletinFetchTime = 0;
apiCallLog.length = 0;

let resolveDelayedBulletin;
const delayedBulletinPromise = new Promise(res => { resolveDelayedBulletin = res; });
mockApiResponseHandler = (action, params) => {
  apiCallLog.push({ action, params, timestamp: Date.now() });
  if (action === 'getBulletinPosts') {
    return delayedBulletinPromise.then(() => ({
      success: true,
      posts: [{ rowId: 2, staffId: 'S002', message: '遅延投稿' }]
    }));
  }
  return { success: true };
};

// プリフェッチ開始 (in-flight 化)
const inFlightPrefetch = sandbox.renderMainStageBulletin();
assert.equal(apiCallLog.filter(c => c.action === 'getBulletinPosts').length, 1, "プリフェッチ通信が 1 回発火");

// 通信中にユーザーが掲示板を開く (switchView)
sandbox.switchView('bulletin');
assert.equal(apiCallLog.filter(c => c.action === 'getBulletinPosts').length, 1, "通信中に掲示板を開いても総通信回数は 1 回を維持 (Dedup)");

// 通信解決
resolveDelayedBulletin();
await inFlightPrefetch;
assert.equal(sandbox.window.DashboardState.bulletinPosts.length, 1, "通信完了後にキャッシュが正常更新されること");
console.log("  ✅ Gate E PASS: prefetch in-flight + Bulletin open: total getBulletinPosts count remains 1");

// [Gate F] Prefetch Completed + Bulletin Open < 30 sec (Cache Hit)
apiCallLog.length = 0;
sandbox.window.DashboardState.currentFocus = 'areas';
sandbox.switchView('bulletin');
const bulletinCallsF = apiCallLog.filter(c => c.action === 'getBulletinPosts');
assert.equal(bulletinCallsF.length, 0, "30秒TTL内の掲示板表示は追加 API ゼロ (即時描画)");
console.log("  ✅ Gate F PASS: prefetch completed + Bulletin open <30sec: additional API count = 0");

// [Gate G] Prefetch Failure Resilience & Retry
sandbox.window.DashboardState.bulletinPosts = null;
sandbox._activeBulletinPromise = null;
sandbox._lastBulletinFetchTime = 0;
apiCallLog.length = 0;

mockApiResponseHandler = (action, params) => {
  apiCallLog.push({ action, params, timestamp: Date.now() });
  if (action === 'getBulletinPosts') {
    return { success: false, message: "Server error" };
  }
  return { success: true };
};

await sandbox.renderMainStageBulletin();
assert.equal(sandbox.window.DashboardState.bulletinPosts, null, "失敗時はキャッシュが null のまま");

mockApiResponseHandler = (action, params) => {
  apiCallLog.push({ action, params, timestamp: Date.now() });
  if (action === 'getBulletinPosts') {
    return { success: true, posts: [{ rowId: 3, message: 'リトライ成功' }] };
  }
  return { success: true };
};

apiCallLog.length = 0;
await sandbox.renderMainStageBulletin();
assert.equal(apiCallLog.filter(c => c.action === 'getBulletinPosts').length, 1, "失敗後に掲示板を開いた際、正しく再取得が発火");
assert.equal(sandbox.window.DashboardState.bulletinPosts.length, 1, "再取得後にキャッシュが正常設定");
console.log("  ✅ Gate G PASS: prefetch failed: later Bulletin open retries normally");

// [Gate H] Force Refresh (force: true)
apiCallLog.length = 0;
await sandbox.renderMainStageBulletin({ force: true });
assert.equal(apiCallLog.filter(c => c.action === 'getBulletinPosts').length, 1, "force: true は即座に強制再取得を発火");
console.log("  ✅ Gate H PASS: force:true: existing manual refresh still performs API refresh");

// -------------------------------------------------------------
// [UI TEST 6] DASHBOARD-TURNOUT-001 + DASHBOARD-AREA-DESKTOP-001
// Desktop 2-Level Drilldown, Single Municipality 1-Level Preservation,
// Turnout Common SSOT & Mobile Isolation Verification (21 Acceptance Gates)
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 6] Desktop 2-Level Drilldown & Turnout Common SSOT Contract (21 Gates)");

{
  const domMap = new Map();
  const createRichEl = (tag = 'div', id = '') => {
    const attrs = new Map();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      id,
      style: {},
      className: '',
      textContent: '',
      _innerHTML: '',
      onclick: null,
      children,
      previousElementSibling: null,
      classList: {
        add: (...cls) => {
          const set = new Set(el.className.split(/\s+/).filter(Boolean));
          cls.forEach(c => set.add(c));
          el.className = Array.from(set).join(' ');
        },
        remove: (...cls) => {
          const set = new Set(el.className.split(/\s+/).filter(Boolean));
          cls.forEach(c => set.delete(c));
          el.className = Array.from(set).join(' ');
        },
        contains: (c) => el.className.split(/\s+/).filter(Boolean).includes(c),
        toggle: (c) => {
          if (el.classList.contains(c)) el.classList.remove(c);
          else el.classList.add(c);
        }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.has(k) ? attrs.get(k) : null,
      appendChild: (child) => {
        if (children.length > 0) {
          child.previousElementSibling = children[children.length - 1];
        }
        children.push(child);
        return child;
      },
      querySelectorAll: (selector) => {
        if (selector === 'button[data-town-id]') {
          return children.filter(c => c.getAttribute && c.getAttribute('data-town-id') !== null);
        }
        if (selector === 'button[data-city-val]') {
          return children.filter(c => c.getAttribute && c.getAttribute('data-city-val') !== null);
        }
        return [];
      },
      querySelector: (selector) => {
        if (selector === '.town-check' || selector === '.city-check') {
          return {
            get textContent() {
              const m = el._innerHTML.match(/<span[^>]*class="[^"]*(?:town-check|city-check)[^"]*"[^>]*>([^<]*)<\/span>/);
              return m ? m[1] : '';
            },
            set textContent(v) {
              el._innerHTML = el._innerHTML.replace(
                /(<span[^>]*class="[^"]*(?:town-check|city-check)[^"]*"[^>]*>)[^<]*(<\/span>)/,
                `$1${v}$2`
              );
            }
          };
        }
        return null;
      }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._innerHTML; },
      set(val) {
        el._innerHTML = String(val);
        if (val === '') {
          children.length = 0;
        }
      }
    });
    return el;
  };

  const getEl = (id) => {
    if (!domMap.has(id)) {
      domMap.set(id, createRichEl('div', id));
    }
    return domMap.get(id);
  };

  // Setup header title + count sibling relationship in #area-selector-card
  const headerTitleEl = createRichEl('span', 'area-selector-title');
  headerTitleEl.innerHTML = '<span>📍</span> エリア選択';
  const countEl = getEl('area-selector-count');
  countEl.previousElementSibling = headerTitleEl;

  // Override document methods for rich DOM inspection
  mockDocument.getElementById = (id) => getEl(id);
  mockDocument.createElement = (tag) => createRichEl(tag);

  let fitBoundsCalls = [];
  let setViewCalls = [];
  let lastCreatedMarkers = [];
  mockMap.fitBounds = (bounds, opts) => { fitBoundsCalls.push({ bounds, opts }); };
  mockMap.setView = (coords, zoom, opts) => { setViewCalls.push({ coords, zoom, opts }); };
  sandbox.L.latLngBounds = (coords) => ({ coords });
  sandbox.L.circleMarker = (latlng, opts) => {
    const handlers = {};
    const marker = {
      latlng,
      opts,
      on: (evt, fn) => { handlers[evt] = fn; },
      trigger: (evt) => { if (handlers[evt]) handlers[evt](); }
    };
    lastCreatedMarkers.push(marker);
    return marker;
  };

  // Sample dynamic multi-municipality dataset (3 cities, 5 pins)
  const cityA = '市町村A';
  const cityB = '市町村B';
  const cityC = '市町村C';
  const samplePins = [
    { rowId: 1, cityName: cityA, townName: 'A町一丁目', fullName: `${cityA} A町一丁目`, lat: 35.01, lng: 136.61, households: 100, population: 250 },
    { rowId: 2, cityName: cityA, townName: 'A町二丁目', fullName: `${cityA} A町二丁目`, lat: 35.02, lng: 136.62, households: 120, population: 300 },
    { rowId: 3, cityName: cityB, townName: 'B町本町', fullName: `${cityB} B町本町`, lat: 35.05, lng: 136.65, households: 200, population: 500 },
    { rowId: 4, cityName: cityB, townName: 'B町栄町', fullName: `${cityB} B町栄町`, lat: 35.06, lng: 136.66, households: 180, population: 420 },
    { rowId: 5, cityName: cityC, townName: 'C町中央', fullName: `${cityC} C町中央`, lat: 35.10, lng: 136.70, households: 150, population: 350 }
  ];

  const sampleElectionData = {
    elections: [
      {
        electionId: 'EL-2026',
        electionType: 'general',
        electionName: '2026総選挙',
        year: '2026',
        electionDate: '2026-02-08',
        eligibleVoters: 400000,
        voters: 235200,
        turnout: 58.80,
        districtTurnout: 58.80,
        municipalities: {
          [cityA]: 64.07,
          [cityB]: 58.25
          // cityC is intentionally missing to test Gate 14 & 15 (no false fallback to 58.80)
        }
      },
      {
        electionId: 'EL-2024',
        electionType: 'general',
        electionName: '2024総選挙',
        year: '2024',
        electionDate: '2024-10-27',
        turnout: 56.64,
        districtTurnout: 56.64,
        municipalities: {
          [cityA]: 62.34,
          [cityB]: 56.82
        }
      },
      {
        electionId: 'EL-2021',
        electionType: 'general',
        electionName: '2021総選挙',
        year: '2021',
        electionDate: '2021-10-31',
        turnout: 55.31,
        districtTurnout: 55.31,
        municipalities: {
          [cityA]: 60.94,
          [cityB]: 55.16
        }
      }
    ]
  };

  // --- [Single Municipality: Gates 1 & 2] ---
  const singlePins = samplePins.filter(p => p.cityName === cityA);
  Object.assign(sandbox.window.DashboardState, {
    cities: [cityA],
    masterPins: singlePins,
    masterLoadStatus: 'LOADED',
    selectedCity: 'ALL',
    selectedTownId: 'ALL',
    selectedPin: null,
    desktopAreaSelectorView: 'CITIES',
    electionTurnout: {
      elections: [
        { year: '2025', electionDate: '2025-11-01', electionName: '市議選', turnout: 49.12 },
        { year: '2021', electionDate: '2021-11-01', electionName: '市議選', turnout: 47.00 }
      ]
    }
  });

  sandbox.populateAreaSelector(singlePins);
  const pcListSingle = getEl('area-selector-list');
  assert.equal(getEl('area-selector-count').textContent, 2, "Gate 1a: 単一自治体モードのバッジは全町丁目数(2)");
  assert.equal(pcListSingle.children.length, 3, "Gate 1b: 単一自治体モードのDesktop左ナビは『全域 + 2町丁目』の1層構造を維持");
  assert.equal(pcListSingle.children[1].getAttribute('data-town-id'), '1', "Gate 1c: 単一自治体モードでは最初から町丁目ボタンが並ぶ");

  const singleTurnout = sandbox.getMunicipalityTurnout(sandbox.window.DashboardState.electionTurnout, cityA);
  assert.equal(singleTurnout.turnout, '49.12', "Gate 2: 単一自治体コンテキスト(cities.length<=1)では自治体別構造が無くてもトップレベルturnoutを正常利用");
  console.log("  ✅ Gates 1-2 PASS: Single Municipality 1-layer preserved & top-level turnout resolved");

  // --- [Multi Municipality: Gates 3, 4, 5, 6, 7, 8, 9, 10, 11] ---
  Object.assign(sandbox.window.DashboardState, {
    cities: [cityA, cityB, cityC],
    masterPins: samplePins,
    masterLoadStatus: 'LOADED',
    selectedCity: 'ALL',
    selectedTownId: 'ALL',
    selectedPin: null,
    desktopAreaSelectorView: 'CITIES',
    electionTurnout: sampleElectionData
  });

  sandbox.populateAreaSelector(samplePins);
  sandbox.renderCurrentView();

  const pcList = getEl('area-selector-list');
  const mobileList = getEl('mobile-city-selector-list');

  // Gate 3 & 4: Desktop initial view is Layer 1 (municipalities only, 0 towns in Desktop DOM)
  assert.equal(sandbox.window.DashboardState.desktopAreaSelectorView, 'CITIES', "Gate 3a: 複数自治体モードの初期状態は CITIES");
  assert.equal(getEl('area-selector-count').textContent, 3, "Gate 3b: 第1層の件数バッジは動的市町村数(3)");
  assert.equal(pcList.children.length, 4, "Gate 3c: 第1層リストは『全域 + 3市町村』の4件のみ");
  assert.equal(pcList.querySelectorAll('button[data-town-id]').length, 0, "Gate 4: 初期Desktop左ナビDOMには町丁目(data-town-id)を1件も展開しない");
  assert.ok( getEl('right-slot-top').innerHTML.includes('58.80'), "初期全域表示の投票率は 58.80%");
  console.log("  ✅ Gates 3-4 PASS: Multi Municipality initial Desktop view shows only municipalities (0 towns)");

  // Gate 5, 6, 7: Click Municipality (cityB) -> Layer 2 towns, MAP/KPI linkage, Municipality turnout
  fitBoundsCalls = [];
  lastCreatedMarkers = [];
  const cityBBtn = pcList.children.find(b => b.getAttribute('data-city-val') === cityB);
  assert.ok(cityBBtn, "第1層に市町村Bボタンが存在");
  cityBBtn.onclick({ stopPropagation: () => {} });

  assert.equal(sandbox.window.DashboardState.desktopAreaSelectorView, 'TOWNS', "Gate 5a: 市町村クリックで TOWNS 第2層へ遷移");
  assert.equal(sandbox.window.DashboardState.selectedCity, cityB, "Gate 5b: selectedCity が市町村Bに更新");
  assert.equal(getEl('area-selector-count').textContent, 2, "Gate 5c: 第2層バッジは市町村Bの町丁目数(2)");
  assert.ok(headerTitleEl.innerHTML.includes('‹') && headerTitleEl.innerHTML.includes(cityB), "Gate 5d: 第2層ヘッダーに ‹ 市町村B が表示");
  assert.ok(headerTitleEl.className.includes('text-sm') && headerTitleEl.className.includes('cursor-pointer'), "Gate 5d-vis1: 第2層ヘッダー全体が text-sm かつクリック可能(cursor-pointer)");
  assert.ok(
    headerTitleEl.innerHTML.includes('w-7') &&
    headerTitleEl.innerHTML.includes('h-7') &&
    headerTitleEl.innerHTML.includes('text-xl') &&
    headerTitleEl.innerHTML.includes('bg-white/10') &&
    headerTitleEl.innerHTML.includes('rounded-md'),
    "Gate 5d-vis2: 第2層ヘッダーの『‹』が 28x28px (w-7 h-7)・約20px (text-xl)・ボタン表現 (bg-white/10 rounded-md) で描画される"
  );
  assert.ok(headerTitleEl.innerHTML.includes(`truncate text-sm font-bold text-white">${cityB}</span>`), "Gate 5d-vis3: 市町村名が text-sm font-bold text-white で描画される");
  assert.equal(typeof headerTitleEl.onclick, 'function', "Gate 5d-vis4: [‹] + 市町村名 のヘッダー領域全体がクリック可能");
  const layer2TownBtns = pcList.querySelectorAll('button[data-town-id]');
  assert.equal(layer2TownBtns.length, 3, "Gate 5e: 第2層リストは『市町村B 全域 + 2町丁目』の3行");
  assert.ok(layer2TownBtns[0].innerHTML.includes(`${cityB} 全域`), "Gate 5f: 第2層先頭は『市町村B 全域』");
  assert.equal(layer2TownBtns[1].getAttribute('data-town-id'), '3', "Gate 5g: 選択市町村所属の町丁目(rowId=3)のみ表示");
  assert.equal(layer2TownBtns[2].getAttribute('data-town-id'), '4', "Gate 5h: 選択市町村所属の町丁目(rowId=4)のみ表示");

  assert.equal(getEl('fact-total-areas').textContent, '2', "Gate 6a: KPI 総エリア数が市町村B(2)に連動");
  assert.equal(fitBoundsCalls.length, 1, "Gate 6b: 市町村Bのピン群へ fitBounds が発火");
  assert.equal(lastCreatedMarkers.length, 2, "Gate 6c: マップ上のピンが市町村Bの2件に絞り込まれる");

  const turnoutTopHtmlAfterCityB = getEl('right-slot-top').innerHTML;
  assert.ok(turnoutTopHtmlAfterCityB.includes(cityB), "Gate 7a: 右上投票率ヘッダーバッジが市町村Bに連動");
  assert.ok(turnoutTopHtmlAfterCityB.includes('58.25'), "Gate 7b: 右上投票率が市町村Bの 58.25% に連動 (全域58.80%ではない)");
  console.log("  ✅ Gates 5-7 PASS: Municipality click transitions to Layer 2 and syncs MAP, KPI, and Municipality Turnout");

  // Gate 9: Click Town in Layer 2 -> town zoom, right-bottom stats, municipality turnout maintained
  setViewCalls = [];
  const town3Btn = layer2TownBtns[1]; // rowId 3 (cityB)
  town3Btn.onclick({ stopPropagation: () => {} });

  assert.equal(sandbox.window.DashboardState.selectedTownId, 3, "Gate 9a: selectedTownId が 3 に更新");
  assert.equal(sandbox.window.DashboardState.selectedPin.rowId, 3, "Gate 9b: selectedPin が rowId=3 に更新");
  assert.equal(setViewCalls.length, 1, "Gate 9c: 町丁目クリックで map.setView(zoom 15) が発火");
  assert.equal(setViewCalls[0].zoom, 15, "Gate 9d: zoom レベルが 15");
  assert.ok(getEl('right-slot-bottom').innerHTML.includes('200'), "Gate 9e: 右下エリア統計に rowId=3 の世帯数(200)が表示");
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.25'), "Gate 9f: 町丁目クリック時も所属自治体(市町村B: 58.25%)の投票率を表示");

  // Gate 8: Click Layer 2 "<Municipality> 全域" -> clears town/pin only, fits city bounds, keeps cityB turnout
  fitBoundsCalls = [];
  const cityBAllBtn = pcList.querySelectorAll('button[data-town-id]')[0];
  cityBAllBtn.onclick({ stopPropagation: () => {} });

  assert.equal(sandbox.window.DashboardState.selectedCity, cityB, "Gate 8a: 『市町村B 全域』クリック後も selectedCity は市町村Bを維持 (ALLに戻らない)");
  assert.equal(sandbox.window.DashboardState.selectedTownId, 'ALL', "Gate 8b: selectedTownId が ALL にリセット");
  assert.equal(sandbox.window.DashboardState.selectedPin, null, "Gate 8c: selectedPin が null にリセット");
  assert.ok(getEl('right-slot-bottom').innerHTML.includes('area-stats-empty'), "Gate 8d: 右下エリア統計が未選択状態に戻る");
  assert.equal(fitBoundsCalls.length, 1, "Gate 8e: 市町村B全体へ fitBounds が実行される");
  assert.equal(fitBoundsCalls[0].bounds.coords.length, 2, "Gate 8f: fitBounds の対象座標数が市町村Bの2ピンである(全5ピンではない)");
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.25'), "Gate 8g: 右上投票率は市町村B(58.25%)を維持");
  console.log("  ✅ Gates 8-9 PASS: Layer 2 town click & Municipality-All row behave strictly as contracted");

  // Gate 11: Back button (`‹ 市町村B`) -> switches view to CITIES only, keeps selectedCity/MAP/KPI/turnout
  fitBoundsCalls = [];
  headerTitleEl.onclick({ stopPropagation: () => {} });

  assert.equal(sandbox.window.DashboardState.desktopAreaSelectorView, 'CITIES', "Gate 11a: Backクリックで表示階層だけ CITIES へ戻る");
  assert.equal(sandbox.window.DashboardState.selectedCity, cityB, "Gate 11b: Back後も selectedCity は市町村Bのまま維持");
  assert.equal(sandbox.window.DashboardState.selectedTownId, 'ALL', "Gate 11b-2: Back後も selectedTownId は不変");
  assert.equal(sandbox.window.DashboardState.selectedPin, null, "Gate 11b-3: Back後も selectedPin は不変");
  assert.ok(headerTitleEl.innerHTML.includes('📍') && headerTitleEl.innerHTML.includes('エリア選択') && headerTitleEl.onclick === null, "Gate 11b-4: 第1層ヘッダー『📍 エリア選択』に復帰");
  assert.equal(fitBoundsCalls.length, 0, "Gate 11c: Back操作でMAP視点は変更されない");
  assert.equal(getEl('fact-total-areas').textContent, '2', "Gate 11d: Back後もKPIは市町村B(2)を維持");
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.25'), "Gate 11e: Back後も右上投票率は市町村B(58.25%)を維持");
  const backCityBBtn = pcList.children.find(b => b.getAttribute('data-city-val') === cityB);
  assert.ok(backCityBBtn && backCityBBtn.innerHTML.includes('✓'), "Gate 11f: 第1層に戻った際、選択中の市町村Bに ✓ ハイライトが付いている");
  console.log("  ✅ Gate 11 PASS: Back navigation changes only presentation layer while preserving selectedCity/MAP/KPI/Turnout");

  // Gate 10: MAP Pin click -> updates turnout to pin.cityName (even when selectedCity is ALL)
  lastCreatedMarkers = [];
  const allCityBtn = pcList.children.find(b => b.getAttribute('data-city-val') === 'ALL');
  allCityBtn.onclick({ stopPropagation: () => {} });
  assert.equal(sandbox.window.DashboardState.selectedCity, 'ALL', "全域へ復帰");
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.80'), "全域投票率 58.80%");

  // Trigger click on marker for rowId 1 (cityA: 64.07%)
  assert.ok(lastCreatedMarkers.length === 5, "全域では5つのマーカーが生成されている");
  lastCreatedMarkers[0].trigger('click'); // rowId 1 (cityA)
  assert.equal(sandbox.window.DashboardState.selectedPin.rowId, 1, "Gate 10a: MAP Pinクリックで selectedPin が rowId=1 に設定");
  assert.ok(getEl('right-slot-top').innerHTML.includes(cityA), "Gate 10b: MAP Pinクリックで右上投票率バッジがピンの所属自治体(市町村A)に連動");
  assert.ok(getEl('right-slot-top').innerHTML.includes('64.07'), "Gate 10c: MAP Pinクリックで右上投票率が市町村Aの 64.07% に連動");
  console.log("  ✅ Gate 10 PASS: MAP Pin click updates turnout to pin.cityName");

  // --- [Turnout Contract: Gates 12, 13, 14, 15, 16, 17] ---
  const turnoutDataA = sandbox.getMunicipalityTurnout(sampleElectionData, cityA);
  assert.deepEqual(
    turnoutDataA.history.map(h => h.turnout),
    ['64.07', '62.34', '60.94'],
    "Gate 12: 過去3回推移(history)がすべて同一自治体(市町村A)の履歴であること"
  );
  assert.equal(turnoutDataA.diffPt, '+1.73', "Gate 13: 前回比(64.07 - 62.34 = +1.73)が同一自治体同士の差で計算されること");

  // Gate 14 & 15: Missing municipality value in multi-municipality dashboard -> '--' (NO false fallback to 58.80)
  const turnoutDataMissing = sandbox.getMunicipalityTurnout(sampleElectionData, cityC);
  assert.equal(turnoutDataMissing.turnout, '--', "Gate 14: 複数自治体で自治体値が欠損している場合は '--' となること");
  assert.notEqual(turnoutDataMissing.turnout, '58.80', "Gate 15a: 選挙区全体値(58.80)への偽Fallbackが絶対に起きないこと");
  assert.equal(turnoutDataMissing.showDiff, false, "Gate 15b: 欠損時は前回比を偽計算せず非表示(showDiff=false)とすること");
  assert.deepEqual(turnoutDataMissing.history.map(h => h.turnout), ['--', '--', '--'], "Gate 15c: 過去3回推移も欠損時はすべて '--'");

  // Gate 17: 30-second sync preserves current target turnout (pin selected -> keeps pin.cityName turnout)
  assert.equal(sandbox.window.DashboardState.selectedPin.rowId, 1, "現在 rowId=1 (市町村A) のPinを選択中");
  sandbox.renderCurrentView(); // Simulates 30s sync re-render
  assert.ok(getEl('right-slot-top').innerHTML.includes('64.07'), "Gate 17: 30秒同期(renderCurrentView)が走っても選択中Pin(市町村A: 64.07%)の投票率が維持され全域にリセットされない");

  // Gate 16: closeAreaDetail() -> clears selectedPin and restores selectedCity turnout
  sandbox.closeAreaDetail();
  assert.equal(sandbox.window.DashboardState.selectedPin, null, "Gate 16a: closeAreaDetail() で selectedPin が null にクリアされる");
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.80'), "Gate 16b: selectedCity==='ALL' のとき Close すると全域投票率(58.80%)へ復帰");

  // Also test Close when selectedCity === cityB and a pin was selected
  sandbox.selectDesktopMunicipality(cityB);
  sandbox.selectTownArea(3); // pin in cityB
  sandbox.closeAreaDetail();
  assert.equal(sandbox.window.DashboardState.selectedPin, null, "Gate 16c: 市町村B選択中のPin Closeで selectedPin が null");
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.25'), "Gate 16d: 市町村B選択中のPin Closeで市町村Bの投票率(58.25%)へ復帰");

  // Also test selecting another municipality resets old selectedTownId and selectedPin
  sandbox.selectTownArea(3);
  assert.equal(sandbox.window.DashboardState.selectedPin.rowId, 3, "rowId=3 選択中");
  sandbox.selectDesktopMunicipality(cityA);
  assert.equal(sandbox.window.DashboardState.selectedTownId, 'ALL', "別市町村選択時に selectedTownId が ALL にリセットされる");
  assert.equal(sandbox.window.DashboardState.selectedPin, null, "別市町村選択時に旧 selectedPin が null にリセットされる");
  assert.ok(getEl('right-slot-bottom').innerHTML.includes('area-stats-empty'), "別市町村選択時に右下エリア統計から旧市町村の町丁目情報が消える");
  console.log("  ✅ Gates 12-17 PASS: Turnout history, diff, no-false-fallback (--), 30s sync preservation, and Close recovery verified");

  // --- [Mobile Contract: Gates 18, 19, 20, 21] ---
  // Gate 18: Mobile UI list remains flat (全域 + all 5 towns) with zero 2-layer mutation
  assert.equal(mobileList.children.length, 6, "Gate 18a: Mobileドロップダウンは『全域 + 全5町丁目』の既存フラット構造を完全維持");
  assert.equal(mobileList.querySelectorAll('button[data-town-id]').length, 6, "Gate 18b: Mobileの全ボタンが既存の data-town-id 契約を維持");

  // Gate 19: Mobile town selection updates turnout to pin.cityName
  sandbox.selectTownArea('ALL');
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.80'), "Mobile 全域選択で全域投票率(58.80%)");
  const mobileTown1Btn = mobileList.children[1]; // rowId 1 (cityA: 64.07%)
  mobileTown1Btn.onclick({ stopPropagation: () => {} });
  assert.equal(sandbox.window.DashboardState.selectedPin.rowId, 1, "Gate 19a: Mobile町丁目選択で selectedPin が更新");
  assert.ok(getEl('right-slot-top').innerHTML.includes('64.07'), "Gate 19b: Mobile町丁目選択で所属自治体(市町村A: 64.07%)の投票率に連動");

  // Gate 20 & 21: Mobile MAP Pin click & Mobile Close recovery
  lastCreatedMarkers = [];
  sandbox.selectTownArea('ALL');
  lastCreatedMarkers[2].trigger('click'); // rowId 3 (cityB: 58.25%)
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.25'), "Gate 20: Mobile MAP Pinタップで所属自治体(市町村B: 58.25%)の投票率に連動");
  sandbox.closeAreaDetail();
  assert.ok(getEl('right-slot-top').innerHTML.includes('58.80'), "Gate 21: Mobile Pin詳細Closeで selectedCity(ALL: 58.80%)の投票率へ復帰");
  console.log("  ✅ Gates 18-21 PASS: Mobile UI unchanged & Mobile town/pin/close turnout linkage verified");

  // -------------------------------------------------------------
  // [UI TEST 7] DASHBOARD-REPORT-FULL-RECORDS-AND-RANKING-AREAS-001
  // PDF/CSV 25件全件出力・ランキング個人完了エリア数 (String正規化 unique rowId)・
  // 21件目以降のGPS/写真判定維持・A4複数ページ印刷CSS・LIVE 4件制限維持検証
  // -------------------------------------------------------------
  console.log("\n▶ [UI TEST 7] PDF/CSV 25-Record Full Output & Staff Unique Completed Areas Contract");

  // 25件の完了実績を構築:
  // - Staff A (S001): 15件 (rowId 1..15, うち rowId 15 は文字列 " 15 " として型正規化を検証)
  //   ※ GPS=OK は22件目(index 21)、写真=OK は23件目(index 22)のみに配置
  // - Staff B (S002): 10件 (rowId 16..25, うち rowId 16 は文字列 "16" として型正規化を検証)
  //   ※ GPS=OK, 写真=OK は25件目(index 24, 最古レコード)のみに配置
  const records25 = [];
  for (let i = 1; i <= 15; i++) {
    records25.push({
      recordId: `REC_A_${i}`,
      rowId: i === 15 ? ' 15 ' : i,
      cityName: 'テスト市A',
      townName: `A地区${i}丁目`,
      time: `10/${String(i).padStart(2, '0')} 10:00`,
      timestamp: `2026/10/${String(i).padStart(2, '0')} 10:00`,
      count: 100 + i,
      staffId: 'S001',
      staffName: 'スタッフA',
      gpsStatus: i === 14 ? 'OK' : 'NO',
      photoStatus: i === 15 ? 'OK' : 'NO'
    });
  }
  for (let i = 16; i <= 25; i++) {
    records25.push({
      recordId: `REC_B_${i}`,
      rowId: i === 16 ? '16' : i,
      cityName: 'テスト市B',
      townName: `B地区${i}丁目`,
      time: `10/${String(i).padStart(2, '0')} 11:00`,
      timestamp: `2026/10/${String(i).padStart(2, '0')} 11:00`,
      count: 200 + i,
      staffId: 'S002',
      staffName: 'スタッフB',
      gpsStatus: i === 25 ? 'OK' : 'NO',
      photoStatus: i === 25 ? 'OK' : 'NO'
    });
  }
  assert.equal(records25.length, 25, "テスト入力の完了実績が25件であること");

  const reportState25 = {
    summary: {
      districtName: 'テスト支部',
      completedPins: 25,
      totalPins: 40,
      unassignedPins: 10,
      inProgressPins: 5,
      totalPostings: 4000,
      totalStockCount: 1000,
      rosterCount: 2
    },
    globalPinStatus: {
      completed: Array.from({ length: 25 }, (_, i) => i + 1),
      inProgress: [26, 27, 28, 29, 30]
    },
    roster: [
      { id: 'S001', name: 'スタッフA', stockTotal: 600, deliveredTotal: 1620 },
      { id: 'S002', name: 'スタッフB', stockTotal: 400, deliveredTotal: 2205 }
    ],
    // item.completedAreas にダミー値(999)を入れても無視され、staffRecs の unique rowId 数が使われることを検証
    ranking: [
      { rank: 1, staffId: 'S002', name: 'スタッフB', count: 2205, completedAreas: 999 },
      { rank: 2, staffId: 'S001', name: 'スタッフA', count: 1620, completedAreas: 888 }
    ],
    stocks: [
      { staffId: 'S001', staffName: 'スタッフA', count: 600, pendingRequestsCount: 0, updatedAt: '2026/10/20 12:00' },
      { staffId: 'S002', staffName: 'スタッフB', count: 400, pendingRequestsCount: 1, updatedAt: '2026/10/20 13:00' }
    ],
    liveRecords: records25
  };

  // 1. PDF出力の検証
  const pdfHtml = sandbox.generateRecordsReportPdfHtml(reportState25);
  assert.ok(!managerCode.includes('liveRecordsList.slice(0, 15)'), "manager.js から liveRecordsList.slice(0, 15) が完全撤廃されていること");
  assert.ok(!pdfHtml.includes('Page 1 / 1'), "PDF HTML から固定の 'Page 1 / 1' が削除されていること");
  assert.ok(pdfHtml.includes('display: table-header-group;'), "PDF CSS に thead 再掲 (display: table-header-group) が設定されていること");
  assert.ok(pdfHtml.includes('.report-table tr {\n      break-inside: avoid;\n      page-break-inside: avoid;\n    }'), "PDF CSS に tr 行途中分断防止が設定されていること");

  // PDF「2、配布実績」に1〜25件目まで全25件が出力されていること
  for (let i = 1; i <= 15; i++) {
    assert.ok(pdfHtml.includes(`テスト市A A地区${i}丁目`), `PDF配布実績に ${i} 件目 (A地区${i}丁目) が出力されていること`);
  }
  for (let i = 16; i <= 25; i++) {
    assert.ok(pdfHtml.includes(`テスト市B B地区${i}丁目`), `PDF配布実績に ${i} 件目 (B地区${i}丁目) が出力されていること`);
  }

  // PDF「3、ランキング」において、Staff B = 10、Staff A = 15、かつ21〜25件目のGPS/写真が OK と判定されていること
  const pdfRankingSection = pdfHtml.split('<div class="section-title">3、ランキング</div>')[1].split('<div class="section-title">4、保有チラシ</div>')[0];
  assert.ok(
    pdfRankingSection.includes('<td class="font-mono">S002</td>\n          <td>スタッフB</td>\n          <td class="font-mono">2,205 枚</td>\n          <td class="font-mono">10</td>\n          <td class="font-mono">OK</td>\n          <td class="font-mono">OK</td>'),
    "PDFランキングで Staff B (S002) の完了エリアが 10 (doneAreas=25 や 999 ではない)、GPS=OK、写真=OK であること"
  );
  assert.ok(
    pdfRankingSection.includes('<td class="font-mono">S001</td>\n          <td>スタッフA</td>\n          <td class="font-mono">1,620 枚</td>\n          <td class="font-mono">15</td>\n          <td class="font-mono">OK</td>\n          <td class="font-mono">OK</td>'),
    "PDFランキングで Staff A (S001) の完了エリアが 15 (doneAreas=25 や 888 ではない)、GPS=OK、写真=OK であること"
  );

  // 2. CSV出力の検証
  const csvOut = sandbox.generateRecordsCsv(reportState25);
  for (let i = 1; i <= 15; i++) {
    assert.ok(csvOut.includes(`"テスト市A A地区${i}丁目"`), `CSV配布実績に ${i} 件目が出力されていること`);
  }
  for (let i = 16; i <= 25; i++) {
    assert.ok(csvOut.includes(`"テスト市B B地区${i}丁目"`), `CSV配布実績に ${i} 件目が出力されていること`);
  }
  assert.ok(
    csvOut.includes('"1","S002","スタッフB","2,205 枚","10","OK","OK"'),
    "CSVランキングで Staff B (S002) の完了エリアが 10、GPS=OK、写真=OK であること"
  );
  assert.ok(
    csvOut.includes('"2","S001","スタッフA","1,620 枚","15","OK","OK"'),
    "CSVランキングで Staff A (S001) の完了エリアが 15、GPS=OK、写真=OK であること"
  );

  // 3. 同一 rowId が数値 (1) と文字列 ("1", " 1 ") で重複混在した場合の String 正規化・重複排除テスト
  const mixedTypeState = {
    ...reportState25,
    ranking: [{ rank: 1, staffId: 'S001', name: 'スタッフA', count: 300 }],
    liveRecords: [
      { rowId: 1, staffId: 'S001', count: 100, gpsStatus: 'NO', photoStatus: 'NO' },
      { rowId: '1', staffId: 'S001', count: 100, gpsStatus: 'NO', photoStatus: 'NO' },
      { rowId: ' 1 ', staffId: 'S001', count: 100, gpsStatus: 'NO', photoStatus: 'NO' },
      { rowId: 2, staffId: 'S001', count: 100, gpsStatus: 'NO', photoStatus: 'NO' }
    ]
  };
  const mixedCsv = sandbox.generateRecordsCsv(mixedTypeState);
  assert.ok(
    mixedCsv.includes('"1","S001","スタッフA","300 枚","2","NO","NO"'),
    "rowId の数値 1 と文字列 '1' / ' 1 ' が String(r.rowId ?? '').trim() で同一エリアとして正規化され unique count = 2 になること"
  );

  // 4. 下部 LIVE フィードは 25件保持時でも最新4件 (slice(0, 4)) のみを描画すること
  sandbox.renderLiveFeed(records25);
  const liveFeedHtml = getEl('live-feed-container').innerHTML;
  assert.ok(liveFeedHtml.includes('A地区1丁目'), "LIVEフィードに1件目が含まれること");
  assert.ok(liveFeedHtml.includes('A地区4丁目'), "LIVEフィードに4件目が含まれること");
  assert.ok(!liveFeedHtml.includes('A地区5丁目'), "LIVEフィードに5件目以降は含まれないこと (slice(0, 4) 維持)");

  console.log("  ✅ UI TEST 7 PASS: PDF/CSV 25/25 records, unique rowId completedAreas (A=15, B=10 + string normalization), full-population GPS/Photo, and LIVE slice(0,4) verified");
}

console.log("\n====================================================");
console.log("🎉 ALL MANAGER UI INTERACTION TESTS PASSED PERFECTLY!");
console.log("====================================================");
process.exit(0);

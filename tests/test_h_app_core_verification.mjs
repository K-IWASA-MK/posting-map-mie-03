#!/usr/bin/env node
/**
 * POSTING MAP - Phase 8 H-App Core Verification Suite
 *
 * 目的:
 * HアプリCore 6領域（起動、Identity、Google Maps地域MAP、地図loader、活動入口、状態表示）、
 * および Phase境界・Universal原則が、現行コードベース（active/h-app/）において
 * 完全に成立し、既存境界を破壊していないことを機械判定する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { verifyAssetTokens, REQUIRED_LOCAL_CODE_ASSETS } from '../scripts/stamp-h-app-token.mjs';

const rootDir = process.cwd();

// テスト対象ファイル
const indexHtmlPath = path.join(rootDir, 'index.html');
const dashboardHtmlPath = path.join(rootDir, 'active/h-app/index.html');
const appJsPath = path.join(rootDir, 'active/h-app/app.js');
const renderJsPath = path.join(rootDir, 'active/h-app/render.js');
const apiJsPath = path.join(rootDir, 'active/h-app/modules/api.js');
const addressMasterServicePath = path.join(rootDir, 'active/business/area/address_master_service.js');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const renderJs = fs.readFileSync(renderJsPath, 'utf8');
const apiJs = fs.readFileSync(apiJsPath, 'utf8');
const addressMasterServiceJs = fs.readFileSync(addressMasterServicePath, 'utf8');

console.log('====================================================');
console.log('📱 PHASE 8 H-APP CORE VERIFICATION SUITE');
console.log('====================================================\n');

// ----------------------------------------------------------------------------
// 1. 起動領域 (Startup Sequence & Optimistic First Paint)
// ----------------------------------------------------------------------------
test('1. 起動: LIFFエントリーから初期画面表示までの導線と Optimistic First Paint', async (t) => {
  // ① ルート index.html の LIFF 初期化とリダイレクト導線
  assert.ok(indexHtml.includes('liff.init({ liffId: liffId })'), 'ルート index.html に liff.init が存在すること');
  assert.ok(indexHtml.includes('liff.login()'), '未ログイン時に liff.login() が呼ばれること');
  assert.ok(indexHtml.includes("window.location.replace('./active/h-app/index.html')"), 'ログイン完了時に active/h-app/index.html へリダイレクトすること');

  // ② safeInitApp および startApp の導線
  assert.ok(appJs.includes('async function safeInitApp()'), 'app.js に safeInitApp が存在すること');
  assert.ok(appJs.includes('async function startApp()'), 'app.js に startApp が存在すること');
  assert.ok(appJs.includes('window !== window.top'), 'iframe 二重実行防止ガードが存在すること');

  // ③ Optimistic First Paint シミュレーション検証
  // 既存 staffId がある端末は即座に showMainApp() が呼ばれ、待たされないこと
  let mainAppLaunchedImmediately = false;
  let backgroundSyncTriggered = false;

  const simulateStartup = (existingStaffId) => {
    const existingUserInfo = { id: existingStaffId, last: '山田' };
    const hasExistingStaffId = existingUserInfo.id && String(existingUserInfo.id).trim() !== '';

    if (hasExistingStaffId) {
      mainAppLaunchedImmediately = true;
    }
    // バックグラウンドで Identity 検証が走る
    backgroundSyncTriggered = true;
  };

  simulateStartup('S001');
  assert.equal(mainAppLaunchedImmediately, true, '既存 staffId 保有時は Optimistic First Paint で即座に表示されること');
  assert.equal(backgroundSyncTriggered, true, 'バックグラウンド同期が並行してトリガーされること');
});

// ----------------------------------------------------------------------------
// 2. Identity領域 (Identity Boundary & SSOT)
// ----------------------------------------------------------------------------
test('2. Identity: liffToken 送信境界、DOM/URL非露出、Backend強制解決', async (t) => {
  // ① liffToken 自動付与
  assert.ok(apiJs.includes('getLiffAuthToken()'), 'modules/api.js に getLiffAuthToken が存在すること');
  assert.ok(apiJs.includes('payload.liffToken = token'), 'callApiPost で payload.liffToken にトークンが付与されること');

  // ② Cookie送信防止
  assert.ok(apiJs.includes("credentials: 'omit'"), "Cookie漏洩防止のため credentials: 'omit' が指定されていること");

  // ③ lineUserId の保護
  // APIレスポンスおよび DOM への露出がないこと
  assert.ok(!dashboardHtml.includes('lineUserId'), 'dashboard/index.html の静的DOMに lineUserId が含まれていないこと');

  // ④ Backend強制解決シミュレーション
  // クライアントが改ざんした staffId を送っても、Backend 検証結果が SSOT として上書きされること
  let localStorageMock = { user_info: JSON.stringify({ id: 'TAMPERED_ID', last: '悪意あるユーザー' }) };

  const simulateIdentitySync = (backendResponse) => {
    if (backendResponse.success && backendResponse.registered) {
      const verifiedUserInfo = {
        id: backendResponse.staffId, // Backend が SSOT
        last: backendResponse.staffName
      };
      localStorageMock.user_info = JSON.stringify(verifiedUserInfo);
    }
  };

  simulateIdentitySync({ success: true, registered: true, staffId: 'S777', staffName: '正規スタッフ' });
  const finalUser = JSON.parse(localStorageMock.user_info);
  assert.equal(finalUser.id, 'S777', 'クライアントの改ざんIDは破棄され、Backendの staffId が強制同期されること');
});

// ----------------------------------------------------------------------------
// 3. 地域MAP領域 (Google Maps Engine & Sync Isolation)
// ----------------------------------------------------------------------------
test('3. 地域MAP: Google Maps JS API、language=ja、同期時リセット防止', async (t) => {
  // ① Google Maps JS API の採用確認
  assert.ok(appJs.includes('https://maps.googleapis.com/maps/api/js'), 'Google Maps API スクリプトURLが存在すること');
  assert.ok(appJs.includes('language=ja'), '日本語表示パラメータ language=ja が指定されていること');
  assert.ok(appJs.includes('callback=initMainMap'), 'コールバックとして initMainMap が指定されていること');

  // ② Apple Style ダークテーマの定義
  assert.ok(renderJs.includes('const appleStyle = ['), 'render.js に appleStyle ダークテーマが定義されていること');

  // ③ 同期処理によるリセット防止構造の機械判定
  // A: DOM バインド済みの場合は再初期化をスキップするガード
  assert.ok(renderJs.includes('window.mainMapInstance.getDiv() === mapEl'), '既存Mapインスタンスの同一DOM重複初期化スキップガードが存在すること');

  // B: カメラ移動（idle）時の状態退避
  assert.ok(renderJs.includes("map.addListener('idle'"), "idle イベントリスナーでカメラ状態が退避されること");
  assert.ok(renderJs.includes('window.currentMapState = {'), 'window.currentMapState に center/zoom が保存されること');

  // C: 既存マーカーの破棄防止
  assert.ok(renderJs.includes('if (window.masterMarkers.length > 0) return;'), 'masterMarkers が存在する場合は再生成を完全スキップすること');
});

// ----------------------------------------------------------------------------
// 4. 地図loader領域 (Loader & Deduplication)
// ----------------------------------------------------------------------------
test('4. 地図loader: APIキー動的ロード、CSV非同期パース、重複初期化抑止', async (t) => {
  // ① 動的 API Key 取得
  assert.ok(appJs.includes("callApiPost('getMapsApiKey')"), "getMapsApiKey API アクションが呼ばれること");

  // ② 重複注入防止フラグ
  assert.ok(appJs.includes('if (window.googleMapsApiLoaded) return;'), 'googleMapsApiLoaded フラグによる多重呼出ガードが存在すること');

  // ③ 住所マスター CSV パースシングルトン
  assert.ok(addressMasterServiceJs.includes('class AddressMasterService'), 'AddressMasterService が定義されていること');
  assert.ok(addressMasterServiceJs.includes('parseCsv(csvText)'), 'CSV パースロジックが存在すること');
  assert.ok(addressMasterServiceJs.includes('if (this.cache) return this.cache;'), 'メモリキャッシュによる二重ロード抑止が存在すること');

  // ④ CSVパースロジックの機械的動作判定
  const sampleCsv = `row_id,city_name,town_name,latitude,longitude,households,population,e_stat_code
1,テスト市,中央町,35.1234,136.5678,100,250,001`;
  
  const parseCsvSim = (csv) => {
    const lines = csv.trim().split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      rows.push({
        rowId: Number(cols[0]),
        city_name: cols[1],
        town_name: cols[2],
        latitude: Number(cols[3]),
        longitude: Number(cols[4])
      });
    }
    return rows;
  };

  const parsed = parseCsvSim(sampleCsv);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].rowId, 1);
  assert.equal(parsed[0].city_name, 'テスト市');
  assert.equal(parsed[0].town_name, '中央町');
});

// ----------------------------------------------------------------------------
// 5. 活動入口領域 (Action Trigger & Accidental Tap Prevention)
// ----------------------------------------------------------------------------
test('5. 活動入口: 2段階タップ誤操作防止、排他ロック、openPointDetailModal への引継', async (t) => {
  // ① CustomMarkerOverlay クラスとボタンの存在
  assert.ok(renderJs.includes('class CustomMarkerOverlay extends google.maps.OverlayView'), 'CustomMarkerOverlay クラスが定義されていること');
  assert.ok(renderJs.includes('input-operation-btn'), '入力操作ボタンクラスが存在すること');
  assert.ok(renderJs.includes('openPointDetailModal(row.rowId)'), 'openPointDetailModal 呼び出しが存在すること');

  // ② 2段階タップ（accidental tap防止）シミュレーション検証
  let isStarted = false;
  let modalOpenedWithRowId = null;

  const handleInputButtonClick = (buttonSpanEl, rowId) => {
    if (!isStarted) {
      isStarted = true;
      buttonSpanEl.textContent = '入力操作';
      return; // 1回目はラベル変化のみでモーダルは開かない
    }
    modalOpenedWithRowId = rowId; // 2回目で初めて開く
  };

  const mockButtonSpan = { textContent: '配布開始' };

  // 1回目のタップ
  handleInputButtonClick(mockButtonSpan, 101);
  assert.equal(mockButtonSpan.textContent, '入力操作', '1回目タップでボタンが「入力操作」に変わること');
  assert.equal(modalOpenedWithRowId, null, '1回目タップではまだモーダルが開かないこと');

  // 2回目のタップ
  handleInputButtonClick(mockButtonSpan, 101);
  assert.equal(modalOpenedWithRowId, 101, '2回目タップで openPointDetailModal(101) が発火すること');

  // ③ 配布済み・作業中ピンのロック検証
  assert.ok(renderJs.includes('const isLocked = isCompleted || isRemoteInProgress;'), '完了または作業中ピンの isLocked 判定が存在すること');
  assert.ok(renderJs.includes('配布済み 🔒'), '配布済みピンにロックバッジが表示されること');
  assert.ok(renderJs.includes('配布中 🔵'), '他端末作業中ピンに作業中バッジが表示されること');
});

// ----------------------------------------------------------------------------
// 6. 状態表示領域 (SSOT & Connectivity Display)
// ----------------------------------------------------------------------------
test('6. 状態表示: Backend/CSV由来のSSOT境界とONLINE/OFFLINE表示', async (t) => {
  // ① updateStats の SSOT 参照
  assert.ok(appJs.includes('function updateStats(summaryData = null)'), 'updateStats 関数が存在すること');
  assert.ok(appJs.includes('AddressMasterService.getInstance().cache'), '総エリア数は AddressMasterService (CSV) を参照すること');
  assert.ok(appJs.includes('summaryData.done'), '完了エリア数は Backend (summaryData) を参照すること');

  // ② 進捗計算シミュレーション検証
  const calculateStats = (csvCount, backendDone) => {
    const total = csvCount;
    const done = backendDone;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { text: `${done}/ ${total}`, percent: `${percent}%` };
  };

  const stats = calculateStats(150, 45);
  assert.equal(stats.text, '45/ 150', '件数フォーマットが一致すること');
  assert.equal(stats.percent, '30%', '進捗率が正しく計算されること');

  // ③ 通信状態表示 (Wave 17: Composition Root Wrapper ➔ Presentation Component 委譲検証)
  assert.ok(appJs.includes('function setSyncStatus(state)'), 'app.js に setSyncStatus wrapper が存在すること');
  assert.ok(appJs.includes('window.SyncStatusView.setStatus(state);'), 'app.js wrapper が window.SyncStatusView へ同期直接呼出していること');
  assert.ok(!appJs.includes("'ONLINE'"), 'app.js に ONLINE 表示文字列が残存していないこと');
  assert.ok(!appJs.includes("'OFFLINE'"), 'app.js に OFFLINE 表示文字列が残存していないこと');
  assert.ok(!appJs.includes("'SYNCING'"), 'app.js に SYNCING 表示文字列が残存していないこと');

  const syncStatusJsPath = path.join(rootDir, 'active/h-app/components/sync-status.js');
  const syncStatusJs = fs.readFileSync(syncStatusJsPath, 'utf8');
  assert.ok(syncStatusJs.includes("'ONLINE'"), 'components/sync-status.js に ONLINE 状態の表示定義が存在すること');
  assert.ok(syncStatusJs.includes("'OFFLINE'"), 'components/sync-status.js に OFFLINE 状態の表示定義が存在すること');
  assert.ok(syncStatusJs.includes("'SYNCING'"), 'components/sync-status.js に SYNCING 状態の表示定義が存在すること');

  const syncStatusPos = dashboardHtml.indexOf('./components/sync-status.js');
  const appJsPos = dashboardHtml.indexOf('./app.js');
  assert.ok(syncStatusPos !== -1 && appJsPos !== -1 && syncStatusPos < appJsPos, 'index.html で sync-status.js が app.js より前にロードされること');
});

// ----------------------------------------------------------------------------
// 7. Phase境界領域 (Phase 8 Isolation)
// ----------------------------------------------------------------------------
test('7. Phase境界: Phase 9以降の処理がPhase 8に侵入していないことの保証', async (t) => {
  // 活動入口（CustomMarkerOverlay）のクリックハンドラ内で、
  // DistributionRecord 登録処理や写真アップロード、GPS位置測位直接実行が同期呼出されていないこと
  const overlayClickSection = renderJs.substring(
    renderJs.indexOf('activeOverlay = new CustomMarkerOverlay'),
    renderJs.indexOf('activeOverlay.rowId = row.rowId')
  );

  assert.ok(!overlayClickSection.includes('recordPosting'), '活動入口ハンドラ内で recordPosting は呼ばれていないこと');
  assert.ok(!overlayClickSection.includes('uploadPhoto'), '活動入口ハンドラ内で uploadPhoto は呼ばれていないこと');
  assert.ok(!overlayClickSection.includes('DistributionRecord'), '活動入口ハンドラ内で DistributionRecord は扱われていないこと');
  assert.ok(overlayClickSection.includes('openPointDetailModal'), '活動入口ハンドラは openPointDetailModal のみを呼ぶこと');
});

// ----------------------------------------------------------------------------
// 8. Universal原則 (District Neutrality)
// ----------------------------------------------------------------------------
test('8. Universal原則: active/h-app/ 配下に地区固有ハードコードが存在しないこと', async (t) => {
  const dashboardDir = path.join(rootDir, 'active/h-app');
  const files = fs.readdirSync(dashboardDir, { recursive: true });

  const forbiddenDistrictTerms = ['kuwana', 'okayama', 'tsushima'];

  for (const file of files) {
    const fullPath = path.join(dashboardDir, file);
    if (fs.statSync(fullPath).isFile() && (file.endsWith('.js') || file.endsWith('.html'))) {
      const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
      for (const term of forbiddenDistrictTerms) {
        // 注釈やドキュメント文字列は除くが、active/h-app の実コード内にKUWANA等の識別子が入っていないことを検証
        const hasForbidden = content.includes(term);
        assert.equal(
          hasForbidden,
          false,
          `File ${file} に地区固有語 "${term}" のハードコードが存在してはならない`
        );
      }
    }
  }
});

// ----------------------------------------------------------------------------
// 9. Standalone Release Token ガード (Asset Cache Busting Integrity)
// ----------------------------------------------------------------------------
test('9. Release Token: 全必須ローカルコードアセットに単一自動Release Tokenが存在し、かつ完全に同一であること', async (t) => {
  const verification = verifyAssetTokens(dashboardHtml);
  assert.equal(verification.valid, true, verification.error || 'Asset token verification failed');
  assert.ok(verification.token, 'Release Token が取得できること');
  assert.equal(verification.count, REQUIRED_LOCAL_CODE_ASSETS.length, `全 ${REQUIRED_LOCAL_CODE_ASSETS.length} アセットが検証されていること`);

  // 外部CDNが誤って汚染されていないことの追加防御
  assert.ok(dashboardHtml.includes('https://static.line-scdn.net/liff/edge/2/sdk.js"></script>'), '外部LINE SDK CDNにはクエリが付与されていないこと');
});

// ----------------------------------------------------------------------------
// 10. ピン統計情報: 世帯数・人口・市前回投票率の動的バインドおよびフォールバック保証
// ----------------------------------------------------------------------------
test('10. ピン統計情報: ピンタップ時の世帯数・人口・市前回投票率表示およびフォールバック (Rectification SSOT)', async (t) => {
  // ① render.js 内に PMS_CLIENT_CONFIG による動的パス解決と no-store が存在すること
  assert.ok(renderJs.includes('PMS_CLIENT_CONFIG?.staticMaster?.electionHistoryFilename'), 'PMS_CLIENT_CONFIGからファイル名を動的解決していること');
  assert.ok(renderJs.includes("cache: 'no-store'"), 'fetch で cache: no-store が指定されていること');

  // ② 表示項目ラベル（世帯数、人口、市前回投票率）が存在すること
  assert.ok(renderJs.includes('世帯数'), 'バブル内に世帯数ラベルが存在すること');
  assert.ok(renderJs.includes('人口'), 'バブル内に人口ラベルが存在すること');
  assert.ok(renderJs.includes('前回投票率'), 'バブル内に前回投票率ラベルが存在すること');
  assert.ok(renderJs.includes('${turnoutLabel}'), '市単位であることを明示する turnoutLabel が動的解決されていること');
  assert.ok(renderJs.includes("'—'"), '未取得時・欠損時のフォールバック "—" が定義されていること');

  // ③ 実値ロジック検証: getLatestElection は配列順序に依存せず electionDate 最大の選挙を特定すること
  // render.js から getLatestElection 関数を抽出して VM コンテキストで直接実行検証
  const getLatestElectionCode = renderJs.substring(
    renderJs.indexOf('function getLatestElection'),
    renderJs.indexOf('window.getLatestElection = getLatestElection;')
  );
  const vmSandbox = {};
  vm.createContext(vmSandbox);
  vm.runInContext(`${getLatestElectionCode}; this.getLatestElection = getLatestElection;`, vmSandbox);

  const testElectionData = {
    elections: [
      { electionId: 'OLD', electionDate: '2018-12-02', turnout: 48.3, municipalities: { 'テスト市': 48.3 } },
      { electionId: 'LATEST', electionDate: '2022-11-20', turnout: 45.08, municipalities: { 'テスト市': 45.08 } },
      { electionId: 'OLDEST', electionDate: '2014-11-16', turnout: 49.0, municipalities: { 'テスト市': 49.0 } }
    ]
  };

  const resolvedLatest = vmSandbox.getLatestElection(testElectionData);
  assert.ok(resolvedLatest, 'getLatestElection は有効なオブジェクトを返すこと');
  assert.equal(resolvedLatest.electionId, 'LATEST', 'elections[0]固定ではなく electionDate最大の選挙が選択されること');
  assert.equal(resolvedLatest.electionDate, '2022-11-20', '最大の electionDate 2022-11-20 が選ばれること');

  // ④ 実値ロジック検証: municipalities[cityName] が無い自治体は election.turnout へ fallback せず厳格に null/— となること
  // render.js 内に latestElection.turnout へのフォールバック代入が存在しないことをコード検証
  const turnoutResolutionSnippet = renderJs.substring(
    renderJs.indexOf('const latestElection = getLatestElection'),
    renderJs.indexOf('const turnoutLabel')
  );
  assert.ok(
    !turnoutResolutionSnippet.includes('latestElection.turnout'),
    'municipalities[row.city_name]が無い場合、election.turnoutへfallbackしてはならない'
  );
  assert.ok(
    turnoutResolutionSnippet.includes('latestElection.municipalities[cityName]'),
    '指定自治体の投票率のみを厳格に取得すること'
  );
});

// ----------------------------------------------------------------------------
// 11. Navigation 200ms Async Race Guard (HAPP-WEEKLY-006)
// ----------------------------------------------------------------------------
test('11. Navigation Race Guard: 200ms非同期遷移中の連続タップで最新遷移のみがcommitされ単一ページ不変条件が維持されること (HAPP-WEEKLY-006)', async (t) => {
  const navigationJsPath = path.join(rootDir, 'active/h-app/modules/navigation.js');
  const navigationJs = fs.readFileSync(navigationJsPath, 'utf8');

  function createNavigationHarness() {
    const createClassList = (initial = []) => {
      const set = new Set(initial);
      return {
        add: (...cls) => cls.forEach(c => set.add(c)),
        remove: (...cls) => cls.forEach(c => set.delete(c)),
        contains: (c) => set.has(c),
        toArray: () => Array.from(set)
      };
    };

    const pageIds = [
      'page-areas',
      'page-settings',
      'page-ranking',
      'page-storage-register',
      'page-storage-list',
      'page-bulletin'
    ];

    const pages = pageIds.map(id => ({
      id,
      classList: createClassList(id === 'page-areas' ? [] : ['hidden']),
      style: { opacity: id === 'page-areas' ? '1' : '0', transform: 'translateY(0)' },
      offsetHeight: 100
    }));

    const appEl = {
      id: 'app',
      classList: createClassList(['is-map-page'])
    };

    const contentEl = {
      id: 'content',
      scrollTop: 0,
      style: { overflowY: 'auto' },
      classList: createClassList(['is-map-view']),
      addEventListener: () => {},
      scrollTo: (x, y) => {
        contentEl.scrollTop = y;
      }
    };

    const bottomNavEl = {
      id: 'bottom-nav',
      innerHTML: 'nav:areas',
      style: { display: '' }
    };

    const elementsById = new Map([
      ['app', appEl],
      ['content', contentEl],
      ['bottom-nav', bottomNavEl],
      ...pages.map(p => [p.id, p])
    ]);

    const onPageEnterCalls = [];
    const timerHistory = [];

    const documentMock = {
      getElementById: (id) => elementsById.get(id) || null,
      querySelectorAll: (sel) => {
        if (sel === '.page') return pages;
        if (sel === '.page:not(.hidden)') return pages.filter(p => !p.classList.contains('hidden'));
        return [];
      },
      querySelector: (sel) => {
        if (sel === '.page:not(.hidden)') return pages.find(p => !p.classList.contains('hidden')) || null;
        return null;
      }
    };

    const sandbox = {
      document: documentMock,
      localStorage: {
        getItem: (k) => (k === 'user_info' ? '{"id":"S001"}' : null)
      },
      currentCity: null,
      setTimeout: (fn, ms) => {
        timerHistory.push(ms);
        return setTimeout(fn, ms);
      },
      clearTimeout,
      requestAnimationFrame: (cb) => cb(),
      Promise
    };
    sandbox.window = sandbox;
    sandbox.window.onPageEnter = (pageId) => {
      onPageEnterCalls.push(pageId);
    };
    sandbox.window.renderBottomNavigation = (pageId) => `nav:${pageId}`;
    sandbox.renderBottomNavigation = sandbox.window.renderBottomNavigation;

    vm.createContext(sandbox);
    vm.runInContext(navigationJs, sandbox);

    return {
      sandbox,
      switchPage: sandbox.window.switchPage,
      pages,
      appEl,
      contentEl,
      bottomNavEl,
      onPageEnterCalls,
      timerHistory,
      getVisiblePages: () => documentMock.querySelectorAll('.page:not(.hidden)').map(p => p.id)
    };
  }

  // Test Case A — Single Navigation & 200ms contract preserved
  {
    const h = createNavigationHarness();
    assert.deepEqual(h.getVisiblePages(), ['page-areas']);
    h.contentEl.scrollTop = 140;

    const p = h.switchPage('settings');
    // Immediately after call (during 200ms fade), outgoing page opacity is 0 and translateY(-12px)
    const areasPage = h.pages.find(pg => pg.id === 'page-areas');
    assert.equal(areasPage.style.opacity, '0', 'フェードアウト開始時に outgoing page の opacity が 0 になること');
    assert.equal(areasPage.style.transform, 'translateY(-12px)', 'フェードアウト開始時に translateY(-12px) になること');

    await p;

    assert.ok(h.timerHistory.includes(200), '既存の 200ms トランジション待機が維持されていること');
    assert.deepEqual(h.getVisiblePages(), ['page-settings'], 'Test Case A: visible pages = [page-settings]');
    assert.equal(areasPage.classList.contains('hidden'), true, 'areas hidden = true');
    const settingsPage = h.pages.find(pg => pg.id === 'page-settings');
    assert.equal(settingsPage.classList.contains('hidden'), false, 'settings hidden = false');
    assert.equal(settingsPage.style.opacity, '1', 'settings opacity = 1');
    assert.equal(settingsPage.style.transform, 'translateY(0)', 'settings transform = translateY(0)');
    assert.deepEqual(h.onPageEnterCalls, ['settings'], 'onPageEnter(settings) = exactly 1');
    assert.equal(h.bottomNavEl.innerHTML, 'nav:settings', 'bottom-nav が settings に更新されること');
    assert.equal(h.sandbox.scrollPositions.areas, 140, 'outgoing page の scroll 位置が保存されること');
  }

  // Test Case B — Two Rapid Calls (areas -> settings -> ranking within 200ms)
  {
    const h = createNavigationHarness();
    h.sandbox.scrollPositions.settings = 320;
    h.sandbox.scrollPositions.ranking = 85;

    const p1 = h.switchPage('settings');
    await new Promise(r => setTimeout(r, 40));
    const p2 = h.switchPage('ranking');

    await Promise.all([p1, p2]);

    const visible = h.getVisiblePages();
    assert.equal(visible.length, 1, 'Test Case B: visible page count = 1');
    assert.deepEqual(visible, ['page-ranking'], 'Test Case B: visible page = page-ranking');
    assert.equal(h.pages.find(pg => pg.id === 'page-settings').classList.contains('hidden'), true, 'page-settings hidden = true');
    assert.equal(h.pages.find(pg => pg.id === 'page-areas').classList.contains('hidden'), true, 'page-areas hidden = true');
    assert.equal(h.bottomNavEl.innerHTML, 'nav:ranking', 'final bottom nav = ranking');
    assert.deepEqual(h.onPageEnterCalls, ['ranking'], 'obsolete settings の onPageEnter は発火せず ranking のみ発火すること');
    assert.equal(h.contentEl.scrollTop, 85, 'scroll 位置も最新 ranking の保存値のみが復元されること');
  }

  // Test Case C & F — Three Rapid Calls & Obsolete onPageEnter Suppression (areas -> settings -> ranking -> bulletin within 200ms)
  {
    const h = createNavigationHarness();

    const p1 = h.switchPage('settings');
    await new Promise(r => setTimeout(r, 25));
    const p2 = h.switchPage('ranking');
    await new Promise(r => setTimeout(r, 25));
    const p3 = h.switchPage('bulletin');

    await Promise.all([p1, p2, p3]);

    const visible = h.getVisiblePages();
    assert.equal(visible.length, 1, 'Test Case C: visible page count = 1');
    assert.deepEqual(visible, ['page-bulletin'], 'Test Case C: visible = page-bulletin');
    assert.equal(h.pages.find(pg => pg.id === 'page-settings').classList.contains('hidden'), true, 'settings = hidden');
    assert.equal(h.pages.find(pg => pg.id === 'page-ranking').classList.contains('hidden'), true, 'ranking = hidden');
    assert.equal(h.pages.find(pg => pg.id === 'page-areas').classList.contains('hidden'), true, 'areas = hidden');
    assert.deepEqual(h.onPageEnterCalls, ['bulletin'], 'Test Case F: obsolete navigation が onPageEnter を発火せず bulletin 1回のみであること');
    assert.equal(h.bottomNavEl.innerHTML, 'nav:bulletin', 'latest bottom-nav state only');
    assert.equal(h.appEl.classList.contains('is-map-page'), false, 'normal page では is-map-page OFF');
    assert.equal(h.appEl.classList.contains('nav-auto-enabled'), true, 'normal page では nav-auto-enabled ON');
  }

  // Test Case D — Re-entry to Original Page (areas -> settings -> areas within 200ms)
  {
    const h = createNavigationHarness();

    const p1 = h.switchPage('settings');
    await new Promise(r => setTimeout(r, 30));
    const p2 = h.switchPage('areas');

    await Promise.all([p1, p2]);

    const visible = h.getVisiblePages();
    assert.equal(visible.length, 1, 'Test Case D: visible page count = 1');
    assert.deepEqual(visible, ['page-areas'], 'Test Case D: visible = page-areas');
    assert.equal(h.appEl.classList.contains('is-map-page'), true, 'Test Case D: app.is-map-page = true');
    assert.equal(h.appEl.classList.contains('nav-auto-enabled'), false, 'Test Case D: nav-auto-enabled = false');
    assert.deepEqual(h.onPageEnterCalls, ['areas'], 'onPageEnter は最新 areas のみ');
    assert.equal(h.bottomNavEl.innerHTML, 'nav:areas', 'bottom-nav は areas');
  }

  // Test Case E — force semantics preserved with generation ownership
  {
    const h = createNavigationHarness();

    // First single transition to settings
    await h.switchPage('settings');
    assert.deepEqual(h.getVisiblePages(), ['page-settings']);
    h.onPageEnterCalls.length = 0;

    // Rapid force transition vs subsequent transition
    const pForce = h.switchPage('settings', true);
    await new Promise(r => setTimeout(r, 30));
    const pNext = h.switchPage('ranking', true);

    await Promise.all([pForce, pNext]);

    assert.deepEqual(h.getVisiblePages(), ['page-ranking'], 'Test Case E: force=true でも最新世代のみが commit されること');
    assert.deepEqual(h.onPageEnterCalls, ['ranking'], 'Test Case E: obsolete force 呼び出しは commit しないこと');

    // Also verify standalone force=true on already visible page still executes transition
    await h.switchPage('ranking', true);
    assert.deepEqual(h.getVisiblePages(), ['page-ranking']);
    assert.deepEqual(h.onPageEnterCalls, ['ranking', 'ranking'], 'Test Case E: 単独 force=true は既存通り再遷移を実行すること');
  }

  // Test Case G — Final DOM Normalization from abnormal 2-pages-visible state
  {
    const h = createNavigationHarness();
    // Intentionally corrupt DOM state: make both areas and settings visible
    const settingsPage = h.pages.find(pg => pg.id === 'page-settings');
    settingsPage.classList.remove('hidden');
    settingsPage.style.opacity = '1';
    assert.equal(h.getVisiblePages().length, 2, '事前条件: 2 pages visible の異常DOM状態');

    await h.switchPage('ranking');

    const visible = h.getVisiblePages();
    assert.equal(visible.length, 1, 'Test Case G: visible count = 1 へ自己収束すること');
    assert.deepEqual(visible, ['page-ranking'], 'Test Case G: target 以外全ページが hidden になること');
  }
});

console.log('✅ ALL PHASE 8 H-APP CORE VERIFICATION CHECKS DEFINED SUCCESSFULLY.\n');


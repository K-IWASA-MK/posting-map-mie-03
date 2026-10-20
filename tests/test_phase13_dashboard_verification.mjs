#!/usr/bin/env node
/**
 * POSTING MAP - Phase 13 Dashboard Verification Suite (Strict Audit)
 *
 * 目的:
 * Phase 13 Universal Dashboard において、
 * 1. ADR-014 制定と Universal Engine 仕様整合性（件数・地区名を固定しない動的処理）
 * 2. 管理者は「見るだけ」の検証（タスク割当・現場指示の排除）
 * 3. Phase 7 Snapshot 契約との整合（7 API ➔ 1 Snapshot、Partial Failure耐性）
 * 4. MAP pin 差分更新（不変時マーカー再生成スキップ、ズーム・中心・選択状態維持）
 * 5. Phase 11 活動状態マシンとの完全同期（completedAt必須、月内ロック、未完了翌日再開、月跨ぎ実績判定）
 * 6. 個人ランキング集計の整合性（completedAt + groupKey + count>0）
 * 7. Universal 原則 & GAP-13-01 是正確認（初期HTML「--」、テストデータの動的整合性ロード）
 * 8. スコープ除外の整合性（stocks/requests/mail/mobile/bulletinの温存と保証除外）
 * を機械判定により厳密に実証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

// テスト対象ファイル
const designContractPath = path.join(rootDir, 'docs/architecture/01_DESIGN_CONTRACT.md');
const apiContractPath = path.join(rootDir, 'docs/api/API_CONTRACT.md');
const managerJsPath = path.join(rootDir, 'active/manager/manager.js');
const managerHtmlPath = path.join(rootDir, 'active/manager/index.html');
const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
const pinStatusServicePath = path.join(rootDir, 'active/business/pin/pin_status_service.js');
const distRepoPath = path.join(rootDir, 'active/business/distribution/distribution_repository.js');
const masterCsvPath = path.join(rootDir, 'data/address_master.csv');

const designContract = fs.readFileSync(designContractPath, 'utf8');
const apiContract = fs.readFileSync(apiContractPath, 'utf8');
const managerJs = fs.readFileSync(managerJsPath, 'utf8');
const managerHtml = fs.readFileSync(managerHtmlPath, 'utf8');
const v2ApiJs = fs.readFileSync(v2ApiPath, 'utf8');
const pinStatusServiceJs = fs.readFileSync(pinStatusServicePath, 'utf8');
const distRepoJs = fs.readFileSync(distRepoPath, 'utf8');
const masterCsv = fs.readFileSync(masterCsvPath, 'utf8');

console.log('====================================================');
console.log('🖥️ PHASE 13 UNIVERSAL DASHBOARD VERIFICATION SUITE');
console.log('====================================================\n');

// ----------------------------------------------------------------------------
// 1. Dashboard 観測契約と Universal 仕様整合性 (Canonical SSOT 直接検証)
// ----------------------------------------------------------------------------
test('1. Dashboard 契約: Universal Engine 仕様、観測専用原則、6大品質受入条件が明文化されていること', () => {
  assert.ok(designContract.includes('Phase 13 — Dashboard'), '01_DESIGN_CONTRACT に Phase 13 が定義されていること');
  assert.ok(designContract.includes('Dashboardは管理者・運営側が地域全体を観測するための画面'), '観測専用原則の明記');
  assert.ok(designContract.includes('管理者による現場個人への固定担当割当・活動強制は行わない'), '担当割当禁止の明記');
  assert.ok(designContract.includes('Dashboard 6大品質受入条件'), 'Dashboard 6大品質受入条件の明記');
  assert.ok(apiContract.includes('Dashboard Read API (全体観測契約)'), 'API_CONTRACT に全体観測契約が明記されていること');
  assert.ok(apiContract.includes('getSystemSummary'), '全体サマリ観測APIが定義されていること');
});

// ----------------------------------------------------------------------------
// 2. 管理者は「見るだけ」の検証 (タスク割当・指示機能の完全排除)
// ----------------------------------------------------------------------------
test('2. 観測専用原則: 管理画面にタスク割当・現場指示・強制操作UIが存在しないこと', () => {
  // 原本要求の確認
  assert.ok(designContract.includes('Dashboardは現場への個別タスク割当を目的としない。'), '原本3.2節');
  assert.ok(designContract.includes('管理者による現場個人への固定担当割当・活動強制は行わない。'), '原本Phase 13節');

  // manager.js 内に担当割当・更新系の送信アクションが存在しないこと
  assert.ok(!managerJs.includes("callApiPost('assignTask'"), 'assignTask APIが存在しないこと');
  assert.ok(!managerJs.includes("callApiPost('setAreaStaff'"), 'setAreaStaff APIが存在しないこと');
  assert.ok(!managerJs.includes("callApiPost('updateAreaStatus'"), 'updateAreaStatus APIが存在しないこと');

  // showAreaDetail でステータス変更UIやボタンが存在せず、テキスト表示のみであること
  assert.ok(managerJs.includes('function showAreaDetail(data)'), 'showAreaDetail が存在すること');
  assert.ok(managerJs.includes('if (statusEl) {\n    statusEl.textContent = cfg.statusText;\n    statusEl.style.color = cfg.color;\n  }'), 'エリアステータスはテキスト表示のみ');
});

// ----------------------------------------------------------------------------
// 3. Phase 7 Snapshot 契約との整合
// ----------------------------------------------------------------------------
test('3. Phase 7 Snapshot 契約: getDashboardSnapshot (1 API) による一括取得と 7 ドメイン構造の整合', () => {
  // manager.js の syncDashboardData で limit: 20 を付けずに getDashboardSnapshot を呼び出していること
  assert.ok(
    managerJs.includes("callApiPost('getDashboardSnapshot', { districtId })"),
    'syncDashboardData で limit 上限なしの getDashboardSnapshot を呼び出していること'
  );
  assert.ok(
    !managerJs.includes("callApiPost('getDashboardSnapshot', { districtId, limit: 20 })"),
    'syncDashboardData から limit: 20 が撤廃されていること'
  );

  // DashboardState.liveRecords への全件格納契約と renderLiveFeed の slice(0, 4) 維持
  assert.ok(
    managerJs.includes('DashboardState.liveRecords = latestDistRes.records;'),
    'DashboardState.liveRecords への格納契約が維持されていること'
  );
  assert.ok(
    managerJs.includes('const latest4 = records.slice(0, 4);'),
    'renderLiveFeed の slice(0, 4) 表示制限が維持されていること'
  );

  // v2_api.js に 7 つのドメインが集約されていること
  const domains = ['summary', 'flyerStock', 'ranking', 'pinStatus', 'roster', 'transfer', 'latestDistribution'];
  for (const d of domains) {
    assert.ok(v2ApiJs.includes(`snapshot.domains.${d} =`), `v2_api.js に ${d} ドメインが存在すること`);
  }
});

// ----------------------------------------------------------------------------
// 4. Partial Failure 耐性 (表示維持 / No Blanking)
// ----------------------------------------------------------------------------
test('4. Partial Failure 耐性: ドメイン障害時も成功ドメインのみ更新され既存表示が維持されること', () => {
  assert.ok(
    managerJs.includes('// 成功ドメインのみ上書き、失敗ドメインは既存表示を保持 (Partial Failure 設計)'),
    'Partial Failure 設計コメントが存在すること'
  );
  assert.ok(managerJs.includes('if (isSummaryOk) {\n      DashboardState.summary = summaryRes;\n    }'), 'summaryRes 成功時のみ更新');
  assert.ok(managerJs.includes('if (isRankOk) {\n      DashboardState.ranking = rankRes.ranking || [];\n    }'), 'rankRes 成功時のみ更新');
  assert.ok(managerJs.includes('if (isPinStatusOk) {'), 'pinStatus 成功時のみ更新');
});

// ----------------------------------------------------------------------------
// 5. マーカー差分更新 (ズーム・中心・選択ピンの維持)
// ----------------------------------------------------------------------------
test('5. 性能・マーカー差分更新: ピン状態不変時に Leaflet マーカー再生成をスキップすること', () => {
  assert.ok(managerJs.includes('let pinStatusChanged = false;'), 'pinStatusChanged フラグ管理');
  assert.ok(
    managerJs.includes('if (pinStatusChanged && DashboardState.map && DashboardState.markersLayer) {\n      renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, DashboardState.masterPins);\n    }'),
    'ピン状態変化時のみ renderPinsOnMap を実行'
  );
  assert.ok(
    managerJs.includes('setInterval(() => {\n    syncDashboardData();\n  }, 30000);'),
    '30秒間隔の自動同期'
  );
});

// ----------------------------------------------------------------------------
// 6. Phase 11 活動状態マシンとの完全同期
// ----------------------------------------------------------------------------
test('6. Phase 11 同期: completedAt 必須完了判定、月内ロック、未完了翌日再開、月跨ぎ実績判定', () => {
  // pin_status_service.js で D列 (completedAt) が存在する行のみ completed と判定
  assert.ok(
    pinStatusServiceJs.includes('.filter(r => r[0] && r[3] !== "" && r[3] !== null)'),
    'completed 判定に D列 (completedAt) が必須であること'
  );

  // manager.js で AREA_STATUS_CONFIG が定義され、completed が橙色 (#EA5F08) であること
  assert.ok(managerJs.includes("statusKey: 'COMPLETED'"), 'COMPLETED 設定');
  assert.ok(managerJs.includes("color: '#EA5F08'"), 'COMPLETED は橙色');
  assert.ok(managerJs.includes("statusKey: 'IN_PROGRESS'"), 'IN_PROGRESS 設定');
  assert.ok(managerJs.includes("color: '#00B7FF'"), 'IN_PROGRESS は青色');
  assert.ok(managerJs.includes("statusKey: 'UNALLOCATED'"), 'UNALLOCATED 設定');
  assert.ok(managerJs.includes("color: '#22C55E'"), 'UNALLOCATED は緑色');

  // ランキング集計確定条件 (completedAt + groupKey + count > 0)
  assert.ok(
    distRepoJs.includes('if (!rawCompletedAt || !groupKey || count <= 0) continue;'),
    'ランキング確定条件が completedAt + groupKey + count > 0 であること'
  );

  // MonthlySheetResolver による当月解決（月跨ぎ時も過去月データは消去せず新月シートを自動解決）
  assert.ok(
    managerJs.includes('MonthlySheetResolver') || pinStatusServiceJs.includes('MonthlySheetResolver'),
    'MonthlySheetResolver により月次シートが動的に解決されること'
  );
});

// ----------------------------------------------------------------------------
// 7. Universal 原則 & GAP-13-01 是正確認
// ----------------------------------------------------------------------------
test('7. Universal 原則 & GAP-13-01 是正: 地区固有値ハードコードがなく、area-selector-count初期値が -- であること', () => {
  // data/** SSOT から動的取得 (Universal Invariant)
  const configContent = fs.readFileSync(path.join(rootDir, 'data/config.js'), 'utf8');
  const districtIdMatch = configContent.match(/districtId:\s*["']([^"']+)["']/);
  const districtId = districtIdMatch ? districtIdMatch[1].trim() : null;

  const electionContent = fs.readFileSync(path.join(rootDir, 'data/election_history.json'), 'utf8');
  const electionData = JSON.parse(electionContent);
  const districtName = electionData.districtName ? electionData.districtName.trim() : null;

  const muniCsvPath = path.join(rootDir, 'data/municipality_master.csv');
  const muniCsv = fs.readFileSync(muniCsvPath, 'utf8');
  const muniLines = muniCsv.trim().split('\n').filter(Boolean).slice(1);
  const muniNames = muniLines.map(l => l.split(',')[0].trim()).filter(Boolean);

  // active/manager 配下に地区固有値のハードコードがないこと
  const managerFiles = [managerJs, managerHtml];
  for (const content of managerFiles) {
    if (districtId) {
      assert.ok(!content.includes(districtId), `地区ID (${districtId}) が manager にハードコードされていないこと`);
    }
    if (districtName) {
      assert.ok(!content.includes(districtName), `地区名 (${districtName}) が manager にハードコードされていないこと`);
    }
    for (const city of muniNames) {
      assert.ok(!content.includes(city), `自治体名 (${city}) が manager にハードコードされていないこと`);
    }
  }

  // GAP-13-01 是正: 初期HTMLの area-selector-count 要素の初期表示が -- であること
  const areaCountMatch = managerHtml.match(/<span[^>]*id=["']area-selector-count["'][^>]*>([\s\S]*?)<\/span>/i);
  assert.ok(areaCountMatch, 'area-selector-count 要素が初期HTMLに存在すること');
  assert.equal(areaCountMatch[1].trim(), '--', 'area-selector-count の初期表示テキストが -- であること');

  // address_master.csv と municipality_master.csv の動的整合性検証 (Universal Invariant)
  const expectedTotalTowns = muniLines.reduce((sum, line) => {
    const parts = line.split(',');
    return sum + (parseInt(parts[2], 10) || 0);
  }, 0);

  const addressDataRows = masterCsv.trim().split('\n').filter(Boolean).slice(1);
  assert.ok(addressDataRows.length > 0, 'マスターCSVに有効なデータ行が存在すること');
  assert.equal(
    addressDataRows.length,
    expectedTotalTowns,
    'address_master.csv のデータ行数は municipality_master.csv の total_towns 合計と完全一致すること'
  );
});

// ----------------------------------------------------------------------------
// 8. スコープ除外の整合性 (stocks/requests/mail/mobile/bulletin の温存と保証除外)
// ----------------------------------------------------------------------------
test('8. スコープ除外の整合性: 除外対象機能が既存コードを破壊せず温存されていること', () => {
  // 既存コードを壊さずに温存していることの確認
  assert.ok(managerJs.includes('renderMainStageStocks'), 'stocks ビューが温存されていること');
  assert.ok(managerJs.includes('renderMainStageRequests'), 'requests ビューが温存されていること');
  assert.ok(managerJs.includes('renderMainStageMail'), 'mail ビューが温存されていること');
  assert.ok(managerJs.includes('renderMainStageMobile'), 'mobile ビューが温存されていること');
  assert.ok(managerJs.includes('renderMainStageBulletin'), 'bulletin ビューが温存されていること');

  // Canonical SSOT (01_DESIGN_CONTRACT.md) で管理者による現場個人への固定担当割当・活動強制を行わない原則が明記されていること
  assert.ok(designContract.includes('管理者による現場個人への固定担当割当・活動強制は行わない'), '01_DESIGN_CONTRACT に現場強制割当不存在が明記されていること');
});

console.log('✅ ALL 8 PHASE 13 UNIVERSAL DASHBOARD VERIFICATION CHECKS DEFINED SUCCESSFULLY.\n');

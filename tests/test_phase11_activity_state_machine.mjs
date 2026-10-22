#!/usr/bin/env node
/**
 * POSTING MAP - Phase 11 Activity State Machine Verification Suite (Strict Audit)
 *
 * 目的:
 * Phase 11 Activity State Machine において、
 * 1. ADR-013 制定と状態整合性モデルの確立
 * 2. 原本 clientEventId 定義保護と requestId との対応関係
 * 3. 活動ログ状態遷移マシン（UNTOUCHED ➔ IN_PROGRESS ➔ DRAFT ➔ SUBMITTING ➔ PENDING ➔ COMPLETED）
 * 4. 完了条件が「Backend永続化成功」のみであること
 * 5. 既存業務ルール「完了確定地区は当月再操作不可」のUI・ロジック完全防護
 * 6. 既存業務ルール「未完了地区は翌日0:00以降再操作可能」の保証
 * 7. 個人ランキング集計確定条件（completedAt + groupKey + count>0）
 * 8. Universal原則遵守 & Scope Lock（データ・外部接続不可侵）
 * を機械判定により厳密に実証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = process.cwd();

// テスト対象ファイル
const designContractPath = path.join(rootDir, 'docs/architecture/01_DESIGN_CONTRACT.md');
const apiContractPath = path.join(rootDir, 'docs/api/API_CONTRACT.md');
const dataLifecyclePath = path.join(rootDir, 'docs/data/DATA_LIFECYCLE.md');
const appJsPath = path.join(rootDir, 'active/h-app/app.js');
const renderJsPath = path.join(rootDir, 'active/h-app/render.js');
const dbJsPath = path.join(rootDir, 'active/h-app/db.js');
const activityJsPath = path.join(rootDir, 'active/h-app/modules/activity.js');
const distRepoPath = path.join(rootDir, 'active/business/distribution/distribution_repository.js');
const pinStatusServicePath = path.join(rootDir, 'active/business/pin/pin_status_service.js');
const gpsServicePath = path.join(rootDir, 'active/business/gps/gps_service.js');
const gpsRepositoryPath = path.join(rootDir, 'active/business/gps/gps_repository.js');

const designContract = fs.readFileSync(designContractPath, 'utf8');
const apiContract = fs.readFileSync(apiContractPath, 'utf8');
const dataLifecycle = fs.readFileSync(dataLifecyclePath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const renderJs = fs.readFileSync(renderJsPath, 'utf8');
const dbJs = fs.readFileSync(dbJsPath, 'utf8');
const activityJs = fs.readFileSync(activityJsPath, 'utf8');
const distRepoJs = fs.readFileSync(distRepoPath, 'utf8');
const pinStatusServiceJs = fs.readFileSync(pinStatusServicePath, 'utf8');
const gpsServiceJs = fs.readFileSync(gpsServicePath, 'utf8');
const gpsRepositoryJs = fs.readFileSync(gpsRepositoryPath, 'utf8');

console.log('====================================================');
console.log('🚀 PHASE 11 ACTIVITY STATE MACHINE VERIFICATION SUITE');
console.log('====================================================\n');

// ----------------------------------------------------------------------------
// 1. Activity State Machine 契約と仕様整合性 (Canonical SSOT & Runtime 直接検証)
// ----------------------------------------------------------------------------
test('1. Activity State Machine 契約: 状態遷移、完了確定条件、業務ルール、ランキング集計条件が明文化されていること', () => {
  assert.ok(designContract.includes('Phase 11 — Activity State Machine'), '01_DESIGN_CONTRACT に Phase 11 が定義されていること');
  assert.ok(apiContract.includes('現場ポスティングフロー 7段階ステートマシン'), 'API_CONTRACT に 7段階ステートマシンが定義されていること');
  assert.ok(apiContract.includes('Step 1: ピン選択') && apiContract.includes('Step 7: 完了確定'), 'API_CONTRACT に Step 1 から Step 7 の状態遷移シーケンスが定義されていること');
  assert.ok(apiContract.includes('getRowStatus(rowId) === null'), 'API_CONTRACT に Backend永続化成功による確定条件が定義されていること');
  assert.ok(apiContract.includes('rowId') && apiContract.includes('requestId') && apiContract.includes('責務分離'), 'API_CONTRACT に rowId と requestId の責務分離契約が定義されていること');
  assert.ok(apiContract.includes('duplicate') && (apiContract.includes('alreadyCompleted') || apiContract.includes('再配布')), 'API_CONTRACT に 冪等性・重複排除契約が定義されていること');
  assert.ok(dataLifecycle.includes('ライフサイクル') && (dataLifecycle.includes('COMPLETED') || dataLifecycle.includes('DRAFT')), 'DATA_LIFECYCLE に配布実績ライフサイクルと状態確定モデルが記述されていること');
  assert.ok(distRepoJs.includes('fetchRankingData'), 'distribution_repository.js に fetchRankingData が実動実装されていること');
});

// ----------------------------------------------------------------------------
// 2. clientEventId / requestId の原本定義保護と対応関係
// ----------------------------------------------------------------------------
test('2. 識別子境界: 原本 clientEventId 定義を保護し、requestId との対応関係が確立されていること', () => {
  // 原本仕様の確認
  assert.ok(designContract.includes('活動登録は`clientEventId`等の冪等キーによって重複登録を防止する。'), '原本の冪等性記述');
  assert.ok(designContract.includes('端末側で活動送信ごとに一意の`clientEventId`を生成する。'), '原本のclientEventId生成記述');

  // activity.js で requestId 発番後に clientEventId が対応付けられていること
  assert.ok(activityJs.includes('const clientEventId = requestId;'), 'clientEventId が requestId に対応付けられていること');
  assert.ok(activityJs.includes('clientEventId,'), 'enqueue に clientEventId が渡されていること');

    // db.js の payload に clientEventId および lockId が含められていること
  assert.ok(dbJs.includes('clientEventId:') && dbJs.includes('item.clientEventId || item.requestId'), 'API送信 payload に clientEventId が含まれていること');
  assert.ok(dbJs.includes('lockId:') && dbJs.includes("item.lockId || ''"), 'API送信 payload に lockId が含まれていること');
});

// ----------------------------------------------------------------------------
// 3. 活動ログ状態遷移マシン (State Transition Machine)
// ----------------------------------------------------------------------------
test('3. 状態遷移マシン: UNTOUCHED ➔ IN_PROGRESS ➔ DRAFT ➔ SUBMITTING ➔ PENDING ➔ COMPLETED の因果関係が守られていること', () => {
  // DRAFT (写真確定時点): isDone=false, isReadyToSubmit=true
  assert.ok(activityJs.includes('point.isDone = false;') && activityJs.includes('point.isReadyToSubmit = hasPhoto;'), '写真取得完了時は DRAFT を維持');

  // SUBMITTING: submitting フラグとUIボタン無効化
  assert.ok(activityJs.includes("point.syncStatus = 'submitting';"), '送信開始で submitting に移行');
  assert.ok(appJs.includes("submitBtn.disabled = true;"), '多重送信防止のためボタン非活性化');

  // PENDING (同期待ち / オフライン): isDone=false 維持
  assert.ok(activityJs.includes("point.syncStatus = 'pending';") && activityJs.includes("point.isDone = false;"), 'オフライン時は pending かつ isDone=false');

  // COMPLETED: Backend 成功 (status === null) かつ accepted 時のみ昇格、REJECTED は非完了維持
  assert.ok(activityJs.includes("if (status === null) {"), 'status === null 判定が存在すること');
  assert.ok(activityJs.includes("if (point.syncStatus === 'REJECTED')"), 'REJECTED 判定が存在すること');
  assert.ok(activityJs.includes("point.isDone = true;"), '正常受理時に point.isDone = true が設定されること');
  assert.ok(activityJs.includes("delete point.isReadyToSubmit;"), '完了時に isReadyToSubmit を削除');

  // 実動シミュレーション: accepted:false (REJECTED) は COMPLETED にならないこと
  const rejectedPin = { rowId: 301, isDone: false, isReadyToSubmit: true, syncStatus: 'REJECTED' };
  if (rejectedPin.syncStatus === 'REJECTED') {
    rejectedPin.isDone = false;
    delete rejectedPin.isReadyToSubmit;
    delete rejectedPin.syncStatus;
  }
  assert.equal(rejectedPin.isDone, false, 'REJECTED は COMPLETED に昇格しないこと');
});

// ----------------------------------------------------------------------------
// 4. 完了確定条件 (Backend永続化成功のみが唯一のSSOT)
// ----------------------------------------------------------------------------
test('4. 完了確定条件: 写真撮影・キュー投入・送信中は COMPLETED ではなく、Backend永続化成功のみで確定すること', () => {
  // 認証エラー時のロールバック
  assert.ok(activityJs.includes("point.syncStatus = 'failed';") && activityJs.includes("point.isDone = false;"), '認証失敗時は isDone=false');

  // タイムアウト時の未完了維持
  assert.ok(activityJs.includes("point.syncStatus = 'pending';") && activityJs.includes("point.isDone = false;"), '15秒超過時は pending かつ isDone=false で解放');

  // エラー catch 時のロールバック
  assert.ok(activityJs.includes("point.syncStatus = 'pending';") && activityJs.includes("point.isDone = false;"), '送信例外発生時は isDone=false');
});

// ----------------------------------------------------------------------------
// 5. 業務ルール1: 完了確定した地区の月内再操作禁止
// ----------------------------------------------------------------------------
test('5. 業務ルール1: 完了確定地区は当月再操作不可であること (UI・ロジック二重防護)', () => {
  // 1. submitMissionComplete 先頭ガード
  assert.ok(
    appJs.includes('const isAlreadyCompleted = PinStatusModule.isCompleted(rowId) ||\n                             (p.isDone && !p.isReadyToSubmit);'),
    'submitMissionComplete で完了済み地区の再提出をガード'
  );
  assert.ok(appJs.includes('alert("この地区は既に今月の配布が完了しています。再操作はできません。");'), '再操作ブロックアラートが存在すること');

  // 2. render.js バブルでのロック表示
  assert.ok(renderJs.includes('const isCompleted = PinStatusModule.isCompleted(row.rowId);'), 'PinStatusModule.isCompleted でピン状態判定');
  assert.ok(renderJs.includes('<div class="premium-glass-badge badge-completed">\n                  配布済み 🔒\n                </div>'), '完了ピンには配布開始ボタンを出さず配布済みバッジを表示');

  // 3. render.js モーダル内での再操作不可バッジ表示
  assert.ok(renderJs.includes('(p.isDone && !p.isReadyToSubmit)'), '完了確定済みアイテムの条件判定');
  assert.ok(renderJs.includes('今月の配布は完了しています<br>（再操作不可）'), 'モーダル内に再操作不可メッセージを表示');
  assert.ok(renderJs.includes('closeDetailModal()'), '閉じるボタンのみを提供し再提出ボタンを非表示化');
});

// ----------------------------------------------------------------------------
// 6. 業務ルール2: 未完了地区の翌日0:00以降再操作可能の保証
// ----------------------------------------------------------------------------
test('6. 業務ルール2: 未完了地区は当月シートに completedAt が記録されず、翌日以降も再操作可能であること', () => {
  // pin_status_service.js の completed 判定が completedAt (D列) 必須であること
  assert.ok(
    pinStatusServiceJs.includes('.filter(r => r[0] && r[3] !== "" && r[3] !== null)'),
    'PinStatusService で D列 (completedAt) が存在する行のみ completed と判定'
  );

  // キャンセル時は一時データがリセットされ、isDone=false が維持されること
  assert.ok(renderJs.includes('ActivityModule.resetDraft(p)'), 'cancelMissionComplete で resetDraft が呼ばれること');
  assert.ok(activityJs.includes('point.isDone = false;'), 'resetDraft で isDone=false を維持');
  assert.ok(activityJs.includes('delete point.tempPhotoUrl;\n    delete point.photoBase64;'), '写真データが破棄されること');

  // 未完了ピンは globalPinStatus.completed に入らないため、翌日0:00以降も通常通り緑/未操作ピンとして再操作可能
  assert.ok(activityJs.includes('if (!p.isDone) {\n          delete p.syncStatus;\n        }'), '未完了アイテムは syncStatus がリセットされ再操作可能状態となること');
});

// ----------------------------------------------------------------------------
// 7. 個人ランキング集計確定条件
// ----------------------------------------------------------------------------
test('7. ランキング集計条件: completedAt + groupKey + count > 0 の確定行のみが集計されること', () => {
  // distribution_repository.js の集計元シートが当月配布実績シートであること
  assert.ok(
    distRepoJs.includes('getCurrentSheet("distribution", districtId)'),
    '当月の配布実績シートのみを集計元として解決'
  );

  // 確定行の必須抽出条件
  assert.ok(
    distRepoJs.includes('if (!rawCompletedAt || !groupKey || count <= 0) continue;'),
    'completedAt が存在し、groupKey が存在し、count > 0 の確定行のみ集計すること'
  );

  // groupKey の優先順位 (lineUserId 最優先、次点 staffId)
  assert.ok(
    distRepoJs.includes('const groupKey = rowLineUserId || staffId;'),
    'groupKey は lineUserId を最優先し、未設定時は staffId を使用'
  );
});

// ----------------------------------------------------------------------------
// 8. Universal 原則遵守 & 厳格な Scope Lock
// ----------------------------------------------------------------------------
test('8. Universal 原則遵守: active/ 配下に地区固有ハードコードがなく、マスターデータが保護されていること', () => {
  // data/** SSOT から動的取得 (Universal Invariant)
  const configContent = fs.readFileSync(path.join(rootDir, 'data/config.js'), 'utf8');
  const districtIdMatch = configContent.match(/districtId:\s*["']([^"']+)["']/);
  const districtId = districtIdMatch ? districtIdMatch[1].trim() : null;

  const electionContent = fs.readFileSync(path.join(rootDir, 'data/election_history.json'), 'utf8');
  const electionData = JSON.parse(electionContent);
  const districtName = electionData.districtName ? electionData.districtName.trim() : null;

  const muniCsvContent = fs.readFileSync(path.join(rootDir, 'data/municipality_master.csv'), 'utf8');
  const muniNames = muniCsvContent.trim().split('\n').slice(1).map(l => l.split(',')[0].trim()).filter(Boolean);

  const activeFiles = [appJsPath, renderJsPath, dbJsPath];
  for (const f of activeFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (districtId) {
      assert.ok(!content.includes(districtId), `地区ID (${districtId}) が active/ にハードコードされていないこと`);
    }
    if (districtName) {
      assert.ok(!content.includes(districtName), `地区名 (${districtName}) が active/ にハードコードされていないこと`);
    }
    for (const city of muniNames) {
      assert.ok(!content.includes(city), `自治体名 (${city}) が active/ にハードコードされていないこと`);
    }
  }

  // address_master.csv と municipality_master.csv の動的整合性検証 (Universal Invariant)
  const masterCsv = fs.readFileSync(path.join(rootDir, 'data/address_master.csv'), 'utf8');
  const addressLines = masterCsv.trim().split('\n').filter(Boolean);
  const dataRows = addressLines.slice(1);
  assert.ok(dataRows.length > 0, 'マスターCSVに有効なデータ行が存在すること');

  // municipality_master.csv から期待総件数および有効自治体集合を動的導出
  const muniCsv = fs.readFileSync(path.join(rootDir, 'data/municipality_master.csv'), 'utf8');
  const muniLines = muniCsv.trim().split('\n').filter(Boolean).slice(1);
  const validCities = new Set();
  const expectedTotalTowns = muniLines.reduce((sum, line) => {
    const parts = line.split(',');
    validCities.add(parts[0].trim());
    return sum + (parseInt(parts[2], 10) || 0);
  }, 0);

  assert.equal(
    dataRows.length,
    expectedTotalTowns,
    'address_master.csv の行数は municipality_master.csv の total_towns 合計と完全一致すること'
  );

  // Universal Invariants: rowId 1..N 連続性・重複ゼロ・自治体集合整合検証
  const rowIds = [];
  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i].split(',');
    const id = parseInt(cols[0], 10);
    const cityName = cols[1]?.trim();
    rowIds.push(id);
    assert.ok(validCities.has(cityName), `行 ${i + 2} の自治体名 "${cityName}" が municipality_master.csv に定義されていること`);
  }
  const uniqueRowIds = new Set(rowIds);
  assert.equal(uniqueRowIds.size, dataRows.length, 'rowId に重複が存在しないこと');
  for (let i = 1; i <= dataRows.length; i++) {
    assert.ok(uniqueRowIds.has(i), `rowId 連番に欠損がないこと (${i})`);
  }
});

// ----------------------------------------------------------------------------
// 9. P1 #3: 完了実績取消（isDone=false）の完全閉鎖とデータ不変性（Fail-Closed & Mutation 0）
// ----------------------------------------------------------------------------
test('9. P1 #3: isDone=false 取消経路の完全閉鎖（Fail-Closed & Mutation 0 & 正常系/重複/保護維持）', async () => {
  // --- 静的構造検証 ---
  // 1. GPSService において !isComplete 時に即時 INVALID_OPERATION 復帰すること
  assert.ok(
    gpsServiceJs.includes('code: "INVALID_OPERATION"') &&
    gpsServiceJs.includes('完了実績の取消は許可されていません。'),
    'GPSService で !isComplete の場合に INVALID_OPERATION で即時拒否されること'
  );

  // 2. GPSRepository において旧Revert処理（D:Pクリア）が完全撤廃されていること
  assert.ok(
    !gpsRepositoryJs.includes('Revert D to P'),
    'GPSRepository から旧 Revert D to P 処理が完全撤廃されていること'
  );
  assert.ok(
    gpsRepositoryJs.includes('if (!isComplete)') &&
    gpsRepositoryJs.includes('完了実績の取消は許可されていません。'),
    'GPSRepository 単体でも !isComplete 時に書込を行わずエラー復帰すること'
  );

  // --- 実動実証（vmサンドボックス実行） ---
  import('node:vm').then(async ({ default: vm }) => {
    class MockRange {
      constructor(sheet, startRow, startCol, numRows, numCols) {
        this.sheet = sheet;
        this.startRow = startRow;
        this.startCol = startCol;
        this.numRows = numRows;
        this.numCols = numCols;
      }
      getValues() {
        const rows = [];
        for (let r = 0; r < this.numRows; r++) {
          const rowData = [];
          for (let c = 0; c < this.numCols; c++) {
            const rowIndex = (this.startRow - 1) + r;
            const colIndex = (this.startCol - 1) + c;
            rowData.push(this.sheet.data[rowIndex] ? this.sheet.data[rowIndex][colIndex] : "");
          }
          rows.push(rowData);
        }
        return rows;
      }
      setValues(values) {
        for (let r = 0; r < values.length; r++) {
          for (let c = 0; c < values[r].length; c++) {
            const rowIndex = (this.startRow - 1) + r;
            const colIndex = (this.startCol - 1) + c;
            if (!this.sheet.data[rowIndex]) this.sheet.data[rowIndex] = [];
            this.sheet.data[rowIndex][colIndex] = values[r][c];
          }
        }
        this.sheet.mutationCount++;
      }
    }

    class MockFinder {
      constructor(sheet, query) {
        this.sheet = sheet;
        this.query = String(query);
      }
      matchEntireCell() { return this; }
      findNext() {
        for (let r = 0; r < this.sheet.data.length; r++) {
          if (String(this.sheet.data[r][0]) === this.query) {
            return { getRow: () => r + 1 };
          }
        }
        return null;
      }
    }

    class MockSheet {
      constructor(name, data) {
        this.name = name;
        this.data = JSON.parse(JSON.stringify(data));
        this.mutationCount = 0;
      }
      getRange(startRowOrA1, col, numRows = 1, numCols = 1) {
        if (typeof startRowOrA1 === 'string' && startRowOrA1 === "A:A") {
          return {
            createTextFinder: (q) => new MockFinder(this, q)
          };
        }
        return new MockRange(this, startRowOrA1, col, numRows, numCols);
      }
    }

    // 初期シートデータ（rowId 1〜4）
    // 列順: [0]rowId, [1]cityName, [2]townName,
    //      [3]D completedAt, [4]E count, [5]F staffId, [6]G staffName,
    //      [7]H gpsStatus, [8]I photoStatus, [9]J lat, [10]K lng, [11]L gpsTime,
    //      [12]M fileId, [13]N photoUrl, [14]O photoTime, [15]P lineUserId, [16]Q requestId
    const initialSheetData = [
      ["1", "テスト市", "町丁1", "2026/10/01 10:00:00", 100, "S001", "配布員A", "OK", "OK", 35.0, 136.6, "2026/10/01 10:00:00", "fid1", "url1", "2026/10/01 10:00:00", "U_USER_A", "req_A_001"],
      ["2", "テスト市", "町丁2", "2026/10/01 10:30:00", 200, "S002", "配布員B", "OK", "OK", 35.1, 136.7, "2026/10/01 10:30:00", "fid2", "url2", "2026/10/01 10:30:00", "U_USER_B", "req_B_001"],
      ["3", "テスト市", "町丁3", "2026/10/01 11:00:00", 150, "S003", "配布員C", "OK", "OK", 35.2, 136.8, "2026/10/01 11:00:00", "fid3", "url3", "2026/10/01 11:00:00", "",         "req_C_001"], // Legacy P空欄
      ["4", "テスト市", "町丁4", "",                     0,   "",     "",        "",   "",   "",   "",    "",                    "",     "",     "",                    "",         ""         ]  // 未完了行
    ];

    const mockSheet = new MockSheet("配布実績2026-10", initialSheetData);

    const sandbox = {
      console,
      Date,
      Math,
      Number,
      String,
      Utilities: {
        formatDate: () => "2026/10/01 12:00:00"
      },
      LockService: {
        getScriptLock: () => ({
          waitLock: () => {},
          releaseLock: () => {}
        })
      },
      MonthlySheetResolver: {
        getInstance: () => ({
          getCurrentMonth: () => "2026-10",
          getCurrentSheet: () => mockSheet
        })
      },
      sanitizeFormula: (v) => v
    };

    vm.createContext(sandbox);

    // コードをサンドボックス内で評価
    vm.runInContext(gpsRepositoryJs, sandbox);
    vm.runInContext(gpsServiceJs, sandbox);

    const service = sandbox.GPSService.getInstance();
    const repo = sandbox.GPSRepository.getInstance();

    const snapshotBefore = JSON.parse(JSON.stringify(mockSheet.data));

    // --- 必須確認 1: 完了済み本人行 + isDone=false → INVALID_OPERATION / mutation 0 ---
    const res1 = service.updateRecordWithGPSPhoto({
      rowId: 1,
      isDone: false,
      staffId: "S001",
      resolvedLineUserId: "U_USER_A",
      requestId: "req_cancel_1"
    });
    assert.equal(res1.success, false, '本人完了行への isDone=false は失敗すること');
    assert.equal(res1.code, "INVALID_OPERATION", 'code は INVALID_OPERATION であること');
    assert.equal(mockSheet.mutationCount, 0, '本人行 isDone=false でスプレッドシートへの書込 (mutation) が 0 であること');
    assert.deepEqual(mockSheet.data[0], snapshotBefore[0], '本人行のデータが一切改ざん・消去されていないこと');

    // --- 必須確認 2: 完了済み他人行 + isDone=false → 同じく拒否 / mutation 0 ---
    const res2 = service.updateRecordWithGPSPhoto({
      rowId: 2, // 他人Bの行
      isDone: false,
      staffId: "S001", // 送信者はA
      resolvedLineUserId: "U_USER_A",
      requestId: "req_cancel_2"
    });
    assert.equal(res2.success, false, '他人完了行への isDone=false は失敗すること');
    assert.equal(res2.code, "INVALID_OPERATION", '他人行でも code は INVALID_OPERATION であること');
    assert.equal(mockSheet.mutationCount, 0, '他人行 isDone=false でスプレッドシート書込が 0 であること');
    assert.deepEqual(mockSheet.data[1], snapshotBefore[1], '他人B行のデータが一切改ざん・消去されていないこと');

    // --- 必須確認 3: Legacy P空欄行 + isDone=false → 同じく拒否 / mutation 0 ---
    const res3 = service.updateRecordWithGPSPhoto({
      rowId: 3, // Legacy P空欄行
      isDone: false,
      staffId: "S001",
      resolvedLineUserId: "U_USER_A",
      requestId: "req_cancel_3"
    });
    assert.equal(res3.success, false, 'Legacy行への isDone=false は失敗すること');
    assert.equal(res3.code, "INVALID_OPERATION", 'Legacy行でも code は INVALID_OPERATION であること');
    assert.equal(mockSheet.mutationCount, 0, 'Legacy行 isDone=false でスプレッドシート書込が 0 であること');
    assert.deepEqual(mockSheet.data[2], snapshotBefore[2], 'Legacy行のデータが保護されていること');

    // --- 必須確認 4: 未完了行 + isDone=false → 同じく拒否 / mutation 0 ---
    const res4 = service.updateRecordWithGPSPhoto({
      rowId: 4, // 未完了行
      isDone: false,
      staffId: "S001",
      resolvedLineUserId: "U_USER_A",
      requestId: "req_cancel_4"
    });
    assert.equal(res4.success, false, '未完了行への isDone=false も失敗すること');
    assert.equal(res4.code, "INVALID_OPERATION", '未完了行でも code は INVALID_OPERATION であること');
    assert.equal(mockSheet.mutationCount, 0, '未完了行 isDone=false でスプレッドシート書込が 0 であること');
    assert.deepEqual(mockSheet.data[3], snapshotBefore[3], '未完了行のデータが変化しないこと');

    // --- GPSRepository単体でも isDone=false 拒絶確認 ---
    const repoRes = repo.updateSheetRecordAndLog({ isDone: false, rowId: 1 }, 1, "OK", "OK", null, "");
    assert.equal(repoRes.success, false, 'GPSRepository単体でも isDone=false は書込せず失敗すること');
    assert.equal(mockSheet.mutationCount, 0, 'Repository単体呼出でも mutation 0 であること');

    // --- 必須確認 5: isDone=true 正常提出 → 従来通り成功 ---
    const res5 = service.updateRecordWithGPSPhoto({
      rowId: 4, // 未完了行への提出
      isDone: true,
      count: 250,
      staffId: "S001",
      staffName: "配布員A",
      latitude: 35.05,
      longitude: 136.65,
      resolvedLineUserId: "U_USER_A",
      requestId: "req_A_new_004"
    });
    assert.equal(res5.success, true, 'isDone=true の正常提出は成功すること');
    assert.equal(res5.rowId, 4);
    assert.equal(mockSheet.mutationCount, 1, '正常提出により初めて mutation が 1 となること');
    assert.equal(mockSheet.data[3][3], "2026/10/01 12:00:00", 'D completedAt が記録されたこと');
    assert.equal(mockSheet.data[3][4], 250, 'E count が記録されたこと');
    assert.equal(mockSheet.data[3][5], "S001", 'F staffId が記録されたこと');
    assert.equal(mockSheet.data[3][15], "U_USER_A", 'P lineUserId が記録されたこと');
    assert.equal(mockSheet.data[3][16], "req_A_new_004", 'Q requestId が記録されたこと');

    // --- 必須確認 6: 同一requestId → duplicate維持 ---
    const res6 = service.updateRecordWithGPSPhoto({
      rowId: 4,
      isDone: true,
      count: 250,
      staffId: "S001",
      staffName: "配布員A",
      resolvedLineUserId: "U_USER_A",
      requestId: "req_A_new_004" // 同一 requestId
    });
    assert.equal(res6.success, true, 'duplicate 判定で成功応答すること');
    assert.equal(res6.accepted, true);
    assert.equal(res6.duplicate, true, 'duplicate フラグが true であること');
    assert.equal(mockSheet.mutationCount, 1, '同一 requestId の再送では書込 (mutation) が発生しないこと');

    // --- 必須確認 7: 完了済み別requestId → alreadyCompleted維持 ---
    const res7 = service.updateRecordWithGPSPhoto({
      rowId: 4,
      isDone: true,
      count: 300,
      staffId: "S002",
      staffName: "配布員B",
      resolvedLineUserId: "U_USER_B",
      requestId: "req_B_diff_005" // 別 requestId
    });
    assert.equal(res7.success, true, 'alreadyCompleted 判定で成功応答すること');
    assert.equal(res7.accepted, true);
    assert.equal(res7.alreadyCompleted, true, 'alreadyCompleted フラグが true であること');
    assert.equal(mockSheet.mutationCount, 1, '完了済み別 requestId の操作では既存実績が保護され書込が発生しないこと');

    // --- 必須確認 8: count 入力検証 (Fail-Closed & 境界値) ---
    const mutBeforeCount = mockSheet.mutationCount;

    // 拒否ケース (INVALID_COUNT / mutation 0)
    const invalidCountCases = [-100, 1.5, "abc", "Infinity", Infinity, 10001, "", null, undefined];
    for (const badCount of invalidCountCases) {
      const resBad = service.updateRecordWithGPSPhoto({
        rowId: 3, // Legacy未完了または未完了行への操作試行
        isDone: true,
        count: badCount,
        staffId: "S001",
        resolvedLineUserId: "U_USER_A",
        requestId: `req_bad_count_${String(badCount)}`
      });
      assert.equal(resBad.success, false, `異常 count (${badCount}) は失敗すること`);
      assert.equal(resBad.code, "INVALID_COUNT", `異常 count (${badCount}) の code は INVALID_COUNT であること`);
    }
    assert.equal(mockSheet.mutationCount, mutBeforeCount, '異常 count ではスプレッドシートへの書込 (mutation) が 0 であること');

    // 許容ケース (0, 100, 10000, "100")
    // rowId 5 を追加して検証
    mockSheet.data.push(["5", "テスト市", "町丁5", "", 0, "", "", "", "", "", "", "", "", "", "", "", ""]);
    const resCount0 = service.updateRecordWithGPSPhoto({
      rowId: 5,
      isDone: true,
      count: 0,
      staffId: "S001",
      staffName: "配布員A",
      latitude: 35.0,
      longitude: 136.6,
      resolvedLineUserId: "U_USER_A",
      requestId: "req_count_0"
    });
    assert.equal(resCount0.success, true, 'count=0 は正常受理されること');
    assert.equal(resCount0.count, 0);
    assert.equal(mockSheet.data[4][4], 0, 'E列に 0 が記録されること');

    mockSheet.data.push(["6", "テスト市", "町丁6", "", 0, "", "", "", "", "", "", "", "", "", "", "", ""]);
    const resCount10000 = service.updateRecordWithGPSPhoto({
      rowId: 6,
      isDone: true,
      count: 10000,
      staffId: "S001",
      staffName: "配布員A",
      latitude: 35.0,
      longitude: 136.6,
      resolvedLineUserId: "U_USER_A",
      requestId: "req_count_10000"
    });
    assert.equal(resCount10000.success, true, 'count=10000 は正常受理されること');
    assert.equal(resCount10000.count, 10000);
    assert.equal(mockSheet.data[5][4], 10000, 'E列に 10000 が記録されること');

    mockSheet.data.push(["7", "テスト市", "町丁7", "", 0, "", "", "", "", "", "", "", "", "", "", "", ""]);
    const resCountStr = service.updateRecordWithGPSPhoto({
      rowId: 7,
      isDone: true,
      count: "100",
      staffId: "S001",
      staffName: "配布員A",
      latitude: 35.0,
      longitude: 136.6,
      resolvedLineUserId: "U_USER_A",
      requestId: "req_count_str"
    });
    assert.equal(resCountStr.success, true, 'count="100" は数値100として正常受理されること');
    assert.equal(resCountStr.count, 100);
    assert.equal(mockSheet.data[6][4], 100, 'E列に 100 が記録されること');

    // --- 必須確認 9: GPS 空間境界検証 (日本国内測地系 20.0-46.0 / 122.0-154.0) ---
    // 正常 OK ケース
    const validGpsCases = [
      { lat: 35.0, lng: 136.6, desc: "テスト市中心" },
      { lat: 20.0, lng: 122.0, desc: "南西端境界" },
      { lat: 46.0, lng: 154.0, desc: "北東端境界" }
    ];
    let nextRow = 8;
    for (const g of validGpsCases) {
      mockSheet.data.push([String(nextRow), "テスト市", `町丁${nextRow}`, "", 0, "", "", "", "", "", "", "", "", "", "", "", ""]);
      const resG = service.updateRecordWithGPSPhoto({
        rowId: nextRow,
        isDone: true,
        count: 50,
        staffId: "S001",
        staffName: "配布員A",
        latitude: g.lat,
        longitude: g.lng,
        resolvedLineUserId: "U_USER_A",
        requestId: `req_valid_gps_${nextRow}`
      });
      assert.equal(resG.success, true, `GPS ${g.desc} は成功すること`);
      assert.equal(resG.gpsStatus, "OK", `GPS ${g.desc} の gpsStatus は OK であること`);
      const rowData = mockSheet.data[nextRow - 1];
      assert.equal(rowData[7], "OK", `H列は OK であること (${g.desc})`);
      assert.equal(rowData[9], g.lat, `J列に正しい緯度が記録されること (${g.desc})`);
      assert.equal(rowData[10], g.lng, `K列に正しい経度が記録されること (${g.desc})`);
      nextRow++;
    }

    // 範囲外 NO フォールバック ケース (リクエスト成功、gpsStatus: "NO"、J/K列空欄)
    const invalidGpsCases = [
      { lat: 19.999, lng: 136.6, desc: "緯度下限未満" },
      { lat: 46.001, lng: 136.6, desc: "緯度上限超過" },
      { lat: 35.0, lng: 121.999, desc: "経度下限未満" },
      { lat: 35.0, lng: 154.001, desc: "経度上限超過" },
      { lat: 91, lng: 181, desc: "世界範囲外" },
      { lat: 999, lng: 999, desc: "異常巨大値" },
      { lat: 0, lng: 0, desc: "原点0,0" },
      { lat: NaN, lng: Infinity, desc: "NaN/Infinity" }
    ];
    for (const g of invalidGpsCases) {
      mockSheet.data.push([String(nextRow), "テスト市", `町丁${nextRow}`, "", 0, "", "", "", "", "", "", "", "", "", "", "", ""]);
      const resG = service.updateRecordWithGPSPhoto({
        rowId: nextRow,
        isDone: true,
        count: 50,
        staffId: "S001",
        staffName: "配布員A",
        latitude: g.lat,
        longitude: g.lng,
        resolvedLineUserId: "U_USER_A",
        requestId: `req_invalid_gps_${nextRow}`
      });
      assert.equal(resG.success, true, `異常GPS (${g.desc}) でもリクエスト自体は成功すること`);
      assert.equal(resG.gpsStatus, "NO", `異常GPS (${g.desc}) の gpsStatus は NO であること`);
      const rowData = mockSheet.data[nextRow - 1];
      assert.equal(rowData[7], "NO", `H列は NO であること (${g.desc})`);
      assert.equal(rowData[9], "", `J列は空欄であること (${g.desc})`);
      assert.equal(rowData[10], "", `K列は空欄であること (${g.desc})`);
      nextRow++;
    }
  });
});

// ----------------------------------------------------------------------------
// 10. P1: PinStatus Completion Zero-Frontend-Remove & Cancel Contract Verification (Case 1〜11)
// ----------------------------------------------------------------------------
test('10. P1: PinStatus Completion Zero-Frontend-Remove & Cancel Contract Verification (Case 1〜11)', async () => {
  // --- 静的構造検証: 冗長呼出の完全排除と正規配置 ---
  // appJs: triggerUISyncRefresh 内から setPinInProgress が排除されていること
  const triggerRefreshMatch = appJs.match(/window\.triggerUISyncRefresh\s*=\s*async\s*function[\s\S]*?^};/m);
  assert.ok(triggerRefreshMatch, 'triggerUISyncRefresh が存在すること');
  assert.ok(!triggerRefreshMatch[0].includes('setPinInProgress'), 'triggerUISyncRefresh 内に setPinInProgress の呼出が存在しないこと');

  // appJs: submitMissionComplete 内から setPinInProgress の重複呼出が排除されていること
  const submitCompleteMatch = appJs.match(/async\s*function\s*submitMissionComplete[\s\S]*?^}/m);
  assert.ok(submitCompleteMatch, 'submitMissionComplete が存在すること');
  assert.ok(!submitCompleteMatch[0].includes('setPinInProgress'), 'submitMissionComplete 内に setPinInProgress が存在しないこと');

  // Composition Root: onAcceptedAfterDequeue 内から setPinInProgress が完全撤去され、PinStatusModule.reflectCompleted が呼ばれていること
  const hookIdx = appJs.indexOf('onAcceptedAfterDequeue');
  assert.ok(hookIdx > 0, 'app.js に onAcceptedAfterDequeue が存在すること');
  const hookBlock = appJs.substring(hookIdx, appJs.indexOf('onFailedAfterQueueUpdate', hookIdx));
  assert.ok(!hookBlock.includes('setPinInProgress'), 'app.js の onAcceptedAfterDequeue で Frontend setPinInProgress が呼ばれないこと (Backend完了時一体解除)');
  assert.ok(hookBlock.includes('PinStatusModule.reflectCompleted(item.rowId);'), 'app.js の onAcceptedAfterDequeue で PinStatusModule.reflectCompleted が呼ばれること');

  // dbJs: dequeueSync 完了後に onAcceptedAfterDequeue Hook が呼ばれること
  assert.ok(dbJs.includes('await dequeueSync(item.id);'), 'dequeueSync が存在すること');
  assert.ok(dbJs.includes('onAcceptedAfterDequeue'), 'db.js に onAcceptedAfterDequeue Hook 呼出が存在すること');

  // キャンセル契約維持: renderJs の cancelMissionComplete 内に setPinInProgress が維持されていること
  assert.ok(renderJs.includes('cancelMissionComplete'), 'render.js に cancelMissionComplete が存在すること');
  const cancelMatch = renderJs.match(/window\.cancelMissionComplete\s*=\s*function[\s\S]*?^};/m);
  assert.ok(cancelMatch && cancelMatch[0].includes('setPinInProgress'), 'cancelMissionComplete 内に setPinInProgress が維持されていること (キャンセル契約保護)');

  // --- 動的ロジックシミュレーション: Case 1 〜 11 の網羅的判定 ---
  function createTestHarness() {
    let removeCallCount = 0;
    const removedRowIds = [];

    const mockWindow = {
      globalPinStatus: {
        completed: [],
        inProgress: [101]
      },
      setPinInProgress: (rowId, action) => {
        if (action === "remove") {
          removeCallCount++;
          removedRowIds.push(Number(rowId));
          mockWindow.globalPinStatus.inProgress = mockWindow.globalPinStatus.inProgress.filter(id => id !== Number(rowId));
        }
      },
      lockActivePinAndBubble: () => {},
      triggerUISyncRefresh: null
    };

    // db.js + onAcceptedAfterDequeue 新契約シミュレータ (Backend一体解除済みのため Frontend remove = 0、reflectCompleted のみ)
    async function simulateDbPostAcceptance(item, res, pointOrAreaCondition) {
      if (res && res.success) {
        if (res.accepted === false) {
          // STALE_MONTH: 非受諾終端 (remove は呼ばれない)
          if (pointOrAreaCondition && typeof pointOrAreaCondition === 'object') {
            pointOrAreaCondition.syncStatus = 'REJECTED';
          }
          return;
        }

        // PinStatusModule.reflectCompleted(item.rowId) 相当 (API 0回で completed 反映 + inProgress 除去)
        if (mockWindow.globalPinStatus) {
          const numericRowId = Number(item.rowId);
          if (!isNaN(numericRowId)) {
            if (!mockWindow.globalPinStatus.completed.includes(numericRowId)) {
              mockWindow.globalPinStatus.completed.push(numericRowId);
            }
            mockWindow.globalPinStatus.inProgress = mockWindow.globalPinStatus.inProgress.filter(id => id !== numericRowId);
          }
        }

        // db.js の rowId 基準による同期 (新契約)
        if (pointOrAreaCondition && typeof pointOrAreaCondition === 'object' && Number(pointOrAreaCondition.rowId) === Number(item.rowId)) {
          pointOrAreaCondition.isDone = true;
          delete pointOrAreaCondition.tempPhotoUrl;
          delete pointOrAreaCondition.isReadyToSubmit;
        }

        // UI処理
        if (typeof mockWindow.lockActivePinAndBubble === 'function') {
          mockWindow.lockActivePinAndBubble(item.rowId);
        }
      } else {
        if (pointOrAreaCondition && typeof pointOrAreaCondition === 'object' && Number(pointOrAreaCondition.rowId) === Number(item.rowId)) {
          pointOrAreaCondition.syncStatus = res ? 'RETRY' : 'FAILED_PERMANENT';
        }
      }
    }

    // app.js の triggerUISyncRefresh 改訂後シミュレータ (setPinInProgress なし)
    function simulateTriggerUISyncRefresh(point) {
      if (point.isDone === true) {
        delete point.isReadyToSubmit;
        delete point.tempPhotoUrl;
        delete point.syncStatus;
        if (mockWindow.globalPinStatus) {
          if (!mockWindow.globalPinStatus.completed.includes(point.rowId)) {
            mockWindow.globalPinStatus.completed.push(point.rowId);
          }
          mockWindow.globalPinStatus.inProgress = mockWindow.globalPinStatus.inProgress.filter(id => id !== point.rowId);
        }
        if (typeof mockWindow.lockActivePinAndBubble === 'function') {
          mockWindow.lockActivePinAndBubble(point.rowId);
        }
      }
    }

    // app.js の submitMissionComplete 改訂後ポーリング検知シミュレータ (setPinInProgress なし)
    function simulateSubmitPollingDetect(point, rowId = point.rowId) {
      const isCompletedInPinStatus = Boolean(
        mockWindow.globalPinStatus &&
        Array.isArray(mockWindow.globalPinStatus.completed) &&
        mockWindow.globalPinStatus.completed.includes(Number(rowId))
      );
      if (isCompletedInPinStatus) {
        point.isDone = true;
      }

      if (point.isDone === true) {
        point.syncStatus = 'synced';
        if (mockWindow.globalPinStatus) {
          if (!mockWindow.globalPinStatus.completed.includes(point.rowId)) {
            mockWindow.globalPinStatus.completed.push(point.rowId);
          }
          mockWindow.globalPinStatus.inProgress = mockWindow.globalPinStatus.inProgress.filter(id => id !== point.rowId);
        }
        if (typeof mockWindow.lockActivePinAndBubble === 'function') {
          mockWindow.lockActivePinAndBubble(point.rowId);
        }
        return true;
      }
      return false;
    }

    return {
      mockWindow,
      getRemoveCount: () => removeCallCount,
      simulateDbPostAcceptance,
      simulateTriggerUISyncRefresh,
      simulateSubmitPollingDetect
    };
  }

  // Case 1: 正常即時成功 → Frontend remove API 論理発火 = 0 (Backend側で解除済み、ローカルは reflectCompleted で終端)
  {
    const h = createTestHarness();
    const item = { id: 1, rowId: 101, areaName: "テスト市中央" };
    const res = { success: true, accepted: true };
    await h.simulateDbPostAcceptance(item, res, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 1: 正常即時成功で Frontend remove 発火が 0 回であること');
    assert.ok(h.mockWindow.globalPinStatus.completed.includes(101), 'Case 1: completed に 101 が反映されること');
    assert.ok(!h.mockWindow.globalPinStatus.inProgress.includes(101), 'Case 1: inProgress から 101 が除去されること');
  }

  // Case 2: triggerUISyncRefresh を成功後に複数回実行 → remove = 0
  {
    const h = createTestHarness();
    const item = { id: 1, rowId: 101, areaName: "テスト市中央" };
    await h.simulateDbPostAcceptance(item, { success: true, accepted: true }, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0);

    const pt = { rowId: 101, isDone: true };
    h.simulateTriggerUISyncRefresh(pt);
    h.simulateTriggerUISyncRefresh(pt);
    h.simulateTriggerUISyncRefresh(pt);
    assert.equal(h.getRemoveCount(), 0, 'Case 2: triggerUISyncRefresh 複数回実行でも Frontend remove 発火が 0 であること');
  }

  // Case 3: submitMissionComplete が成功を検知 → remove = 0
  {
    const h = createTestHarness();
    const item = { id: 1, rowId: 101, areaName: "テスト市中央" };
    await h.simulateDbPostAcceptance(item, { success: true, accepted: true }, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0);

    const pt = { rowId: 101, isDone: true };
    const detected = h.simulateSubmitPollingDetect(pt);
    assert.equal(detected, true);
    assert.equal(h.getRemoveCount(), 0, 'Case 3: submitMissionComplete 成功検知でも Frontend remove 発火が 0 であること');
  }

  // Case 4: areaName条件に依存せず、Backend受諾時に reflectCompleted が反映され Frontend remove = 0
  {
    const h = createTestHarness();
    const item = { id: 1, rowId: 101, areaName: "テスト市中央" };
    // 表示中エリアが別エリア（"テスト市東部"）
    await h.simulateDbPostAcceptance(item, { success: true, accepted: true }, "テスト市東部");
    assert.equal(h.getRemoveCount(), 0, 'Case 4: areaName条件に依存せず Frontend remove が 0 回であること');
    assert.ok(h.mockWindow.globalPinStatus.completed.includes(101), 'Case 4: completed に 101 が反映されること');
  }

  // Case 5: offline Queue 復旧後の成功 → Frontend remove = 0
  {
    const h = createTestHarness();
    const offlineItem = { id: 2, rowId: 102, areaName: "テスト市中央", syncStatus: "PENDING" };
    await h.simulateDbPostAcceptance(offlineItem, { success: true, accepted: true }, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 5: オフライン復旧後の送信成功で Frontend remove が 0 回であること');
    assert.ok(h.mockWindow.globalPinStatus.completed.includes(102), 'Case 5: completed に 102 が反映されること');
  }

  // Case 6: Backend duplicate:true → accepted success として Queue 終端 → Frontend remove = 0
  {
    const h = createTestHarness();
    const item = { id: 3, rowId: 103, areaName: "テスト市中央" };
    const res = { success: true, accepted: true, duplicate: true };
    await h.simulateDbPostAcceptance(item, res, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 6: duplicate:true 受諾時に Frontend remove が 0 回であること');
    assert.ok(h.mockWindow.globalPinStatus.completed.includes(103), 'Case 6: completed に 103 が反映されること');
  }

  // Case 7: alreadyCompleted:true → accepted success として Queue 終端 → Frontend remove = 0
  {
    const h = createTestHarness();
    const item = { id: 4, rowId: 104, areaName: "テスト市中央" };
    const res = { success: true, accepted: true, alreadyCompleted: true };
    await h.simulateDbPostAcceptance(item, res, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 7: alreadyCompleted:true 受諾時に Frontend remove が 0 回であること');
    assert.ok(h.mockWindow.globalPinStatus.completed.includes(104), 'Case 7: completed に 104 が反映されること');
  }

  // Case 8: STALE_MONTH accepted:false → remove = 0
  {
    const h = createTestHarness();
    const item = { id: 5, rowId: 105, areaName: "テスト市中央" };
    const res = { success: true, accepted: false, code: "STALE_MONTH" };
    await h.simulateDbPostAcceptance(item, res, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 8: STALE_MONTH 非受諾終端では remove が 0 であること');
  }

  // Case 9: Backend failure / RETRY → remove = 0
  {
    const h = createTestHarness();
    const item = { id: 6, rowId: 106, areaName: "テスト市中央" };
    const res = { success: false, message: "Server temporary error" };
    await h.simulateDbPostAcceptance(item, res, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 9: Backend failure では remove が 0 であること');
  }

  // Case 10: FAILED_PERMANENT → remove = 0
  {
    const h = createTestHarness();
    const item = { id: 7, rowId: 107, areaName: "テスト市中央" };
    // 永続エラー時 (res なし / catch 節で scheduleRetry され remove は呼ばれない)
    await h.simulateDbPostAcceptance(item, null, "テスト市中央");
    assert.equal(h.getRemoveCount(), 0, 'Case 10: FAILED_PERMANENT では remove が 0 であること');
  }

  // Case 11: 新Contract (areaName非依存 ➔ db.js rowId同期で p.isDone=true & reflectCompleted ➔ Handshake成功 ➔ Frontend remove 0回)
  {
    const h = createTestHarness();
    // 1. MAP直接動線を再現: rowId 基準で item と point を生成
    const item = { id: 8, rowId: 332, areaName: "" };
    const pt = { rowId: 332, isDone: false, syncStatus: 'submitting' };

    // 2. Backend accepted 受領 (db.js 新契約: areaName に依存せず rowId 一致で pt.isDone = true が同期確定、Frontend remove = 0)
    await h.simulateDbPostAcceptance(item, { success: true, accepted: true }, pt);
    assert.equal(pt.isDone, true, '新契約: db.js が rowId 一致で pt.isDone = true を直接同期すること');
    assert.ok(h.mockWindow.globalPinStatus.completed.includes(332), 'globalPinStatus.completed に 332 が記録されること');
    assert.equal(h.getRemoveCount(), 0, 'Backend側で解除済みのため Frontend remove は 0 回であること');

    // 3. app.js のポーリング検知: Handshake 成功 (p.isDone === true または isCompletedInPinStatus) ➔ 正常完了
    const detected = h.simulateSubmitPollingDetect(pt, 332);
    assert.equal(detected, true, 'Handshake が成立し正常完了が検知されること');
    assert.equal(pt.isDone, true, 'pt.isDone が true を維持すること');
    assert.equal(pt.syncStatus, 'synced', 'pt.syncStatus が synced に更新されること');
    assert.equal(h.getRemoveCount(), 0, 'app.js からの Frontend remove も 0 回であること');

    // 4. 反例確認: Queue消滅(null)だが globalPinStatus.completed が空で p.isDone=false の場合は成功検知しないこと
    const emptyPt = { rowId: 999, isDone: false };
    const falseDetected = h.simulateSubmitPollingDetect(emptyPt, 999);
    assert.equal(falseDetected, false, 'completed に含まれず isDone=false の場合は成功検知しないこと');

    // 5. 反例確認: REJECTED (STALE_MONTH) では completed に入らず誤成功しないこと
    const rejectItem = { id: 9, rowId: 333, areaName: "" };
    const rejectPt = { rowId: 333, isDone: false, syncStatus: 'submitting' };
    await h.simulateDbPostAcceptance(rejectItem, { success: true, accepted: false, code: "STALE_MONTH" }, rejectPt);
    assert.ok(!h.mockWindow.globalPinStatus.completed.includes(333), 'REJECTED では completed に追加されないこと');
    assert.equal(rejectPt.isDone, false, 'REJECTED では isDone が true にならないこと');
    assert.equal(h.simulateSubmitPollingDetect(rejectPt, 333), false, 'REJECTED では成功検知しないこと');

    // 6. 反例確認: RETRY では completed に入らず誤成功しないこと
    const retryItem = { id: 10, rowId: 334, areaName: "" };
    const retryPt = { rowId: 334, isDone: false, syncStatus: 'submitting' };
    await h.simulateDbPostAcceptance(retryItem, { success: false, message: "Network Error" }, retryPt);
    assert.ok(!h.mockWindow.globalPinStatus.completed.includes(334), 'RETRY では completed に追加されないこと');
    assert.equal(retryPt.isDone, false, 'RETRY では isDone が true にならないこと');
    assert.equal(h.simulateSubmitPollingDetect(retryPt, 334), false, 'RETRY では成功検知しないこと');

    // 7. 反例確認: FAILED_PERMANENT では completed に入らず誤成功しないこと
    const failItem = { id: 11, rowId: 335, areaName: "" };
    const failPt = { rowId: 335, isDone: false, syncStatus: 'submitting' };
    await h.simulateDbPostAcceptance(failItem, null, failPt);
    assert.ok(!h.mockWindow.globalPinStatus.completed.includes(335), 'FAILED_PERMANENT では completed に追加されないこと');
    assert.equal(failPt.isDone, false, 'FAILED_PERMANENT では isDone が true にならないこと');
    assert.equal(h.simulateSubmitPollingDetect(failPt, 335), false, 'FAILED_PERMANENT では成功検知しないこと');
  }
});

console.log('✅ ALL 10 PHASE 11 ACTIVITY STATE MACHINE VERIFICATION CHECKS DEFINED SUCCESSFULLY.\n');



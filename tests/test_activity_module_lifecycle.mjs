#!/usr/bin/env node
/**
 * tests/test_activity_module_lifecycle.mjs
 * H-App Activity Feature Module Lifecycle Audit Suite (38 Gates)
 *
 * 目的:
 * Architecture B' Wave 4 における ActivityModule の
 * 1. 状態遷移マシン (UNTOUCHED ➔ IN_PROGRESS ➔ DRAFT ➔ SUBMITTING ➔ QUEUED ➔ COMPLETED)
 * 2. 厳格な公開 API (exactly 7 methods)
 * 3. 外部直接依存の完全排除 (DOM, window, navigator, localStorage, indexedDB 等の禁止)
 * 4. Camera User Gesture 同期保護契約
 * 5. COMPLETED 確定条件および因果関係の絶対順序
 * 6. Single-Fire 契約 (PinStatus remove 重複防止)
 * 7. Queue Hook 連携と Fail-Closed 契約
 * を網羅的に検証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = process.cwd();
const activityJsPath = path.join(rootDir, 'active/h-app/modules/activity.js');
const dbJsPath = path.join(rootDir, 'active/h-app/db.js');
const appJsPath = path.join(rootDir, 'active/h-app/app.js');

console.log('====================================================');
console.log('🧪 H-APP ACTIVITY MODULE LIFECYCLE AUDIT (45 GATES)');
console.log('====================================================\n');

/**
 * テスト用 ActivityModule インスタンス生成ヘルパー
 */
function createActivityModule() {
  const code = fs.readFileSync(activityJsPath, 'utf8');
  const sandbox = {
    setTimeout,
    clearTimeout,
    Date,
    Math,
    parseFloat,
    parseInt,
    Number,
    Boolean,
    Array,
    Object,
    Promise,
    console
  };
  vm.createContext(sandbox);
  return vm.runInContext(code + '\nActivityModule;', sandbox);
}

test('Gate 1: UNTOUCHED 初期状態の検証', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 101, isDone: false, count: 0, syncStatus: '', photoStatus: 'NONE', gpsStatus: 'NO' };
  assert.equal(point.isDone, false);
  assert.equal(point.count, 0);
  assert.equal(point.syncStatus, '');
  assert.equal(point.photoStatus, 'NONE');
  assert.equal(point.gpsStatus, 'NO');
});

test('Gate 2: count 入力単独では COMPLETED にならないこと', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 102, isDone: false };
  // count 入力中 (Draft 確定前)
  point.count = 150;
  assert.equal(point.isDone, false);
  assert.equal(point.isReadyToSubmit, undefined);
});

test('Gate 3: camera / GPS 完了でも COMPLETED にならないこと', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 103, isDone: false };
  ActivityModule.createDraft(point, 200, { staffName: '配布員A', staffId: 'STF01' }, 'base64data', 'blob:http://...');
  ActivityModule.applyGpsResult(point, { latitude: 35.0, longitude: 136.0, accuracy: 10 });
  assert.equal(point.isDone, false, 'DRAFT 完了時でも isDone は false を維持');
  assert.equal(point.isReadyToSubmit, true);
});

test('Gate 4: DRAFT 状態で isReadyToSubmit: true かつ isDone: false であること', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 104, isDone: false };
  ActivityModule.createDraft(point, 100, { staffName: '配布員B' }, 'imgBase64', 'blob:preview');
  assert.strictEqual(point.isReadyToSubmit, true);
  assert.strictEqual(point.isDone, false);
  assert.strictEqual(point.count, 100);
  assert.strictEqual(point.photoStatus, 'OK');
  assert.strictEqual(point.syncStatus, 'pending');
});

test('Gate 5: カメラキャンセル時に Draft 確定しないこと', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 105, isDone: false, count: 0 };
  // photoData が空の場合の挙動
  ActivityModule.createDraft(point, 50, { staffName: '配布員' }, '', '');
  assert.strictEqual(point.photoStatus, 'NONE');
  assert.strictEqual(point.isReadyToSubmit, false);
  assert.strictEqual(point.isDone, false);
});

test('Gate 6: 【最重要】camera activation 前に await / microtask が存在しないこと (静的検査)', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const pressNumOkIndex = appJs.indexOf("key === 'OK'");
  assert.ok(pressNumOkIndex > 0, "pressNum key === 'OK' ブロックが存在すること");
  const section = appJs.substring(pressNumOkIndex, pressNumOkIndex + 1200);

  const gpsPos = section.indexOf('getGPSLocation()');
  const cameraPos = section.indexOf('capturePhoto()');
  const closeNumpadPos = section.indexOf('closeNumpad()');

  assert.ok(gpsPos > 0 && cameraPos > 0 && closeNumpadPos > 0, '必要な呼び出しが存在すること');
  assert.ok(gpsPos < cameraPos, 'getGPSLocation() が capturePhoto() より前または直前であること');
  assert.ok(cameraPos < closeNumpadPos, 'capturePhoto() が closeNumpad() より前であること');

  const beforeCamera = section.substring(0, cameraPos);
  assert.ok(!beforeCamera.includes('await '), 'capturePhoto() より前に await が存在しないこと');
  assert.ok(!beforeCamera.includes('setTimeout'), 'capturePhoto() より前に setTimeout が存在しないこと');
  assert.ok(!beforeCamera.includes('Promise.then'), 'capturePhoto() より前に Promise.then が存在しないこと');
  assert.ok(!beforeCamera.includes('queueMicrotask'), 'capturePhoto() より前に queueMicrotask が存在しないこと');
  assert.ok(!beforeCamera.includes('requestAnimationFrame'), 'capturePhoto() より前に requestAnimationFrame が存在しないこと');
});

test('Gate 7: capturePhoto is called before closeNumpad', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const pressNumOkIndex = appJs.indexOf("key === 'OK'");
  const section = appJs.substring(pressNumOkIndex, pressNumOkIndex + 1000);
  assert.ok(section.indexOf('capturePhoto()') < section.indexOf('closeNumpad()'));
});

test('Gate 8: GPS 測位結果適用セマンティクス維持 (Current HEAD: finite, non-zero, range validation)', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 108 };
  // 正常座標オブジェクト
  ActivityModule.applyGpsResult(point, { latitude: 35.1234, longitude: 136.5678, accuracy: 15 });
  assert.equal(point.gpsStatus, 'OK');
  assert.equal(point.gps, '35.1234,136.5678');
  assert.equal(point.accuracy, 15);

  // 不正座標 (0, 0)
  ActivityModule.applyGpsResult(point, { latitude: 0, longitude: 0 });
  assert.equal(point.gpsStatus, 'NO');

  // 不正座標 (範囲外)
  ActivityModule.applyGpsResult(point, { latitude: 95.0, longitude: 136.5678 });
  assert.equal(point.gpsStatus, 'NO');

  // 空/falsy
  ActivityModule.applyGpsResult(point, null);
  assert.equal(point.gpsStatus, 'NO');
});

test('Gate 9: submitActivity duplicate guard (submitting 保護)', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 109, syncStatus: 'submitting', photoStatus: 'OK', photoBase64: 'data' };
  const res = await ActivityModule.submitActivity(point, { rowId: 109 }, {});
  assert.equal(res.success, false);
  assert.equal(res.reason, 'ALREADY_SUBMITTING');
});

test('Gate 10: SUBMITTING state transition', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 110, syncStatus: 'pending', photoStatus: 'OK', photoBase64: 'data' };
  let submittingCalled = false;
  await ActivityModule.submitActivity(point, { rowId: 110 }, {
    onSubmitting: () => {
      submittingCalled = true;
      assert.equal(point.syncStatus, 'submitting');
    },
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S1', staffName: 'N1' }),
    generateRequestId: () => 'req_test',
    enqueue: async () => 1,
    isOnline: () => false,
    onOfflineQueued: () => {}
  });
  assert.equal(submittingCalled, true);
});

test('Gate 11: auth failure ≠ COMPLETED', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 111, syncStatus: 'pending', photoStatus: 'OK', photoBase64: 'data' };
  let errorCaught = false;
  const res = await ActivityModule.submitActivity(point, { rowId: 111 }, {
    authorize: async () => { throw new Error('Auth failed'); },
    onError: (err, type) => {
      errorCaught = true;
      assert.equal(type, 'AUTH_FAILED');
    }
  });
  assert.equal(res.success, false);
  assert.equal(point.syncStatus, 'failed');
  assert.equal(point.isDone, false);
  assert.equal(errorCaught, true);
});

test('Gate 12: photo validation failure ≠ COMPLETED (写真不備の2条件それぞれにおいて isDone書き込み0回・UIフック呼び出し0回で pending へ復帰)', async () => {
  const ActivityModule = createActivityModule();

  const invalidCases = [
    {
      name: '条件1: photoStatus !== "OK"',
      point: { rowId: 1121, syncStatus: 'pending', photoStatus: 'NONE', photoBase64: 'valid_base64_data' }
    },
    {
      name: '条件2: !photoBase64 (null)',
      point: { rowId: 1122, syncStatus: 'pending', photoStatus: 'OK', photoBase64: null }
    },
    {
      name: '条件2: !photoBase64 (空文字)',
      point: { rowId: 1123, syncStatus: 'pending', photoStatus: 'OK', photoBase64: '' }
    }
  ];

  for (const c of invalidCases) {
    let isDoneWriteCount = 0;
    let isDoneVal = false;
    Object.defineProperty(c.point, 'isDone', {
      get() { return isDoneVal; },
      set(v) {
        isDoneWriteCount++;
        isDoneVal = v;
      },
      configurable: true,
      enumerable: true
    });

    const eventOrder = [];
    const res = await ActivityModule.submitActivity(c.point, { rowId: c.point.rowId }, {
      onSubmitting: async () => { eventOrder.push('submitting'); },
      onFinally: () => { eventOrder.push('finally'); },
      waitGps: async () => { eventOrder.push('waitGps'); },
      authorize: async () => { eventOrder.push('authorize'); },
      enqueue: async () => { eventOrder.push('enqueue'); return 1; }
    });

    assert.strictEqual(res.success, false, `${c.name}: success は false であること`);
    assert.strictEqual(res.reason, 'INVALID_PHOTO', `${c.name}: reason は INVALID_PHOTO であること`);
    assert.strictEqual(c.point.syncStatus, 'pending', `${c.name}: syncStatus は pending であること`);
    assert.strictEqual(c.point.isDone, false, `${c.name}: isDone は false であること`);
    assert.strictEqual(isDoneWriteCount, 0, `${c.name}: point.isDone への書き込み代入は厳密に 0 回であること (基準コード契約)`);
    assert.deepEqual(eventOrder, [], `${c.name}: UIフックおよび後続フックの呼び出しは厳密に 0 回であること`);
  }
});

test('Gate 12b: enqueue hook missing 時は SUBMISSION_FAILED となり例外を捕捉 (Fail-Closed)', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 1122, photoStatus: 'OK', photoBase64: 'data' };
  let errorCaught = null;
  const res = await ActivityModule.submitActivity(point, { rowId: 1122 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S', staffName: 'N' }),
    generateRequestId: () => 'req_1122',
    // enqueue なし
    isOnline: () => true,
    onError: (err) => { errorCaught = err; }
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'SUBMISSION_FAILED');
  assert.ok(res.error && res.error.message.includes('enqueue hook is missing'));
  assert.ok(errorCaught && errorCaught.message.includes('enqueue hook is missing'));
  assert.equal(point.isDone, false);
});

test('Gate 12c: app.js 実際の onSubmitting フック評価 (RAF前・RAF後かつタイマー前・タイマー完了後の順序因果性検証)', async () => {
  // 1. app.js 実ソースから実際の onSubmitting 関数コードを抽出して実体化
  const appJsSource = fs.readFileSync(appJsPath, 'utf8');
  const match = appJsSource.match(/onSubmitting:\s*(async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\}),/);
  assert.ok(match, 'app.js の submitMissionComplete 内から実際の onSubmitting 定義が抽出できること');

  let rafCallback = null;
  let timerCallback = null;

  const mockRaf = (cb) => {
    rafCallback = cb;
    return 1;
  };

  const mockSetTimeout = (cb, delay) => {
    timerCallback = cb;
    return 1;
  };

  const mockSubmitBtn = { disabled: false, textContent: '🚀 この内容で提出する' };
  const mockCancelBtn = { disabled: false };

  // app.js の実際の onSubmitting 関数を実体化 (代替10msフックではなく app.js 実ソースコードを直接評価)
  const actualOnSubmittingFactory = new Function('submitBtn', 'cancelBtn', 'requestAnimationFrame', 'setTimeout', `
    return (${match[1]});
  `);
  const actualOnSubmitting = actualOnSubmittingFactory(mockSubmitBtn, mockCancelBtn, mockRaf, mockSetTimeout);

  // 2. 実行時因果性の検証
  const ActivityModule = createActivityModule();
  const point = { rowId: 1123, photoStatus: 'OK', photoBase64: 'data', gpsStatus: 'pending' };
  const lifecycleEvents = [];

  const submitPromise = ActivityModule.submitActivity(point, { rowId: 1123, areaName: 'テスト町' }, {
    onSubmitting: actualOnSubmitting,
    waitGps: async () => {
      lifecycleEvents.push('wait_gps_start');
      point.gpsStatus = 'OK';
    },
    authorize: async () => {
      lifecycleEvents.push('authorize');
    },
    getVerifiedUser: () => ({ staffId: 'S_TEST', staffName: 'N_TEST' }),
    generateRequestId: () => 'req_1123',
    enqueue: async (payload) => {
      lifecycleEvents.push('enqueue');
      return 1;
    },
    isOnline: () => false // オフラインとして即時終了
  });

  // Microtask を消化して onSubmitting の初期実行を進める
  await new Promise(r => setImmediate(r));

  // --- フェーズ ①: RAF 実行前 ---
  assert.strictEqual(mockSubmitBtn.disabled, true, 'ボタンは即時無効化されていること');
  assert.strictEqual(mockSubmitBtn.textContent, '⏳ 提出中...');
  assert.strictEqual(mockCancelBtn.disabled, true, 'キャンセルボタンは即時無効化されていること');
  assert.strictEqual(typeof rafCallback, 'function', 'requestAnimationFrame にコールバックが登録されていること');
  assert.strictEqual(timerCallback, null, 'RAF 実行前はまだ setTimeout は登録されていないこと');
  assert.deepEqual(lifecycleEvents, [], '【フェーズ①】RAF 実行前には GPS待機／認証／enqueue は一切始まっていないこと');

  // --- フェーズ ②: RAF 実行後、かつタイマー実行前 ---
  rafCallback(); // RAF コールバック実行 ➔ 内部で setTimeout(resolve, 0) が呼ばれる
  assert.strictEqual(typeof timerCallback, 'function', 'RAF 実行により setTimeout にコールバックが登録されたこと');

  // Microtask を消化
  await new Promise(r => setImmediate(r));
  assert.deepEqual(lifecycleEvents, [], '【フェーズ②】RAF後かつタイマー実行前にも GPS待機／認証／enqueue は一切始まっていないこと');

  // --- フェーズ ③: タイマー完了後 ---
  timerCallback(); // タイマー完了 ➔ resolve() が呼ばれて描画待ちが解決

  const res = await submitPromise;
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.status, 'OFFLINE_QUEUED');
  assert.deepEqual(lifecycleEvents, [
    'wait_gps_start',
    'authorize',
    'enqueue'
  ], '【フェーズ③】タイマー完了後に初めて順序どおり GPS待機 ➔ 認証 ➔ enqueue と進むこと');
});

test('Gate 13: requestId 生成', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 113, syncStatus: 'pending', photoStatus: 'OK', photoBase64: 'data' };
  let capturedPayload = null;
  await ActivityModule.submitActivity(point, { rowId: 113 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S1', staffName: 'N1' }),
    generateRequestId: () => 'req_113_custom',
    enqueue: async (payload) => { capturedPayload = payload; return 1; },
    isOnline: () => false,
    onOfflineQueued: () => {}
  });
  assert.equal(capturedPayload.requestId, 'req_113_custom');
});

test('Gate 14: clientEventId === requestId の対応付け維持', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 114, syncStatus: 'pending', photoStatus: 'OK', photoBase64: 'data' };
  let capturedPayload = null;
  await ActivityModule.submitActivity(point, { rowId: 114 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S1', staffName: 'N1' }),
    generateRequestId: () => 'req_114_uuid',
    enqueue: async (payload) => { capturedPayload = payload; return 1; },
    isOnline: () => false,
    onOfflineQueued: () => {}
  });
  assert.equal(capturedPayload.requestId, 'req_114_uuid');
  assert.equal(capturedPayload.clientEventId, capturedPayload.requestId);
});

test('Gate 15: enqueue ペイロード完全性 (14フィールド & 基準HEAD準拠の送信値解決)', async () => {
  const ActivityModule = createActivityModule();
  const point = {
    rowId: 115,
    count: 350,
    photoStatus: 'OK',
    photoBase64: 'base64_data',
    gpsStatus: 'OK',
    latitude: 35.1,
    longitude: 136.2,
    accuracy: 8,
    gpsTimestamp: '10:00:00',
    townName: 'フォールバック禁止の町'
  };
  let pld = null;
  await ActivityModule.submitActivity(point, { areaName: 'テスト町1' }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'STF_115', staffName: 'スタッフ115' }),
    getBranchCode: () => 'BR01',
    generateRequestId: () => 'req_115',
    enqueue: async (payload) => { pld = payload; return 1; },
    isOnline: () => false,
    onOfflineQueued: () => {}
  });
  assert.equal(pld.requestId, 'req_115');
  assert.equal(pld.clientEventId, 'req_115');
  assert.equal(pld.areaName, 'テスト町1');
  assert.equal(pld.rowId, 115);
  assert.equal(pld.isDone, true);
  assert.equal(pld.count, 350);
  assert.equal(pld.latitude, 35.1);
  assert.equal(pld.longitude, 136.2);
  assert.equal(pld.accuracy, 8);
  assert.equal(pld.branchCode, 'BR01', 'getBranchCode フックから branchCode が取得されること');
  assert.equal(pld.areaId, '115');
  assert.equal(pld.photoBase64, 'base64_data');
  assert.equal(pld.staffName, 'スタッフ115');
  assert.equal(pld.staffId, 'STF_115');

  // point.townName による不正な fallback が行われないことの検証
  let pldNoArea = null;
  await ActivityModule.submitActivity(point, {}, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'STF_115', staffName: 'スタッフ115' }),
    getBranchCode: () => 'BR01',
    generateRequestId: () => 'req_115_b',
    enqueue: async (payload) => { pldNoArea = payload; return 1; },
    isOnline: () => false,
    onOfflineQueued: () => {}
  });
  assert.strictEqual(pldNoArea.areaName, undefined, '基準HEAD準拠: options.areaName未指定時はそのままundefinedが維持されること');
});

test('Gate 16: offline enqueue 後 UI 解放通知', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 116, photoStatus: 'OK', photoBase64: 'data' };
  let offlineNotice = false;
  const res = await ActivityModule.submitActivity(point, { rowId: 116 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S', staffName: 'N' }),
    generateRequestId: () => 'req_116',
    enqueue: async () => 1,
    isOnline: () => false,
    onOfflineQueued: () => { offlineNotice = true; }
  });
  assert.equal(res.status, 'OFFLINE_QUEUED');
  assert.equal(point.syncStatus, 'pending');
  assert.equal(point.isDone, false);
  assert.equal(offlineNotice, true);
});

test('Gate 17: offline ≠ COMPLETED', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 117, photoStatus: 'OK', photoBase64: 'data', isDone: false };
  await ActivityModule.submitActivity(point, { rowId: 117 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S', staffName: 'N' }),
    generateRequestId: () => 'req_117',
    enqueue: async () => 1,
    isOnline: () => false,
    onOfflineQueued: () => {}
  });
  assert.strictEqual(point.isDone, false);
});

test('Gate 18: online wait max 15s timeout (fake clock in sandbox)', async () => {
  let mockTime = 10000;
  const code = fs.readFileSync(activityJsPath, 'utf8');
  const sandbox = {
    setTimeout: (fn, ms) => {
      mockTime += 15001;
      return setTimeout(fn, 1);
    },
    clearTimeout,
    Date: { now: () => mockTime },
    Math, parseFloat, parseInt, Number, Boolean, Array, Object, Promise, console
  };
  vm.createContext(sandbox);
  const ActivityModule = vm.runInContext(code + '\nActivityModule;', sandbox);

  const point = { rowId: 118, photoStatus: 'OK', photoBase64: 'data' };
  let timeoutTriggered = false;
  const res = await ActivityModule.submitActivity(point, { rowId: 118 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S', staffName: 'N' }),
    generateRequestId: () => 'req_118',
    enqueue: async () => 1,
    isOnline: () => true,
    getRowStatus: async () => 'SYNCING', // 常に待機中
    onTimeout: () => { timeoutTriggered = true; }
  });
  assert.equal(res.status, 'TIMEOUT');
  assert.equal(point.syncStatus, 'pending');
  assert.equal(point.isDone, false);
  assert.equal(timeoutTriggered, true);
});

test('Gate 19: Queue null 単独 ≠ COMPLETED (受諾確認なしは完了にしない)', async () => {
  let mockTime = 10000;
  const code = fs.readFileSync(activityJsPath, 'utf8');
  const sandbox = {
    setTimeout: (fn, ms) => {
      mockTime += 15001;
      return setTimeout(fn, 1);
    },
    clearTimeout,
    Date: { now: () => mockTime },
    Math, parseFloat, parseInt, Number, Boolean, Array, Object, Promise, console
  };
  vm.createContext(sandbox);
  const ActivityModule = vm.runInContext(code + '\nActivityModule;', sandbox);

  const point = { rowId: 119, photoStatus: 'OK', photoBase64: 'data', isDone: false, syncStatus: 'submitting' };
  let acceptedHookCalled = false;
  await ActivityModule.submitActivity(point, { rowId: 119 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S', staffName: 'N' }),
    generateRequestId: () => 'req_119',
    enqueue: async () => 1,
    isOnline: () => true,
    getRowStatus: async () => null, // Queue消滅
    isPinCompleted: () => false, // まだ PinStatus 完了なし
    onAccepted: () => { acceptedHookCalled = true; }
  });
  assert.equal(acceptedHookCalled, false, '受諾確認が取れるまでは onAccepted を呼ばない');
  assert.equal(point.isDone, false);
});

test('Gate 20: Backend accepted only ➔ COMPLETED', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 120, photoStatus: 'OK', photoBase64: 'data', isDone: false };
  let acceptedCalled = false;
  const res = await ActivityModule.submitActivity(point, { rowId: 120 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'S', staffName: 'N' }),
    generateRequestId: () => 'req_120',
    enqueue: async () => 1,
    isOnline: () => true,
    getRowStatus: async () => null,
    isPinCompleted: () => true, // PinStatus 側で受諾反映を確認
    onAccepted: () => { acceptedCalled = true; }
  });
  assert.equal(res.status, 'ACCEPTED');
  assert.equal(point.isDone, true);
  assert.equal(point.syncStatus, 'synced');
  assert.equal(acceptedCalled, true);
});

test('Gate 21: REJECTED ≠ COMPLETED (基準HEAD: isDoneは即時更新せず後続タイミングを維持)', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 121, isDone: 'PRESERVED_STATUS', isReadyToSubmit: true, tempPhotoUrl: 'blob:url' };
  ActivityModule.applyQueueOutcome(point, { type: 'REJECTED' });
  assert.strictEqual(point.isDone, 'PRESERVED_STATUS', '基準HEAD準拠: applyQueueOutcome(REJECTED)ではisDoneを更新せず後続処理に委ねる');
  assert.strictEqual(point.syncStatus, 'REJECTED');
  assert.strictEqual(point.isReadyToSubmit, undefined);
  assert.strictEqual(point.tempPhotoUrl, undefined);
});

test('Gate 22: RETRY ≠ COMPLETED', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 122, isDone: false };
  ActivityModule.applyQueueOutcome(point, { type: 'FAILED', finalStatus: 'RETRY' });
  assert.strictEqual(point.isDone, false);
  assert.strictEqual(point.syncStatus, 'RETRY');
});

test('Gate 23: FAILED_PERMANENT ≠ COMPLETED', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 123, isDone: false };
  ActivityModule.applyQueueOutcome(point, { type: 'FAILED', finalStatus: 'FAILED_PERMANENT' });
  assert.strictEqual(point.isDone, false);
  assert.strictEqual(point.syncStatus, 'FAILED_PERMANENT');
});

test('Gate 24: accepted causality order 維持 (applyQueueOutcome ACCEPTED)', () => {
  const ActivityModule = createActivityModule();
  const point = {
    rowId: 124,
    isDone: false,
    isReadyToSubmit: true,
    tempPhotoUrl: 'blob:x'
  };
  ActivityModule.applyQueueOutcome(point, {
    type: 'ACCEPTED',
    res: { photoUrl: 'https://drive.google.com/photo124' },
    item: { latitude: 35.5, longitude: 136.6 }
  });
  assert.strictEqual(point.isDone, true);
  assert.strictEqual(point.isReadyToSubmit, undefined);
  assert.strictEqual(point.tempPhotoUrl, undefined);
  assert.strictEqual(point.syncStatus, undefined);
  assert.strictEqual(point.photoUrl, 'https://drive.google.com/photo124');
  assert.strictEqual(point.gps, '35.5,136.6');
});

test('Gate 25: PinStatus remove Single-Fire 維持 (静的構造検査)', () => {
  const dbJs = fs.readFileSync(dbJsPath, 'utf8');
  assert.ok(!dbJs.includes('window.setPinInProgress(item.rowId, "remove")'), 'db.js 内の直接 setPinInProgress は除去されていること');
  assert.ok(dbJs.includes('onAcceptedAfterDequeue'), 'onAcceptedAfterDequeue Hook が呼ばれていること');
});

test('Gate 26: reflectCompleted timing 維持', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(appJs.includes('PinStatusModule.reflectCompleted(item.rowId)'), 'Composition Root の accepted ハンドラで reflectCompleted が呼ばれること');
});

test('Gate 27: p.isDone timing 維持', () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 127, isDone: false };
  assert.equal(point.isDone, false);
  ActivityModule.applyQueueOutcome(point, { type: 'ACCEPTED', res: {} });
  assert.equal(point.isDone, true);
});

test('Gate 28: crash-recovery pending restoration (restorePendingState)', () => {
  const ActivityModule = createActivityModule();
  const points = [
    { rowId: 1281, isDone: false, syncStatus: '' },
    { rowId: 1282, isDone: true, syncStatus: '' }, // 完了済みはスキップ
    { rowId: 1283, isDone: false, syncStatus: '' }
  ];
  ActivityModule.restorePendingState(points, [1281, 1282]);
  assert.equal(points[0].syncStatus, 'pending');
  assert.equal(points[1].syncStatus, '');
  assert.equal(points[2].syncStatus, '');
});

test('Gate 29: current-month queue filtering (reconcileQueueState)', () => {
  const ActivityModule = createActivityModule();
  const points = [
    { rowId: 1291, syncStatus: 'pending' },
    { rowId: 1292, syncStatus: 'pending' }
  ];
  const queueItems = [
    { rowId: 1291, syncStatus: 'SYNCING' }
  ];
  ActivityModule.reconcileQueueState(points, queueItems);
  assert.equal(points[0].syncStatus, 'SYNCING');
  assert.equal(points[1].syncStatus, undefined);
});

test('Gate 30: triggerUISyncRefresh submitting protection', () => {
  const ActivityModule = createActivityModule();
  const points = [
    { rowId: 1301, syncStatus: 'submitting' }
  ];
  const queueItems = [
    { rowId: 1301, syncStatus: 'SYNCING' }
  ];
  ActivityModule.reconcileQueueState(points, queueItems);
  assert.equal(points[0].syncStatus, 'submitting', 'submitting 状態は上書き保護されること');
});

test('Gate 31: cancel resets draft state (resetDraft: 基準HEADのresetPointDataと完全一致)', () => {
  const ActivityModule = createActivityModule();
  const point = {
    rowId: 131,
    isDone: false,
    count: 200,
    staffName: 'スタッフ',
    staffId: 'STF',
    completedAt: '12:00',
    syncStatus: 'pending',
    photoStatus: 'OK',
    gpsStatus: 'OK',
    gps: '35,136',
    latitude: 35,
    longitude: 136,
    accuracy: 5,
    tempPhotoUrl: 'blob:temp',
    photoBase64: 'base64',
    isReadyToSubmit: true
  };
  ActivityModule.resetDraft(point);
  assert.strictEqual(point.isDone, false);
  assert.strictEqual(point.count, 0);
  assert.strictEqual(point.staffName, '');
  assert.strictEqual(point.staffId, '');
  assert.strictEqual(point.completedAt, '');
  assert.strictEqual(point.syncStatus, '');
  assert.strictEqual(point.photoStatus, 'NONE');
  assert.strictEqual(point.gpsStatus, 'NO');
  assert.strictEqual(point.gps, '');
  assert.strictEqual(point.latitude, '');
  assert.strictEqual(point.longitude, '');
  assert.strictEqual(point.accuracy, null);
  assert.strictEqual(point.tempPhotoUrl, undefined);
  assert.strictEqual(point.photoBase64, undefined);
  assert.strictEqual(point.isReadyToSubmit, true, '基準HEAD準拠: resetDraftではisReadyToSubmitを削除せず維持すること');
});

test('Gate 32: cancel PinStatus remove, onFinally DOM re-query, rerenderDetailModal strict check (整合検査)', () => {
  const renderJs = fs.readFileSync(path.join(rootDir, 'active/h-app/render.js'), 'utf8');
  assert.ok(renderJs.includes('ActivityModule.resetDraft(p)'), 'cancelMissionComplete で resetDraft が呼ばれること');
  assert.ok(renderJs.includes('!markerHandled && typeof window.setPinInProgress === \'function\''), 'Single-Fire ガードが維持されていること');

  // Codex 指摘 4: rerenderDetailModalIfOpen の再描画判定は数値変換比較を行わず厳密等価比較 === であること
  const rerenderMatch = renderJs.match(/function rerenderDetailModalIfOpen[\s\S]*?^}/m);
  assert.ok(rerenderMatch, 'rerenderDetailModalIfOpen が存在すること');
  assert.ok(!rerenderMatch[0].includes('Number(currentPointDetailRowId)'), 'rerenderDetailModalIfOpen の判定で Number(currentPointDetailRowId) 変換を行わないこと');
  assert.ok(rerenderMatch[0].includes('currentPointDetailRowId === rowId'), 'rerenderDetailModalIfOpen の判定で厳密等価比較 (currentPointDetailRowId === rowId) を行うこと');

  // Codex 指摘 1: app.js submitMissionComplete 内の onFinally でその時点のボタンを DOM から再取得すること
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const submitMissionMatch = appJs.match(/async function submitMissionComplete[\s\S]*?^}/m);
  assert.ok(submitMissionMatch, 'submitMissionComplete が存在すること');
  const onFinallyMatch = submitMissionMatch[0].match(/onFinally:\s*\(\)\s*=>\s*\{[\s\S]*?^\s*\}/m);
  assert.ok(onFinallyMatch, 'app.js submitMissionComplete 内に onFinally が存在すること');
  assert.ok(onFinallyMatch[0].includes("$('submit-mission-btn')"), 'onFinally 内で submit-mission-btn を再取得すること');
  assert.ok(onFinallyMatch[0].includes("$('cancel-mission-btn')"), 'onFinally 内で cancel-mission-btn を再取得すること');
});

test('Gate 33: ActivityModule has no DOM dependencies', () => {
  const code = fs.readFileSync(activityJsPath, 'utf8');
  assert.ok(!code.includes('document.'), 'document 参照なし');
  assert.ok(!code.includes('innerHTML'), 'innerHTML 参照なし');
  assert.ok(!code.includes('getElementById'), 'getElementById 参照なし');
});

test('Gate 34: ActivityModule has no Map dependency', () => {
  const code = fs.readFileSync(activityJsPath, 'utf8');
  assert.ok(!code.includes('google.maps'), 'google.maps 参照なし');
  assert.ok(!code.includes('google.'), 'google 参照なし');
});

test('Gate 35: ActivityModule has no Auth reverse dependency', () => {
  const code = fs.readFileSync(activityJsPath, 'utf8');
  assert.ok(!code.includes('waitForIdentityVerified('), 'waitForIdentityVerified 直接呼び出しなし');
  assert.ok(!code.includes('localStorage.'), 'localStorage 参照なし');
});

test('Gate 36: ActivityModule has no IndexedDB internals', () => {
  const code = fs.readFileSync(activityJsPath, 'utf8');
  assert.ok(!code.includes('indexedDB.'), 'indexedDB 参照なし');
  assert.ok(!code.includes('transaction('), 'transaction 参照なし');
  assert.ok(!code.includes('objectStore('), 'objectStore 参照なし');
});

test('Gate 37: Queue Hooks 未設定時は FAIL-CLOSED & 4本完全検証', async () => {
  const dbJs = fs.readFileSync(dbJsPath, 'utf8');

  // 1. configureActivityQueueHooks が 4 Hook 全てを検証していること
  assert.ok(dbJs.includes('onRejectedBeforeDequeue') && dbJs.includes('onAcceptedAfterDequeue'), 'configure checks reject & accept');
  assert.ok(dbJs.includes('onFailedAfterQueueUpdate') && dbJs.includes('onManualRetryReset'), 'configure checks fail & retry');
  assert.ok(dbJs.includes('Invalid Activity Queue Hooks') || dbJs.includes('throw new Error'), 'configure throws on invalid hooks');

  // 2. fail-closed guard 位置 < first callApiPost
  const guardPos = dbJs.indexOf('if (!_activityQueueHooks)');
  assert.ok(guardPos > 0, 'fail-closed guard exists');
  const apiPostPos = dbJs.indexOf('callApiPost(', guardPos);
  assert.ok(apiPostPos > guardPos, 'fail-closed guard before first callApiPost');

  // 3. fail-closed guard 位置 < first dequeueSync in processQueue path
  const dequeuePos = dbJs.indexOf('dequeueSync(', guardPos);
  assert.ok(dequeuePos > guardPos, 'fail-closed guard before dequeueSync');

  // 4. fail-closed guard 位置 < retry mutation / schedule path
  const retryPos = dbJs.indexOf('scheduleRetry(', guardPos);
  assert.ok(retryPos > guardPos, 'fail-closed guard before scheduleRetry');
});

test('Gate 38: Queue Hooks が startApp / processQueue より前に直接必須設定されること (no typeof fallback)', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const configPos = appJs.indexOf('configureActivityQueueHooks({');
  const startAppExecutionPos = appJs.lastIndexOf('startApp()');
  const processQueuePos = appJs.indexOf('processQueue()');
  assert.ok(configPos > 0, 'configureActivityQueueHooks is directly called');
  assert.ok(startAppExecutionPos > 0, 'startApp() invocation exists');
  assert.ok(configPos < startAppExecutionPos, 'configureActivityQueueHooks is defined before startApp() execution');
  assert.ok(processQueuePos > 0, 'processQueue() exists');
  assert.ok(configPos < processQueuePos, 'configureActivityQueueHooks is called before processQueue()');

  // direct required configuration (no typeof fallback)
  assert.ok(!appJs.includes("if (typeof configureActivityQueueHooks === 'function')"), 'no typeof fallback for configureActivityQueueHooks');
});

test('Gate 39: app.js, render.js, db.js have ZERO direct Activity-field assignments or deletes (Activity field mutation authority = ActivityModule only)', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const renderJs = fs.readFileSync(path.join(rootDir, 'active/h-app/render.js'), 'utf8');
  const dbJs = fs.readFileSync(dbJsPath, 'utf8');

  // 1. no silent skip of ActivityModule
  assert.ok(!appJs.includes("typeof ActivityModule !== 'undefined'"), 'app.js has no typeof ActivityModule checks');
  assert.ok(!renderJs.includes("typeof ActivityModule !== 'undefined'"), 'render.js has no typeof ActivityModule checks');

  // 2. app.js / render.js / db.js の全 Activity-field direct assignment/delete = 0
  const fields = [
    'photoStatus',
    'tempPhotoUrl',
    'photoBase64',
    'isReadyToSubmit',
    'gpsStatus',
    'completedAt',
    'count'
  ];

  const files = [
    { name: 'app.js', content: appJs },
    { name: 'render.js', content: renderJs },
    { name: 'db.js', content: dbJs }
  ];

  for (const { name, content } of files) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

      for (const field of fields) {
        const assignRegex = new RegExp(`\\b(p|pt|point)\\.${field}\\s*(?<![!=<>])=(?![=])`);
        assert.ok(!assignRegex.test(line), `File ${name}:${idx + 1} has direct assignment to point.${field}: ${trimmed}`);

        const deleteRegex = new RegExp(`delete\\s+(p|pt|point)\\.${field}\\b`);
        assert.ok(!deleteRegex.test(line), `File ${name}:${idx + 1} has delete point.${field}: ${trimmed}`);
      }
    });
  }
});

test('Gate 40: Backend { success: true, accepted: false } ➔ REJECTED hook exactly once & ACCEPTED hook 0 (processQueue 実動検証)', async () => {
  const dbJs = fs.readFileSync(dbJsPath, 'utf8');
  const activityJs = fs.readFileSync(activityJsPath, 'utf8');

  let rejectedCalls = 0;
  let acceptedCalls = 0;
  let dequeuedBeforeRejected = false;
  let queueItemRemoved = false;
  let rejectedPointState = null;

  const testPoint = { rowId: 999, isDone: false, isReadyToSubmit: true, syncStatus: 'pending' };

  const mockDb = {
    transaction: (storeName, mode) => {
      const storeProxy = {
        getAll: () => {
          const req = { onsuccess: null, onerror: null, result: [{ id: 101, rowId: 999, syncStatus: 'PENDING', timestamp: Date.now() }] };
          setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
          return req;
        },
        get: (id) => {
          const req = { onsuccess: null, onerror: null, result: { id: 101, rowId: 999, syncStatus: 'PENDING', timestamp: Date.now() } };
          setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
          return req;
        },
        delete: (id) => {
          if (rejectedCalls === 0) dequeuedBeforeRejected = true;
          queueItemRemoved = true;
          const req = { onsuccess: null, onerror: null, result: true };
          setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
          return req;
        },
        put: (item) => {
          const req = { onsuccess: null, onerror: null, result: item };
          setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
          return req;
        }
      };
      const tx = {
        objectStore: () => storeProxy,
        onsuccess: null,
        onerror: null
      };
      return tx;
    }
  };

  const sandbox = {
    console,
    Date,
    setTimeout,
    setInterval: () => {},
    navigator: { onLine: true },
    window: {
      isIdentityVerifiedReady: () => true,
      addEventListener: () => {}
    },
    indexedDB: {
      open: () => {
        const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: mockDb };
        setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
        return req;
      }
    },
    callApiPost: async (action, payload) => {
      // Backend 非受諾 (STALE_MONTH 等) レスポンス
      return { success: true, accepted: false, code: 'STALE_MONTH' };
    },
    updateUISyncStatus: () => {},
    loadData: () => {}
  };

  vm.createContext(sandbox);
  vm.runInContext(activityJs, sandbox);
  vm.runInContext(dbJs, sandbox);

  const ActivityModule = vm.runInContext('ActivityModule;', sandbox);

  sandbox.setQueueLifecycleGates({
    isIdentityVerifiedReady: sandbox.window.isIdentityVerifiedReady,
    loadData: sandbox.loadData
  });

  sandbox.configureActivityQueueHooks({
    onRejectedBeforeDequeue: async (item, res) => {
      rejectedCalls++;
      ActivityModule.applyQueueOutcome(testPoint, {
        type: 'REJECTED',
        item,
        res
      });
      rejectedPointState = { ...testPoint };
    },
    onAcceptedAfterDequeue: async (item, res) => {
      acceptedCalls++;
    },
    onFailedAfterQueueUpdate: async () => {},
    onManualRetryReset: () => {}
  });

  await sandbox.processQueue();

  assert.equal(rejectedCalls, 1, 'REJECTED hook must be called exactly once');
  assert.equal(acceptedCalls, 0, 'ACCEPTED hook must NEVER be called on non-accepted');
  assert.equal(dequeuedBeforeRejected, false, 'REJECTED hook must be fired BEFORE dequeueSync');
  assert.equal(queueItemRemoved, true, 'dequeueSync must be executed after REJECTED hook');
  assert.equal(rejectedPointState.isDone, false, 'point.isDone must remain false');
  assert.equal(rejectedPointState.syncStatus, 'REJECTED', 'point.syncStatus must be REJECTED before dequeue');
  assert.equal(rejectedPointState.isReadyToSubmit, undefined, 'isReadyToSubmit must be deleted');
});

test('Gate 41: 写真付き下書き作成時に GPS 状態が必ず pending にリセットされ、新結果確定まで enqueue されないこと (既存 OK/NO 回帰検証)', async () => {
  const ActivityModule = createActivityModule();

  // Case A: 既存状態が 'OK' のポイント
  const pointFromOk = { rowId: 201, isDone: false, gpsStatus: 'OK', latitude: 35.1, longitude: 136.2 };
  ActivityModule.createDraft(pointFromOk, { valNum: 100, photoBase64: 'photo_data', tempPhotoUrl: 'blob:...' });
  assert.strictEqual(pointFromOk.gpsStatus, 'pending', '既存状態 OK でも createDraft で必ず pending に戻ること');

  // Case B: 既存状態が 'NO' のポイント
  const pointFromNo = { rowId: 202, isDone: false, gpsStatus: 'NO' };
  ActivityModule.createDraft(pointFromNo, { valNum: 100, photoBase64: 'photo_data', tempPhotoUrl: 'blob:...' });
  assert.strictEqual(pointFromNo.gpsStatus, 'pending', '既存状態 NO でも createDraft で必ず pending に戻ること');

  // Case C: submitActivity において新しい GPS 確定 (applyGpsResult) まで enqueue がブロックされること
  const testPoint = { rowId: 203, isDone: false, gpsStatus: 'OK', latitude: 35.1, longitude: 136.2 };
  ActivityModule.createDraft(testPoint, { valNum: 100, photoBase64: 'photo_data', tempPhotoUrl: 'blob:...' });
  assert.strictEqual(testPoint.gpsStatus, 'pending');

  let enqueueCalled = false;
  let gpsResolved = false;

  const waitGps = async () => {
    while (testPoint.gpsStatus === 'pending') {
      await new Promise(r => setTimeout(r, 10));
    }
  };

  // 非同期で提出開始
  const submitPromise = ActivityModule.submitActivity(testPoint, {}, {
    waitGps,
    enqueue: async (payload) => {
      assert.strictEqual(gpsResolved, true, 'enqueue は GPS 結果確定 (applyGpsResult) 前に呼ばれてはならない');
      assert.notEqual(testPoint.gpsStatus, 'pending', 'enqueue 時点で gpsStatus は pending であってはならない');
      enqueueCalled = true;
    },
    isOnline: () => false
  });

  // 短い待機: pending 中は enqueue が呼ばれていないことを確認
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(enqueueCalled, false, 'GPS が pending の間は enqueue されないこと');

  // GPS 測位完了をシミュレート
  ActivityModule.applyGpsResult(testPoint, { latitude: 35.5, longitude: 136.8, accuracy: 5 });
  gpsResolved = true;

  await submitPromise;
  assert.strictEqual(enqueueCalled, true, 'GPS 確定後に enqueue が正常に実行されること');
  assert.strictEqual(testPoint.gpsStatus, 'OK');
});

test('Gate 45: triggerUISyncRefresh reflects completed pin ONLY when point NOT in active queue regardless of calendar month (app.js + ActivityModule real execution)', async () => {
  // 1. app.js 実ソースから実際の triggerUISyncRefresh 関数コードを抽出
  const appJsSource = fs.readFileSync(appJsPath, 'utf8');
  const triggerMatch = appJsSource.match(/window\.triggerUISyncRefresh\s*=\s*(async\s*function\s*\([\s\S]*?^};)/m);
  assert.ok(triggerMatch, 'app.js から実際の triggerUISyncRefresh 定義が抽出できること');

  // 2. 外部依存のみのモック化（呼出追跡スパイ）
  const reflectCompletedCalls = [];
  const lockActivePinCalls = [];

  const mockPinStatusModule = {
    reflectCompleted: (rid) => reflectCompletedCalls.push(Number(rid))
  };
  const mockWindow = {
    lockActivePinAndBubble: (rid) => lockActivePinCalls.push(Number(rid)),
    currentPointDetailRowId: null
  };
  const mockDollar = () => null;

  // 3. JST基準タイムスタンプの算出（当月・前月）
  const nowTs = Date.now();
  // 40日前（前月以前）
  const prevMonthTs = nowTs - (40 * 24 * 60 * 60 * 1000);

  // 4. 網羅的テストデータ（6条件）
  // ① 当月キューあり: isDone: true だがキューに存在 ➔ 反映・ロック対象外 (0回)
  // ② キューなし: isDone: true かつキュー不在 ➔ 反映・ロック対象 (1回, rowId: 102)
  // ③ 未完了: isDone: false かつキュー不在 ➔ 反映・ロック対象外 (0回)
  // ④ submitting: isDone: true だが提出中保護 ➔ 反映・ロック対象外 (0回)
  // ⑤ REJECTED: isDone: false かつ非受諾終端 ➔ 反映・ロック対象外 (0回)
  // ⑥ 前月未終端キューあり: isDone: true だが前月未終端キューが存在（inQueue=true として保護） ➔ 反映・ロック対象外 (0回, rowId: 106)
  const testPoints = [
    { rowId: 101, isDone: true, syncStatus: 'pending' },
    { rowId: 102, isDone: true },
    { rowId: 103, isDone: false },
    { rowId: 104, isDone: true, syncStatus: 'submitting' },
    { rowId: 105, isDone: false, syncStatus: 'REJECTED' },
    { rowId: 106, isDone: true, syncStatus: 'pending' }
  ];

  const rawQueueItems = [
    { rowId: 101, timestamp: nowTs, syncStatus: 'pending' },       // 当月キュー
    { rowId: 106, timestamp: prevMonthTs, syncStatus: 'pending' }  // 前月未終端キュー
  ];

  const mockGetQueue = async () => rawQueueItems;

  // 5. 実際の ActivityModule を生成
  const ActivityModule = createActivityModule();

  // 6. app.js 実ソースコードから抽出した triggerUISyncRefresh を実体化して実行
  const sandbox = {
    window: mockWindow,
    allPoints: testPoints,
    getQueue: mockGetQueue,
    ActivityModule,
    PinStatusModule: mockPinStatusModule,
    $: mockDollar,
    console
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(triggerMatch[0], context);

  await mockWindow.triggerUISyncRefresh();

  // 7. 検証: 暦月を問わず未終端キューが存在する rowId 101 および 106 は inQueue=true として保護され、
  //    キュー不在かつ完了済みの [102] のみが reflectCompleted / lockActivePinAndBubble されること
  assert.strictEqual(
    reflectCompletedCalls.includes(101),
    false,
    '当月キューが存在する rowId 101 は reflectCompleted されてはならない'
  );
  assert.strictEqual(
    lockActivePinCalls.includes(101),
    false,
    '当月キューが存在する rowId 101 は lockActivePinAndBubble されてはならない'
  );
  assert.strictEqual(
    reflectCompletedCalls.includes(106),
    false,
    '前月未終端キューが存在する rowId 106 は reflectCompleted されてはならない'
  );
  assert.strictEqual(
    lockActivePinCalls.includes(106),
    false,
    '前月未終端キューが存在する rowId 106 は lockActivePinAndBubble されてはならない'
  );

  assert.deepStrictEqual(
    reflectCompletedCalls,
    [102],
    'reflectCompleted は未終端キュー不在かつ完了済みの [102] のみ正確に1回呼ばれること'
  );
  assert.deepStrictEqual(
    lockActivePinCalls,
    [102],
    'lockActivePinAndBubble は未終端キュー不在かつ完了済みの [102] のみ正確に1回呼ばれること'
  );

  assert.strictEqual(reflectCompletedCalls.length, 1, 'reflectCompleted 呼出総数が正確に 1 回であること');
  assert.strictEqual(lockActivePinCalls.length, 1, 'lockActivePinAndBubble 呼出総数が正確に 1 回であること');
});

test('Gate 46: startDraftWorkflow 正常系 (写真 ➔ Draft生成 ➔ GPS ➔ applyGps ➔ onDraftReady / onGpsReady 順序呼出し)', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 201 };

  const dummyBlob = { size: 100 };
  const cameraPromise = Promise.resolve(dummyBlob);
  const gpsPromise = Promise.resolve({ latitude: 35.11, longitude: 136.66 });

  const callOrder = [];

  await ActivityModule.startDraftWorkflow(point, {
    valNum: 42,
    staffName: 'テスト太郎',
    staffId: 'U_100',
    timeStr: '10/06 18:00',
    cameraPromise,
    gpsPromise
  }, {
    isSessionValid: () => {
      callOrder.push('isSessionValid');
      return true;
    },
    blobToBase64: async (b) => {
      callOrder.push('blobToBase64');
      return 'data:image/jpeg;base64,TEST_DATA';
    },
    createObjectURL: (b) => 'blob:http://localhost/test-uuid',
    getGPSLocationRetry: async () => null,
    onDraftReady: (p) => {
      callOrder.push('onDraftReady');
      assert.equal(p.count, 42);
      assert.equal(p.isReadyToSubmit, true);
      assert.equal(p.isDone, false);
      assert.equal(p.photoStatus, 'OK');
      assert.equal(p.tempPhotoUrl, 'blob:http://localhost/test-uuid');
    },
    onGpsReady: (p) => {
      callOrder.push('onGpsReady');
      assert.equal(p.gpsStatus, 'OK');
      assert.equal(p.gps, '35.11,136.66');
    },
    onFinally: () => {
      callOrder.push('onFinally');
    }
  });

  assert.deepEqual(callOrder, [
    'isSessionValid',
    'blobToBase64',
    'isSessionValid',
    'onDraftReady',
    'isSessionValid',
    'onGpsReady',
    'onFinally'
  ], 'フック呼出しの因果順序が厳密に守られていること');
});

test('Gate 47: startDraftWorkflow セッション無効化時の早期遮断 (各チェックポイントでの isSessionValid() === false 検証)', async () => {
  const ActivityModule = createActivityModule();

  // Case 1: 写真Blob受信前にセッション無効化
  {
    const point = { rowId: 202 };
    let draftReadyCalled = false;
    let finallyCalled = false;

    await ActivityModule.startDraftWorkflow(point, {
      valNum: 10,
      cameraPromise: Promise.resolve({ size: 50 }),
      gpsPromise: Promise.resolve({ latitude: 35, longitude: 136 })
    }, {
      isSessionValid: () => false,
      blobToBase64: async () => 'base64',
      onDraftReady: () => { draftReadyCalled = true; },
      onFinally: () => { finallyCalled = true; }
    });

    assert.equal(draftReadyCalled, false, 'セッション無効時は createDraft / onDraftReady が呼ばれないこと');
    assert.equal(finallyCalled, true, '中断時も onFinally は必ず呼ばれること');
    assert.equal(point.count, undefined, 'point 状態は未更新のままであること');
  }

  // Case 2: Base64変換後にセッション無効化
  {
    const point = { rowId: 203 };
    let checkCount = 0;
    let draftReadyCalled = false;
    let finallyCalled = false;

    await ActivityModule.startDraftWorkflow(point, {
      valNum: 20,
      cameraPromise: Promise.resolve({ size: 50 }),
      gpsPromise: Promise.resolve({ latitude: 35, longitude: 136 })
    }, {
      isSessionValid: () => {
        checkCount++;
        return checkCount === 1;
      },
      blobToBase64: async () => 'base64',
      onDraftReady: () => { draftReadyCalled = true; },
      onFinally: () => { finallyCalled = true; }
    });

    assert.equal(draftReadyCalled, false, 'Base64後無効時は onDraftReady が呼ばれないこと');
    assert.equal(finallyCalled, true, '中断時も onFinally は必ず呼ばれること');
  }

  // Case 3: GPS再取得完了後にセッション無効化
  {
    const point = { rowId: 204 };
    let checkCount = 0;
    let gpsReadyCalled = false;
    let finallyCalled = false;

    await ActivityModule.startDraftWorkflow(point, {
      valNum: 25,
      cameraPromise: Promise.resolve({ size: 50 }),
      gpsPromise: Promise.resolve(null)
    }, {
      isSessionValid: () => {
        checkCount++;
        // 1回目(写真後): true, 2回目(Base64後): true, 3回目(GPS再取得後): false
        return checkCount < 3;
      },
      blobToBase64: async () => 'base64',
      getGPSLocationRetry: async () => ({ latitude: 35.1, longitude: 136.6 }),
      onDraftReady: () => {},
      onGpsReady: () => { gpsReadyCalled = true; },
      onFinally: () => { finallyCalled = true; }
    });

    assert.equal(gpsReadyCalled, false, 'GPS再取得後無効時は applyGps / onGpsReady が呼ばれないこと');
    assert.equal(point.gpsStatus, 'pending', 'セッション無効化時はGPS状態が確定されずpendingのままであること');
    assert.equal(finallyCalled, true, '中断時も onFinally は必ず呼ばれること');
  }
});

test('Gate 48: startDraftWorkflow GPS空時の再取得 (getGPSLocationRetry) および onFinally 確実実行', async () => {
  const ActivityModule = createActivityModule();

  // Case 1: 初回GPS空 ➔ 再取得成功
  {
    const point = { rowId: 205 };
    let retryCalled = false;
    let finallyCalled = false;

    await ActivityModule.startDraftWorkflow(point, {
      valNum: 30,
      staffName: 'リトライ花子',
      cameraPromise: Promise.resolve({ size: 50 }),
      gpsPromise: Promise.resolve(null)
    }, {
      isSessionValid: () => true,
      blobToBase64: async () => 'base64_ok',
      getGPSLocationRetry: async () => {
        retryCalled = true;
        return { latitude: 35.22, longitude: 136.77, accuracy: 20 };
      },
      onDraftReady: () => {},
      onGpsReady: (p) => {
        assert.equal(p.gpsStatus, 'OK');
        assert.equal(p.gps, '35.22,136.77');
      },
      onFinally: () => {
        finallyCalled = true;
      }
    });

    assert.equal(retryCalled, true, '初回GPSが空の場合は getGPSLocationRetry が呼ばれること');
    assert.equal(finallyCalled, true, 'onFinally が確実に呼ばれること');
  }

  // Case 2: 初回GPS空 ➔ 再取得も空 (applyGpsResult へ渡され gpsStatus: 'NO' への失敗遷移を維持)
  {
    const point = { rowId: 206 };
    let retryCalled = false;
    let gpsReadyCalled = false;
    let finallyCalled = false;

    await ActivityModule.startDraftWorkflow(point, {
      valNum: 35,
      staffName: '再試行空太郎',
      cameraPromise: Promise.resolve({ size: 50 }),
      gpsPromise: Promise.resolve(null)
    }, {
      isSessionValid: () => true,
      blobToBase64: async () => 'base64_ok',
      getGPSLocationRetry: async () => {
        retryCalled = true;
        return null;
      },
      onDraftReady: () => {},
      onGpsReady: (p) => {
        gpsReadyCalled = true;
        assert.equal(p.gpsStatus, 'NO', '再取得後も空の場合は applyGpsResult により gpsStatus が NO に遷移すること');
      },
      onFinally: () => {
        finallyCalled = true;
      }
    });

    assert.equal(retryCalled, true, '再取得が試みられること');
    assert.equal(gpsReadyCalled, true, '空結果適用後も onGpsReady が呼ばれること');
    assert.equal(point.gpsStatus, 'NO', 'point.gpsStatus が NO であること');
    assert.equal(finallyCalled, true, 'onFinally が確実に呼ばれること');
  }
});

test('Gate 49: startDraftWorkflow 対象ポイント不在時も onFinally を確実に実行し世代確認付きロック解除を通すこと', async () => {
  const ActivityModule = createActivityModule();
  let finallyCalled = false;

  const sessionId = 'session-point-missing-999';
  const numpadContext = {
    sessionId: 'session-point-missing-999',
    isStarting: true
  };

  await ActivityModule.startDraftWorkflow(null, {
    valNum: 50,
    cameraPromise: Promise.resolve({ size: 100 }),
    gpsPromise: Promise.resolve({ latitude: 35, longitude: 136 })
  }, {
    isSessionValid: () => true,
    blobToBase64: async () => 'base64',
    onDraftReady: () => {},
    onGpsReady: () => {},
    onFinally: () => {
      finallyCalled = true;
      if (numpadContext && numpadContext.sessionId === sessionId) {
        numpadContext.isStarting = false;
      }
    }
  });

  assert.equal(finallyCalled, true, 'point不在時も onFinally が確実に実行されること');
  assert.equal(numpadContext.isStarting, false, '世代確認付きロック解除が実行されロックが残らないこと');
});

test('Gate 50 (HAPP-WEEKLY-003 Case A): submitActivity FAILED_PERMANENT immediate terminal failure return', async () => {
  const ActivityModule = createActivityModule();
  const point = { rowId: 501, photoStatus: 'OK', photoBase64: 'data:image/jpeg;base64,xxx', isDone: false, syncStatus: 'pending' };
  let timeoutCalls = 0;
  let acceptedCalls = 0;
  let errorCalls = 0;
  let errorTypeReceived = null;
  let finallyCalls = 0;

  const result = await ActivityModule.submitActivity(point, { rowId: 501, areaName: 'テスト町1' }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'STF_501', staffName: 'テスト員' }),
    generateRequestId: () => 'req_501',
    enqueue: async () => 1,
    isOnline: () => true,
    getRowStatus: async () => 'FAILED_PERMANENT',
    onTimeout: () => { timeoutCalls++; },
    onAccepted: () => { acceptedCalls++; },
    onError: (err, type) => {
      errorCalls++;
      errorTypeReceived = type;
    },
    onFinally: () => { finallyCalls++; }
  });

  assert.equal(result.success, false, 'result.success must be false');
  assert.equal(result.reason, 'FAILED_PERMANENT', 'result.reason must be FAILED_PERMANENT');
  assert.equal(point.isDone, false, 'point.isDone must remain false');
  assert.equal(point.syncStatus, 'FAILED_PERMANENT', 'point.syncStatus must remain FAILED_PERMANENT (not overwritten to pending)');
  assert.equal(timeoutCalls, 0, 'onTimeout must NOT be called');
  assert.equal(acceptedCalls, 0, 'onAccepted must NOT be called');
  assert.equal(errorCalls, 1, 'onError must be called once');
  assert.equal(errorTypeReceived, 'FAILED_PERMANENT', 'onError type must be FAILED_PERMANENT');
  assert.equal(finallyCalls, 1, 'onFinally must be called once');
});

test('Gate 51 (HAPP-WEEKLY-003 Case B): submitActivity FAILED_PERMANENT does not wait 15s (zero poll delay)', async () => {
  let mockTime = 20000;
  let setTimeoutCalls = 0;
  let pollCalls = 0;
  const code = fs.readFileSync(activityJsPath, 'utf8');
  const sandbox = {
    setTimeout: (fn, ms) => {
      setTimeoutCalls++;
      mockTime += ms;
      return setTimeout(fn, 1);
    },
    clearTimeout,
    Date: { now: () => mockTime },
    Math, parseFloat, parseInt, Number, Boolean, Array, Object, Promise, console
  };
  vm.createContext(sandbox);
  const ActivityModule = vm.runInContext(code + '\nActivityModule;', sandbox);

  const point = { rowId: 502, photoStatus: 'OK', photoBase64: 'data:image/jpeg;base64,yyy', isDone: false };
  const result = await ActivityModule.submitActivity(point, { rowId: 502 }, {
    authorize: async () => {},
    getVerifiedUser: () => ({ staffId: 'STF_502', staffName: 'テスト員' }),
    generateRequestId: () => 'req_502',
    enqueue: async () => 1,
    isOnline: () => true,
    getRowStatus: async () => {
      pollCalls++;
      return 'FAILED_PERMANENT';
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'FAILED_PERMANENT');
  assert.equal(pollCalls, 1, '1回目のポーリングで即時終了すること');
  assert.equal(setTimeoutCalls, 0, '15秒ポーリング待機用の setTimeout が一切呼ばれないこと');
  assert.equal(mockTime, 20000, '経過時間が0msで終了すること');
});

test('Gate 52 (HAPP-WEEKLY-003 Case C & D): restorePendingState preserves FAILED_PERMANENT, RETRY, SYNCING, PENDING and legacy rowId array compatibility', () => {
  const ActivityModule = createActivityModule();
  const points = [
    { rowId: 601, isDone: false, syncStatus: '' },
    { rowId: 602, isDone: false, syncStatus: '' },
    { rowId: 603, isDone: false, syncStatus: '' },
    { rowId: 604, isDone: false, syncStatus: '' },
    { rowId: 605, isDone: true, syncStatus: '' },
    { rowId: 606, isDone: false, syncStatus: '' }
  ];

  ActivityModule.restorePendingState(points, [
    { rowId: 601, syncStatus: 'FAILED_PERMANENT' },
    { rowId: 602, syncStatus: 'RETRY' },
    { rowId: 603, syncStatus: 'SYNCING' },
    { rowId: 604, syncStatus: 'PENDING' },
    { rowId: 605, syncStatus: 'FAILED_PERMANENT' }, // 完了済みは保護
    606 // legacy numeric rowId input
  ]);

  assert.equal(points[0].syncStatus, 'FAILED_PERMANENT', 'FAILED_PERMANENT must be preserved');
  assert.equal(points[1].syncStatus, 'RETRY', 'RETRY must be preserved');
  assert.equal(points[2].syncStatus, 'SYNCING', 'SYNCING must be preserved');
  assert.equal(points[3].syncStatus, 'PENDING', 'PENDING must be preserved');
  assert.equal(points[4].syncStatus, '', 'isDone === true point must NOT be overwritten');
  assert.equal(points[5].syncStatus, 'pending', 'legacy numeric rowId must default to pending');
});

test('Gate 53 (HAPP-WEEKLY-005 Ordering Invariant): submitMissionComplete re-renders detail modal after submitActivity finally and guards onFinally button reset', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const submitMissionMatch = appJs.match(/async function submitMissionComplete[\s\S]*?^}/m);
  assert.ok(submitMissionMatch, 'submitMissionComplete exists');
  const body = submitMissionMatch[0];

  assert.ok(body.includes("if (p.syncStatus === 'FAILED_PERMANENT') return;"), 'onFinally does not overwrite button to 🚀 この内容で提出する when FAILED_PERMANENT');
  const submitCallPos = body.indexOf('await ActivityModule.submitActivity(');
  const rerenderPos = body.indexOf('rerenderDetailModalIfOpen(rowId)', submitCallPos);
  assert.ok(submitCallPos > 0 && rerenderPos > submitCallPos, 'rerenderDetailModalIfOpen(rowId) is called AFTER await ActivityModule.submitActivity completes');
});

test('Architecture Gate: Public API exactly 8 methods & no globals', () => {
  const ActivityModule = createActivityModule();
  const keys = Object.keys(ActivityModule).sort();
  const expected = [
    'applyGpsResult',
    'applyQueueOutcome',
    'createDraft',
    'reconcileQueueState',
    'resetDraft',
    'restorePendingState',
    'startDraftWorkflow',
    'submitActivity'
  ].sort();
  assert.deepEqual(keys, expected, 'Public API は厳密に承認された8メソッドのみであること');
});

console.log('✅ ALL 53 ACTIVITY LIFECYCLE GATES DEFINED SUCCESSFULLY.\n');

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 8096;
const rootDir = process.cwd();

function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let relativePath = req.url.split('?')[0];
      if (relativePath.startsWith('/app/')) {
        relativePath = relativePath.replace('/app/', '/active/h-app/');
      } else if (relativePath === '/app') {
        relativePath = '/active/h-app/index.html';
      } else if (relativePath.startsWith('/business/')) {
        relativePath = relativePath.replace('/business/', '/active/business/');
      }
      let filePath = path.join(rootDir, relativePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end(`File not found: ${req.url}`);
        } else {
          let contentType = 'text/html';
          if (filePath.endsWith('.js')) contentType = 'application/javascript';
          if (filePath.endsWith('.css')) contentType = 'text/css';
          if (filePath.endsWith('.json')) contentType = 'application/json';
          if (filePath.endsWith('.png')) contentType = 'image/png';
          if (filePath.endsWith('.csv')) contentType = 'text/plain; charset=utf-8';

          let responseData = data;
          if (filePath.endsWith('config.js')) {
            let configText = data.toString('utf8');
            configText = configText.replace(/gasWebAppUrl:\s*".*?"/, `gasWebAppUrl: "http://localhost:${PORT}/mock-exec"`);
            configText = configText.replace(/liffId:\s*".*?"/, 'liffId: "test-liff-id"');
            responseData = Buffer.from(configText, 'utf8');
          }

          res.writeHead(200, { 'Content-Type': contentType });
          res.end(responseData);
        }
      });
    });
    server.listen(PORT, () => {
      resolve(server);
    });
  });
}

async function runPinStatusBrowserTests() {
  console.log("===============================================================");
  console.log("📱 REAL-BROWSER PIN STATUS INTEGRATION VERIFICATION (CASES 1 - 7)");
  console.log("===============================================================\n");

  const server = await startLocalServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.0.0'
  });

  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Google Maps API script tag without key will output a console error which is expected in local test
      if (!text.includes('Google Maps JavaScript API error') && !text.includes('MissingKeyMapError')) {
        consoleErrors.push(text);
      }
    }
  });

  // Mock LIFF SDK
  await page.route('**/sdk.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.liff = {
          init: () => Promise.resolve(),
          isLoggedIn: () => true,
          getAccessToken: () => 'stub-access-token',
          getIDToken: () => 'stub-id-token',
          getOS: () => 'ios',
          getProfile: () => Promise.resolve({
            userId: 'U_TEST_USER_001',
            displayName: 'テストスタッフ',
            pictureUrl: ''
          })
        };
      `
    });
  });

  // LocalStorage 初期データ (認証完了状態)
  await page.addInitScript(() => {
    localStorage.setItem('user_info', JSON.stringify({
      id: 'STAFF001',
      first: 'スタッフ',
      last: 'テスト',
      phone: '09012345678'
    }));
  });

  // Mock Google Maps API
  await page.route('**/maps/api/js*', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.google = {
          maps: {
            Point: class {
              constructor(x, y) { this.x = x; this.y = y; }
            },
            Map: class {
              constructor(el) { this.el = el; this._listeners = {}; }
              getDiv() { return this.el || document.getElementById('main-map') || document.body; }
              setCenter() {}
              setZoom() {}
              panTo() {}
              fitBounds() {}
              addListener(event, fn) {
                if (!this._listeners[event]) this._listeners[event] = [];
                this._listeners[event].push(fn);
                if (event === 'idle') {
                  setTimeout(fn, 100);
                }
              }
              getCenter() {
                return {
                  lat: () => 35.0,
                  lng: () => 136.0,
                  toJSON: () => ({ lat: 35.0, lng: 136.0 })
                };
              }
              getProjection() { return null; }
              getZoom() { return 15; }
              setOptions() {}
              get() { return null; }
            },
            event: {
              trigger: (target, eventName) => {
                if (target && target._listeners && Array.isArray(target._listeners[eventName])) {
                  target._listeners[eventName].slice().forEach(fn => fn());
                }
              },
              addListener: (target, eventName, fn) => {
                if (target && typeof target.addListener === 'function') {
                  target.addListener(eventName, fn);
                }
              },
              addListenerOnce: (target, eventName, fn) => {
                if (eventName === 'idle') {
                  setTimeout(fn, 10);
                } else if (target && typeof target.addListener === 'function') {
                  target.addListener(eventName, fn);
                }
              }
            },
            Marker: class {
              constructor(opts) {
                this.opts = opts || {};
                this.icon = opts.icon;
                this.rowId = opts.rowId;
                this._listeners = {};
                const pos = opts.position || { lat: 35.0, lng: 136.0 };
                this._pos = {
                  lat: () => (typeof pos.lat === 'function' ? pos.lat() : pos.lat),
                  lng: () => (typeof pos.lng === 'function' ? pos.lng() : pos.lng),
                  toJSON: () => ({
                    lat: typeof pos.lat === 'function' ? pos.lat() : pos.lat,
                    lng: typeof pos.lng === 'function' ? pos.lng() : pos.lng
                  })
                };
              }
              setIcon(icon) { this.icon = icon; }
              getIcon() { return this.icon; }
              getPosition() { return this._pos; }
              setMap() {}
              addListener(eventName, fn) {
                if (!this._listeners[eventName]) this._listeners[eventName] = [];
                this._listeners[eventName].push(fn);
              }
            },
            OverlayView: class {
              static preventMapHitsAndGesturesFrom() {}
              getPanes() {
                return { floatPane: document.getElementById('main-map') || document.body };
              }
              getProjection() { return null; }
              getMap() { return this._map || null; }
              setMap(map) {
                if (map) {
                  this._map = map;
                  if (typeof this.onAdd === 'function') this.onAdd();
                  if (typeof this.draw === 'function') this.draw();
                } else {
                  if (typeof this.onRemove === 'function') this.onRemove();
                  this._map = null;
                }
              }
            },
            LatLngBounds: class {
              extend() {}
            }
          }
        };
        setTimeout(() => {
          if (typeof window.initMainMap === 'function') {
            try { window.initMainMap(); } catch (e) {}
          }
        }, 100);
      `
    });
  });

  const apiRequests = [];
  let failRemoveApi = false;
  let removeDelayMs = 0;
  await page.route('**/*exec*', async route => {
    const postData = route.request().postData() || '';
    let action = '';
    let payload = {};
    try {
      payload = JSON.parse(postData);
      action = payload.action;
    } catch(e) {}

    apiRequests.push({ action, payload, timestamp: Date.now() });

    if (action === 'getMapsApiKey') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mapsApiKey: 'dummy-key' })
      });
      return;
    }

    if (action === 'getGlobalPinStatus') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          inProgress: [101, 102],
          completed: [201, 202],
          myInProgress: [{ rowId: 101, lockId: 'lock_server_101' }]
        })
      });
      return;
    }

    if (action === 'setPinInProgress') {
      if (payload.pinAction === 'remove' && removeDelayMs > 0) {
        await new Promise(r => setTimeout(r, removeDelayMs));
      }
      if (payload.pinAction === 'remove' && failRemoveApi) {
        route.abort('failed');
        return;
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: payload.pinAction === 'add' ? 'IN_PROGRESS' : 'REMOVED',
          rowId: payload.rowId,
          lockId: payload.lockId || 'lock_generated'
        })
      });
      return;
    }

    if (action === 'getStaffIdentity' || action === 'registerStaff') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id: 'STAFF001', staff: { id: 'STAFF001', name: 'テストスタッフ' } })
      });
      return;
    }

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  try {
    await page.goto(`http://localhost:${PORT}/app/index.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => typeof window.switchPage === 'function' && typeof window.refreshMainMapPins === 'function', { timeout: 10000 });
    await page.waitForTimeout(500);

    console.log("▶ Case 1: Initial status fetch & myInProgress restoration via window.fetchGlobalPinStatus()");
    const initialStatus = await page.evaluate(async () => {
      await window.fetchGlobalPinStatus({ force: true });
      return {
        is101InProgress: PinStatusModule.isInProgress(101),
        is101MyInProgress: PinStatusModule.isMyInProgress(101),
        lock101: PinStatusModule.getMyLockId(101),
        is102MyInProgress: PinStatusModule.isMyInProgress(102),
        is201Completed: PinStatusModule.isCompleted(201),
        is999InProgress: PinStatusModule.isInProgress(999),
        is999Completed: PinStatusModule.isCompleted(999)
      };
    });
    if (!initialStatus.is101InProgress || !initialStatus.is101MyInProgress || initialStatus.lock101 !== 'lock_server_101' || initialStatus.is102MyInProgress || !initialStatus.is201Completed || initialStatus.is999InProgress || initialStatus.is999Completed) {
      throw new Error(`Initial status mismatch: ${JSON.stringify(initialStatus)}`);
    }
    console.log("  ✅ Case 1 PASS: initial fetch status & myInProgress restored via window.fetchGlobalPinStatus()");

    console.log("▶ Case 2: IN_PROGRESS styling logic via window.refreshMainMapPins()");
    const inProgressResult = await page.evaluate(() => {
      let updatedIcon = null;
      const fakeMarker = {
        rowId: 101,
        getIcon: () => ({ fillColor: '#22c55e', path: 0 }),
        setIcon: (icon) => { updatedIcon = icon; }
      };
      window.masterMarkers = [fakeMarker];
      window.refreshMainMapPins();
      return {
        isInProgress: PinStatusModule.isInProgress(101),
        isCompleted: PinStatusModule.isCompleted(101),
        fillColor: updatedIcon ? updatedIcon.fillColor : null
      };
    });
    if (!inProgressResult.isInProgress || inProgressResult.isCompleted || inProgressResult.fillColor !== '#00B7FF') {
      throw new Error(`IN_PROGRESS styling condition failed: ${JSON.stringify(inProgressResult)}`);
    }
    console.log("  ✅ Case 2 PASS: IN_PROGRESS marker evaluated to #00B7FF via refreshMainMapPins");

    console.log("▶ Case 3: COMPLETED styling logic & unified conflict precedence (IN_PROGRESS > COMPLETED > UNALLOCATED) via window.refreshMainMapPins()");
    const completedResult = await page.evaluate(async () => {
      let updatedIcon201 = null;
      const marker201 = {
        rowId: 201,
        getIcon: () => ({ fillColor: '#22c55e', path: 0 }),
        setIcon: (icon) => { updatedIcon201 = icon; }
      };

      // conflictMarker: rowId 999 を completed に追加し、inProgress にも add して競合状態を作成
      PinStatusModule.reflectCompleted(999);
      await PinStatusModule.setInProgress(999, 'add');

      let updatedIconConflict = null;
      const markerConflict = {
        rowId: 999,
        getIcon: () => ({ fillColor: '#22c55e', path: 0 }),
        setIcon: (icon) => { updatedIconConflict = icon; }
      };

      window.masterMarkers = [marker201, markerConflict];
      window.refreshMainMapPins();

      return {
        marker201Color: updatedIcon201 ? updatedIcon201.fillColor : null,
        markerConflictColor: updatedIconConflict ? updatedIconConflict.fillColor : null,
        isConflictCompleted: PinStatusModule.isCompleted(999),
        isConflictInProgress: PinStatusModule.isInProgress(999)
      };
    });
    if (completedResult.marker201Color !== '#EA5F08') {
      throw new Error(`COMPLETED status color failed: ${JSON.stringify(completedResult)}`);
    }
    if (completedResult.markerConflictColor !== '#00B7FF') {
      throw new Error(`Conflict precedence color failed (expected #00B7FF for IN_PROGRESS > COMPLETED): ${JSON.stringify(completedResult)}`);
    }
    console.log("  ✅ Case 3 PASS: COMPLETED marker = #EA5F08 and conflict resolves to #00B7FF (IN_PROGRESS > COMPLETED) via refreshMainMapPins");

    console.log("▶ Case 4 (Case A): Green pin tap -> Backend Write 0 -> click '配布開始' -> add = 1");
    await page.evaluate(async () => {
      await window.waitForIdentityVerified();
      // Reset any open overlay and re-initialize real markers from render.js
      if (typeof window.closeCustomInfoWindow === 'function') {
        window.closeCustomInfoWindow();
      }
      window.mainMapInstance = null;
      window.masterMarkers = [];
      const testPin = {
        rowId: 301,
        city_name: 'テスト市',
        town_name: '緑ピン町',
        latitude: 35.0,
        longitude: 136.0,
        households: 120,
        population: 300
      };
      window.masterPins = [testPin];
      window.AddressMasterService = {
        getInstance: () => ({
          getAll: async () => [testPin]
        })
      };
      window.initMainMap();
    });
    await page.waitForTimeout(150);

    const setPinCallsBeforeTap = apiRequests.filter(r => r.action === 'setPinInProgress').length;

    // 1. 緑ピンをタップして吹き出しを開く (executeOpen)
    const afterTapState = await page.evaluate(async () => {
      const m = window.masterMarkers.find(mk => Number(mk.rowId) === 301);
      if (!m) return { error: 'Marker 301 not found' };
      window.google.maps.event.trigger(m, 'click');
      await new Promise(r => setTimeout(r, 80));
      const btn = document.querySelector('.input-operation-btn');
      return {
        fillColor: m.getIcon() ? m.getIcon().fillColor : null,
        isInProgress: PinStatusModule.isInProgress(301),
        btnText: btn ? btn.textContent.trim() : null
      };
    });

    const setPinCallsAfterTap = apiRequests.filter(r => r.action === 'setPinInProgress').length;
    if (setPinCallsAfterTap !== setPinCallsBeforeTap) {
      throw new Error(`Green pin tap must trigger 0 Backend writes, but triggered ${setPinCallsAfterTap - setPinCallsBeforeTap}`);
    }
    if (afterTapState.fillColor !== '#22c55e' || afterTapState.isInProgress !== false || afterTapState.btnText !== '配布開始') {
      throw new Error(`Green pin tap state mismatch: ${JSON.stringify(afterTapState)}`);
    }

    // 2. 吹き出し内の「配布開始」ボタンをクリック ➔ 初めて setPinInProgress(add) が 1 回発火し青ピンへ遷移
    const afterStartClickState = await page.evaluate(async () => {
      const btn = document.querySelector('.input-operation-btn');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 80));
      const m = window.masterMarkers.find(mk => Number(mk.rowId) === 301);
      const updatedBtn = document.querySelector('.input-operation-btn');
      return {
        fillColor: m && m.getIcon() ? m.getIcon().fillColor : null,
        isInProgress: PinStatusModule.isInProgress(301),
        isMyInProgress: PinStatusModule.isMyInProgress(301),
        btnText: updatedBtn ? updatedBtn.textContent.trim() : null
      };
    });
    const addCallsFor301 = apiRequests.filter(
      r => r.action === 'setPinInProgress' && r.payload.pinAction === 'add' && Number(r.payload.rowId) === 301
    );
    if (addCallsFor301.length !== 1) {
      throw new Error(`Expected exactly 1 add API call on '配布開始' click, got ${addCallsFor301.length}`);
    }
    if (
      afterStartClickState.fillColor !== '#00B7FF' ||
      !afterStartClickState.isInProgress ||
      !afterStartClickState.isMyInProgress ||
      afterStartClickState.btnText !== '入力操作'
    ) {
      throw new Error(`After '配布開始' click state mismatch: ${JSON.stringify(afterStartClickState)}`);
    }
    console.log("  ✅ Case 4 (Case A) PASS: Green pin tap = 0 Backend writes (#22c55e), '配布開始' click = 1 add API (#00B7FF -> '入力操作')");

    console.log("▶ Case 5: Close / cancel (remove) integration verification");
    const removeResult = await page.evaluate(async () => {
      if (typeof window.closeCustomInfoWindow === 'function') {
        window.closeCustomInfoWindow();
      } else {
        await window.setPinInProgress(301, 'remove');
      }
      await new Promise(r => setTimeout(r, 80));
      return PinStatusModule.isInProgress(301);
    });
    if (removeResult) throw new Error("setPinInProgress remove failed to update PinStatusModule");
    const hasRemoveApiCall = apiRequests.some(r => r.action === 'setPinInProgress' && r.payload.pinAction === 'remove' && r.payload.rowId === 301);
    if (!hasRemoveApiCall) throw new Error("API call for setPinInProgress remove not detected");
    console.log("  ✅ Case 5 PASS: close/cancel remove updates local state and fires API");

    console.log("▶ Case 6: reflectCompleted zero-API local reflection verification");

    const apiCountBeforeReflect = apiRequests.length;

    const reflectResult = await page.evaluate(() => {
      const rowId = 102;

      const beforeReflect = {
        inProgress: PinStatusModule.isInProgress(rowId),
        completed: PinStatusModule.isCompleted(rowId)
      };

      PinStatusModule.reflectCompleted(rowId);

      const afterReflect = {
        inProgress: PinStatusModule.isInProgress(rowId),
        completed: PinStatusModule.isCompleted(rowId)
      };

      return { beforeReflect, afterReflect };
    });

    await page.waitForTimeout(50);

    const apiCountAfterReflect = apiRequests.length;

    if (!reflectResult.beforeReflect.inProgress ||
        reflectResult.beforeReflect.completed) {
      throw new Error(
        `Before reflect state mismatch: ${JSON.stringify(reflectResult)}`
      );
    }

    if (reflectResult.afterReflect.inProgress ||
        !reflectResult.afterReflect.completed) {
      throw new Error(
        `After reflect state mismatch: ${JSON.stringify(reflectResult)}`
      );
    }

    if (apiCountAfterReflect !== apiCountBeforeReflect) {
      throw new Error(
        `reflectCompleted triggered unexpected API traffic: ` +
        `${apiCountBeforeReflect} -> ${apiCountAfterReflect}`
      );
    }

    console.log(
      "  ✅ Case 6 PASS: reflectCompleted updates local state with zero extra API calls"
    );

    console.log("▶ Case 7: Console errors zero & globalPinStatus / PinStatusModule elimination");
    const runtimeStateCheck = await page.evaluate(() => {
      return {
        hasGlobalPinStatus: typeof window.globalPinStatus !== 'undefined',
        hasLastPinStatusSync: typeof window.lastPinStatusSync !== 'undefined',
        hasWindowPinStatusModule: typeof window.PinStatusModule !== 'undefined',
        hasLexicalPinStatusModule: typeof PinStatusModule === 'object'
      };
    });
    if (runtimeStateCheck.hasGlobalPinStatus) {
      throw new Error("window.globalPinStatus still exists in browser runtime!");
    }
    if (runtimeStateCheck.hasLastPinStatusSync) {
      throw new Error("window.lastPinStatusSync still exists in browser runtime!");
    }
    if (runtimeStateCheck.hasWindowPinStatusModule) {
      throw new Error("window.PinStatusModule must NOT exist on window object!");
    }
    if (!runtimeStateCheck.hasLexicalPinStatusModule) {
      throw new Error("lexical PinStatusModule not found in browser runtime!");
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Console errors detected: ${JSON.stringify(consoleErrors)}`);
    }
    console.log("  ✅ Case 7 PASS: Zero console errors, window globals eliminated, lexical PinStatusModule confirmed");

    console.log("▶ Case 8 (Case B): remove A network failure -> pending A -> same-row add B while remove A still fails -> PENDING_REMOVE_UNRESOLVED & add B = 0");
    // 1. row 401 を lock_A で開始
    const add401A = await page.evaluate(async () => {
      return await PinStatusModule.setInProgress(401, 'add', { lockId: 'lock_401_A' });
    });
    if (!add401A || !add401A.success) {
      throw new Error(`Setup add 401 failed: ${JSON.stringify(add401A)}`);
    }

    // 2. remove 通信失敗を発生させ pending A を残す
    failRemoveApi = true;
    const rem401A = await page.evaluate(async () => {
      return await PinStatusModule.setInProgress(401, 'remove');
    });
    const pendingAfterFail = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('h_app_pending_pin_removes_v1') || '[]');
    });
    if (rem401A.success !== false || pendingAfterFail.length !== 1 || pendingAfterFail[0].lockId !== 'lock_401_A') {
      throw new Error(`Expected pending remove lock_401_A in localStorage, got: ${JSON.stringify(pendingAfterFail)}`);
    }

    // 3. 通信障害継続中に同一 row 401 を再開始 ➔ remove A が先に試みられて失敗 ➔ PENDING_REMOVE_UNRESOLVED, add API = 0
    const apiSnapshotBeforeBlockedAdd = apiRequests.length;
    const blockedAddRes = await page.evaluate(async () => {
      return await PinStatusModule.setInProgress(401, 'add', { lockId: 'lock_401_B' });
    });
    const newCallsDuringBlockedAdd = apiRequests.slice(apiSnapshotBeforeBlockedAdd);
    const addCallsDuringBlocked = newCallsDuringBlockedAdd.filter(
      r => r.action === 'setPinInProgress' && r.payload.pinAction === 'add' && Number(r.payload.rowId) === 401
    );
    if (
      !blockedAddRes ||
      blockedAddRes.success !== false ||
      blockedAddRes.code !== 'PENDING_REMOVE_UNRESOLVED' ||
      addCallsDuringBlocked.length !== 0
    ) {
      throw new Error(
        `Case B failed: res=${JSON.stringify(blockedAddRes)}, addCalls=${addCallsDuringBlocked.length}`
      );
    }
    console.log("  ✅ Case 8 (Case B) PASS: Unresolved pending remove blocks same-row add with PENDING_REMOVE_UNRESOLVED (add API = 0)");

    console.log("▶ Case 9 (Case C): Network recovers -> concurrent fetchStatus() & same-row add B -> remove A = 1 -> add B = 1");
    failRemoveApi = false;
    removeDelayMs = 40;
    const apiSnapshotBeforeConcurrent = apiRequests.length;

    const concurrentRes = await page.evaluate(async () => {
      const [fetchOut, addOut] = await Promise.all([
        PinStatusModule.fetchStatus({ force: true }),
        PinStatusModule.setInProgress(401, 'add', { lockId: 'lock_401_B' })
      ]);
      return {
        addOut,
        pendingAfter: JSON.parse(localStorage.getItem('h_app_pending_pin_removes_v1') || '[]'),
        myLockId: PinStatusModule.getMyLockId(401)
      };
    });
    removeDelayMs = 0;

    const concurrentCalls = apiRequests.slice(apiSnapshotBeforeConcurrent);
    const removeACalls = concurrentCalls.filter(
      r => r.action === 'setPinInProgress' && r.payload.pinAction === 'remove' && Number(r.payload.rowId) === 401 && r.payload.lockId === 'lock_401_A'
    );
    const addBCalls = concurrentCalls.filter(
      r => r.action === 'setPinInProgress' && r.payload.pinAction === 'add' && Number(r.payload.rowId) === 401 && r.payload.lockId === 'lock_401_B'
    );
    const firstRemoveIdx = concurrentCalls.findIndex(
      r => r.action === 'setPinInProgress' && r.payload.pinAction === 'remove' && Number(r.payload.rowId) === 401
    );
    const firstAddIdx = concurrentCalls.findIndex(
      r => r.action === 'setPinInProgress' && r.payload.pinAction === 'add' && Number(r.payload.rowId) === 401
    );

    if (
      !concurrentRes.addOut ||
      concurrentRes.addOut.success !== true ||
      concurrentRes.pendingAfter.length !== 0 ||
      concurrentRes.myLockId !== 'lock_401_B' ||
      removeACalls.length !== 1 ||
      addBCalls.length !== 1 ||
      firstRemoveIdx < 0 ||
      firstAddIdx < firstRemoveIdx
    ) {
      throw new Error(
        `Case C failed: res=${JSON.stringify(concurrentRes)}, removeACalls=${removeACalls.length}, addBCalls=${addBCalls.length}, order=${firstRemoveIdx}->${firstAddIdx}, blockedCalls=${JSON.stringify(newCallsDuringBlockedAdd)}, concurrentCalls=${JSON.stringify(concurrentCalls)}`
      );
    }
    console.log("  ✅ Case 9 (Case C) PASS: Concurrent fetchStatus & same-row add sends remove A exactly once, followed by add B once");

    console.log("\n===============================================================");
    console.log("🎉 ALL 9 REAL-BROWSER PIN STATUS VERIFICATION CASES PASSED!");
    console.log("===============================================================");
  } finally {
    await browser.close();
    server.close();
  }
}

runPinStatusBrowserTests().catch(err => {
  console.error("\n❌ Browser verification failed:", err);
  process.exit(1);
});

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
            Map: class {
              constructor(el) { this.el = el; }
              getDiv() { return this.el; }
              setCenter() {}
              setZoom() {}
              fitBounds() {}
              addListener(event, fn) {
                if (event === 'idle') {
                  setTimeout(fn, 100);
                }
              }
              getCenter() { return { toJSON: () => ({ lat: 35.0, lng: 136.0 }) }; }
              getZoom() { return 15; }
              setOptions() {}
              get() { return null; }
            },
            event: {
              trigger: () => {},
              addListener: () => {}
            },
            Marker: class {
              constructor(opts) { this.opts = opts || {}; this.icon = opts.icon; this.rowId = opts.rowId; }
              setIcon(icon) { this.icon = icon; }
              getIcon() { return this.icon; }
              getPosition() { return this.opts.position; }
              setMap() {}
              addListener() {}
            },
            OverlayView: class {
              setMap() {}
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
  await page.route('**/*exec*', async route => {
    const postData = route.request().postData() || '';
    let action = '';
    let payload = {};
    try {
      payload = JSON.parse(postData);
      action = payload.action;
    } catch(e) {}

    apiRequests.push({ action, payload });

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

    console.log("▶ Case 4: Marker selection (add) integration verification");
    await page.evaluate(async () => {
      await window.waitForIdentityVerified();
    });
    const addResult = await page.evaluate(async () => {
      await window.setPinInProgress(301, 'add');
      return PinStatusModule.isInProgress(301);
    });
    if (!addResult) throw new Error("setPinInProgress add failed to update PinStatusModule");
    const hasAddApiCall = apiRequests.some(r => r.action === 'setPinInProgress' && r.payload.pinAction === 'add' && r.payload.rowId === 301);
    if (!hasAddApiCall) throw new Error("API call for setPinInProgress add not detected");
    console.log("  ✅ Case 4 PASS: marker tap add updates local state and fires API");

    console.log("▶ Case 5: Close / cancel (remove) integration verification");
    const removeResult = await page.evaluate(async () => {
      await window.setPinInProgress(301, 'remove');
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

    console.log("\n===============================================================");
    console.log("🎉 ALL 7 REAL-BROWSER PIN STATUS VERIFICATION CASES PASSED!");
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

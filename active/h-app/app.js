const $ = id => document.getElementById(id);

// SEC-004: XSS対策用エスケープ関数
window.escapeHtml = function(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// 暗号学的UUID v4 + 実機フォールバック対応のRequestId生成関数 (冪等性キー)
window.generateRequestId = function(prefix = 'req') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return `${prefix}_${crypto.randomUUID()}`;
    } catch (e) {}
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${prefix}_${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    } catch (e) {}
  }
  const p = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? Math.floor(performance.now() * 1000) : 0;
  return `${prefix}_${Date.now()}_${p}_${Math.random().toString(36).substring(2, 11)}`;
};

// デバッグログ出力関数 (本番用: コンソールのみ出力)
window.logDebug = function(msg) {
  console.log("[DEBUG]", msg);
};
window.onerror = function(message, source, lineno, colno, error) {
  if (message === "Script error.") return false;
  logDebug(`ERROR: ${message} at ${source}:${lineno}:${colno}`);
  return false;
};
window.onunhandledrejection = function(event) {
  logDebug(`UNHANDLED PROMISE: ${event.reason}`);
};

let allPoints = [];
let currentCity = null;


function setLoadingProgress(pct, label) {
  const bar = document.getElementById('loading-bar');
  const txt = document.getElementById('loading-status');
  if (bar) bar.style.width = pct + '%';
  if (txt) {
    txt.style.opacity = '0';
    setTimeout(() => { txt.textContent = label; txt.style.opacity = '1'; }, 180);
  }
}

// プレミアム・インタラクション・スキル (JS Touch Handler)
document.addEventListener('touchstart', e => {
  const el = e.target.closest('.btn-neu, .clickable-card, .nav-btn');
  if (!el) return;
  if (el.classList.contains('btn-neu')) el.classList.add('pressed-primary');
  if (el.classList.contains('clickable-card')) el.classList.add('pressed-secondary');
  if (el.classList.contains('nav-btn')) el.classList.add('pressed-nav');
}, {passive: true});

document.addEventListener('touchend', removePressed);
document.addEventListener('touchcancel', removePressed);
function removePressed() {
  document.querySelectorAll('.pressed-primary, .pressed-secondary, .pressed-nav').forEach(el => {
    el.classList.remove('pressed-primary', 'pressed-secondary', 'pressed-nav');
  });
}

// =====================================
// Phase 4-B: Global Pin Status Sync (Thin Wiring Wrapper)
// =====================================
window.fetchGlobalPinStatus = async function() {
  return PinStatusModule.fetchStatus({
    onStatusUpdated: () => {
      if (typeof window.refreshMainMapPins === 'function') {
        window.refreshMainMapPins();
      }
    },
    onError: (err) => {
      logDebug(`[fetchGlobalPinStatus] Error: ${err.message}`);
    }
  });
};

// =====================================
// Wave 15: Auth & Identity Gate Wiring (Compatibility Wrappers & DI)
// =====================================
if (typeof AuthModule !== 'undefined' && typeof AuthModule.configure === 'function') {
  AuthModule.configure({
    getLiffAuthToken: () => (typeof getLiffAuthToken === 'function' ? getLiffAuthToken() : null),
    isLiffLoggedIn: () => (typeof liff !== 'undefined' && typeof liff.isLoggedIn === 'function' && liff.isLoggedIn())
  });
}

function waitForLiffAuthReady() {
  return AuthModule.waitForLiffAuthReady();
}
window.waitForLiffAuthReady = waitForLiffAuthReady;

window.isLiffAuthReady = function() {
  return AuthModule.isLiffAuthReady();
};

function waitForIdentityVerified() {
  return AuthModule.waitForIdentityVerified();
}
window.waitForIdentityVerified = waitForIdentityVerified;

window.isIdentityVerifiedReady = function() {
  return AuthModule.isIdentityVerifiedReady();
};

// =====================================
// Phase 4-B: Pin In-Progress Control (Thin Wiring Wrapper)
// =====================================
window.setPinInProgress = function(rowId, action) {
  return PinStatusModule.setInProgress(rowId, action, {
    authorize: () => waitForIdentityVerified(),
    onError: (err) => {
      logDebug(`[setPinInProgress] Error/Blocked: ${err.message}`);
    }
  });
};

let appStartupTriggered = false;
let mainAppVisible = false;

function showMainApp() {
  if (mainAppVisible || window.__contractExpired) return;

  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  if (!userInfo.id) return;

  mainAppVisible = true;

  // 初期画面（page-settings）のDOMを同期的に完全確定させる
  if (typeof renderSettings === 'function') {
    renderSettings();
  }
  updateBottomNavVisibility();

  const navContainer = document.getElementById('bottom-nav');
  const renderNavFn = window.renderBottomNavigation || (typeof renderBottomNavigation === 'function' ? renderBottomNavigation : null);
  if (navContainer && renderNavFn) {
    navContainer.innerHTML = renderNavFn('settings');
  }

  // 初期ページを同期的に settings に即時確定（200msアニメーション遅延による未描画フレームを排除）
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => {
    if (p.id === 'page-settings') {
      p.classList.remove('hidden');
      p.style.opacity = '1';
      p.style.transform = 'translateY(0)';
    } else {
      p.classList.add('hidden');
      p.style.opacity = '0';
    }
  });

  $('app').classList.remove('hidden');
  $('app').classList.remove('opacity-0');

  const loadingEl = $('loading');
  if (loadingEl) {
    loadingEl.classList.add('opacity-0');
    setTimeout(() => loadingEl.classList.add('hidden'), 400);
  }
}

function loadGoogleMapsApi() {
  if (window.googleMapsApiLoaded) return;
  window.googleMapsApiLoaded = true;

  callApiPost('getMapsApiKey').then(keyData => {
    if (keyData && keyData.success && keyData.mapsApiKey) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${keyData.mapsApiKey}&callback=initMainMap&language=ja`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else {
      window.googleMapsApiLoaded = false;
    }
  }).catch(err => {
    window.googleMapsApiLoaded = false;
    logDebug("[loadGoogleMapsApi] Error: " + (err ? err.message : err));
  });
}

async function startApp() {
  if (appStartupTriggered) return;
  appStartupTriggered = true;

  setApiAuthGates({
    waitForLiffAuthReady: waitForLiffAuthReady,
    waitForIdentityVerified: waitForIdentityVerified
  });

  // Wave 4: Activity Queue Hooks Wiring (Composition Root) - MissingならBoot時に明示failure
  configureActivityQueueHooks({
    onRejectedBeforeDequeue(item, res) {
      const pt = Array.isArray(allPoints) ? allPoints.find(p => Number(p.rowId) === Number(item.rowId)) : null;
      if (pt) {
        ActivityModule.applyQueueOutcome(pt, {
          type: 'REJECTED',
          item,
          res
        });
      }
    },
    onAcceptedAfterDequeue(item, res) {
      // 1. window.setPinInProgress(item.rowId, "remove") - Current Runtime同様、awaitしない
      if (typeof window.setPinInProgress === 'function') {
        window.setPinInProgress(item.rowId, "remove");
      }

      // 2. PinStatusModule.reflectCompleted(item.rowId) - 必須直接呼出
      PinStatusModule.reflectCompleted(item.rowId);

      // 3. ActivityModule.applyQueueOutcome(point, ACCEPTED)
      // → ここで初めて p.isDone = true
      const pt = Array.isArray(allPoints) ? allPoints.find(p => Number(p.rowId) === Number(item.rowId)) : null;
      if (pt) {
        ActivityModule.applyQueueOutcome(pt, {
          type: 'ACCEPTED',
          item,
          res
        });
      }

      // 4. lockActivePinAndBubble(rowId)
      if (typeof window.lockActivePinAndBubble === 'function') {
        window.lockActivePinAndBubble(item.rowId);
      }

      // 5. current detail modal rerender if applicable
      if (typeof rerenderDetailModalIfOpen === 'function') {
        rerenderDetailModalIfOpen(item.rowId);
      }
    },
    onFailedAfterQueueUpdate(item, finalStatus, err) {
      const pt = Array.isArray(allPoints) ? allPoints.find(p => Number(p.rowId) === Number(item.rowId)) : null;
      if (pt) {
        ActivityModule.applyQueueOutcome(pt, {
          type: 'FAILED',
          finalStatus,
          item,
          error: err
        });
      }
    },
    onManualRetryReset(item) {
      const pt = Array.isArray(allPoints) ? allPoints.find(p => Number(p.rowId) === Number(item.rowId)) : null;
      if (pt) {
        ActivityModule.applyQueueOutcome(pt, {
          type: 'RETRY_RESET',
          item
        });
      }
    }
  });

  try {
    loadGoogleMapsApi();

    // 起動時の未送信キュー復旧・送信処理（クラッシュ・オフライン復旧）
    if (typeof processQueue === 'function') {
      processQueue();
    }

    loadData(false).catch(err => {
      console.warn("Background load error:", err);
      logDebug("[loadData] Background error: " + (err ? err.message : err));
    });

    showMainApp();
  } catch (err) {
    console.error("Startup error:", err);
    logDebug("Startup error: " + err.message);
  }
}

function setSyncStatus(state) {
  window.SyncStatusView.setStatus(state);
}

// =====================================
// Wave 12: Staff Registration Flow (Composition Root Wiring)
// =====================================
function triggerBackgroundRegistration(profile) {
  window.liffProfile = profile;

  return StaffRegistrationModule.registerStaff(profile, {
    onStart: () => {
      StorageView.updateStaffIdDisplay('registering');
    },
    onSuccess: (res, p) => {
      const registeredInfo = {
        last: p.displayName,
        first: "",
        id: res.id,
        picture: p.pictureUrl
      };
      localStorage.setItem('user_info', JSON.stringify(registeredInfo));
      logDebug("Registered! Staff ID: " + res.id);

      StorageView.updateStaffIdDisplay('success', res.id);

      if (typeof renderSettings === 'function') {
        renderSettings();
      }
      updateBottomNavVisibility();
      return res;
    },
    onError: (err) => {
      StorageView.updateStaffIdDisplay('error', null, () => {
        window.retryRegistration();
      });
      StaffRegistrationView.showRegistrationError(err, () => {
        window.retryRegistration();
      });
    }
  });
}

// 登録再試行用のグローバルハンドラーを公開 (現行順序を100%完全維持)
window.retryRegistration = () => {
  if (window.liffProfile) {
    return triggerBackgroundRegistration(window.liffProfile).then(() => {
      const verifiedInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
      if (verifiedInfo && verifiedInfo.id) {
        setLoadingProgress(100, 'READY');
        AuthModule.setIdentityVerified(true);
        showMainApp();
      }
    }).catch(err => {
      logDebug("Retry registration failed: " + (err ? err.message : err));
    });
  }
};


async function loadData(skipSync = false) {
  logDebug("[loadData] START (Background)");

  const tier1Promise = fetchTier1();

  if (!skipSync) {
    setSyncStatus(navigator.onLine ? 'online' : 'offline');
  }

  await tier1Promise;

  // 待機中キューのピン状態復元（強制終了・クラッシュ復旧）
  if (typeof window.getSyncQueueRowIds === 'function') {
    try {
      const queueRowIds = await window.getSyncQueueRowIds();
      if (queueRowIds && queueRowIds.length > 0 && Array.isArray(allPoints)) {
        ActivityModule.restorePendingState(allPoints, queueRowIds);
      }
    } catch (qErr) {
      console.warn("[loadData] Failed to restore pending queue pins:", qErr);
    }
  }
}



let numpadContext = null;

function openNumpad(areaName, rowId, initialCount, isDoneToggle = false, checkbox = null) {
  if (numpadContext) numpadContext.aborted = true;
  const sessionId = (numpadContext ? numpadContext.sessionId : 0) + 1;
  numpadContext = { sessionId, areaName, rowId, isDoneToggle, checkbox, aborted: false, isStarting: false };
  NumpadView.open({
    areaName,
    rowId,
    initialCount,
    isDoneToggle,
    checkbox,
    onCancel: () => {
      if (numpadContext) {
        numpadContext.aborted = true;
        numpadContext.isStarting = false;
      }
    }
  });
}

function closeNumpad() {
  if (numpadContext) {
    if (numpadContext.isStarting) {
      // 確定後の非表示: セッション世代を維持して画面のみ隠す
      NumpadView.hide();
      return;
    }
    // ユーザー明示的キャンセル
    numpadContext.aborted = true;
    numpadContext.isStarting = false;
  }
  NumpadView.close();
}


window.triggerUISyncRefresh = async function() {
  if (!allPoints || allPoints.length === 0) return; // let変数は window に付かないため直接参照
  if (typeof getQueue !== 'function') return;

  try {
    const queue = await getQueue();
    const nowTs = Date.now();
    const dNow = new Date(nowTs + (9 * 60 * 60 * 1000));
    const currentJstMonth = `${dNow.getUTCFullYear()}-${String(dNow.getUTCMonth() + 1).padStart(2, '0')}`;

    // 当月キューアイテムの抽出
    const currentMonthQueue = (queue || []).filter(q => {
      const qTs = Number(q.timestamp) || nowTs;
      const qD = new Date(qTs + (9 * 60 * 60 * 1000));
      const qM = `${qD.getUTCFullYear()}-${String(qD.getUTCMonth() + 1).padStart(2, '0')}`;
      return qM === currentJstMonth;
    });

    // ActivityModule へ状態調停を委譲 (直接呼出)
    ActivityModule.reconcileQueueState(allPoints, currentMonthQueue);

    // UI・PinStatus 副作用の調停 (Composition Root)
    allPoints.forEach(p => {
      if (p.syncStatus === 'submitting') return;
      const inQueue = currentMonthQueue.some(q => Number(q.rowId) === Number(p.rowId));
      if (!inQueue) {
        if (p.isDone === true) {
          PinStatusModule.reflectCompleted(p.rowId);
          if (typeof window.lockActivePinAndBubble === 'function') {
            window.lockActivePinAndBubble(p.rowId);
          }
        }
      }
    });

    // 開いている詳細モーダルの再描画
    if (window.currentPointDetailRowId) {
      const p = allPoints.find(point => point.rowId === window.currentPointDetailRowId);
      const modalContent = $('detail-modal-content');
      if (p && p.syncStatus !== 'submitting' && modalContent && typeof renderDetailModalContent === 'function') {
        modalContent.innerHTML = renderDetailModalContent(p);
      }
    }
  } catch (err) {
    console.error("triggerUISyncRefresh error:", err);
  }
};

setQueueLifecycleGates({
  isIdentityVerifiedReady: window.isIdentityVerifiedReady,
  triggerUISyncRefresh: window.triggerUISyncRefresh,
  loadData: loadData
});



function pressNum(key) {
  if (!numpadContext) return;

  if (key === 'OK') {
    if (numpadContext.isStarting) return; // OK連打防止
    numpadContext.isStarting = true;

    // GPS・カメラを先に開始（ユーザーのタップジェスチャーが生きている間に呼ぶ）
    const gpsPromise = getGPSLocation();
    const cameraPromise = capturePhoto();
    closeNumpad(); // カメラ起動後にテンキーを閉じる (確定後の非表示: isStartingによりセッション維持)

    const sessionId = numpadContext.sessionId;
    const { areaName, rowId } = numpadContext;
    const numpadResult = NumpadView.pressKey('OK');
    const valNum = numpadResult ? numpadResult.valNum : 0;

    const p = (allPoints && allPoints.find(point => point.rowId === rowId)) ||
              (typeof window.allPoints !== 'undefined' && Array.isArray(window.allPoints) && window.allPoints.find(point => point.rowId === rowId));
    const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim();
    const staffId = userInfo.id || '';
    const now = new Date();
    const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // ActivityModule へ下書き開始ワークフローを委譲 (Composition Root 配線)
    ActivityModule.startDraftWorkflow(p, {
      valNum,
      staffName,
      staffId,
      timeStr,
      cameraPromise,
      gpsPromise
    }, {
      isSessionValid: () => Boolean(numpadContext && numpadContext.sessionId === sessionId && !numpadContext.aborted),
      blobToBase64: (blob) => (typeof window.blobToBase64 === 'function' ? window.blobToBase64(blob) : Promise.resolve('')),
      createObjectURL: (blob) => URL.createObjectURL(blob),
      getGPSLocationRetry: () => getGPSLocation(),
      onDraftReady: (p) => {
        const modalContent = $('detail-modal-content');
        if (modalContent && window.currentPointDetailRowId === rowId) {
          modalContent.innerHTML = renderDetailModalContent({ ...p, isDone: true });
        }
      },
      onGpsReady: (p) => {
        const modalContent = $('detail-modal-content');
        if (modalContent && window.currentPointDetailRowId === rowId && p.syncStatus !== 'submitting') {
          modalContent.innerHTML = renderDetailModalContent(p.isDone ? p : { ...p, isDone: true });
        }
      },
      onFinally: () => {
        if (numpadContext && numpadContext.sessionId === sessionId) {
          numpadContext.isStarting = false;
        }
      }
    });

    return;
  }

  NumpadView.pressKey(key);
}

// モーダルの「この内容で提出する」ボタン押下時に呼ばれる
async function submitMissionComplete(areaName, rowId) {
  const p = (typeof allPoints !== 'undefined' && Array.isArray(allPoints) && allPoints.find(point => point.rowId === rowId)) ||
            (typeof window.allPoints !== 'undefined' && Array.isArray(window.allPoints) && window.allPoints.find(point => point.rowId === rowId));
  if (!p) return;

  // Phase 11 ガード: 完了確定した地区は当月再操作不可 (既存業務ルール維持)
  const isAlreadyCompleted = PinStatusModule.isCompleted(rowId) ||
                             (p.isDone && !p.isReadyToSubmit);
  if (isAlreadyCompleted) {
    alert("この地区は既に今月の配布が完了しています。再操作はできません。");
    if (typeof closeDetailModal === 'function') closeDetailModal();
    return;
  }

  if (p.syncStatus === 'submitting') return;

  const submitBtn = $('submit-mission-btn');
  const cancelBtn = $('cancel-mission-btn');

  const hooks = {
    isAlreadyCompleted: (rid) => PinStatusModule.isCompleted(rid) || (p.isDone && !p.isReadyToSubmit),
    onSubmitting: async () => {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ 提出中...';
      }
      if (cancelBtn) {
        cancelBtn.disabled = true;
      }
      // 基準コードと同一の提出開始時描画待ちを実行
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    },
    waitGps: async () => {
      while (p.gpsStatus === 'pending') {
        await new Promise(r => setTimeout(r, 200));
      }
    },
    authorize: async () => {
      await waitForIdentityVerified();
    },
    getVerifiedUser: () => {
      const verifiedUserInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
      return {
        staffId: verifiedUserInfo.id || p.staffId || '',
        staffName: `${verifiedUserInfo.last || ''} ${verifiedUserInfo.first || ''}`.trim() || p.staffName || ''
      };
    },
    generateRequestId: (prefix) => {
      return (typeof window.generateRequestId === 'function')
        ? window.generateRequestId(prefix)
        : ('req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    },
    enqueue: async (payload) => {
      return await enqueueSync(payload);
    },
    isOnline: () => navigator.onLine,
    onOfflineQueued: () => {
      alert("電波が圏外のため、端末内に安全に保存しました。\n電波が回復次第、自動で送信されます。");
      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      }
    },
    getRowStatus: async (rid) => {
      if (typeof window.getRowStatus !== 'function') {
        throw new Error("Sync check mechanism is missing.");
      }
      return await window.getRowStatus(Number(rid));
    },
    isPinCompleted: (rid) => Boolean(PinStatusModule.isCompleted(rid)),
    getBranchCode: () => localStorage.getItem('branch_name') || '',
    onAccepted: (res) => {
      PinStatusModule.reflectCompleted(rowId);
      if (typeof window.lockActivePinAndBubble === 'function') {
        window.lockActivePinAndBubble(rowId);
      }
      alert("✓ 提出致しました");
      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      }
    },
    onRejected: (res) => {
      alert("旧月の配布操作のため、当月シートには反映されませんでした。");
      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      }
    },
    onTimeout: () => {
      alert("送信処理中です。バックグラウンドで送信を継続します。");
      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      }
    },
    onError: (err, type) => {
      if (type === 'AUTH_FAILED') {
        alert("スタッフ認証が完了していないため、配布完了を送信できません。再起動してください。");
      } else {
        alert("提出に失敗しました: " + (err.message || "エラー"));
      }
    },
    onFinally: () => {
      const submitBtn = $('submit-mission-btn');
      const cancelBtn = $('cancel-mission-btn');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 この内容で提出する';
      }
      if (cancelBtn) {
        cancelBtn.disabled = false;
      }
    }
  };

  await ActivityModule.submitActivity(p, {
    areaName,
    rowId
  }, hooks);
}

window.addEventListener('online', () => {
  setSyncStatus('online');
});

window.addEventListener('offline', () => {
  console.log("Device went offline.");
  setSyncStatus('offline');
});

window.onPageEnter = function(id) {
  if (id === 'settings') renderSettings();
  if (id === 'ranking') initRankingPage();
  if (id === 'storage-register') initStorageRegisterPage();
  if (id === 'storage-list') initStorageListPage();
  if (id === 'bulletin' && typeof fetchBulletinPosts === 'function') fetchBulletinPosts();

  // エリア（MAP）画面表示時: display:none解除に伴うリサイズ同期 & 初回Visible-fit保証
  if (id === 'areas' && window.mainMapInstance && window.google && window.google.maps) {
    google.maps.event.trigger(window.mainMapInstance, 'resize');

    let initialFitRan = false;
    if (typeof window.ensureMainMapInitialFit === 'function') {
      initialFitRan = window.ensureMainMapInitialFit();
    }

    // 初回fitを実行した場合は、旧center上書きを行わずfit結果のCameraを優先
    if (!initialFitRan) {
      // 初回fit完了後の通常再訪時: ユーザーのPan/Zoom状態（currentMapState）を維持復元
      const center = window.currentMapState?.center;
      if (center) {
        window.mainMapInstance.setCenter(center);
      }
    }
  }
};

// ランキングページ制御 (Wave 10: RankingModule & RankingView へ委譲)
function initRankingPage() {
  if (typeof RankingView !== 'undefined' && typeof RankingView.initPage === 'function' && typeof RankingModule !== 'undefined') {
    RankingView.initPage({
      rankingModule: RankingModule,
      getMyStaffId: () => {
        const u = JSON.parse(localStorage.getItem('user_info') || '{}');
        return u.id ? String(u.id).trim() : '';
      },
      renderCard: typeof window.renderRankingCard === 'function' ? window.renderRankingCard : null
    });
  }
}

// 在庫登録・一覧ページ制御 (Wave 9: StorageView へ委譲)
function initStorageRegisterPage() {
  if (typeof StorageView !== 'undefined' && typeof StorageView.initRegisterPage === 'function') {
    StorageView.initRegisterPage({
      getUserInfo: () => JSON.parse(localStorage.getItem('user_info') || '{}'),
      getRegistrationStatus: () => (typeof StaffRegistrationModule !== 'undefined' ? StaffRegistrationModule.getStatus() : ({ isRegistering: window.isRegistering, registrationError: window.registrationError })),
      onRetryRegistration: async () => {
        const profile = await liff.getProfile();
        triggerBackgroundRegistration(profile);
      },
      getTier1Cache: () => (typeof tier1Cache !== 'undefined' ? tier1Cache : null),
      storageModule: StorageModule
    });
  }
}

function initStorageListPage() {
  if (typeof StorageView !== 'undefined' && typeof StorageView.initListPage === 'function') {
    StorageView.initListPage({
      getTier1Cache: () => (typeof tier1Cache !== 'undefined' ? tier1Cache : null),
      storageModule: StorageModule,
      renderList: typeof renderStorageList === 'function' ? renderStorageList : null
    });
  }
}

// 在庫登録フォームの処理 (Wave 9: StorageView へ委譲)
window.submitFlyerStock = async function() {
  if (typeof StorageView !== 'undefined' && typeof StorageView.submitRegisterForm === 'function') {
    return await StorageView.submitRegisterForm({
      authorize: () => waitForIdentityVerified(),
      getUserInfo: () => JSON.parse(localStorage.getItem('user_info') || '{}'),
      storageModule: StorageModule
    });
  }
};



/**
 * updateStats(summaryData) - 表示専用関数 (SystemSummaryService / AddressMasterService 参照)
 */
function updateStats(summaryData = null) {
  const countEl = $('header-count');
  const pctEl = $('header-pct');

  if (summaryData) {
    SummaryModule.setLastSummaryData(summaryData);
  } else {
    summaryData = SummaryModule.getLastSummaryData();
  }

  if (!summaryData) {
    if (countEl) countEl.textContent = '( -- / -- )';
    if (pctEl) pctEl.textContent = '--%';
    return;
  }

  // data/address_master.csv の件数を総エリア数 (total) のSSOTとして使用
  let total = 0;
  if (typeof AddressMasterService !== 'undefined' && AddressMasterService.getInstance) {
    const masterCache = AddressMasterService.getInstance().cache;
    if (masterCache && Array.isArray(masterCache) && masterCache.length > 0) {
      total = masterCache.length;
    }
  }

  const done = typeof summaryData.done === 'number' ? summaryData.done : 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  if (summaryData.districtName) {
    window.__districtName = summaryData.districtName;
    document.title = "POSTING MAP";
  }

  if (countEl) countEl.textContent = `( ${done} / ${total} )`;
  if (pctEl) pctEl.textContent = `${percent}%`;

  // AddressMasterServiceが未ロードの場合は非同期取得後に自動再反映
  if (total === 0 && typeof AddressMasterService !== 'undefined' && AddressMasterService.getInstance) {
    AddressMasterService.getInstance().getAll().then(master => {
      if (master && master.length > 0 && SummaryModule.getLastSummaryData()) {
        updateStats(SummaryModule.getLastSummaryData());
      }
    }).catch(() => {});
  }
}

async function fetchSystemSummary(forceRefresh = false) {
  const existingPromise = SummaryModule.getSystemSummaryPromise();
  if (existingPromise && !forceRefresh) {
    return existingPromise;
  }

  SummaryModule.setSystemSummaryPromise((async () => {
    try {
      const res = await callApiPost('getSystemSummary');
      if (res && (res.code === 'CONTRACT_EXPIRED' || res.contractStatus === 'EXPIRED' || res.isExpired === true)) {
        window.__contractExpired = true;
        if (typeof setSyncStatus === 'function') setSyncStatus('offline');
        const statusEl = $('loading-status');
        if (statusEl) statusEl.textContent = '接続エラー: 接続できません。';
        const appEl = $('app');
        if (appEl) { appEl.classList.add('hidden'); appEl.classList.add('opacity-0'); }
        const loadingEl = $('loading');
        if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.remove('opacity-0'); }
        return res;
      }
      if (res && res.success) {
        updateStats(res);
        return res;
      }
    } catch (err) {
      console.warn("fetchSystemSummary failed:", err);
      if (err && (err.code === 'CONTRACT_EXPIRED' || err.contractStatus === 'EXPIRED' || err.isExpired === true)) {
        window.__contractExpired = true;
        if (typeof setSyncStatus === 'function') setSyncStatus('offline');
        const appEl = $('app');
        if (appEl) { appEl.classList.add('hidden'); appEl.classList.add('opacity-0'); }
        const loadingEl = $('loading');
        if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.remove('opacity-0'); }
        const statusEl = $('loading-status');
        if (statusEl) {
          statusEl.textContent = '契約期間が終了しているため利用できません。';
          statusEl.onclick = null;
          statusEl.style.cursor = 'default';
        }
      }
    }
    SummaryModule.setSystemSummaryPromise(null);
    return null;
  })());

  return SummaryModule.getSystemSummaryPromise();
}

/**
 * fetchTier1() - Tier 1 市町村サマリー取得
 */
let tier1Cache = null;

async function fetchTier1() {
  try {
    const cities = await AddressMasterService.getInstance().getCities();

    if (cities && cities.length > 0) {
      tier1Cache = cities;

      if (typeof StorageView !== 'undefined' && typeof StorageView.updateLocationDropdown === 'function') {
        StorageView.updateLocationDropdown(StorageModule.getSnapshot().locations, null, tier1Cache);
      }

      if (typeof renderAreas === 'function') {
        renderAreas();
      }

      if (SummaryModule.getLastSummaryData()) {
        updateStats(SummaryModule.getLastSummaryData());
      }

      return tier1Cache;
    }
  } catch (err) {
    console.warn("fetchTier1 failed:", err);
  }

  return null;
}


async function safeInitApp() {
  // LIFF SDK が内部でトークン交換用に生成する非表示 iframe 内での二重実行（アクセストークン失効）を完全に防止するガード
  if (window !== window.top) {
    console.log("[DEBUG] Running inside iframe, skipping safeInitApp.");
    return;
  }

  logDebug("safeInitApp invoked.");
  console.log("POSTING MAP PRO safeInitApp started.");

  // URLに死んだパラメータが残っている、かつ初期化前（または失敗時）の保険
  const urlParams = new URLSearchParams(window.location.search);
  const hasOAuthParams = urlParams.has('code') || urlParams.has('liff.state');
  const isReturningFromLogin = sessionStorage.getItem('liff_initializing') === 'true';

  // liff.login()で戻ってきた場合（?code= あり & フラグあり）→ LIFFに正常処理させる
  // 孤立した ?code=（フラグなし）→ クリーンURLでやり直し（スタック防止）
  if (hasOAuthParams && !isReturningFromLogin) {
      sessionStorage.setItem('liff_initializing', 'true');
      window.location.href = window.location.origin + window.location.pathname;
      return;
  }
  // ※ フラグはここでは削除しない。ログイン確認成功後（isLoggedIn()=true）に削除する。

  // クライアント設定(PMS_CLIENT_CONFIG)からLIFF IDを取得、なければホスト名からフォールバック
  const liffId = (window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.line && window.PMS_CLIENT_CONFIG.line.liffId);
  if (!liffId) {
    throw new Error("LIFF ID missing in client configuration.");
  }

  const existingUserInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  const hasExistingStaffId = existingUserInfo.id && String(existingUserInfo.id).trim() !== '';

  // 【Optimistic First Paint】既存 user_info.id がある場合は LIFF / Identity API を待たずに即時先行表示！
  if (hasExistingStaffId) {
    logDebug("Optimistic First Paint: existing staffId found. Launching main app immediately.");
    if (typeof renderSettings === 'function') {
      renderSettings();
    }
    updateBottomNavVisibility();
    showMainApp();
  }

  startApp();

  if (typeof liff !== 'undefined') {
    try {
      logDebug("LIFF INIT START");
      await new Promise(r => setTimeout(r, 50));

      const liffInitPromise = liff.init({ liffId: liffId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("LINEログインの応答がタイムアウトしました(5秒)")), 5000)
      );

      await Promise.race([liffInitPromise, timeoutPromise]);
      logDebug("LIFF INIT OK");
      setLoadingProgress(35, 'AUTHENTICATED');

      logDebug("LOGIN CHECK");
      if (liff.isLoggedIn()) {
        logDebug("LOGIN OK");
        sessionStorage.removeItem('liff_initializing');

        const currentToken = typeof getLiffAuthToken === 'function' ? getLiffAuthToken() : null;
        if (typeof currentToken === 'string' && currentToken.trim().length > 0) {
          AuthModule.markAuthReady();
        } else {
          const tokenErr = new Error("LIFF_TOKEN_MISSING");
          tokenErr.code = "UNAUTHORIZED";
          tokenErr.errorType = "PERMANENT";
          tokenErr.retryable = false;
          AuthModule.markAuthFailed(tokenErr);
        }

        // ★ MASTER指示 ①: fetchSystemSummary() は liff.isLoggedIn() 成立直後、await liff.getProfile() より前に非同期発火すること。HeaderをProfile取得に依存させない。
        fetchSystemSummary();

        try {
          logDebug("PROFILE START");
          const profile = await liff.getProfile();
          logDebug("PROFILE OK");
          // 再試行で確実に使用できるよう早期確保
          window.liffProfile = profile;

          try {
            const cleanUrl = window.location.origin + window.location.pathname + window.location.search.replace(/[\?&](code|liff\.state)=[^&]*/g, '');
            window.history.replaceState({}, document.title, cleanUrl);
            logDebug("OAuth query parameters cleaned from address bar via history.replaceState (Safe Delay)");
          } catch (e) {
            console.warn("Failed to clean OAuth query parameters:", e);
          }

          if (!hasExistingStaffId) {
            // 初回・未登録端末: 従来どおり Identity 検証または登録完了までローディングを維持
            setLoadingProgress(50, 'VERIFYING IDENTITY...');
          }

          // 【Backend Identity 非同期同期】getStaffIdentity をバックグラウンド Promise で実行
          AuthModule.setIdentityLastError(null);
          AuthModule.setIdentitySyncPromise(callApiPost('getStaffIdentity', {})
            .then(identityRes => {
              if (identityRes && identityRes.success && identityRes.registered && identityRes.staffId && String(identityRes.staffId).trim() !== '') {
                // ① 登録済み: Backend の検証済み Identity を正として localStorage へ同期（lineUserId は保存しない）
                logDebug("STAFF IDENTITY VERIFIED (BG): " + identityRes.staffId);
                const verifiedUserInfo = {
                  last: identityRes.staffName || profile.displayName || '',
                  first: '',
                  id: identityRes.staffId,
                  picture: profile.pictureUrl || ''
                };
                localStorage.setItem('user_info', JSON.stringify(verifiedUserInfo));
                AuthModule.setIdentityVerified(true);
                AuthModule.setIdentityLastError(null);

                if (typeof renderSettings === 'function') {
                  renderSettings();
                }
                updateBottomNavVisibility();

                // Identity確定に伴う未送信Queue Flush再発火
                if (typeof processQueue === 'function') {
                  processQueue();
                }

                // 初回起動ユーザーの場合はここで画面を表示
                if (!hasExistingStaffId) {
                  setLoadingProgress(100, 'READY');
                  showMainApp();
                }
                return true;
              } else {
                // ② 未登録または不一致: キャッシュを無効化し、初回登録フローへ
                logDebug("STAFF NOT REGISTERED OR IDENTITY MISMATCH. PROCEEDING TO REGISTRATION...");
                AuthModule.setIdentityVerified(false);

                const initialUserInfo = {
                  last: profile.displayName || '',
                  first: '',
                  id: '',
                  picture: profile.pictureUrl || ''
                };
                localStorage.setItem('user_info', JSON.stringify(initialUserInfo));

                // 既存表示していた場合でも未登録なら画面を戻して登録完了までロック
                mainAppVisible = false;
                $('app').classList.add('hidden');
                $('app').classList.add('opacity-0');
                const loadingEl = $('loading');
                if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.remove('opacity-0'); }
                setLoadingProgress(60, 'REGISTERING...');

                return triggerBackgroundRegistration(profile).then(() => {
                  const verifiedInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
                  if (!verifiedInfo.id) {
                    throw new Error("Registration finished but staffId is missing in storage");
                  }
                  AuthModule.setIdentityVerified(true);
                  AuthModule.setIdentityLastError(null);

                  // 登録完了に伴う未送信Queue Flush再発火
                  if (typeof processQueue === 'function') {
                    processQueue();
                  }

                  setLoadingProgress(100, 'READY');
                  showMainApp();
                  return true;
                }).catch(rErr => {
                  AuthModule.setIdentityVerified(false);
                  AuthModule.setIdentityLastError(rErr);
                  logDebug("Registration halted: " + (rErr ? rErr.message : rErr));
                  throw rErr;
                });
              }
            })
            .catch(err => {
              console.warn("Identity verification failed:", err);
              logDebug("Identity verification failed: " + err.message);
              AuthModule.setIdentityVerified(false);
              AuthModule.setIdentityLastError(err);
              showIdentityErrorUI(err);
              return false;
            }));

          // 初回起動時のみ、非同期 Promise の完了を待ってから抜ける
          if (!hasExistingStaffId) {
            await AuthModule.getIdentitySyncPromise();
            if (!AuthModule.isIdentityVerified()) {
              return;
            }
          }
        } catch (err) {
          console.error("LIFF PROFILE / AUTH ERROR", err);
          logDebug("LIFF PROFILE / AUTH ERROR: " + err.message);

          if (err.message && err.message.toUpperCase().includes("REVOKED")) {
            logDebug("Access token revoked detected. Routing to standard UNAUTHORIZED flow...");
            err.code = 'UNAUTHORIZED';
            err.errorType = 'PERMANENT';
            err.retryable = false;
            showIdentityErrorUI(err);
            return;
          }

          showIdentityErrorUI(err);
        }
      } else {
        // LINEログイン処理中（OAuthコールバックのパラメータがある）なら、手動ログイン画面を出さずに少し待機して再チェックする
        const urlParams = new URLSearchParams(window.location.search);
        const isProcessing = urlParams.has('code') || urlParams.has('liff.state');
        if (isProcessing) {
          logDebug("LINE login is processing in background. Retrying login check in 1.5s...");
          setTimeout(() => {
            if (liff.isLoggedIn()) {
              logDebug("Retried Login: OK");
              safeInitApp(); // 再起動してメインフローへ入る
            } else {
              logDebug("Retried Login: FAIL. Redirecting to LINE Login automatically...");
              sessionStorage.setItem('liff_initializing', 'true');
              liff.login();
            }
          }, 1500);
          return;
        }

        logDebug("Not logged in. Redirecting to LINE Login automatically...");
        sessionStorage.setItem('liff_initializing', 'true');
        liff.login();
      }
    } catch (err) {
      console.error("LIFF Init Error:", err);
      logDebug("LIFF Error: " + err.message);
      AuthModule.markAuthFailed(err);
      showIdentityErrorUI(err);
    }
  } else {
    logDebug("Running in standalone web browser. Blocked.");
    const standaloneErr = new Error("STANDALONE_BROWSER_NOT_SUPPORTED");
    standaloneErr.code = "UNAUTHORIZED";
    standaloneErr.errorType = "PERMANENT";
    standaloneErr.retryable = false;
    AuthModule.markAuthFailed(standaloneErr);
    $('loading-status').textContent = "エラー: LINEアプリ内から起動してください。";
  }
}

function showIdentityErrorUI(err) {
  mainAppVisible = false;
  const appEl = $('app');
  if (appEl) {
    appEl.classList.add('hidden');
    appEl.classList.add('opacity-0');
  }
  const loadingEl = $('loading');
  if (loadingEl) {
    loadingEl.classList.remove('hidden');
    loadingEl.classList.remove('opacity-0');
  }

  const statusEl = $('loading-status');
  if (!statusEl) return;

  // 1. CONTRACT_EXPIRED: App遮断、再試行なし
  if (err && (err.code === 'CONTRACT_EXPIRED' || err.contractStatus === 'EXPIRED' || err.isExpired === true)) {
    window.__contractExpired = true;
    if (typeof setSyncStatus === 'function') setSyncStatus('offline');
    statusEl.textContent = "契約期間が終了しているため利用できません。";
    statusEl.onclick = null;
    statusEl.style.cursor = 'default';
    return;
  }

  // 2. UNAUTHORIZED / token失効: App遮断、LINE再ログイン
  if (err && err.code === 'UNAUTHORIZED') {
    statusEl.textContent = "認証エラー: LINEログインの有効期限が切れました。\n(タップして再ログイン)";
    statusEl.style.cursor = 'pointer';
    statusEl.onclick = function() {
      statusEl.onclick = null;
      statusEl.style.cursor = 'default';
      // Safe Delay OAuth復帰フラグを必ずlogin前に設定
      sessionStorage.setItem('liff_initializing', 'true');
      const liffObj = typeof liff !== 'undefined' ? liff : (typeof window !== 'undefined' ? window.liff : null);
      if (liffObj && liffObj.logout && liffObj.login) {
        try { liffObj.logout(); } catch(e) {}
        liffObj.login({ redirectUri: window.location.href });
      } else {
        window.location.reload();
      }
    };
    return;
  }

  // 3. LIFF init timeout / init reject / FAILED: App遮断、「タップして再接続」でページreload
  const isLiffInitFailure = AuthModule.getAuthState() === 'FAILED' || (err && (err.isLiffInitError || (err.message && err.message.includes('LINEログインの応答がタイムアウト'))));
  if (isLiffInitFailure) {
    let msg = "接続エラー: ";
    msg += (err ? err.message : "LINE初期化に失敗しました") + "\n(タップして再接続)";
    statusEl.textContent = msg;
    statusEl.style.cursor = 'pointer';
    statusEl.onclick = function() {
      statusEl.onclick = null;
      statusEl.style.cursor = 'default';
      window.location.reload();
    };
    return;
  }

  // 4. Identity API の TRANSIENT / 通信エラー: App遮断、retryIdentityVerification()
  let msg = "初期化エラー: ";
  msg += (err ? (err.message || err.code) : "通信エラー") + "\n(タップして再試行)";
  statusEl.textContent = msg;
  statusEl.style.cursor = 'pointer';
  statusEl.onclick = function() {
    statusEl.onclick = null;
    statusEl.style.cursor = 'default';
    window.retryIdentityVerification();
  };
}

window.retryIdentityVerification = function() {
  const statusEl = $('loading-status');
  if (statusEl) {
    statusEl.onclick = null;
    statusEl.style.cursor = 'default';
    statusEl.textContent = "アカウント照合を再試行中...";
  }

  const profile = window.liffProfile || (typeof liff !== 'undefined' && liff.getDecodedIDToken ? {
    displayName: liff.getDecodedIDToken()?.name || '',
    userId: liff.getDecodedIDToken()?.sub || '',
    pictureUrl: liff.getDecodedIDToken()?.picture || ''
  } : null);

  // 新規 Promise を生成して再試行（reject済みの古いPromiseは再利用しない）
  AuthModule.setIdentityLastError(null);
  AuthModule.setIdentitySyncPromise(callApiPost('getStaffIdentity', {})
    .then(identityRes => {
      if (identityRes && identityRes.success && identityRes.registered && identityRes.staffId && String(identityRes.staffId).trim() !== '') {
        logDebug("RETRY STAFF IDENTITY VERIFIED: " + identityRes.staffId);
        const verifiedUserInfo = {
          last: identityRes.staffName || (profile ? profile.displayName : '') || '',
          first: '',
          id: identityRes.staffId,
          picture: (profile ? profile.pictureUrl : '') || ''
        };
        localStorage.setItem('user_info', JSON.stringify(verifiedUserInfo));
        AuthModule.setIdentityVerified(true);
        AuthModule.setIdentityLastError(null);
        if (typeof renderSettings === 'function') renderSettings();
        updateBottomNavVisibility();
        if (typeof processQueue === 'function') processQueue();
        setLoadingProgress(100, 'READY');
        showMainApp();
        return true;
      } else {
        // 未登録分岐の完結: registerStaff -> 成功 -> staffId確認 -> Verified -> Queue flush -> READY -> showMainApp
        logDebug("RETRY STAFF NOT REGISTERED. PROCEEDING TO REGISTRATION...");
        AuthModule.setIdentityVerified(false);
        return triggerBackgroundRegistration(profile).then(() => {
          const verifiedInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
          if (!verifiedInfo.id) {
            throw new Error("Registration finished but staffId is missing in storage");
          }
          AuthModule.setIdentityVerified(true);
          AuthModule.setIdentityLastError(null);
          if (typeof processQueue === 'function') processQueue();
          setLoadingProgress(100, 'READY');
          showMainApp();
          return true;
        });
      }
    })
    .catch(err => {
      console.warn("Retry identity verification failed:", err);
      AuthModule.setIdentityVerified(false);
      AuthModule.setIdentityLastError(err);
      showIdentityErrorUI(err);
      return false;
    }));
};

if (document.readyState === 'complete') {
  safeInitApp();
} else {
  window.addEventListener('DOMContentLoaded', safeInitApp);
}

// ID情報モーダルの制御 (Wave 8: StaffIdInfoView へ委譲)
function openIdInfoModal(type, event) {
  let displayBranch = '';
  // 地区名の解決は従来どおり License を開く時だけ行い、優先順位 (window.__districtName -> localStorage) を維持
  if (type === 'license') {
    displayBranch = window.__districtName || localStorage.getItem('branch_name') || '';
  }

  if (typeof StaffIdInfoView !== 'undefined' && typeof StaffIdInfoView.open === 'function') {
    StaffIdInfoView.open(type, { branchName: displayBranch, event });
  }
}

function closeIdInfoModal() {
  if (typeof StaffIdInfoView !== 'undefined' && typeof StaffIdInfoView.close === 'function') {
    StaffIdInfoView.close();
  }
}

// =============================
// 受渡要請システム (Flyer Transfer Request - Wave 5 Wiring Wrapper)
// =============================
window.openTransferRequestDialog = function(name, id, loc, count, storageId) {
  const displayStorageId = String(storageId || '').trim();
  const sessionId = TransferModule.startSession(name, id, loc, count, displayStorageId);

  TransferView.openDialog({
    displayStorageId: displayStorageId,
    onCancel: function() {
      TransferModule.invalidateSession(sessionId);
    },
    onSubmit: async function({ contactMethod, contactValue }) {
      if (TransferModule.isSubmitting()) return;

      const val = TransferModule.validateContact(contactMethod, contactValue);
      if (!val.valid) {
        alert(val.message);
        TransferView.focusContactInput();
        return;
      }

      // 認証待機前から二重送信防止ロックを有効化 (Pre-Auth In-Flight Lock)
      TransferView.setSubmittingState(true);
      TransferModule.setSubmitting(true);

      try {
        await waitForIdentityVerified();
      } catch (authErr) {
        if (!TransferModule.isSessionActive(sessionId)) return;
        alert("本人確認が完了していないため要請を送信できません。");
        TransferView.setSubmittingState(false);
        TransferModule.setSubmitting(false);
        return;
      }

      if (!TransferModule.isSessionActive(sessionId)) return;

      const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
      const requestUserId = userInfo.id ? String(userInfo.id).trim() : 'UNKNOWN';
      const requestId = window.generateRequestId ? window.generateRequestId('req_tr') : `req_tr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const result = await TransferModule.submitTransferRequest({
        sessionId: sessionId,
        contactMethod: contactMethod,
        contactValue: contactValue,
        requestUserId: requestUserId,
        requestId: requestId
      });

      if (result.aborted) {
        // 世代不一致（閉じる→再表示等）の場合は新しいダイアログへ作用させず静かに破棄
        return;
      }

      if (result.success) {
        TransferView.closeDialog();
        const res = result.res;
        if (res && (res.status === 'SENT' || res.status === 'SKIPPED_NO_LINE_ID')) {
          alert('✅ 受渡要請を送信しました！\n保管者に通知されます。');
        } else if (res && res.status === 'UNKNOWN') {
          alert('⚠️ 送信結果を確認できませんでした。\n通信状態をご確認のうえ、二重送信を防ぐためしばらくお待ちください。');
        } else {
          alert('送信に失敗しました: ' + (res ? res.message : 'Unknown error'));
        }
      } else {
        alert('通信エラー: ' + (result.error ? result.error.message : 'Unknown error'));
        TransferView.setSubmittingState(false);
      }
    }
  });
};

window.closeTransferRequestDialog = function() {
  TransferModule.invalidateSession();
  TransferView.closeDialog();
};

window.updateBulletinCharCount = function(textarea) {
  if (typeof BulletinView !== 'undefined' && BulletinView.updateCharCount) {
    BulletinView.updateCharCount(textarea);
  }
};

window.fetchBulletinPosts = function(options = {}) {
  if (typeof BulletinModule === 'undefined') {
    console.error("[Bulletin Error] BulletinModule is not loaded.");
    return Promise.reject(new Error("BulletinModule unavailable"));
  }

  const hooks = {
    isPageActive: () => {
      const page = document.getElementById('page-bulletin');
      return !!(page && !page.classList.contains('hidden'));
    },
    onLoading: () => {
      if (typeof BulletinView !== 'undefined' && BulletinView.showLoading) {
        BulletinView.showLoading();
      }
    },
    onRender: (posts) => {
      if (typeof BulletinView !== 'undefined' && BulletinView.renderPosts) {
        BulletinView.renderPosts(posts);
      } else if (typeof renderBulletinList === 'function') {
        renderBulletinList(posts);
      }
    },
    onError: (info) => {
      if (typeof BulletinView !== 'undefined' && BulletinView.showError) {
        BulletinView.showError(info);
      }
    }
  };

  return BulletinModule.fetchPosts(options, hooks);
};

window.submitBulletinPost = async function() {
  if (typeof BulletinView !== 'undefined' && BulletinView.submitPost) {
    return await BulletinView.submitPost({
      getStaffInfo: () => {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        const id = userInfo.id ? String(userInfo.id).trim() : (window.currentUser && window.currentUser.id ? String(window.currentUser.id).trim() : '');
        const name = `${userInfo.last || ''} ${userInfo.first || ''}`.trim() || id;
        return { id, name };
      },
      authorize: () => waitForIdentityVerified(),
      refreshPosts: () => {
        window.fetchBulletinPosts({ force: true });
      }
    });
  }
};

window.openBulletinContactDialog = function(targetStaffId) {
  if (typeof BulletinView !== 'undefined' && BulletinView.openContactDialog) {
    BulletinView.openContactDialog(targetStaffId, {
      authorize: () => waitForIdentityVerified(),
      getRequestContext: () => {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        const requestUserId = userInfo.id ? String(userInfo.id).trim() : (window.currentUser && window.currentUser.id ? String(window.currentUser.id).trim() : 'UNKNOWN');
        const requestId = window.generateRequestId ? window.generateRequestId('req_bc') : `req_bc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        return { requestUserId, requestId };
      }
    });
  }
};

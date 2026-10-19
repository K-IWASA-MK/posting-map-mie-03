// Election Master SSOT Loader & Memory Cache
const StorageView = (function() {
  function $(id) {
    return document.getElementById(id);
  }

  function updateCountDisplay() {
    const countInput = $('storage-register-count');
    const countText = $('storage-register-count-text');
    const countUnit = $('storage-register-count-unit');

    if (!countInput || !countText) return;

    const raw = countInput.value.replace(/,/g, '').replace(/枚/g, '').trim();
    if (raw !== '' && !isNaN(parseInt(raw, 10))) {
      countText.textContent = Number(raw).toLocaleString();
      if (countUnit) countUnit.style.display = 'inline';
    } else {
      countText.textContent = '';
      if (countUnit) countUnit.style.display = 'none';
    }
  }

  function updateRegisterButtonText() {
    const btn = $('btn-storage-register-submit');
    const countInput = $('storage-register-count');
    if (!btn || !countInput) return;

    const raw = countInput.value.replace(/,/g, '').replace(/枚/g, '').trim();
    btn.textContent = raw ? 'チラシ枚数を更新する' : 'チラシ枚数を入力する';
  }

  function setupRegisterInputFormatter(inputEl) {
    if (!inputEl || inputEl.dataset.formatted) return;
    inputEl.dataset.formatted = 'true';

    const container = $('storage-register-count-container');
    const display = $('storage-register-count-display');

    if (container && display) {
      container.addEventListener('click', function() {
        inputEl.classList.remove('hidden');
        display.classList.add('hidden');
        inputEl.dataset.userEditing = 'true';

        const raw = inputEl.value.replace(/,/g, '').replace(/枚/g, '').trim();
        inputEl.value = raw;
        inputEl.focus();

        if (typeof inputEl.setSelectionRange === 'function') {
          inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        }
      });
    }

    inputEl.addEventListener('focus', function() {
      if (display) display.classList.add('hidden');
      inputEl.classList.remove('hidden');
      inputEl.dataset.userEditing = 'true';
      const rawVal = this.value.replace(/,/g, '').replace(/枚/g, '').replace(/[^\d]/g, '');
      this.value = rawVal;
    });

    inputEl.addEventListener('blur', function() {
      inputEl.classList.add('hidden');
      if (display) display.classList.remove('hidden');

      const rawVal = this.value.replace(/,/g, '').replace(/枚/g, '').replace(/[^\d]/g, '');
      if (!rawVal) {
        this.value = '';
      } else {
        const num = parseInt(rawVal, 10);
        this.value = isNaN(num) ? '' : String(num);
      }

      updateCountDisplay();
      updateRegisterButtonText();
    });

    inputEl.addEventListener('input', function() {
      inputEl.dataset.userEditing = 'true';
      const rawVal = this.value.replace(/,/g, '').replace(/枚/g, '').replace(/[^\d]/g, '');
      this.value = rawVal;
      updateRegisterButtonText();
    });
  }

  function updateLocationDisplayText() {
    const locSelect = $('storage-register-location');
    const locText = $('storage-location-text');
    if (!locSelect || !locText) return;

    if (locSelect.value) {
      locText.textContent = locSelect.value;
    } else {
      locText.textContent = '保管場所を選択';
    }
  }

  function updateLocationDropdown(locations, overrideCities, tier1CacheFallback) {
    const locSelect = $('storage-register-location');
    if (!locSelect) return;

    if (!locSelect.dataset.listenerBound) {
      locSelect.dataset.listenerBound = 'true';
      locSelect.addEventListener('change', function() {
        updateLocationDisplayText();
      });
    }

    const prevValue = locSelect.value;

    const customCities = (Array.isArray(locations) && locations.length > 0)
      ? locations
      : (Array.isArray(overrideCities) && overrideCities.length > 0 ? overrideCities : null);

    const targetCities = customCities || (Array.isArray(tier1CacheFallback) && tier1CacheFallback.length > 0 ? tier1CacheFallback : null);

    locSelect.innerHTML = '';
    const cityList = [];

    if (Array.isArray(targetCities) && targetCities.length > 0) {
      targetCities.forEach(c => {
        const name = typeof c === 'string' ? c : (c.name || '');
        if (name && !cityList.includes(name)) {
          cityList.push(name);
        }
      });
    }

    if (cityList.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'データ読み込み中...';
      locSelect.appendChild(opt);
      updateLocationDisplayText();
      return;
    }

    cityList.forEach(city => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = city;
      locSelect.appendChild(opt);
    });

    if (prevValue && cityList.includes(prevValue)) {
      locSelect.value = prevValue;
    }

    updateLocationDisplayText();
  }

  function applyMyStockToForm(snapshot, options = {}) {
    const { isAsyncResponse = false } = options;
    const countInput = $('storage-register-count');
    const locSelect = $('storage-register-location');
    if (!countInput) return;

    let myStock = snapshot.myStock || null;
    if (!myStock && Array.isArray(snapshot.stocks) && snapshot.stocks.length > 0) {
      myStock = snapshot.stocks.find(s => s.isMe === true) || null;
    }
    if (!myStock) return;

    const isInputActive = document.activeElement === countInput ||
                          !countInput.classList.contains('hidden') ||
                          countInput.dataset.userEditing === 'true';

    if (!isAsyncResponse || !isInputActive) {
      const rawCount = parseInt(myStock.count, 10);
      countInput.value = isNaN(rawCount) ? '' : String(rawCount);
      if (!isAsyncResponse) {
        delete countInput.dataset.userEditing;
      }
      updateCountDisplay();
      updateRegisterButtonText();
    }

    const isLocActive = document.activeElement === locSelect || (locSelect && locSelect.dataset.userSelected === 'true');
    if (locSelect && myStock.location && (!isAsyncResponse || !isLocActive)) {
      locSelect.value = myStock.location;
      updateLocationDisplayText();
    }
  }

  function renderLoadingUI(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#2563eb]/40 border-t-[#2563eb] animate-spin"></div>
        <p class="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Loading Inventory...</p>
      </div>`;
  }

  function renderErrorUI(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-2xl">⚠️</span>
        <p class="text-sm font-black text-white/60">エラーが発生しました</p>
      </div>`;
  }

  function renderFetchFailedUI(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-2xl">⚠️</span>
        <p class="text-sm font-black text-white/60">データ取得に失敗しました</p>
      </div>`;
  }

  let _isSubmitting = false;

  /**
   * 在庫登録ページの初期化
   * @param {Object} hooks
   */
  function initRegisterPage(hooks = {}) {
    const {
      getUserInfo,
      getRegistrationStatus = () => ({ isRegistering: false, registrationError: null }),
      onRetryRegistration = null,
      getTier1Cache = () => null,
      storageModule
    } = hooks;

    if (!storageModule) {
      throw new Error('[StorageView.initRegisterPage] storageModule is required.');
    }

    const userInfo = typeof getUserInfo === 'function' ? (getUserInfo() || {}) : {};
    const staffId = userInfo.id || '';
    const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim();
    const idEl = $('storage-register-staff-id');
    const nameEl = $('storage-register-staff-name');

    const regStatus = typeof getRegistrationStatus === 'function' ? (getRegistrationStatus() || {}) : {};
    const isRegistering = !!regStatus.isRegistering;
    const registrationError = regStatus.registrationError;

    if (idEl) {
      if (staffId) {
        idEl.textContent = 'ID: ' + staffId;
        idEl.style.color = 'inherit';
        idEl.style.cursor = 'default';
        idEl.onclick = null;
      } else if (isRegistering) {
        idEl.textContent = 'ID: 登録中...';
        idEl.style.color = 'inherit';
        idEl.style.cursor = 'default';
        idEl.onclick = null;
      } else if (registrationError) {
        idEl.textContent = 'ID: 登録失敗 (タップして再試行)';
        idEl.style.color = '#ef4444';
        idEl.style.cursor = 'pointer';
        idEl.onclick = async () => {
          if (typeof onRetryRegistration === 'function') {
            try {
              idEl.textContent = 'ID: 再登録中...';
              idEl.style.color = 'inherit';
              await onRetryRegistration();
            } catch (e) {
              idEl.textContent = 'ID: 登録失敗 (タップして再試行)';
              idEl.style.color = '#ef4444';
            }
          }
        };
      } else {
        idEl.textContent = 'ID: ---';
        idEl.style.color = 'inherit';
        idEl.style.cursor = 'default';
        idEl.onclick = null;
      }
    }
    if (nameEl) nameEl.textContent = staffName || '---';

    const countInput = $('storage-register-count');
    setupRegisterInputFormatter(countInput);

    const locSelect = $('storage-register-location');
    if (locSelect && !locSelect.dataset.changeBound) {
      locSelect.dataset.changeBound = 'true';
      locSelect.addEventListener('change', function() {
        this.dataset.userSelected = 'true';
        updateLocationDisplayText();
      });
    }

    const tier1 = typeof getTier1Cache === 'function' ? getTier1Cache() : null;
    updateLocationDropdown(storageModule.getSnapshot().locations, null, tier1);

    const snapshot = storageModule.getSnapshot();
    if (!snapshot.locations) {
      storageModule.getLocations().then(cities => {
        const latestTier1 = typeof getTier1Cache === 'function' ? getTier1Cache() : null;
        updateLocationDropdown(cities, null, latestTier1);
      });
    }

    if (snapshot.fetched && Array.isArray(snapshot.stocks) && snapshot.stocks.length > 0) {
      applyMyStockToForm(snapshot, { isAsyncResponse: false });
    }

    if (staffId && countInput) {
      storageModule.fetchStock().then(data => {
        if (data && data.success && Array.isArray(data.stocks)) {
          applyMyStockToForm(storageModule.getSnapshot(), { isAsyncResponse: true });
        }
      }).catch(err => {
        console.warn('[initRegisterPage] fetchFlyerStock failed:', err);
        updateCountDisplay();
        updateRegisterButtonText();
      });
    }

    updateCountDisplay();
    updateRegisterButtonText();
  }

  /**
   * 在庫一覧ページの初期化
   * @param {Object} hooks
   */
  function initListPage(hooks = {}) {
    const {
      getTier1Cache = () => null,
      storageModule,
      renderList = (typeof renderStorageList === 'function' ? renderStorageList : null)
    } = hooks;

    if (!storageModule) {
      throw new Error('[StorageView.initListPage] storageModule is required.');
    }

    const listContainer = $('storage-list-container');
    const snapshot = storageModule.getSnapshot();
    const tier1 = typeof getTier1Cache === 'function' ? getTier1Cache() : null;

    if (!snapshot.fetched) {
      renderLoadingUI(listContainer);
      storageModule.fetchStock().then(data => {
        const currentTier1 = typeof getTier1Cache === 'function' ? getTier1Cache() : null;
        if (data && data.success) {
          if (typeof renderList === 'function') renderList(storageModule.getSnapshot().stocks, currentTier1);
        } else if (data === null) {
          if (typeof renderList === 'function') renderList(storageModule.getSnapshot().stocks, currentTier1);
        } else {
          renderFetchFailedUI(listContainer);
        }
      }).catch(err => {
        renderErrorUI(listContainer);
      });
    } else {
      if (typeof renderList === 'function') renderList(snapshot.stocks, tier1);
    }
  }

  /**
   * 在庫登録フォームの送信制御
   * @param {Object} hooks
   */
  async function submitRegisterForm(hooks = {}) {
    if (_isSubmitting) {
      return null;
    }

    const {
      authorize,
      getUserInfo,
      storageModule,
      onSuccess = null,
      onError = null
    } = hooks;

    if (!storageModule) {
      throw new Error('[StorageView.submitRegisterForm] storageModule is required.');
    }
    if (typeof authorize !== 'function') {
      throw new Error('[StorageView.submitRegisterForm] authorize hook is required.');
    }

    const locSelect = $('storage-register-location');
    const countInput = $('storage-register-count');
    const btn = $('btn-storage-register-submit');

    if (!locSelect || !countInput || !btn) return null;

    const location = locSelect.value;
    const count = parseInt(String(countInput.value).replace(/,/g, '').replace(/枚/g, ''), 10);

    if (!location) {
      alert("保管場所を選択してください。");
      return null;
    }
    if (isNaN(count) || count < 0) {
      alert("正しい枚数を入力してください。");
      return null;
    }

    const userInfo = typeof getUserInfo === 'function' ? (getUserInfo() || {}) : {};
    const staffId = userInfo.id || '';
    const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim();

    if (!staffId || !staffName) {
      alert("ID情報がありません。ID登録を行ってください。");
      return null;
    }

    const submittedCountRaw = String(countInput.value).replace(/,/g, '').replace(/枚/g, '').trim();
    const submittedLocation = location;

    _isSubmitting = true;
    btn.disabled = true;
    btn.textContent = "更新中...";

    try {
      await authorize();
    } catch (authErr) {
      alert("本人確認が完了していないか、未登録のため更新できません。");
      btn.disabled = false;
      btn.textContent = "チラシ枚数を更新";
      _isSubmitting = false;
      return null;
    }

    try {
      const res = await storageModule.updateStock({
        location: location,
        count: count,
        staffName: staffName,
        staffId: staffId
      });

      if (res && res.success) {
        alert("✓ チラシ枚数を更新しました");
        const currentCountRaw = String(countInput.value).replace(/,/g, '').replace(/枚/g, '').trim();
        if (countInput && currentCountRaw === submittedCountRaw) {
          delete countInput.dataset.userEditing;
        }
        if (locSelect && locSelect.value === submittedLocation) {
          delete locSelect.dataset.userSelected;
        }
        if (typeof onSuccess === 'function') onSuccess(res);
        return res;
      } else {
        const errMsg = res && res.message ? res.message : "エラー";
        alert("更新に失敗しました: " + errMsg);
        if (typeof onError === 'function') onError(res);
        return res;
      }
    } catch (e) {
      alert("エラーが発生しました: " + (e ? e.message : e));
      if (typeof onError === 'function') onError(e);
      return null;
    } finally {
      _isSubmitting = false;
      if (btn) {
        btn.disabled = false;
        updateRegisterButtonText();
      }
    }
  }

  function updateStaffIdDisplay(state, staffId, onRetry) {
    const idEl = $('storage-register-staff-id');
    if (idEl) {
      if (state === 'registering') {
        idEl.textContent = 'ID: 登録中...';
        idEl.style.color = 'inherit';
        idEl.style.cursor = 'default';
        idEl.onclick = null;
      } else if (state === 'success') {
        idEl.textContent = 'ID: ' + (staffId || '---');
        idEl.style.color = 'inherit';
        idEl.style.cursor = 'default';
        idEl.onclick = null;
      } else if (state === 'error') {
        idEl.textContent = 'ID: 登録失敗 (タップして再試行)';
        idEl.style.color = '#ef4444';
        idEl.style.cursor = 'pointer';
        idEl.onclick = () => {
          onRetry();
        };
      }
    }
  }

  return {
    updateCountDisplay,
    updateRegisterButtonText,
    setupRegisterInputFormatter,
    updateLocationDisplayText,
    updateLocationDropdown,
    applyMyStockToForm,
    renderLoadingUI,
    renderErrorUI,
    renderFetchFailedUI,
    initRegisterPage,
    initListPage,
    submitRegisterForm,
    updateStaffIdDisplay
  };
})();

const StaffRegistrationView = (function() {
  function $(id) {
    return document.getElementById(id);
  }

  function showRegistrationError(err, onRetry) {
    const loadingStatusEl = $('loading-status');
    if (loadingStatusEl) {
      loadingStatusEl.textContent = '登録エラー (タップして再試行): ' + (err.message || '通信失敗');
      loadingStatusEl.style.color = '#ef4444';
      loadingStatusEl.style.cursor = 'pointer';
      loadingStatusEl.onclick = () => {
        loadingStatusEl.textContent = '再試行中...';
        loadingStatusEl.style.color = 'inherit';
        loadingStatusEl.onclick = null;
        onRetry();
      };
    }
  }

  return {
    showRegistrationError
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ...(module.exports || {}),
    StaffRegistrationView
  };
}

let cachedElectionData = null;
let electionDataPromise = null;

function getLatestElection(electionData) {
  if (!electionData || !Array.isArray(electionData.elections) || electionData.elections.length === 0) {
    return null;
  }
  return electionData.elections.reduce((latest, current) => {
    if (!latest || !latest.electionDate) return current;
    if (!current || !current.electionDate) return latest;
    return String(current.electionDate) > String(latest.electionDate) ? current : latest;
  }, null);
}
window.getLatestElection = getLatestElection;

async function fetchElectionData() {
  if (cachedElectionData) return cachedElectionData;
  if (!electionDataPromise) {
    electionDataPromise = (async () => {
      try {
        const filename = (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG?.staticMaster?.electionHistoryFilename)
          ? window.PMS_CLIENT_CONFIG.staticMaster.electionHistoryFilename
          : 'election_history.json';
        const electionHistoryUrl = `../../data/${filename}`;

        const res = await fetch(electionHistoryUrl, { cache: 'no-store' });
        if (!res.ok) {
          console.warn(`[render] Failed to fetch ${filename}: status ${res.status}`);
          return null;
        }
        cachedElectionData = await res.json();
        return cachedElectionData;
      } catch (err) {
        console.warn('[render] Error loading election_history.json:', err);
        return null;
      }
    })();
  }
  return electionDataPromise;
}
window.fetchElectionData = fetchElectionData;

function renderAreas() {
  const contentEl = $('content');

  if (currentCity === null) {
    const pageAreas = $('page-areas');
    const isPageAreasVisible = pageAreas && !pageAreas.classList.contains('hidden');
    if (contentEl) {
      if (isPageAreasVisible) {
        contentEl.classList.add('is-map-view');
      } else {
        contentEl.classList.remove('is-map-view');
      }
    }

    let cities = [];
    if (typeof tier1Cache !== 'undefined' && Array.isArray(tier1Cache) && tier1Cache.length > 0) {
      cities = tier1Cache.map(c => {
        const done = c.done || 0;
        const total = c.total || 0;
        const progress = total > 0 ? Math.round((done / total) * 100) : 0;
        return { name: typeof c === "string" ? c : c.name, done: done, total: total, progress: progress };
      });
    }

    if (cities.length === 0) {
      $('area-list').innerHTML = `
        <div class="premium-glass p-8 text-center space-y-4 mx-4 my-10 border border-white/10 rounded-3xl bg-white/5 backdrop-blur-2xl">
          <p class="text-base font-black text-white">エリアデータ読み込み中...</p>
        </div>`;
      return;
    }

    let mapEl = document.getElementById("main-map");
    if (!mapEl) {
      const mapHtml = `
        <div id="main-map" style="width:100%; height:var(--primary-card-height, 356px); border-radius:1.5rem; overflow:hidden; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.5);"></div>
      `;
      $('area-list').innerHTML = mapHtml;
    }

    if (!window.mainMapInstance && typeof window.initMainMap === 'function') {
      setTimeout(window.initMainMap, 100);
    }
  }
}

// Open point detail modal
function openPointDetailModal(rowId) {
  if (!allPoints) {
    allPoints = [];
  }
  let p = allPoints.find(point => point.rowId === rowId);

  if (!p) {
    // 【Hアプリ専用フォールバック】allPointsが未初期化、または対象データが存在しない場合
    // initMainMap完了済みの masterPins から構造データを復元する。
    // ※実績データはスプレッドシートのもの（Dashboardが見るもの）と混同しないよう、初期状態をセット。
    if (Array.isArray(window.masterPins)) {
      const csvRow = window.masterPins.find(item => String(item.rowId) === String(rowId));
      if (csvRow) {
        p = {
          // 基本・位置情報 (CSVマッピング修正)
          rowId: csvRow.rowId,
          address: `${csvRow.city_name} ${csvRow.town_name}`,
          cityName: csvRow.city_name,
          townName: csvRow.town_name,
          lat: csvRow.latitude,
          latitude: csvRow.latitude,
          lng: csvRow.longitude,
          longitude: csvRow.longitude,
          
          // 業務ステータス初期化
          isDone: false,
          count: 0,
          staffName: '',
          staffId: '',
          completedAt: '',
          total: 0,
          done: 0,
          status: '未着手',

          // UI・同期状態管理（正常系動作に必須）
          syncStatus: '',
          photoStatus: 'NONE',
          photoBase64: null,
          photoUrl: '',
          gpsStatus: 'NO',
          gps: '',
          gpsLog: '',
          accuracy: null
        };
        allPoints.push(p);
      }
    }
  }

  if (!p) {
    return;
  }

  window.currentPointDetailRowId = rowId;
  const modalContent = $('detail-modal-content');
  if (modalContent) {
    modalContent.innerHTML = renderDetailModalContent(p);
    modalContent.scrollTop = 0; // スクロール位置を確実に一番上へリセット
  }

  const modal = $('detail-modal');

  if (!modal) {
    console.error("[ERROR] detail-modal not found");
    return;
  }

  if (getComputedStyle(modal).display === "none") {
    modal.style.display = ""; // クラスで定義された 'flex' 等に戻す
  }

  modal.classList.remove('pointer-events-none', 'opacity-0');
  if (modal.firstElementChild) {
    modal.firstElementChild.classList.remove('translate-y-full');
  }
}

// Close point detail modal
function closeDetailModal() {
  const modal = $('detail-modal');
  if (!modal) return;
  modal.classList.add('opacity-0', 'pointer-events-none');
  if (modal.firstElementChild) {
    modal.firstElementChild.classList.add('translate-y-full');
  }
  // アニメーション完了後にdisplay: noneにする
  setTimeout(() => {
    if (modal.classList.contains('opacity-0')) {
      modal.style.display = "none";
    }
  }, 300);
  window.currentPointDetailRowId = null;
}

// キャンセル時の完全破棄＆PinStatus解除 (二重remove防止設計)
window.cancelMissionComplete = function(rowId) {
  const numericRowId = parseInt(rowId, 10);

  // 1. 対象ポイントの一時下書きデータを完全破棄 (ActivityModule へ単一委譲)
  const resetPoint = (p) => {
    ActivityModule.resetDraft(p);
  };

  if (typeof allPoints !== 'undefined' && Array.isArray(allPoints)) {
    const p = allPoints.find(point => point.rowId === numericRowId || point.rowId === rowId);
    if (p) resetPoint(p);
  }
  if (typeof window.allPoints !== 'undefined' && Array.isArray(window.allPoints)) {
    const p = window.allPoints.find(point => point.rowId === numericRowId || point.rowId === rowId);
    if (p) resetPoint(p);
  }

  // 2. モーダルを閉じる
  closeDetailModal();

  // 3. activeMarker の有無を確認し、removeの二重送信を防止
  let markerHandled = false;
  if (typeof window.closeCustomInfoWindow === 'function') {
    markerHandled = window.closeCustomInfoWindow();
  }

  // activeMarker が無かった場合のみ直接 remove を呼ぶ (重複送信の防止)
  if (!markerHandled && typeof window.setPinInProgress === 'function') {
    window.setPinInProgress(numericRowId || rowId, "remove");
  }

  // 4. マップピンの同期
  if (typeof window.refreshMainMapPins === 'function') {
    window.refreshMainMapPins();
  }
};

// Render single point detail modal contents
function renderDetailModalContent(p) {
  const areaName = p.townName || '';

  // 「大字」除去 + 余分な空白整理
  const cleanAddr = (p.address || '').replace(/大字/g, '').replace(/\s+/g, ' ').trim();
  return `
    <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; box-sizing: border-box;">
      <!-- 1行目: 住所バッジ（中央寄せ） -->
      <div class="w-full flex flex-col items-center">
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); height: 26px; font-size: 12px; color: rgba(255, 255, 255, 0.9);" class="inline-flex items-center px-3 font-bold rounded-full tracking-wide truncate max-w-full select-text">
          🏠 ${escapeHtml(cleanAddr)}
        </div>
        ${p.memo ? `<div class="text-xs text-white/50 bg-white/5 rounded-xl p-3 border border-white/5 select-text w-full text-center mt-1">${escapeHtml(p.memo)}</div>` : ''}
      </div>

      ${!p.isDone ? `
        <!-- 【未完了】配布枚数入力案内カード -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);" class="w-full rounded-3xl py-6 px-5 flex flex-col items-center justify-center gap-6">
          <div style="color: rgba(255, 255, 255, 0.7); font-size: 13px; font-weight: 700; line-height: 1.6; text-align: center; margin-bottom: 12px;">
            配布枚数を入力してください<br>入力後 写真を撮影します
          </div>

          <div style="display: flex; gap: 10px; width: 100%;">
            <button type="button" onclick="cancelMissionComplete(${p.rowId})"
              style="flex: 1; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.6); border-radius: 14px; padding: 14px 8px; font-size: 13px; font-weight: 900; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease;"
              onpointerdown="this.style.transform='scale(0.94)'; this.style.opacity='0.7';"
              onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
              onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">キャンセル</button>
            <button type="button" onclick="openNumpad('${escapeHtml(areaName)}', ${p.rowId}, ${p.count || 0}, true);" class="btn-neu"
              style="flex: 1; background: #2563eb; border: none; color: white; border-radius: 14px; padding: 14px 8px; font-size: 13px; font-weight: 900; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease;"
              onpointerdown="this.style.transform='scale(0.96)'; this.style.opacity='0.85';"
              onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
              onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">OK</button>
          </div>
        </div>
      ` : `
        <!-- 【完了確認】MISSION COMPLETED 大見出しカード (コンパクト化) -->
        <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); box-shadow: 0 0 20px rgba(16, 185, 129, 0.08); border-radius: 20px; padding: 14px 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 4px; box-sizing: border-box; width: 100%;">
          <div style="width: 28px; height: 28px; border-radius: 9999px; background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); display: flex; align-items: center; justify-content: center; color: #10b981; font-weight: 900; font-size: 14px;">
            ✓
          </div>
          <div style="font-size: 13px; font-weight: 900; letter-spacing: 0.08em; color: #10b981; text-transform: uppercase;">
            MISSION COMPLETED!
          </div>
          <div style="font-size: 11px; font-weight: 700; color: rgba(255, 255, 255, 0.7);">
            配布が完了しました
          </div>
          <div style="font-size: 10px; font-weight: 700; color: rgba(255, 255, 255, 0.4); margin-top: 2px;">
            🕒 ${p.completedAt || ''}${p.staffName ? ` · ${escapeHtml(p.staffName)}` : ''}
          </div>
        </div>

        <!-- 【中央2カラムエリア】左: 提出写真 / 右: GPS・枚数・配布員 -->
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; width: 100%; box-sizing: border-box;">
          <!-- 左カラム: 提出写真 -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 10px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 6px; box-sizing: border-box; overflow: hidden;">
            <div style="font-size: 10px; font-weight: 900; color: rgba(255, 255, 255, 0.5); width: 100%; display: flex; align-items: center; gap: 4px;">
              <span>📷</span><span>提出写真</span>
            </div>
            <div style="width: 100%; aspect-ratio: 1 / 1; border-radius: 10px; overflow: hidden; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: center;">
              ${(p.tempPhotoUrl || p.photoUrl) ? `
                <img src="${p.tempPhotoUrl || p.photoUrl}" alt="Evidence" style="width: 100%; height: 100%; object-fit: cover;" />
              ` : `
                <span style="font-size: 10px; color: rgba(255, 255, 255, 0.3);">写真なし</span>
              `}
            </div>
            <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; font-size: 8.5px; font-weight: 900; padding: 2px 6px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; letter-spacing: 0.04em;">
              <span>🛡️</span><span>PHOTO VERIFIED</span>
            </div>
            <div style="font-size: 9px; font-weight: 700; color: rgba(255, 255, 255, 0.4); text-align: center; white-space: nowrap;">
              写真を確認しました
            </div>
          </div>

          <!-- 右カラム: GPS・配布数・配布員（3段） -->
          <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; justify-content: space-between;">
            <!-- 1. GPS位置情報 -->
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 8px 9px; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; overflow: hidden;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 2px; width: 100%;">
                <span style="font-size: 9.5px; font-weight: 900; color: rgba(255, 255, 255, 0.5); display: flex; align-items: center; gap: 2px; white-space: nowrap;">📍 GPS</span>
                ${(p.gpsStatus === 'OK' || p.gps || p.latitude) ? `
                  <span style="background: rgba(16, 185, 129, 0.12); color: #10b981; font-size: 7.5px; font-weight: 900; padding: 1px 4px; border-radius: 4px; white-space: nowrap;">取得済み</span>
                ` : p.gpsStatus === 'pending' ? `
                  <span style="background: rgba(37, 99, 235, 0.12); color: #60a5fa; font-size: 7.5px; font-weight: 900; padding: 1px 4px; border-radius: 4px; white-space: nowrap;">取得中...</span>
                ` : `
                  <span style="background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.5); font-size: 7.5px; font-weight: 900; padding: 1px 4px; border-radius: 4px; white-space: nowrap;">未取得</span>
                `}
              </div>
              <div style="font-size: 9px; font-family: monospace; font-weight: 700; color: ${(p.gps || p.latitude) ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.4)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">
                ${p.gps || (p.latitude && p.longitude ? `${String(p.latitude).slice(0,9)}, ${String(p.longitude).slice(0,10)}` : (p.gpsStatus === 'pending' ? '測位中...' : '位置情報なし (GPSオフ)'))}
              </div>
              <div style="font-size: 7.5px; font-weight: 700; color: rgba(255, 255, 255, 0.3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${(p.gps || p.latitude) ? `精度: ±${p.accuracy ? Math.round(p.accuracy) : 5}m · ${(p.completedAt || '').split(' ')[1] || ''}` : '※未取得でも提出できます'}
              </div>
            </div>

            <!-- 2. 配布枚数（右詰め・コンパクト化） -->
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 8px 9px; display: flex; flex-direction: column; justify-content: center; gap: 1px; box-sizing: border-box; overflow: hidden;">
              <div style="font-size: 9.5px; font-weight: 900; color: rgba(255, 255, 255, 0.5); display: flex; align-items: center; gap: 2px;">📄 配布枚数</div>
              <div style="font-size: 18px; font-weight: 900; color: #ffffff; font-family: monospace; text-align: right; width: 100%; line-height: 1.1; margin-top: 2px; letter-spacing: -0.02em;">
                ${p.count || 0}枚
              </div>
            </div>

            <!-- 3. 配布員（右詰め・コンパクト化） -->
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 8px 9px; display: flex; flex-direction: column; justify-content: center; gap: 1px; box-sizing: border-box; overflow: hidden;">
              <div style="font-size: 9.5px; font-weight: 900; color: rgba(255, 255, 255, 0.5); display: flex; align-items: center; gap: 2px;">👤 配布員</div>
              <div style="font-size: 11px; font-weight: 900; color: rgba(255, 255, 255, 0.9); text-align: right; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(p.staffName || '担当者')}
              </div>
            </div>
          </div>
        </div>

        ${(p.isDone && !p.isReadyToSubmit) ? `
          <!-- 【完了確定済み】当月再操作不可ガード (ADR-013) -->
          <div style="background: rgba(234, 95, 8, 0.12); border: 1px solid rgba(234, 95, 8, 0.4); color: #ea5f08; border-radius: 12px; padding: 10px; font-size: 12px; font-weight: 900; width: 100%; box-sizing: border-box; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>🔒</span><span>今月の配布は完了しています<br>（再操作不可）</span>
          </div>
          <div style="width: 100%; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;">
            <button type="button" onclick="closeDetailModal()" class="btn-neu"
              style="width: 100%; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: white; border-radius: 14px; padding: 12px 8px; font-size: 13px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box;">
              閉じる
            </button>
          </div>
        ` : `
          <!-- 【注意文】枠線・背景なしのシンプルなテキスト / キュー状態バッジ -->
          ${p.syncStatus === 'FAILED_PERMANENT' ? `
            <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 10px; padding: 6px 10px; font-size: 11px; font-weight: 700; width: 100%; box-sizing: border-box; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>⚠️</span><span>送信に失敗しました</span>
            </div>
          ` : p.syncStatus === 'RETRY' ? `
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; border-radius: 10px; padding: 6px 10px; font-size: 11px; font-weight: 700; width: 100%; box-sizing: border-box; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>🔄</span><span>送信再試行待ち（バックグラウンドで自動再送されます）</span>
            </div>
          ` : (p.syncStatus === 'submitting' || p.syncStatus === 'PENDING' || p.syncStatus === 'SYNCING') ? `
            <div style="background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; border-radius: 10px; padding: 6px 10px; font-size: 11px; font-weight: 700; width: 100%; box-sizing: border-box; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>⏳</span><span>送信中・キュー待機中（画面を閉じても送信されます）</span>
            </div>
          ` : `
            <div style="color: rgba(245, 158, 11, 0.9); display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 11px; font-weight: 700; width: 100%; box-sizing: border-box; padding: 2px 0;">
              <span>⚠️</span><span>提出すると配布実績として記録されます</span>
            </div>
          `}

          <!-- 【アクションボタン】上: 提出 / 下: キャンセル -->
          <div style="width: 100%; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;">
            ${p.syncStatus === 'FAILED_PERMANENT' ? `
              <button type="button" id="submit-mission-btn" onclick="manualRetrySync(${p.rowId})" class="btn-neu"
                style="width: 100%; background: #dc2626; border: none; color: white; border-radius: 14px; padding: 14px 8px; font-size: 13px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;">
                🔄 もう一度送信する
              </button>
            ` : `
              <button type="button" id="submit-mission-btn" onclick="submitMissionComplete('${escapeHtml(areaName)}', ${p.rowId})" class="btn-neu"
                ${(p.syncStatus === 'submitting' || p.syncStatus === 'PENDING' || p.syncStatus === 'SYNCING' || p.syncStatus === 'RETRY') ? 'disabled style="width: 100%; background: #475569; border: none; color: rgba(255,255,255,0.6); border-radius: 14px; padding: 14px 8px; font-size: 13px; font-weight: 900; cursor: not-allowed; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;"' : 'style="width: 100%; background: #2563eb; border: none; color: white; border-radius: 14px; padding: 14px 8px; font-size: 13px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;"'}>
                ${p.syncStatus === 'RETRY' ? '🔄 再試行待機中...' : (p.syncStatus === 'submitting' || p.syncStatus === 'PENDING' || p.syncStatus === 'SYNCING') ? '⏳ 送信中...' : '🚀 この内容で提出する'}
              </button>
            `}
            <button type="button" id="cancel-mission-btn" onclick="cancelMissionComplete(${p.rowId})"
              ${(p.syncStatus === 'submitting' || p.syncStatus === 'PENDING' || p.syncStatus === 'SYNCING' || p.syncStatus === 'RETRY' || p.syncStatus === 'FAILED_PERMANENT') ? 'disabled style="width: 100%; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.2); border-radius: 14px; padding: 12px 8px; font-size: 13px; font-weight: 900; cursor: not-allowed; display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box;"' : 'style="width: 100%; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.6); border-radius: 14px; padding: 12px 8px; font-size: 13px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box;"'}>
              ✕ キャンセル
            </button>
          </div>
        `}
      `}
    </div>
  `;
}

/**
 * 開いている詳細モーダルを再描画（旧 db.js の accepted 処理副作用を維持）
 * @param {number|string} rowId
 */
function rerenderDetailModalIfOpen(rowId) {
  if (typeof currentPointDetailRowId !== 'undefined' && currentPointDetailRowId === rowId) {
    const mc = $('detail-modal-content');
    if (mc && typeof renderDetailModalContent === 'function' && typeof allPoints !== 'undefined' && Array.isArray(allPoints)) {
      const updatedPoint = allPoints.find(pt => Number(pt.rowId) === Number(rowId));
      if (updatedPoint) {
        mc.innerHTML = renderDetailModalContent(updatedPoint);
      }
    }
  }
}

function renderSettings() {
  const contentEl = $('content');
  if (contentEl) {
    contentEl.classList.remove('is-map-view');
  }

  const userInfo = JSON.parse(localStorage.getItem('user_info'));
  const container = $('settings-content');

  if (!userInfo) {
    // サーチ画面から1.5秒で確実にID画面へ移行する仕様のため、中途半端なスピナーや登録画面等の中間表示は一切行わない
    container.innerHTML = '';
    return;
  }



  // Normal view mode: Show ID card + assigned area shortcut + edit name button
  const displayBranch = window.__districtName || localStorage.getItem('branch_name') || '';

  // Format sync time
  const lastSyncTime = localStorage.getItem('__last_sync_time__') || '--:--';
  const regDate = userInfo.registrationDate || '2025/07/01';

  const staffCardHtml = renderStaffCard(userInfo, {
    districtName: displayBranch,
    lastSyncTime: lastSyncTime,
    registrationDate: regDate
  });

  container.innerHTML = staffCardHtml;
}

// --- Ranking Presentation View ---
const RankingView = (function() {
  function renderLoading(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#2563eb]/40 border-t-[#2563eb] animate-spin"></div>
        <p class="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Loading Leaderboard...</p>
      </div>`;
  }

  function renderEmpty(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255, 255, 255, 0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-3xl">🏆</span>
        <div class="text-sm font-black text-white/80">まだ配布ランキングがありません</div>
        <p class="text-[10px] text-white/40 font-bold leading-relaxed uppercase tracking-wider">
          ポスティング完了が記録されると<br>
          ここにランキングが表示されます
        </p>
      </div>`;
  }

  function renderError(container, errorMessage = '') {
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-2xl">⚠️</span>
        <p class="text-sm font-black text-white/60">ランキングの取得に失敗しました</p>
        <p class="text-[10px] text-white/40 font-mono">${errorMessage ? String(errorMessage).replace(/&/g,'&amp;').replace(/</g,'&lt;') : '通信環境をご確認ください'}</p>
      </div>`;
  }

  function renderSuccess(container, rankingData, mySummary, myStaffId, renderCardFn) {
    if (!container) return;
    const cardFn = (typeof renderCardFn === 'function') ? renderCardFn : (typeof renderRankingCard === 'function' ? renderRankingCard : null);
    const cardHtml = cardFn ? cardFn(rankingData, myStaffId, mySummary) : '';
    container.innerHTML = cardHtml;
  }

  async function initPage(hooks = {}) {
    const {
      rankingModule,
      getMyStaffId = () => '',
      renderCard = (typeof renderRankingCard === 'function' ? renderRankingCard : null)
    } = hooks;

    if (!rankingModule || typeof rankingModule.fetchRanking !== 'function') {
      throw new Error('[RankingView.initPage] rankingModule is required.');
    }

    const container = $('ranking-list');
    if (!container) return;

    const snapshot = rankingModule.getSnapshot();
    const myStaffId = typeof getMyStaffId === 'function' ? getMyStaffId() : '';

    // ① キャッシュ存在時: API通信を待たずに即時同期描画
    if (snapshot.fetched) {
      if (Array.isArray(snapshot.ranking) && snapshot.ranking.length === 0) {
        renderEmpty(container);
      } else if (Array.isArray(snapshot.ranking)) {
        renderSuccess(container, snapshot.ranking, snapshot.mySummary, myStaffId, renderCard);
      } else {
        renderError(container, '応答形式が不正です');
      }
      return;
    }

    // ② 未取得時: Loading UI を表示してデータ取得
    renderLoading(container);

    try {
      const result = await rankingModule.fetchRanking();
      const currentStaffId = typeof getMyStaffId === 'function' ? getMyStaffId() : '';
      if (result && Array.isArray(result.ranking) && result.ranking.length === 0) {
        renderEmpty(container);
      } else if (result && Array.isArray(result.ranking)) {
        renderSuccess(container, result.ranking, result.mySummary, currentStaffId, renderCard);
      } else {
        renderError(container, '応答形式が不正です');
      }
    } catch (err) {
      renderError(container, err ? (err.message || '') : '');
    }
  }

  return {
    initPage,
    renderLoading,
    renderEmpty,
    renderError,
    renderSuccess
  };
})();

// チラシ保管状況の描画処理
function renderStorageList(stocks, fallbackCities = null) {
  const container = $('storage-list-container');
  if (!container) return;

  // テスト用データおよび「自分のデータ（isMe）」を除外（他人の在庫のみ共有表示）
  if (stocks && stocks.length > 0) {
    stocks = stocks.filter(s => {
      const name = s.staffName || '';
      const id = s.staffId ? String(s.staffId).trim() : '';

      // テストデータの除外
      if (name.includes('テスト') || id.toUpperCase().includes('TEST')) return false;

      // 自分のレコードは在庫一覧（共有一覧）から除外（Backend判定済みの isMe フラグを優先）
      if (s.isMe === true) return false;

      return true;
    });
  }

  if (!stocks || stocks.length === 0) {
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-2xl">📦</span>
        <p class="text-sm font-black text-white/60">現在、他の方が保管している<br>チラシはありません</p>
      </div>`;
    return;
  }

  // 保管場所ごとにグループ化
  const groups = {};
  stocks.forEach(s => {
    const loc = s.location || 'その他';
    if (!groups[loc]) groups[loc] = [];
    groups[loc].push(s);
  });

  // fallbackCities の出現順を SSOT として取得
  let masterCities = [];
  if (Array.isArray(fallbackCities) && fallbackCities.length > 0) {
    masterCities = fallbackCities.map(c => typeof c === 'string' ? c : (c.name || ''));
  }

  const sortedLocations = Object.keys(groups).sort((a, b) => {
    const idxA = masterCities.indexOf(a);
    const idxB = masterCities.indexOf(b);
    const orderA = idxA !== -1 ? idxA : 999;
    const orderB = idxB !== -1 ? idxB : 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b); // SSOTに存在しない未知の保管場所のみ五十音順で末尾に配置
  });

  const groupsHtml = sortedLocations.map(loc => {
    const list = groups[loc];

    // 日時の降順（新しい順）にソート
    list.sort((a, b) => {
      const dateA = a.updatedAt || '';
      const dateB = b.updatedAt || '';
      return dateB.localeCompare(dateA);
    });

    const staffCount = list.length;

    const rowsHtml = list.map(s => {
      return `
        <div class="stock-row flex flex-col pt-1 pb-4 border-b border-white/5 last:border-b-0 rounded-xl px-2 -mx-2 gap-2"
          data-storage-id="${(s.id||'').replace(/"/g,'&quot;')}"
          data-name="${(s.staffName||'').replace(/"/g,'&quot;')}"
          data-id="${(s.staffId||'').replace(/"/g,'&quot;')}"
          data-loc="${(s.location||'').replace(/"/g,'&quot;')}"
          data-count="${s.count||0}">

          <!-- 1行目：左詰め（ID） -->
          <div class="w-full text-left">
            <div class="text-sm font-black font-mono text-white truncate">${([s.staffId, s.staffName].filter(Boolean).join(' ')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          </div>

          <!-- 2行目：中央揃え（枚数とLINEボタン） -->
          <div class="flex items-center justify-center w-full py-1" style="gap: 32px;">
            <span class="text-base font-black text-[#22c55e] font-mono">${(s.count || 0).toLocaleString()}枚</span>
            <button type="button"
              ontouchstart="this.style.transform='scale(0.92)'; this.style.opacity='0.7';"
              ontouchend="this.style.transform='scale(1)'; this.style.opacity='1'; event.preventDefault(); var r=this.closest('.stock-row'); if(window.openTransferRequestDialog){window.openTransferRequestDialog(r.dataset.name,r.dataset.id,r.dataset.loc,parseFloat(r.dataset.count)||0,r.dataset.storageId||'');}"
              ontouchcancel="this.style.transform='scale(1)'; this.style.opacity='1';"
              onclick="var r=this.closest('.stock-row'); if(window.openTransferRequestDialog){window.openTransferRequestDialog(r.dataset.name,r.dataset.id,r.dataset.loc,parseFloat(r.dataset.count)||0,r.dataset.storageId||'');}"
              style="background: rgba(6,199,85,0.1); border-color: rgba(6,199,85,0.3); color: #06C755; gap: 6px; transition: transform 0.15s ease, opacity 0.15s ease; touch-action: manipulation;"
              class="flex items-center justify-center px-5 py-2 rounded-full border">
              <span class="text-sm pointer-events-none">🤝</span>
              <span class="text-[10px] font-black tracking-wider pointer-events-none">受渡要請</span>
            </button>
          </div>

          <!-- 3行目：右詰め（更新日時） -->
          <div class="w-full text-right">
            <div class="text-[9px] text-white/40 font-mono truncate">UPDATE: ${(s.updatedAt||'---').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="premium-glass p-6 space-y-2">
        <div class="flex justify-between items-center border-b border-white/10 pb-3">
          <span class="text-base font-black text-white tracking-wider">🏢 ${escapeHtml(loc)}</span>
          <span style="background: rgba(37,99,235,0.1); color: #2563eb;" class="text-[10px] font-black px-2 py-0.5 rounded-full font-mono">${staffCount}名保管</span>
        </div>
        <div class="space-y-1">
          ${rowsHtml}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = groupsHtml;
}

const BulletinView = {
  renderPosts(posts) {
    if (typeof renderBulletinList === 'function') {
      renderBulletinList(posts);
    }
  },
  showLoading() {
    const container = typeof $ === 'function' ? $('bulletin-list-container') : document.getElementById('bulletin-list-container');
    if (!container) return;
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#2563eb]/40 border-t-[#2563eb] animate-spin"></div>
        <p class="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Loading Bulletin...</p>
      </div>`;
  },
  showError(info = {}) {
    const curContainer = typeof $ === 'function' ? $('bulletin-list-container') : document.getElementById('bulletin-list-container');
    if (!curContainer) return;
    const errMsg = info.isTimeout ? "通信がタイムアウトしました" : "データ取得に失敗しました";
    curContainer.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-2xl">⚠️</span>
        <p class="text-sm font-black text-white/60">${errMsg}</p>
        <button type="button" onclick="window.fetchBulletinPosts({ force: true })"
          class="mt-2 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-white/10 hover:bg-white/20 active:scale-95 transition">
          再読み込み
        </button>
      </div>`;
  },

  updateCharCount(textarea) {
    const counter = document.getElementById('bulletin-char-counter');
    if (!counter || !textarea) return;
    const len = textarea.value.length;
    counter.textContent = len + ' / 150';
    if (len >= 150) {
      counter.classList.add('text-red-400');
      counter.classList.remove('text-white/40');
    } else {
      counter.classList.remove('text-red-400');
      counter.classList.add('text-white/40');
    }
  },

  async submitPost(hooks = {}) {
    const inputEl = document.getElementById('bulletin-message-input');
    const btn = document.getElementById('btn-bulletin-submit');
    const counter = document.getElementById('bulletin-char-counter');
    if (!inputEl || !btn) return;

    const msg = inputEl.value;
    if (typeof BulletinModule === 'undefined') {
      alert('BulletinModuleが読み込まれていません。');
      return;
    }

    const valRes = BulletinModule.validateMessage(msg);
    if (!valRes.valid) {
      alert(valRes.message);
      if (valRes.error === 'EMPTY') inputEl.focus();
      return;
    }

    const staffInfo = (typeof hooks.getStaffInfo === 'function') ? hooks.getStaffInfo() : null;
    const staffId = staffInfo && staffInfo.id ? String(staffInfo.id).trim() : '';
    const staffName = staffInfo && staffInfo.name ? String(staffInfo.name).trim() : staffId;

    if (!staffId) {
      alert('配布員IDが取得できませんでした。');
      return;
    }

    const originalText = btn.textContent;
    btn.textContent = '投稿中...';
    btn.disabled = true;

    try {
      await hooks.authorize();
    } catch (authErr) {
      alert("本人確認が完了していないため投稿できません。");
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }

    try {
      const res = await BulletinModule.createPost({
        staffId: staffId,
        staffName: staffName,
        message: valRes.value
      });

      if (res && res.success) {
        inputEl.value = '';
        if (counter) counter.textContent = '0 / 150';
        alert('✓ 投稿が完了しました');
        // 投稿完了後：キャッシュを無視して最新取得を要求（await なし・既存順序維持）
        if (typeof hooks.refreshPosts === 'function') {
          hooks.refreshPosts();
        }
      } else {
        alert('投稿に失敗しました: ' + (res ? res.message : 'Unknown error'));
      }
    } catch (err) {
      alert('通信エラー: ' + err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  },

  openContactDialog(targetStaffId, hooks = {}) {
    const prev = document.getElementById('dynamic-bulletin-contact-dialog');
    if (prev) prev.remove();

    const targetIdStr = String(targetStaffId || '').trim();
    const overlay = document.createElement('div');
    overlay.id = 'dynamic-bulletin-contact-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.85);';

    overlay.innerHTML = `
      <div style="background:#1C1C1E;border-radius:24px;border:1px solid rgba(255,255,255,0.12);padding:28px 20px;width:100%;max-width:340px;box-sizing:border-box;">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:24px;margin-bottom:8px;">💬</div>
          <div style="color:white;font-size:16px;font-weight:900;letter-spacing:0.05em;">連絡</div>
        </div>
        <div style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:700;margin-bottom:20px;line-height:1.5;text-align:left;">
          ${escapeHtml(targetIdStr)}さんとの<br>連絡方法を入力してください。
        </div>

        <div style="margin-bottom:16px;">
          <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡方法】</label>
          <div style="display:flex;gap:16px;align-items:center;padding:4px 0;">
            <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
              <input type="radio" name="bulletin-contact-method" value="LINE" checked style="accent-color:#2563eb;cursor:pointer;"> LINE
            </label>
            <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
              <input type="radio" name="bulletin-contact-method" value="電話" style="accent-color:#2563eb;cursor:pointer;"> 電話
            </label>
            <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
              <input type="radio" name="bulletin-contact-method" value="メール" style="accent-color:#2563eb;cursor:pointer;"> メール
            </label>
          </div>
        </div>

        <div style="margin-bottom:24px;">
          <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡先】</label>
          <input type="text" id="bulletin-contact-value" placeholder="LINE ID"
            style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:12px 14px;color:white;font-size:14px;font-weight:700;outline:none;" />
        </div>

        <div style="display:flex;gap:10px;">
          <button id="btn-bulletin-contact-cancel"
            style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
            onpointerdown="this.style.transform='scale(0.94)'; this.style.opacity='0.7';"
            onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
            onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">キャンセル</button>
          <button id="btn-bulletin-contact-submit" class="btn-neu"
            style="flex:2;background:#2563eb;border:none;color:white;border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
            onpointerdown="this.style.transform='scale(0.96)'; this.style.opacity='0.85';"
            onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
            onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">連絡する</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const contactValueInput = document.getElementById('bulletin-contact-value');
    const methodPlaceholders = {
      'LINE': 'LINE ID',
      '電話': '電話番号',
      'メール': 'メールアドレス'
    };

    document.querySelectorAll('input[name="bulletin-contact-method"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (contactValueInput) {
          contactValueInput.placeholder = methodPlaceholders[e.target.value] || '連絡先を入力';
        }
      });
    });

    document.getElementById('btn-bulletin-contact-cancel').addEventListener('click', () => overlay.remove());

    let isSubmittingContact = false;
    document.getElementById('btn-bulletin-contact-submit').addEventListener('click', async () => {
      if (isSubmittingContact) return;

      const contactValueInput = document.getElementById('bulletin-contact-value');
      const contactValue = contactValueInput ? contactValueInput.value.trim() : '';

      if (!contactValue) {
        alert('連絡先を入力してください。');
        if (contactValueInput) contactValueInput.focus();
        return;
      }

      const methodRadio = document.querySelector('input[name="bulletin-contact-method"]:checked');
      const contactMethod = methodRadio ? methodRadio.value : 'LINE';

      const btn = document.getElementById('btn-bulletin-contact-submit');
      if (btn) { btn.textContent = '連絡中...'; btn.disabled = true; }
      isSubmittingContact = true;

      try {
        await hooks.authorize();
      } catch (authErr) {
        alert("本人確認が完了していないため連絡を送信できません。");
        if (btn) { btn.textContent = '連絡する'; btn.disabled = false; }
        isSubmittingContact = false;
        return;
      }

      const ctx = (typeof hooks.getRequestContext === 'function') ? hooks.getRequestContext() : null;
      const requestUserId = ctx && ctx.requestUserId ? String(ctx.requestUserId).trim() : 'UNKNOWN';
      const requestId = ctx && ctx.requestId ? String(ctx.requestId).trim() : `req_bc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      try {
        const res = await BulletinModule.sendContact({
          requestId: requestId,
          requestUserId: requestUserId,
          targetStaffId: targetIdStr,
          contactMethod: contactMethod,
          contactValue: contactValue
        });

        overlay.remove();
        if (res && (res.status === 'SENT' || res.status === 'SKIPPED_NO_LINE_ID')) {
          alert('✓ 連絡を送信しました');
        } else if (res && res.status === 'UNKNOWN') {
          alert('⚠️ 送信結果を確認できませんでした。\n通信状態をご確認のうえ、二重送信を防ぐためしばらくお待ちください。');
        } else {
          alert('連絡の送信に失敗しました: ' + (res ? res.message : 'Unknown error'));
        }
      } catch(err) {
        alert('通信エラー: ' + err.message);
        isSubmittingContact = false;
        if (btn) { btn.textContent = '連絡する'; btn.disabled = false; }
      }
    });
  },

  closeContactDialog() {
    const d = document.getElementById('dynamic-bulletin-contact-dialog');
    if (d) d.remove();
  }
};

function renderBulletinList(posts) {
  const container = $('bulletin-list-container');
  if (!container) return;

  let displayPosts = Array.isArray(posts) ? posts.slice() : [];
  if (displayPosts.length > 0) {
    displayPosts = displayPosts.filter(p => {
      // 自分の投稿は除外（Backend判定済みの isMe フラグを優先）
      if (p.isMe === true) return false;
      return true;
    });
  }

  if (displayPosts.length === 0) {
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <span class="text-2xl">💬</span>
        <p class="text-sm font-black text-white/60">現在、他の配布員からの<br>投稿はありません</p>
      </div>`;
    return;
  }

  const rowsHtml = displayPosts.map(p => {
    const sId = (p.staffId || '').replace(/"/g, '&quot;');
    const sIdEscaped = escapeHtml(p.staffId || '');
    const sMsgEscaped = escapeHtml(p.message || '');
    const sTimeEscaped = escapeHtml(p.updatedAt || '---');

    return `
      <div class="bulletin-row flex flex-col pt-2 pb-4 border-b border-white/5 last:border-b-0 rounded-xl px-2 -mx-2 gap-2" data-staff-id="${sId}">
        <div class="w-full text-left">
          <div class="text-sm font-black font-mono text-white truncate">${sIdEscaped}</div>
        </div>
        <div class="w-full flex items-start justify-between gap-3 py-1">
          <div class="text-sm text-white/90 whitespace-pre-wrap break-words leading-relaxed flex-1">${sMsgEscaped}</div>
          <button type="button"
            ontouchstart="this.style.transform='scale(0.92)'; this.style.opacity='0.7';"
            ontouchend="this.style.transform='scale(1)'; this.style.opacity='1'; event.preventDefault(); if(window.openBulletinContactDialog){window.openBulletinContactDialog('${sId}');}"
            ontouchcancel="this.style.transform='scale(1)'; this.style.opacity='1';"
            onclick="if(window.openBulletinContactDialog){window.openBulletinContactDialog('${sId}');}"
            style="background: rgba(6,199,85,0.1); border-color: rgba(6,199,85,0.3); color: #06C755; gap: 6px; transition: transform 0.15s ease, opacity 0.15s ease; touch-action: manipulation;"
            class="flex items-center justify-center px-4 py-1.5 rounded-full border shrink-0">
            <span class="text-sm pointer-events-none">🤝</span>
            <span class="text-[10px] font-black tracking-wider pointer-events-none">連絡</span>
          </button>
        </div>
        <div class="w-full text-right">
          <div class="text-[9px] text-white/40 font-mono truncate">UPDATE: ${sTimeEscaped}</div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="premium-glass p-6 space-y-2">
      <div class="flex justify-between items-center border-b border-white/10 pb-3">
        <span class="text-base font-black text-white tracking-wider">💬 配布員タイムライン</span>
        <span style="background: rgba(37,99,235,0.1); color: #2563eb;" class="text-[10px] font-black px-2 py-0.5 rounded-full font-mono">${displayPosts.length}件</span>
      </div>
      <div class="space-y-1">
        ${rowsHtml}
      </div>
    </div>`;
}

window.initMainMap = function() {
  const mapEl = document.getElementById("main-map");
  if (!mapEl || !window.google || !window.google.maps) return;

  // 選挙マスターデータをバックグラウンド先行キャッシュ
  if (typeof fetchElectionData === 'function') {
    fetchElectionData();
  }

  // 既存Mapインスタンスが同一DOM要素にバインド済みの場合はMap生成・Marker生成・Listener登録のすべてをスキップ
  if (window.mainMapInstance && window.mainMapInstance.getDiv() === mapEl) {
    return;
  }

  const hadExistingMapState = !!window.currentMapState?.center;

  window.__initialFitCompleted = hadExistingMapState;
  window.__pendingInitialBounds = null;
  window.__pendingSingleCenter = null;

  window.ensureMainMapInitialFit = function() {
    if (window.__initialFitCompleted || !window.mainMapInstance) return false;
    const el = window.mainMapInstance.getDiv();
    if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;

    if (window.__pendingInitialBounds) {
      window.__initialFitCompleted = true;
      google.maps.event.trigger(window.mainMapInstance, 'resize');
      window.mainMapInstance.fitBounds(window.__pendingInitialBounds);
      return true;
    } else if (window.__pendingSingleCenter) {
      window.__initialFitCompleted = true;
      google.maps.event.trigger(window.mainMapInstance, 'resize');
      window.mainMapInstance.setCenter(window.__pendingSingleCenter);
      window.mainMapInstance.setZoom(13);
      return true;
    }
    return false;
  };

  const appleStyle = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    {
      featureType: "administrative.locality",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }]
    },
    {
      featureType: "poi",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }]
    },
    {
      featureType: "poi.park",
      elementType: "geometry",
      stylers: [{ color: "#263c3f" }]
    },
    {
      featureType: "poi.park",
      elementType: "labels.text.fill",
      stylers: [{ color: "#6b9a76" }]
    },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#38414e" }]
    },
    {
      featureType: "road",
      elementType: "geometry.stroke",
      stylers: [{ color: "#212a37" }]
    },
    {
      featureType: "road",
      elementType: "labels.text.fill",
      stylers: [{ color: "#9ca5b3" }]
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [{ color: "#746855" }]
    },
    {
      featureType: "road.highway",
      elementType: "geometry.stroke",
      stylers: [{ color: "#1f2835" }]
    },
    {
      featureType: "road.highway",
      elementType: "labels.text.fill",
      stylers: [{ color: "#f3d19c" }]
    },
    {
      featureType: "transit",
      elementType: "geometry",
      stylers: [{ color: "#2f3948" }]
    },
    {
      featureType: "transit.station",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }]
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [{ color: "#17263c" }]
    },
    {
      featureType: "water",
      elementType: "labels.text.fill",
      stylers: [{ color: "#515c6d" }]
    },
    {
      featureType: "water",
      elementType: "labels.text.stroke",
      stylers: [{ color: "#17263c" }]
    }
  ];

  // 優先順位: 1. currentMapState?.center, 2. 読み込み済み masterPins から算出, 3. 中立的フォールバック
  let initialCenter = window.currentMapState?.center;
  if (!initialCenter && Array.isArray(window.masterPins) && window.masterPins.length > 0) {
    const firstValid = window.masterPins.find(p => typeof p.latitude === 'number' && typeof p.longitude === 'number' && isFinite(p.latitude) && isFinite(p.longitude));
    if (firstValid) {
      initialCenter = { lat: firstValid.latitude, lng: firstValid.longitude };
    }
  }
  if (!initialCenter) {
    initialCenter = { lat: 36.5, lng: 138.0 }; // 中立的フォールバック
  }

  const map = new google.maps.Map(mapEl, {
    center: initialCenter,
    zoom: window.currentMapState?.zoom || (window.currentMapState?.center ? 11 : 8),
    disableDefaultUI: true,
    zoomControl: false,
    clickableIcons: false,
    styles: appleStyle
  });
  window.mainMapInstance = map;

  map.addListener('idle', () => {
    // 既存Cameraが元々存在した、または初回fitBoundsが完了した後のみ正規Camera状態として保存
    if (hadExistingMapState || window.__initialFitCompleted) {
      window.currentMapState = {
        center: map.getCenter().toJSON(),
        zoom: map.getZoom()
      };
    }
    if (typeof window.fetchGlobalPinStatus === 'function') {
      window.fetchGlobalPinStatus();
    }
  });

  if (!Array.isArray(window.masterMarkers)) {
    window.masterMarkers = [];
  }

  // ── Custom Marker Overlay クラス定義 (H-app専用オーバーレイ) ──
  class CustomMarkerOverlay extends google.maps.OverlayView {
    constructor(position, content, map, onInputClick) {
      super();
      this.position = position;
      this.content = content;
      this.onInputClick = onInputClick;
      this.div = null;
      this.hasPresented = false;
      this.rafId1 = null;
      this.rafId2 = null;
      this.setMap(map);
    }

    onAdd() {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.innerHTML = this.content;
      this.div = div;

      // 「入力操作」ボタンへイベント接続 (インラインonclickの排除)
      const inputButton = div.querySelector('.input-operation-btn');
      if (inputButton && this.onInputClick) {
        inputButton.addEventListener('click', () => {
          this.onInputClick(inputButton);
        });
      }

      // floatPane（InfoWindow と同じ最前面ペイン）に格納し、マーカーのタップ判定より前面でクリックを有効にする
      const panes = this.getPanes();
      google.maps.OverlayView.preventMapHitsAndGesturesFrom(div);
      panes.floatPane.appendChild(div);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const map = this.getMap();
      if (!projection || !map) return;

      const center = map.getCenter();
      if (!center) return;

      const centerPixels = projection.fromLatLngToDivPixel(center);
      const pinPixels = projection.fromLatLngToDivPixel(this.position);

      this.div.style.left = centerPixels.x + 'px';
      this.div.style.top = centerPixels.y + 'px';

      if (!this.hasPresented) {
        this.hasPresented = true;

        const dx = pinPixels.x - centerPixels.x;
        const dy = (pinPixels.y - 20) - centerPixels.y;

        this.div.style.transition = 'none';
        this.div.style.opacity = '0';
        this.div.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.88)`;

        this.rafId1 = requestAnimationFrame(() => {
          this.rafId2 = requestAnimationFrame(() => {
            if (!this.div) return;
            this.div.style.transition = 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out';
            this.div.style.opacity = '1';
            this.div.style.transform = 'translate(-50%, -50%) scale(1)';
          });
        });
      }
    }

    onRemove() {
      if (this.rafId1) {
        cancelAnimationFrame(this.rafId1);
        this.rafId1 = null;
      }
      if (this.rafId2) {
        cancelAnimationFrame(this.rafId2);
        this.rafId2 = null;
      }
      if (this.div) {
        this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
      this.onInputClick = null;
    }
  }

  let activeOverlay = null;
  let activeMarker = null;
  let savedMapOptions = null;

  function lockMapControls() {
    if (map) {
      if (!savedMapOptions) {
        savedMapOptions = {
          gestureHandling: map.get('gestureHandling') || 'greedy',
          zoomControl: map.get('zoomControl') !== false,
          scrollwheel: map.get('scrollwheel') !== false,
          disableDoubleClickZoom: map.get('disableDoubleClickZoom') === true
        };
      }
      map.setOptions({
        gestureHandling: 'none',
        zoomControl: false,
        scrollwheel: false,
        disableDoubleClickZoom: true
      });
    }
    const capsuleEl = document.getElementById('map-area-selector-capsule');
    const citySelectEl = document.getElementById('map-city-select');
    const townSelectEl = document.getElementById('map-town-select');
    if (capsuleEl) capsuleEl.classList.add('is-locked');
    if (citySelectEl) citySelectEl.disabled = true;
    if (townSelectEl) townSelectEl.disabled = true;
  }

  function unlockMapControls() {
    if (map && savedMapOptions) {
      map.setOptions({
        gestureHandling: savedMapOptions.gestureHandling,
        zoomControl: savedMapOptions.zoomControl,
        scrollwheel: savedMapOptions.scrollwheel,
        disableDoubleClickZoom: savedMapOptions.disableDoubleClickZoom
      });
      savedMapOptions = null;
    }
    const capsuleEl = document.getElementById('map-area-selector-capsule');
    const citySelectEl = document.getElementById('map-city-select');
    const townSelectEl = document.getElementById('map-town-select');
    const townTextEl = document.getElementById('map-town-select-text');
    if (capsuleEl) capsuleEl.classList.remove('is-locked');
    if (citySelectEl) citySelectEl.disabled = false;
    if (townSelectEl) {
      townSelectEl.value = '';
      townSelectEl.disabled = !(citySelectEl && citySelectEl.value);
    }
    if (townTextEl) {
      townTextEl.textContent = '🏘 町名を選択';
    }
  }

  const revertActiveMarkerColor = () => {
    if (activeMarker) {
      const isCompleted = PinStatusModule.isCompleted(activeMarker.rowId);
      const isRemoteView = !!activeMarker.isRemoteView;
      const prevIcon = activeMarker.getIcon();

      if (prevIcon) {
        let restoredColor = "#22c55e";
        if (isCompleted) {
          restoredColor = "#EA5F08";
        } else if (isRemoteView) {
          restoredColor = "#00B7FF";
        }
        activeMarker.setIcon({
          ...prevIcon,
          fillColor: restoredColor
        });
      }

      // Phase 4-B: 自端末で追加していた場合のみ IN_PROGRESS を remove
      if (!isCompleted && !isRemoteView && typeof window.setPinInProgress === 'function') {
        window.setPinInProgress(activeMarker.rowId, "remove");
      }

      unlockMapControls();
      activeMarker = null;
    }
  };

  window.refreshMainMapPins = function() {
    if (!window.masterMarkers) return;
    window.masterMarkers.forEach(marker => {
      const isCompleted = PinStatusModule.isCompleted(marker.rowId);
      const isInProgress = PinStatusModule.isInProgress(marker.rowId);
      const isMine = activeMarker && activeMarker.rowId === marker.rowId;

      const currentIcon = marker.getIcon();
      if (currentIcon) {
        let targetColor = "#22c55e";
        if (isCompleted) {
          targetColor = "#EA5F08";
        } else if (isInProgress || isMine) {
          targetColor = "#00B7FF";
        }

        if (currentIcon.fillColor !== targetColor) {
          marker.setIcon({
            ...currentIcon,
            fillColor: targetColor
          });
        }
      }
    });
  };

  // カスタム「×」ボタンから呼び出す退場用関数
  window.closeCustomInfoWindow = function() {
    if (activeOverlay) {
      activeOverlay.setMap(null);
      activeOverlay = null;
    }
    const hadMarker = (typeof activeMarker !== 'undefined' && activeMarker !== null);
    revertActiveMarkerColor();
    return hadMarker;
  };

  // E2Eテスト用および下位互換性スタブ
  window.infoWindowInstance = {
    close: () => window.closeCustomInfoWindow()
  };

  window.lockActivePinAndBubble = function(rowId) {
    if (activeMarker && activeMarker.rowId === rowId) {
      const currentIcon = activeMarker.getIcon();
      if (currentIcon) {
        activeMarker.setIcon({ ...currentIcon, fillColor: "#EA5F08" });
      }
    }
    if (activeOverlay && activeOverlay.rowId === rowId) {
      activeOverlay.div.innerHTML = `
        <div class="custom-iw-wrapper">
          <div class="custom-iw-close-btn" onclick="closeCustomInfoWindow()">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </div>
          <div style="font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.4); margin-bottom: 2px; text-align: center;">
            ${activeOverlay.cityName || ''}
          </div>
          <div style="font-size: 20px; font-weight: 900; line-height: 1.2; text-align: center; margin-bottom: 12px;">
            ${activeOverlay.townName || ''}
          </div>
          ${activeOverlay.statsBlockHtml || ''}
          <div style="background: rgba(234, 95, 8, 0.2); border: 1px solid rgba(234, 95, 8, 0.5); border-radius: 4px; padding: 4px 8px; text-align: center; color: #EA5F08; font-weight: bold; font-size: 13px;">
            配布済み 🔒
          </div>
        </div>
      `;
    }
  };

  const PIN_SVG_PATH = "M 12 2 C 8.13 2 5 5.13 5 9 C 5 14.25 12 22 12 22 C 12 22 19 14.25 19 9 C 19 5.13 15.87 2 12 2 Z";

  const getPinScale = (zoom) => {
    if (zoom <= 11) return 0.55;
    if (zoom === 12) return 0.70;
    if (zoom === 13) return 0.85;
    return 1.05;
  };

  let _mapSelectorTownsByCity = {};

  function populateMapTownSelect(selectedCity) {
    const townSelectEl = document.getElementById('map-town-select');
    const townTextEl = document.getElementById('map-town-select-text');
    const capsuleEl = document.getElementById('map-area-selector-capsule');
    if (!townSelectEl) return;

    townSelectEl.innerHTML = '';
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = '町名を選択';
    townSelectEl.appendChild(placeholderOpt);

    const towns = selectedCity && Array.isArray(_mapSelectorTownsByCity[selectedCity])
      ? _mapSelectorTownsByCity[selectedCity]
      : [];

    towns.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.rowId;
      opt.textContent = item.label;
      townSelectEl.appendChild(opt);
    });

    townSelectEl.value = '';
    if (townTextEl) {
      townTextEl.textContent = '🏘 町名を選択';
    }
    const isCapsuleLocked = !!(capsuleEl && capsuleEl.classList.contains('is-locked'));
    townSelectEl.disabled = isCapsuleLocked || towns.length === 0;
  }

  function initMapAreaSelector(pins) {
    if (!Array.isArray(pins) || pins.length === 0) return;
    const citySelectEl = document.getElementById('map-city-select');
    const townSelectEl = document.getElementById('map-town-select');
    const cityTextEl = document.getElementById('map-city-select-text');
    const capsuleEl = document.getElementById('map-area-selector-capsule');
    if (!citySelectEl || !townSelectEl) return;

    const cityList = [];
    const rawByCity = {};

    pins.forEach(row => {
      if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return;
      const cityName = String(row.city_name || '').trim();
      const townName = String(row.town_name || '').trim();
      if (!cityName || !townName) return;
      if (!rawByCity[cityName]) {
        rawByCity[cityName] = [];
        cityList.push(cityName);
      }
      rawByCity[cityName].push({
        rowId: String(row.rowId),
        townName: townName
      });
    });

    const nextTownsByCity = {};
    cityList.forEach(cityName => {
      const rows = rawByCity[cityName] || [];
      const counts = {};
      rows.forEach(r => {
        counts[r.townName] = (counts[r.townName] || 0) + 1;
      });
      const seq = {};
      nextTownsByCity[cityName] = rows.map(r => {
        if (counts[r.townName] > 1) {
          seq[r.townName] = (seq[r.townName] || 0) + 1;
          return {
            rowId: r.rowId,
            label: `${r.townName} (${seq[r.townName]})`
          };
        }
        return {
          rowId: r.rowId,
          label: r.townName
        };
      });
    });
    _mapSelectorTownsByCity = nextTownsByCity;

    const prevCity = citySelectEl.value;
    citySelectEl.innerHTML = '';
    const cityPlaceholder = document.createElement('option');
    cityPlaceholder.value = '';
    cityPlaceholder.textContent = '市名を選択';
    citySelectEl.appendChild(cityPlaceholder);

    cityList.forEach(cityName => {
      const opt = document.createElement('option');
      opt.value = cityName;
      opt.textContent = cityName;
      citySelectEl.appendChild(opt);
    });

    const restoredCity = prevCity && cityList.includes(prevCity) ? prevCity : '';
    citySelectEl.value = restoredCity;
    if (cityTextEl) {
      cityTextEl.textContent = restoredCity ? `📍 ${restoredCity}` : '📍 市名を選択';
    }
    const isCapsuleLocked = !!(capsuleEl && capsuleEl.classList.contains('is-locked'));
    citySelectEl.disabled = isCapsuleLocked;

    populateMapTownSelect(restoredCity);

    if (!citySelectEl.dataset.listenerBound) {
      citySelectEl.dataset.listenerBound = 'true';
      citySelectEl.addEventListener('change', function() {
        const selectedCity = this.value || '';
        const labelEl = document.getElementById('map-city-select-text');
        if (labelEl) {
          labelEl.textContent = selectedCity ? `📍 ${selectedCity}` : '📍 市名を選択';
        }
        populateMapTownSelect(selectedCity);
      });
    }

    if (!townSelectEl.dataset.listenerBound) {
      townSelectEl.dataset.listenerBound = 'true';
      townSelectEl.addEventListener('change', function() {
        const selectedRowId = this.value || '';
        const labelEl = document.getElementById('map-town-select-text');
        if (!selectedRowId) {
          if (labelEl) labelEl.textContent = '🏘 町名を選択';
          return;
        }
        const selectedOpt = this.options && this.selectedIndex >= 0 ? this.options[this.selectedIndex] : null;
        if (labelEl) {
          labelEl.textContent = selectedOpt && selectedOpt.textContent
            ? `🏘 ${selectedOpt.textContent}`
            : '🏘 町名を選択';
        }
        const markers = typeof masterMarkers !== 'undefined' && Array.isArray(masterMarkers) ? masterMarkers : [];
        const targetMarker = markers.find(m => m && String(m.rowId) === String(selectedRowId));
        if (targetMarker && typeof google !== 'undefined' && google.maps && google.maps.event) {
          google.maps.event.trigger(targetMarker, 'click');
        }
      });
    }
  }

  // 初回のみ Marker 生成を実行（2回目以降は既存Markerを保持・再利用、二重生成防止）
  const renderMasterMarkers = async () => {
    if (typeof masterPins !== 'undefined' && Array.isArray(masterPins) && masterPins.length > 0) {
      initMapAreaSelector(masterPins);
    }
    if (window.masterMarkers.length > 0) return;

    let pins = [];
    if (window.AddressMasterService && typeof window.AddressMasterService.getInstance === 'function') {
      try {
        pins = await window.AddressMasterService.getInstance().getAll();
      } catch (err) {
        console.warn("[initMainMap] AddressMasterService.getAll failed:", err);
      }
    }

    if (!Array.isArray(pins) || pins.length === 0) return;
    initMapAreaSelector(pins);
    if (window.masterMarkers.length > 0) return;

    window.masterPins = pins;

    // 初回表示時（Map生成前にCamera状態が未保存だった場合）、pins のバウンディングボックスまたは先頭ピンを登録
    if (!hadExistingMapState && pins.length > 0) {
      const validCoords = pins.filter(p => typeof p.latitude === 'number' && typeof p.longitude === 'number' && isFinite(p.latitude) && isFinite(p.longitude));
      if (validCoords.length === 1) {
        window.__pendingSingleCenter = { lat: validCoords[0].latitude, lng: validCoords[0].longitude };
      } else if (validCoords.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        validCoords.forEach(p => bounds.extend({ lat: p.latitude, lng: p.longitude }));
        window.__pendingInitialBounds = bounds;
      }
      if (typeof window.ensureMainMapInitialFit === 'function') {
        window.ensureMainMapInitialFit();
      }
    }

    pins.forEach(row => {
      if (typeof row.latitude === 'number' && typeof row.longitude === 'number') {
        const marker = new google.maps.Marker({
          map: map,
          position: { lat: row.latitude, lng: row.longitude },
          icon: {
            path: PIN_SVG_PATH,
            scale: getPinScale(map.getZoom()),
            fillColor: "#22c55e",
            fillOpacity: 0.9,
            strokeWeight: 1,
            strokeColor: "#ffffff",
            anchor: new google.maps.Point(12, 22)
          }
        });
        marker.rowId = row.rowId;

        marker.addListener('click', async () => {
          // 先頭ガード：既にPopupが開いていれば他ピンの新規タップを完全に無視
          if (activeOverlay || activeMarker) {
            return;
          }

          if (!cachedElectionData && typeof fetchElectionData === 'function') {
            await fetchElectionData();
          }

          const cleanTown = (row.town_name || '').replace(/^大字/, '');
          const mapQuery = encodeURIComponent(`${row.city_name} ${cleanTown}`);
          const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;

          const formatNumber = (val) => {
            if (val === null || val === undefined || val === '') return '—';
            const num = Number(val);
            return isNaN(num) ? '—' : num.toLocaleString();
          };

          const householdsStr = formatNumber(row.households) !== '—' ? `${formatNumber(row.households)} 世帯` : '—';
          const populationStr = formatNumber(row.population) !== '—' ? `${formatNumber(row.population)} 人` : '—';

          const latestElection = getLatestElection(cachedElectionData);
          const cityName = row.city_name || '';
          let turnoutVal = '—';
          if (latestElection && latestElection.municipalities && cityName && latestElection.municipalities[cityName] !== undefined && latestElection.municipalities[cityName] !== null && latestElection.municipalities[cityName] !== '') {
            turnoutVal = `${latestElection.municipalities[cityName]}%`;
          }
          const turnoutLabel = `${cityName ? cityName : '市'} 前回投票率`;

          const statsBlockHtml = `
            <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 8px 10px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="flex: 1; text-align: center; border-right: 1px solid rgba(255, 255, 255, 0.08);">
                  <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); font-weight: 600;">世帯数</div>
                  <div style="font-size: 13px; font-weight: 800; color: #ffffff; margin-top: 1px;">${householdsStr}</div>
                </div>
                <div style="flex: 1; text-align: center;">
                  <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); font-weight: 600;">人口</div>
                  <div style="font-size: 13px; font-weight: 800; color: #ffffff; margin-top: 1px;">${populationStr}</div>
                </div>
              </div>
              <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 5px; display: flex; justify-content: space-between; align-items: center; padding-left: 4px; padding-right: 4px;">
                <span style="font-size: 10px; color: rgba(255, 255, 255, 0.5); font-weight: 600;">${turnoutLabel}</span>
                <span style="font-size: 12px; font-weight: 800; color: #38bdf8;">${turnoutVal}</span>
              </div>
            </div>
          `;

          const createContent = (isCompleted, isRemoteInProgress) => {
            let bottomUI = '';

            if (isCompleted) {
              bottomUI = `
                <div class="premium-glass-badge badge-completed">
                  配布済み 🔒
                </div>
              `;
            } else if (isRemoteInProgress) {
              bottomUI = `
                <div class="premium-glass-badge badge-in-progress">
                  配布中 🔵
                </div>
              `;
            } else {
              bottomUI = `
                <div style="display: flex; gap: 8px; width: 100%;">
                  <a href="${googleMapsUrl}" target="_blank" class="premium-glass-btn btn-maps" style="flex: 1;">
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
                      <line x1="9" y1="3" x2="9" y2="18"></line>
                      <line x1="15" y1="6" x2="15" y2="21"></line>
                    </svg>
                    <span>詳細地図</span>
                  </a>
                  <button class="premium-glass-btn btn-input input-operation-btn" style="flex: 1;">
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    <span>配布開始</span>
                  </button>
                </div>
              `;
            }

            return `
              <div class="custom-iw-wrapper">
                <div class="custom-iw-close-btn" onclick="closeCustomInfoWindow()">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </div>
                <div style="font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.4); margin-bottom: 2px; text-align: center;">
                  ${row.city_name}
                </div>
                <div style="font-size: 20px; font-weight: 900; line-height: 1.2; text-align: center; margin-bottom: 12px;">
                  ${cleanTown}
                </div>
                ${statsBlockHtml}
                ${bottomUI}
              </div>
            `;
          };

          const executeOpen = () => {
            // 先頭ガード：既にPopupが開いていれば他ピンの新規タップを完全に無視
            if (activeOverlay || activeMarker) {
              return;
            }

            const isCompleted = PinStatusModule.isCompleted(row.rowId);
            const isRemoteInProgress = PinStatusModule.isInProgress(row.rowId);
            const isLocked = isCompleted || isRemoteInProgress;

            // タップされたPINのアイコン色変更 (自端末選択表示のため青へ変更 / PinStatus追加なし)
            const currentIcon = marker.getIcon();
            if (currentIcon) {
              let targetColor = "#00B7FF";
              if (isCompleted) {
                targetColor = "#EA5F08";
              } else if (isRemoteInProgress) {
                targetColor = "#00B7FF";
              }
              marker.setIcon({
                ...currentIcon,
                fillColor: targetColor
              });
            }

            marker.isRemoteView = isRemoteInProgress;

            // Phase 4-B: 未完了かつ他端末作業中でない自端末の新規選択時のみ IN_PROGRESS を add
            if (!isCompleted && !isRemoteInProgress && typeof window.setPinInProgress === 'function') {
               window.setPinInProgress(row.rowId, "add");
            }
            activeMarker = marker;

            // MAP操作可逆ロック
            lockMapControls();

            const showOverlay = () => {
              // 重複表示防止のガード：表示前に再度クリアする
              if (activeOverlay) {
                activeOverlay.setMap(null);
                activeOverlay = null;
              }
              let isStarted = false;
              activeOverlay = new CustomMarkerOverlay(marker.getPosition(), createContent(isCompleted, isRemoteInProgress), map, (buttonEl) => {
                if (isLocked) return;

                if (!isStarted) {
                  isStarted = true;
                  const span = buttonEl ? buttonEl.querySelector('span') : null;
                  if (span) {
                    span.textContent = '入力操作';
                  } else if (buttonEl) {
                    buttonEl.textContent = '入力操作';
                  }
                  return;
                }

                openPointDetailModal(row.rowId);
              });
              activeOverlay.rowId = row.rowId;
              activeOverlay.cityName = row.city_name;
              activeOverlay.townName = cleanTown;
              activeOverlay.statsBlockHtml = statsBlockHtml;
            };

            // スクリュー移動が必要かどうかの判定（すでに中心付近にある場合は即表示）
            const center = map.getCenter();
            const pos = marker.getPosition();

            // 投影法を用いてカメラの中心位置を22px上にずらし、PINが画面中央より22px下に下がるようにする
            const scale = Math.pow(2, map.getZoom());
            const projection = map.getProjection();
            let targetPos = pos;
            if (projection) {
              const projPoint = projection.fromLatLngToPoint(pos);
              const offsetPoint = new google.maps.Point(
                projPoint.x,
                projPoint.y - (22 / scale) // 22px分カメラを北へずらす（Y座標を引き算）
              );
              targetPos = projection.fromPointToLatLng(offsetPoint);
            }

            const threshold = 0.00002; // スクロール判定のしきい値
            const isAlreadyCentered = Math.abs(center.lat() - targetPos.lat()) < threshold &&
                                      Math.abs(center.lng() - targetPos.lng()) < threshold;

            if (isAlreadyCentered) {
              showOverlay();
            } else {
              // 移動完了（idle）イベントを一度だけ購読し、スクロール完了後に表示
              google.maps.event.addListenerOnce(map, 'idle', showOverlay);
              map.panTo(targetPos);
            }
          };

          executeOpen();
        });

        window.masterMarkers.push(marker);
      }
    });

    initMapAreaSelector(pins);

    if (typeof window.refreshMainMapPins === 'function') {
      window.refreshMainMapPins();
    }
  };

  renderMasterMarkers();

  let zoomFrameId = null;
  let currentAppliedScale = getPinScale(map.getZoom());

  // 初回生成時に zoom_changed リスナーを1回だけ登録（重複登録防止）
  map.addListener('zoom_changed', () => {
    if (zoomFrameId) cancelAnimationFrame(zoomFrameId);
    zoomFrameId = requestAnimationFrame(() => {
      const currentZoom = map.getZoom();
      const newScale = getPinScale(currentZoom);
      if (newScale !== currentAppliedScale && window.masterMarkers) {
        currentAppliedScale = newScale;
        window.masterMarkers.forEach(m => {
          const icon = m.getIcon();
          if (icon && icon.scale !== newScale) {
            m.setIcon({ ...icon, scale: newScale });
          }
        });
      }
    });
  });
};

// =============================
// TransferView (Flyer Transfer Request Presentation Component)
// =============================
const TransferView = (function() {
  const methodPlaceholders = {
    'LINE': 'LINE ID',
    '電話': '電話番号',
    'メール': 'メールアドレス'
  };

  function openDialog(options) {
    const { displayStorageId, onCancel, onSubmit } = options;

    closeDialog();

    const overlay = document.createElement('div');
    overlay.id = 'dynamic-transfer-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.85);';

    const safeStorageId = (typeof escapeHtml === 'function')
      ? escapeHtml(displayStorageId)
      : String(displayStorageId || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    overlay.innerHTML = `
      <div style="background:#1C1C1E;border-radius:24px;border:1px solid rgba(255,255,255,0.12);padding:28px 20px;width:100%;max-width:340px;box-sizing:border-box;">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:24px;margin-bottom:8px;">📦</div>
          <div style="color:white;font-size:16px;font-weight:900;letter-spacing:0.05em;">受渡要請</div>
        </div>
        <div style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:700;margin-bottom:20px;line-height:1.5;text-align:left;">
          ${safeStorageId}さんとの<br>連絡方法を入力してください。
        </div>

        <div style="margin-bottom:16px;">
          <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡方法】</label>
          <div style="display:flex;gap:16px;align-items:center;padding:4px 0;">
            <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
              <input type="radio" name="contact-method" value="LINE" checked style="accent-color:#2563eb;cursor:pointer;"> LINE
            </label>
            <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
              <input type="radio" name="contact-method" value="電話" style="accent-color:#2563eb;cursor:pointer;"> 電話
            </label>
            <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
              <input type="radio" name="contact-method" value="メール" style="accent-color:#2563eb;cursor:pointer;"> メール
            </label>
          </div>
        </div>

        <div style="margin-bottom:24px;">
          <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡先】</label>
          <input type="text" id="transfer-contact-value" placeholder="LINE ID"
            style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:12px 14px;color:white;font-size:14px;font-weight:700;outline:none;" />
        </div>

        <div style="display:flex;gap:10px;">
          <button id="dyn-cancel"
            style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
            onpointerdown="this.style.transform='scale(0.94)'; this.style.opacity='0.7';"
            onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
            onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">キャンセル</button>
          <button id="dyn-submit" class="btn-neu"
            style="flex:2;background:#2563eb;border:none;color:white;border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
            onpointerdown="this.style.transform='scale(0.96)'; this.style.opacity='0.85';"
            onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
            onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">受渡要請を送る</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const contactValueInput = document.getElementById('transfer-contact-value');

    overlay.querySelectorAll('input[name="contact-method"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (contactValueInput) {
          contactValueInput.placeholder = methodPlaceholders[e.target.value] || '連絡先を入力';
        }
      });
    });

    const cancelBtn = document.getElementById('dyn-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        closeDialog();
        if (typeof onCancel === 'function') onCancel();
      });
    }

    const submitBtn = document.getElementById('dyn-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const contactVal = contactValueInput ? contactValueInput.value.trim() : '';
        const methodRadio = overlay.querySelector('input[name="contact-method"]:checked');
        const contactMethod = methodRadio ? methodRadio.value : 'LINE';

        if (typeof onSubmit === 'function') {
          await onSubmit({ contactMethod, contactValue: contactVal });
        }
      });
    }

    return overlay;
  }

  function closeDialog() {
    const prev = document.getElementById('dynamic-transfer-dialog');
    if (prev) {
      prev.remove();
      return true;
    }
    return false;
  }

  function setSubmittingState(isSubmitting) {
    const btn = document.getElementById('dyn-submit');
    if (!btn) return;
    if (isSubmitting) {
      btn.textContent = '送信中...';
      btn.disabled = true;
    } else {
      btn.textContent = '受渡要請を送る';
      btn.disabled = false;
    }
  }

  function focusContactInput() {
    const input = document.getElementById('transfer-contact-value');
    if (input) input.focus();
  }

  return {
    openDialog,
    closeDialog,
    setSubmittingState,
    focusContactInput
  };
})();

// --- Numpad Presentation View ---
const NumpadView = (function() {
  let context = null;

  function $(id) {
    return document.getElementById(id);
  }

  function getElements() {
    const display = $('numpad-display');
    const modal = $('numpad-modal');
    const content = modal ? modal.firstElementChild : null;
    return { display, modal, content };
  }

  function open({ areaName, rowId, initialCount = 0, isDoneToggle = false, checkbox = null, onConfirm = null, onCancel = null }) {
    context = {
      areaName,
      rowId,
      isDoneToggle,
      checkbox,
      currentVal: initialCount ? String(initialCount) : '0',
      onConfirm,
      onCancel
    };

    const { display, modal, content } = getElements();
    if (display) display.textContent = context.currentVal;
    if (modal) modal.classList.remove('pointer-events-none', 'opacity-0');
    if (content) content.classList.remove('translate-y-full');
  }

  function hide() {
    // 確定後の非表示: セッションを破棄せず画面のみ閉じる
    const { modal, content } = getElements();
    if (modal) modal.classList.add('opacity-0', 'pointer-events-none');
    if (content) content.classList.add('translate-y-full');
  }

  function close() {
    // ユーザー明示的キャンセル / 閉じる操作
    if (!context) return;
    const ctx = context;
    if (ctx.isDoneToggle && ctx.checkbox) {
      ctx.checkbox.checked = false;
    }
    const { modal, content } = getElements();
    if (modal) modal.classList.add('opacity-0', 'pointer-events-none');
    if (content) content.classList.add('translate-y-full');

    context = null;
    if (typeof ctx.onCancel === 'function') {
      ctx.onCancel();
    }
  }

  function pressKey(key) {
    if (!context) return null;

    if (key === 'C') {
      context.currentVal = '0';
    } else if (key === 'OK') {
      const valNum = parseFloat(context.currentVal) || 0;
      const { areaName, rowId, onConfirm } = context;
      if (context.isDoneToggle) {
        context.isDoneToggle = false;
      }
      if (typeof onConfirm === 'function') {
        onConfirm({ valNum, areaName, rowId });
      }
      return { action: 'confirm', valNum, areaName, rowId };
    } else {
      if (context.currentVal === '0') {
        context.currentVal = String(key);
      } else {
        if (context.currentVal.length < 5) {
          context.currentVal += String(key);
        }
      }
    }

    const { display } = getElements();
    if (display) display.textContent = context.currentVal;
    return { action: 'update', currentVal: context.currentVal };
  }

  function getContext() {
    return context;
  }

  function isOpen() {
    const { modal } = getElements();
    return !!(modal && !modal.classList.contains('pointer-events-none'));
  }

  return {
    open,
    hide,
    close,
    pressKey,
    getContext,
    isOpen
  };
})();


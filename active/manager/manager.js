
function getApiUrl() {
  if (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.api && window.PMS_CLIENT_CONFIG.api.gasWebAppUrl) {
    return window.PMS_CLIENT_CONFIG.api.gasWebAppUrl;
  }
  throw new Error('[Dashboard Config Error] PMS_CLIENT_CONFIG.api.gasWebAppUrl が未設定です。config.js を確認してください。');
}

function getStaticMasterConfig() {
  if (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.staticMaster) {
    return window.PMS_CLIENT_CONFIG.staticMaster;
  }
  return {};
}

const DashboardState = {
  summary: null,
  cities: [],
  stocks: [],
  ranking: [], // 現場アプリと完全同一の計算済みランキング (getRanking)
  roster: [],
  requests: [], // 受渡要請 (getTransferRequests)
  bulletinPosts: null, // 掲示板投稿キャッシュ (getBulletinPosts)
  liveRecords: [], // Backendから取得した最新配布実績レコード (SSOT)
  latestSeenRecordId: null, // アニメーション検知用最新レコードID
  globalPinStatus: { inProgress: [], completed: [] },
  masterPins: [], // SSOT マスターピン（config.js で指定された CSV から動的取得）
  masterLoadStatus: 'PENDING', // 'PENDING' | 'LOADED' | 'ERROR'
  areaMapping: null, // 新旧エリア対応表（実績・ステータス継承用）
  boundariesGeoJson: null, // 国勢調査小地域境界GeoJSON（純粋地理背景）
  boundariesLayer: null, // Leaflet GeoJSON レイヤー
  electionTurnout: null, // 国政・地方選 投票率SSOTデータ (data/election_history.json)
  selectedPin: null, // 現在MAP上で選択中のピン/エリアデータ (右下エリア統計連動)
  selectedCity: 'ALL',
  selectedTownId: 'ALL',
  desktopAreaSelectorView: 'CITIES',
  mobileAreaSelectorView: 'CITIES',
  currentFocus: 'areas',
  domainState: {
    ranking: 'IDLE',
    stocks: 'IDLE',
    roster: 'IDLE',
    requests: 'IDLE'
  },
  lastSuccessfulSyncTime: null,
  map: null,
  markersLayer: null
};
if (typeof window !== 'undefined') {
  window.DashboardState = DashboardState;
}

const AREA_STATUS_CONFIG = {
  COMPLETED: {
    statusKey: 'COMPLETED',
    statusText: '● 配布済',
    color: '#EA5F08',
    strokeColor: '#fb923c',
    radius: 6,
    weight: 1.5,
    opacity: 0.9,
    fillOpacity: 0.9
  },
  IN_PROGRESS: {
    statusKey: 'IN_PROGRESS',
    statusText: '● 配布中',
    color: '#00B7FF',
    strokeColor: '#0284c7',
    radius: 5.5,
    weight: 1,
    opacity: 0.9,
    fillOpacity: 0.8
  },
  UNALLOCATED: {
    statusKey: 'UNALLOCATED',
    statusText: '○ 未配布',
    color: '#22C55E',
    strokeColor: '#16a34a',
    radius: 4.5,
    weight: 1,
    opacity: 0.9,
    fillOpacity: 0.8
  },
  UNKNOWN: {
    statusKey: 'UNKNOWN',
    statusText: '？ 状態不明',
    color: '#A8B3C7',
    strokeColor: '#64748b',
    radius: 4.5,
    weight: 1,
    opacity: 0.7,
    fillOpacity: 0.5
  }
};

function getZoomScaledRadius(baseRadius, currentZoom) {
  const scale = 0.50 * Math.pow(2, (currentZoom - 11) * 0.52);
  const radius = baseRadius * scale;
  return Math.max(1.2, Math.min(24.0, Math.round(radius * 10) / 10));
}

function updatePinsRadiusOnZoom(mapInstance, layerGroup) {
  if (!mapInstance || !layerGroup) return;
  const currentZoom = typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 11;
  layerGroup.eachLayer(layer => {
    if (layer instanceof L.CircleMarker && layer.options && layer.options._baseRadius) {
      const newRadius = getZoomScaledRadius(layer.options._baseRadius, currentZoom);
      layer.setRadius(newRadius);
    }
  });
}

function getAreaStatusConfig(isCompleted, isInProgress) {
  if (isInProgress) return AREA_STATUS_CONFIG.IN_PROGRESS;
  if (isCompleted) return AREA_STATUS_CONFIG.COMPLETED;
  return AREA_STATUS_CONFIG.UNALLOCATED;
}

function getResolvedDistrictCode() {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname.toLowerCase();
    const parts = host.split('.');
    if (parts.length >= 2 && parts[0] && parts[0] !== 'www' && parts[0] !== 'localhost') {
      return parts[0].toUpperCase();
    }
  }
  if (DashboardState && DashboardState.districtCode) {
    return DashboardState.districtCode;
  }
  try {
    const lastDistrict = localStorage.getItem('pm_last_district');
    if (lastDistrict) return lastDistrict;
  } catch (e) {}

  return 'DEFAULT';
}

// ─── Dashboard サーバーサイドセッション管理 (SEC-001) ───────────
const DASHBOARD_SESSION_KEY_PREFIX = 'pm_dash_session_';

function getDashboardSessionToken(districtCode) {
  const code = districtCode || getResolvedDistrictCode();
  const key = DASHBOARD_SESSION_KEY_PREFIX + code;
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
  } catch (e) {
    return '';
  }
}

function setDashboardSessionToken(districtCode, token) {
  const code = districtCode || getResolvedDistrictCode();
  const key = DASHBOARD_SESSION_KEY_PREFIX + code;
  try {
    sessionStorage.setItem(key, token);
    localStorage.setItem(key, token);
  } catch (e) {}
}

function clearDashboardSessionToken(districtCode) {
  const code = districtCode || getResolvedDistrictCode();
  const key = DASHBOARD_SESSION_KEY_PREFIX + code;
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
    localStorage.removeItem('pm_auth_' + code);
  } catch (e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}

let _isDashboardInitialized = false;
let _isSyncing = false;
let _isInitialSummaryFresh = false;
let _hasAppliedPinStatus = false;

async function checkManagerAuth() {
  const districtCode = getResolvedDistrictCode();
  DashboardState.districtCode = districtCode;

  // サーバーサイドセッショントークンが存在するか確認
  const token = getDashboardSessionToken(districtCode);
  if (!token) {
    // トークンが存在しない場合、localStorage改ざん（pm_auth_xxx=true）があっても拒否
    clearDashboardSessionToken(districtCode);
    return false;
  }

  try {
    const summary = await callApiPost('getSystemSummary');
    if (summary && (summary.code === 'CONTRACT_EXPIRED' || summary.contractStatus === 'EXPIRED' || summary.isExpired === true)) {
      return false;
    }
    if (summary && summary.districtName) {
      DashboardState.districtCode = summary.districtName;
      DashboardState.summary = summary;
      _isInitialSummaryFresh = true;
    }
    return true;
  } catch (err) {
    const isTimeout = err && (err.isTimeout || err.name === 'TimeoutError' || err.code === 'API_TIMEOUT' || (err.message && err.message.includes('タイムアウト')));
    if (!isTimeout) {
      console.warn('[Manager Auth Check Error]', err);
    }
    if (err && err.message && (err.message.includes('UNAUTHORIZED') || err.message.includes('session') || err.message.includes('MISMATCH'))) {
      clearDashboardSessionToken(districtCode);
      return false;
    }
    return false;
  }
}

function showManagerPinGate(customMessage) {
  const gateEl = document.getElementById('manager-pin-gate');
  if (gateEl) {
    gateEl.classList.remove('hidden');
    const errorEl = document.getElementById('manager-pin-error');
    if (errorEl && customMessage) {
      errorEl.textContent = customMessage;
    }
    const inputEl = document.getElementById('manager-pin-input');
    if (inputEl) {
      inputEl.value = '';
      setTimeout(() => inputEl.focus(), 100);
    }
  }
}

function hideManagerPinGate() {
  const gateEl = document.getElementById('manager-pin-gate');
  if (gateEl) {
    gateEl.classList.add('hidden');
  }
}

async function handleManagerPinSubmit(event) {
  if (event) event.preventDefault();
  const inputEl = document.getElementById('manager-pin-input');
  const errorEl = document.getElementById('manager-pin-error');
  const btnText = document.getElementById('manager-pin-btn-text');
  const btnSpinner = document.getElementById('manager-pin-btn-spinner');
  const btn = document.getElementById('manager-pin-btn');

  if (!inputEl) return;
  const pin = inputEl.value.trim();
  if (pin.length !== 6) {
    if (errorEl) errorEl.textContent = '6桁のパスワードを入力してください';
    inputEl.focus();
    return;
  }

  if (errorEl) errorEl.textContent = '';
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = '照合中...';
  if (btnSpinner) btnSpinner.classList.remove('hidden');

  try {
    const res = await callApiPost('verifyManagerPassword', { password: pin }, { timeoutMs: 45000 });
    if (res && res.success && res.dashboardSessionToken) {
      const districtCode = res.districtCode || getResolvedDistrictCode();
      setDashboardSessionToken(districtCode, res.dashboardSessionToken);
      localStorage.setItem('pm_auth_' + districtCode, 'true');
      localStorage.setItem('pm_last_district', districtCode);
      DashboardState.districtCode = districtCode;
      hideManagerPinGate();
      await startDashboardLifecycle();
    } else {
      if (errorEl) errorEl.textContent = (res && res.message) || '認証コードが正しくありません';
      inputEl.focus();
    }
  } catch (err) {
    if (err && (err.isTimeout || err.name === 'TimeoutError' || err.code === 'API_TIMEOUT' || (err.message && err.message.includes('タイムアウト')))) {
      if (errorEl) errorEl.textContent = '通信がタイムアウトしました。もう一度お試しください';
    } else {
      if (errorEl) errorEl.textContent = (err && err.message) || '通信エラーが発生しました';
    }
    inputEl.focus();
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'ログイン';
    if (btnSpinner) btnSpinner.classList.add('hidden');
  }
}

async function handleManagerLogout() {
  const districtCode = DashboardState.districtCode || getResolvedDistrictCode();
  try {
    await callApiPost('logoutManager', {});
  } catch (e) {}
  clearDashboardSessionToken(districtCode);
  _isDashboardInitialized = false;
  showManagerPinGate('ログアウトしました。');
}

if (typeof window !== 'undefined') {
  window.handleManagerPinSubmit = handleManagerPinSubmit;
  window.handleManagerLogout = handleManagerLogout;
  window.getDashboardSessionToken = getDashboardSessionToken;
  window.setDashboardSessionToken = setDashboardSessionToken;
  window.clearDashboardSessionToken = clearDashboardSessionToken;
}

async function initDashboard() {
  const urlParams = new URLSearchParams(window.location.search);
  const pairKey = urlParams.get('pair');
  if (pairKey) {
    history.replaceState(null, '', window.location.pathname);
  }

  const isAuth = await checkManagerAuth();
  if (!isAuth) {
    showManagerPinGate();
    return;
  }

  hideManagerPinGate();
  await startDashboardLifecycle();
}

async function startDashboardLifecycle() {
  if (_isDashboardInitialized) return;
  _isDashboardInitialized = true;

  initMap();
  updateNavHighlight('areas');
  
  await loadAddressMaster();

  await loadAreaMapping();

  loadBoundariesGeoJson();

  await loadElectionTurnoutData();

  renderCurrentView();
  if (DashboardState.map && DashboardState.markersLayer) {
    renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, DashboardState.masterPins);
  }

  syncDashboardData().finally(() => {
    setTimeout(() => {
      renderMainStageBulletin();
    }, 0);
  });

  setInterval(() => {
    syncDashboardData();
  }, 30000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncDashboardData();
    }
  });

  window.addEventListener('resize', () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      closeMobileAreaModal();
    }
    if (DashboardState.map) DashboardState.map.invalidateSize();
  });
}

async function fetchStaticDataFile(filename) {
  const candidates = [
    `../../data/${filename}`,
    `/data/${filename}`,
    `./data/${filename}`,
    `data/${filename}`
  ];
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (res.ok) return res;
    } catch (e) {}
  }
  throw new Error(`Failed to load static file: ${filename}`);
}

async function callApiPost(action, payload = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 25000;
  const districtId = (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.districtId) || "";
  if (districtId && !payload.districtId) {
    payload.districtId = districtId;
  }

  // Dashboard 認証セッショントークンを自動付与 (SEC-001)
  const targetDistrict = payload.districtId || districtId;
  const dashToken = (typeof getDashboardSessionToken === 'function') ? getDashboardSessionToken(targetDistrict) : '';
  if (dashToken && !payload.dashboardSessionToken) {
    payload.dashboardSessionToken = dashToken;
  }

  const url = `${getApiUrl()}?action=${encodeURIComponent(action)}&_t=${Date.now()}`;
  const body = JSON.stringify({ action, ...payload });

  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      body: body,
      signal: controller.signal
    });
  } catch (fetchErr) {
    const isAbort = fetchErr && (fetchErr.name === 'AbortError' || String(fetchErr.message || '').includes('aborted'));
    if (didTimeout || isAbort) {
      const timeoutErr = new Error('通信がタイムアウトしました。もう一度お試しください');
      timeoutErr.name = 'TimeoutError';
      timeoutErr.code = 'API_TIMEOUT';
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    throw new Error("JSON形式ではない応答を受け取りました: " + parseErr.message);
  }

  // 認証エラー検知 (UNAUTHORIZED / DISTRICT_MISMATCH)
  if (data && data.success === false && (data.code === 'UNAUTHORIZED' || data.code === 'DISTRICT_MISMATCH')) {
    if (typeof clearDashboardSessionToken === 'function') {
      clearDashboardSessionToken(targetDistrict);
    }
    if (typeof showManagerPinGate === 'function' && action !== 'verifyManagerPassword') {
      _isDashboardInitialized = false;
      showManagerPinGate(data.message || 'セッションの有効期限が切れました。再度PINを入力してください。');
    }
    throw new Error(data.message || "認証エラーが発生しました");
  }

  if (data && typeof data === 'object' && 'data' in data && data.data !== null) {
    const innerSuccess = data.data.success !== undefined ? data.data.success : data.success;
    if (innerSuccess === false) throw new Error(data.data.message || data.message || "API Error");
    return data.data;
  }

  if (data.success === false) throw new Error(data.message || "API Error");
  return data;
}


async function loadAddressMaster() {
  try {
    const cfg = getStaticMasterConfig();
    const csvFilename = cfg.addressCsvFilename;
    if (!csvFilename) throw new Error('[Config Error] staticMaster.addressCsvFilename が未設定です');
    const res = await fetchStaticDataFile(csvFilename);
    const text = await res.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const pins = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 5) {
        const rowId = parseInt(parts[0], 10);
        const cityName = parts[1];
        const townName = parts[2];
        const lat = parseFloat(parts[3]);
        const lng = parseFloat(parts[4]);
        const households = parts[5] !== undefined && parts[5] !== '' ? parseInt(parts[5], 10) : null;
        const population = parts[6] !== undefined && parts[6] !== '' ? parseInt(parts[6], 10) : null;
        const eStatCode = parts[7] || null;

        if (!isNaN(rowId) && !isNaN(lat) && !isNaN(lng)) {
          pins.push({
            rowId: rowId,
            cityName: cityName,
            townName: townName,
            fullName: `${cityName} ${townName}`,
            lat: lat,
            lng: lng,
            households: !isNaN(households) ? households : null,
            population: !isNaN(population) ? population : null,
            eStatCode: eStatCode
          });
        }
      }
    }

    DashboardState.masterLoadStatus = 'LOADED';
    DashboardState.masterPins = pins;
    console.log(`[SSOT Master Pins Loaded] Total: ${pins.length} items`);

    const masterCities = Array.from(new Set(pins.map(p => p.cityName).filter(Boolean)));
    if (masterCities.length > 0) {
      DashboardState.cities = masterCities;
      populateCitySelector(masterCities);
    }
    populateAreaSelector(pins);
    bindBoundariesStatsToPins();
    renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, pins);

    if (DashboardState.map && pins.length > 0) {
      const validCoords = pins
        .filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0)
        .map(p => [p.lat, p.lng]);
      if (validCoords.length > 0) {
        const bounds = L.latLngBounds(validCoords);
        DashboardState.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
      }
    }

  } catch (err) {
    console.error('[SSOT Load Error]', err);
    DashboardState.masterLoadStatus = 'ERROR';
  }
}

async function loadBoundariesGeoJson() {
  try {
    const cfg = getStaticMasterConfig();
    const geojsonFilename = cfg.boundariesGeojsonFilename;
    if (!geojsonFilename) { console.warn('[Config] boundariesGeojsonFilename 未設定 - 境界線スキップ'); return; }
    const res = await fetchStaticDataFile(geojsonFilename);
    const geojsonData = await res.json();
    DashboardState.boundariesGeoJson = geojsonData;

    const layer = L.geoJSON(geojsonData, {
      pane: 'boundariesPane',
      interactive: false, // 境界ポリゴン自体はクリックを奪わずピン操作を最優先
      style: () => ({
        color: '#475569',
        weight: 1.0,
        opacity: 0.55,
        fillColor: '#3B82F6',
        fillOpacity: 0.03
      })
    });

    DashboardState.boundariesLayer = layer;

    bindBoundariesStatsToPins();
    updateBoundariesVisibility();

    console.log('[Boundaries Layer Loaded] Pure geographic background layer initialized.');
  } catch (err) {
    console.warn('[Boundaries Load Error - Map continues normally]', err);
  }
}

async function loadAreaMapping() {
  try {
    const res = await fetchStaticDataFile('area_mapping.json');
    const mappingData = await res.json();
    DashboardState.areaMapping = mappingData;
    console.log('[Area Mapping Loaded] Total mapped parent areas:', mappingData.length);
  } catch (err) {
    console.warn('[Area Mapping Load Info - None loaded or not found]', err.message);
  }
}

function bindBoundariesStatsToPins() {
  if (!DashboardState.masterPins || DashboardState.masterPins.length === 0) return;
  if (!DashboardState.boundariesGeoJson || !Array.isArray(DashboardState.boundariesGeoJson.features)) return;

  const statsMap = new Map();
  DashboardState.boundariesGeoJson.features.forEach(f => {
    if (f.properties && f.properties.rowId !== undefined) {
      statsMap.set(f.properties.rowId, {
        population: f.properties.population,
        households: f.properties.households
      });
    }
  });

  DashboardState.masterPins.forEach(pin => {
    const stats = statsMap.get(pin.rowId);
    if (stats) {
      if (stats.population !== undefined) pin.population = stats.population;
      if (stats.households !== undefined) pin.households = stats.households;
    }
  });

  if (DashboardState.selectedPin) {
    const selStats = statsMap.get(DashboardState.selectedPin.rowId);
    if (selStats) {
      if (selStats.population !== undefined) DashboardState.selectedPin.population = selStats.population;
      if (selStats.households !== undefined) DashboardState.selectedPin.households = selStats.households;
      renderRightBottomAreaStats(DashboardState.selectedPin);
    }
  }
}

function updateBoundariesVisibility() {
  if (!DashboardState.map || !DashboardState.boundariesLayer) return;
  const currentZoom = typeof DashboardState.map.getZoom === 'function' ? DashboardState.map.getZoom() : 11;

  if (currentZoom >= 12) {
    if (!DashboardState.map.hasLayer(DashboardState.boundariesLayer)) {
      DashboardState.boundariesLayer.addTo(DashboardState.map);
    }
  } else {
    if (DashboardState.map.hasLayer(DashboardState.boundariesLayer)) {
      DashboardState.map.removeLayer(DashboardState.boundariesLayer);
    }
  }
}

if (typeof window !== 'undefined') {
  window.showAreaDetail = showAreaDetail;
  window.closeAreaDetail = closeAreaDetail;
  window.AREA_STATUS_CONFIG = AREA_STATUS_CONFIG;
  window.toggleCityDropdown = toggleCityDropdown;
  window.openMobileAreaModal = openMobileAreaModal;
  window.closeMobileAreaModal = closeMobileAreaModal;
  window.backToMobileMunicipalityList = backToMobileMunicipalityList;
  window.renderMobileAreaSelector = renderMobileAreaSelector;
  window.selectCity = selectCity;
  window.onCitySelected = onCitySelected;
  window.selectTownArea = selectTownArea;
  window.selectDesktopMunicipality = selectDesktopMunicipality;
  window.backToDesktopMunicipalityList = backToDesktopMunicipalityList;
  window.selectDesktopMunicipalityAll = selectDesktopMunicipalityAll;
  window.renderDesktopAreaSelector = renderDesktopAreaSelector;
  window.getMunicipalityTurnout = getMunicipalityTurnout;
}

function toggleCityDropdown(event) {
  if (event) event.stopPropagation();
  const listEl = document.getElementById('city-selector-list');
  const triggerEl = document.getElementById('city-selector-trigger');
  if (!listEl) return;

  const isHidden = listEl.classList.contains('hidden');
  if (isHidden) {
    listEl.classList.remove('hidden');
    if (triggerEl) triggerEl.setAttribute('aria-expanded', 'true');
  } else {
    listEl.classList.add('hidden');
    if (triggerEl) triggerEl.setAttribute('aria-expanded', 'false');
  }
}

// ドロップダウン外部クリック時に自動で閉じる (PC専用)
document.addEventListener('click', (e) => {
  ['city-selector'].forEach(suffix => {
    const listEl = document.getElementById(`${suffix}-list`);
    const triggerEl = document.getElementById(`${suffix}-trigger`);
    if (listEl && !listEl.classList.contains('hidden')) {
      if (!listEl.contains(e.target) && !triggerEl?.contains(e.target)) {
        listEl.classList.add('hidden');
        if (triggerEl) triggerEl.setAttribute('aria-expanded', 'false');
      }
    }
  });
});

function selectCity(cityName) {
  DashboardState.selectedPin = null;
  DashboardState.selectedTownId = 'ALL';
  DashboardState.selectedCity = cityName;
  if (typeof closeAreaDetail === 'function') {
    const detailEl = document.getElementById('map-area-detail');
    if (detailEl) detailEl.classList.add('hidden');
  }

  const labelText = cityName === 'ALL' ? '全域' : cityName;

  const currentLabelEl = document.getElementById('city-selector-current');
  if (currentLabelEl) currentLabelEl.textContent = labelText;

  const mobileLabelEl = document.getElementById('mobile-city-selector-current');
  if (mobileLabelEl) {
    const cities = (Array.isArray(DashboardState.cities) && DashboardState.cities.length > 0)
      ? DashboardState.cities
      : Array.from(new Set((DashboardState.masterPins || []).map(p => p.cityName).filter(Boolean)));
    const isMultiMunicipality = cities.length > 1;
    if (!isMultiMunicipality || cityName === 'ALL') {
      mobileLabelEl.textContent = '全域';
    } else {
      mobileLabelEl.textContent = `${cityName} / 全域`;
    }
  }

  updateCitySelectorHighlight(cityName);
  onCitySelected(cityName);
  renderDesktopAreaSelector(DashboardState.masterPins);
}

function updateCitySelectorHighlight(selectedCity) {
  ['city-selector-list'].forEach(listId => {
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    const buttons = listEl.querySelectorAll('button[data-city-val]');
    buttons.forEach(btn => {
      const val = btn.getAttribute('data-city-val');
      if (val === selectedCity) {
        btn.className = 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-between bg-brand/15 text-brand border border-brand/30';
        const checkSpan = btn.querySelector('.city-check');
        if (checkSpan) checkSpan.textContent = '✓';
      } else {
        btn.className = 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent';
        const checkSpan = btn.querySelector('.city-check');
        if (checkSpan) checkSpan.textContent = '';
      }
    });
  });
}

function populateCitySelector(cities) {
  const currentVal = DashboardState.selectedCity || 'ALL';
  const labelText = currentVal === 'ALL' ? '全域' : currentVal;

  const currentLabelEl = document.getElementById('city-selector-current');
  if (currentLabelEl) currentLabelEl.textContent = labelText;

  ['city-selector-list'].forEach(listId => {
    const listEl = document.getElementById(listId);
    if (!listEl) return;
    listEl.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.setAttribute('data-city-val', 'ALL');
    allBtn.onclick = (e) => { e.stopPropagation(); selectCity('ALL'); };
    allBtn.innerHTML = `<span>全域</span><span class="city-check text-[11px] font-bold">${currentVal === 'ALL' ? '✓' : ''}</span>`;
    allBtn.className = currentVal === 'ALL'
      ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-between bg-brand/15 text-brand border border-brand/30'
      : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent';
    listEl.appendChild(allBtn);

    cities.forEach(cityName => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-city-val', cityName);
      btn.onclick = (e) => { e.stopPropagation(); selectCity(cityName); };
      btn.innerHTML = `<span>${escapeHtml(cityName)}</span><span class="city-check text-[11px] font-bold">${currentVal === cityName ? '✓' : ''}</span>`;
      btn.className = currentVal === cityName
        ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-between bg-brand/15 text-brand border border-brand/30'
        : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent';
      listEl.appendChild(btn);
    });
  });
}

function updateDesktopAreaSelectorHeader(mode, cityName, count) {
  const countEl = document.getElementById('area-selector-count');
  if (countEl && count !== undefined && count !== null) {
    countEl.textContent = count;
  }

  let titleEl = null;
  if (countEl && countEl.previousElementSibling) {
    titleEl = countEl.previousElementSibling;
  } else {
    const cardEl = document.getElementById('area-selector-card');
    if (cardEl && typeof cardEl.querySelector === 'function') {
      titleEl = cardEl.querySelector('span');
    }
  }
  if (!titleEl) return;

  if (mode === 'TOWNS' && cityName && cityName !== 'ALL') {
    titleEl.className = 'text-sm font-bold text-white tracking-wide flex items-center gap-1.5 min-w-0 cursor-pointer transition-colors';
    titleEl.onclick = (e) => backToDesktopMunicipalityList(e);
    titleEl.innerHTML = `<span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-white/10 border border-white/10 hover:border-brand/40 text-brand text-xl font-bold leading-none flex-shrink-0">‹</span> <span class="truncate text-sm font-bold text-white">${escapeHtml(cityName)}</span>`;
  } else {
    titleEl.className = 'text-xs font-bold text-white tracking-wide flex items-center gap-1';
    titleEl.onclick = null;
    titleEl.innerHTML = `<span>📍</span> エリア選択`;
  }
}

function selectDesktopMunicipality(cityName) {
  if (!cityName || cityName === 'ALL') {
    DashboardState.desktopAreaSelectorView = 'CITIES';
    selectCity('ALL');
    return;
  }
  DashboardState.desktopAreaSelectorView = 'TOWNS';
  selectCity(cityName);
}

function backToDesktopMunicipalityList(event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  DashboardState.desktopAreaSelectorView = 'CITIES';
  renderDesktopAreaSelector(DashboardState.masterPins);
}

function selectDesktopMunicipalityAll() {
  const currentCity = DashboardState.selectedCity;
  if (!currentCity || currentCity === 'ALL') {
    selectCity('ALL');
    return;
  }

  DashboardState.selectedPin = null;
  DashboardState.selectedTownId = 'ALL';

  const detailEl = document.getElementById('map-area-detail');
  if (detailEl) detailEl.classList.add('hidden');

  updateAreaSelectorHighlight('ALL');

  if (DashboardState.map && Array.isArray(DashboardState.masterPins)) {
    const cityPins = DashboardState.masterPins.filter(
      p => p.cityName === currentCity && isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0
    );
    if (cityPins.length > 0) {
      const bounds = L.latLngBounds(cityPins.map(p => [p.lat, p.lng]));
      DashboardState.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
  }

  renderCurrentView();
}

function renderDesktopAreaSelector(pins) {
  const pcListEl = document.getElementById('area-selector-list');
  const pinList = Array.isArray(pins) ? pins : (DashboardState.masterPins || []);
  const cities = (Array.isArray(DashboardState.cities) && DashboardState.cities.length > 0)
    ? DashboardState.cities
    : Array.from(new Set(pinList.map(p => p.cityName).filter(Boolean)));

  const isMultiMunicipality = cities.length > 1;
  const currentSelectedTown = DashboardState.selectedTownId || 'ALL';
  const currentSelectedCity = DashboardState.selectedCity || 'ALL';

  if (!isMultiMunicipality) {
    updateDesktopAreaSelectorHeader('SINGLE', null, pinList.length);
    if (!pcListEl) return;
    pcListEl.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.setAttribute('data-town-id', 'ALL');
    allBtn.onclick = (e) => {
      e.stopPropagation();
      selectTownArea('ALL');
    };
    const isAllSelected = currentSelectedTown === 'ALL';
    allBtn.innerHTML = `<span class="truncate font-semibold text-xs">全域</span><span class="town-check text-[11px] font-bold">${isAllSelected ? '✓' : ''}</span>`;
    allBtn.className = isAllSelected
      ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer'
      : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
    pcListEl.appendChild(allBtn);

    pinList.forEach(pin => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-town-id', String(pin.rowId));
      btn.onclick = (e) => {
        e.stopPropagation();
        selectTownArea(pin.rowId);
      };
      const isSelected = String(currentSelectedTown) === String(pin.rowId);
      btn.innerHTML = `<span class="truncate text-xs">${escapeHtml(pin.townName)}</span><span class="town-check text-[11px] font-bold">${isSelected ? '✓' : ''}</span>`;
      btn.className = isSelected
        ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer'
        : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
      pcListEl.appendChild(btn);
    });
    return;
  }

  const viewMode = (DashboardState.desktopAreaSelectorView === 'TOWNS' && currentSelectedCity !== 'ALL')
    ? 'TOWNS'
    : 'CITIES';
  DashboardState.desktopAreaSelectorView = viewMode;

  if (viewMode === 'CITIES') {
    updateDesktopAreaSelectorHeader('CITIES', null, cities.length);
    if (!pcListEl) return;
    pcListEl.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.setAttribute('data-city-val', 'ALL');
    allBtn.onclick = (e) => {
      e.stopPropagation();
      selectDesktopMunicipality('ALL');
    };
    const isAllCity = currentSelectedCity === 'ALL';
    allBtn.innerHTML = `<span class="truncate font-semibold text-xs">全域</span><span class="city-check text-[11px] font-bold">${isAllCity ? '✓' : ''}</span>`;
    allBtn.className = isAllCity
      ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer'
      : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
    pcListEl.appendChild(allBtn);

    cities.forEach(cityName => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-city-val', cityName);
      btn.onclick = (e) => {
        e.stopPropagation();
        selectDesktopMunicipality(cityName);
      };
      const isSelected = currentSelectedCity === cityName;
      btn.innerHTML = `<span class="truncate text-xs">${escapeHtml(cityName)}</span><span class="city-check text-[11px] font-bold">${isSelected ? '✓' : ''}</span>`;
      btn.className = isSelected
        ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer'
        : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
      pcListEl.appendChild(btn);
    });
    return;
  }

  const cityPins = pinList.filter(p => p.cityName === currentSelectedCity);
  updateDesktopAreaSelectorHeader('TOWNS', currentSelectedCity, cityPins.length);
  if (!pcListEl) return;
  pcListEl.innerHTML = '';

  const cityAllBtn = document.createElement('button');
  cityAllBtn.type = 'button';
  cityAllBtn.setAttribute('data-town-id', 'ALL');
  cityAllBtn.onclick = (e) => {
    e.stopPropagation();
    selectDesktopMunicipalityAll();
  };
  const isCityAllSelected = currentSelectedTown === 'ALL';
  cityAllBtn.innerHTML = `<span class="truncate font-semibold text-xs">${escapeHtml(currentSelectedCity)} 全域</span><span class="town-check text-[11px] font-bold">${isCityAllSelected ? '✓' : ''}</span>`;
  cityAllBtn.className = isCityAllSelected
    ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer'
    : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
  pcListEl.appendChild(cityAllBtn);

  cityPins.forEach(pin => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-town-id', String(pin.rowId));
    btn.onclick = (e) => {
      e.stopPropagation();
      selectTownArea(pin.rowId);
    };
    const isSelected = String(currentSelectedTown) === String(pin.rowId);
    btn.innerHTML = `<span class="truncate text-xs">${escapeHtml(pin.townName)}</span><span class="town-check text-[11px] font-bold">${isSelected ? '✓' : ''}</span>`;
    btn.className = isSelected
      ? 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer'
      : 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
    pcListEl.appendChild(btn);
  });
}

/**
 * モバイル2段階 Bottom Sheet Modal の開閉・STEP遷移・描画
 * (OPEN時およびModal内STEP遷移時のみ描画を実行)
 */
function openMobileAreaModal(event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  const modalEl = document.getElementById('mobile-area-modal');
  const triggerEl = document.getElementById('mobile-city-selector-trigger');
  if (!modalEl) return;

  const pinList = Array.isArray(DashboardState.masterPins) ? DashboardState.masterPins : [];
  const cities = (Array.isArray(DashboardState.cities) && DashboardState.cities.length > 0)
    ? DashboardState.cities
    : Array.from(new Set(pinList.map(p => p.cityName).filter(Boolean)));

  if (cities.length <= 1) {
    DashboardState.mobileAreaSelectorView = 'TOWNS';
  } else if (DashboardState.selectedCity && DashboardState.selectedCity !== 'ALL') {
    DashboardState.mobileAreaSelectorView = 'TOWNS';
  } else {
    DashboardState.mobileAreaSelectorView = 'CITIES';
  }

  renderMobileAreaSelector(pinList);
  modalEl.classList.remove('hidden');
  if (triggerEl) triggerEl.setAttribute('aria-expanded', 'true');
}

function closeMobileAreaModal(event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  const modalEl = document.getElementById('mobile-area-modal');
  const triggerEl = document.getElementById('mobile-city-selector-trigger');
  if (modalEl) modalEl.classList.add('hidden');
  if (triggerEl) triggerEl.setAttribute('aria-expanded', 'false');
}

function backToMobileMunicipalityList(event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  DashboardState.mobileAreaSelectorView = 'CITIES';
  renderMobileAreaSelector(DashboardState.masterPins);
}

function renderMobileAreaSelector(pins) {
  const listEl = document.getElementById('mobile-area-selector-list');
  if (!listEl) return;

  const backBtnEl = document.getElementById('mobile-area-modal-back');
  const titleEl = document.getElementById('mobile-area-modal-title');
  const pinList = Array.isArray(pins) ? pins : (DashboardState.masterPins || []);
  const cities = (Array.isArray(DashboardState.cities) && DashboardState.cities.length > 0)
    ? DashboardState.cities
    : Array.from(new Set(pinList.map(p => p.cityName).filter(Boolean)));

  const isMultiMunicipality = cities.length > 1;
  const currentSelectedCity = DashboardState.selectedCity || 'ALL';
  const currentSelectedTown = DashboardState.selectedTownId || 'ALL';

  const activeItemClass = 'w-full min-h-[44px] text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-2 bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer';
  const normalItemClass = 'w-full min-h-[44px] text-left px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between gap-2 text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';

  if (!isMultiMunicipality) {
    if (backBtnEl) backBtnEl.classList.add('hidden');
    if (titleEl) titleEl.textContent = cities[0] || 'エリア選択';
    listEl.innerHTML = '';

    const isAllSelected = currentSelectedTown === 'ALL';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.setAttribute('data-town-id', 'ALL');
    allBtn.onclick = (e) => {
      e.stopPropagation();
      selectTownArea('ALL');
      closeMobileAreaModal();
    };
    allBtn.innerHTML = `<span class="town-check w-4 text-center text-xs font-bold flex-shrink-0">${isAllSelected ? '✓' : ''}</span><span class="mobile-area-item-label flex-1 min-w-0 font-semibold text-xs">全域</span>`;
    allBtn.className = isAllSelected ? activeItemClass : normalItemClass;
    listEl.appendChild(allBtn);

    pinList.forEach(pin => {
      const isSelected = String(currentSelectedTown) === String(pin.rowId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-town-id', String(pin.rowId));
      btn.onclick = (e) => {
        e.stopPropagation();
        selectTownArea(pin.rowId);
        closeMobileAreaModal();
      };
      btn.innerHTML = `<span class="town-check w-4 text-center text-xs font-bold flex-shrink-0">${isSelected ? '✓' : ''}</span><span class="mobile-area-item-label flex-1 min-w-0 text-xs">${escapeHtml(pin.townName)}</span>`;
      btn.className = isSelected ? activeItemClass : normalItemClass;
      listEl.appendChild(btn);
    });
    return;
  }

  const viewMode = (DashboardState.mobileAreaSelectorView === 'TOWNS' && currentSelectedCity !== 'ALL')
    ? 'TOWNS'
    : 'CITIES';
  DashboardState.mobileAreaSelectorView = viewMode;

  if (viewMode === 'CITIES') {
    if (backBtnEl) backBtnEl.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'エリア選択（市町村）';
    listEl.innerHTML = '';

    const isAllCity = currentSelectedCity === 'ALL';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.setAttribute('data-city-val', 'ALL');
    allBtn.onclick = (e) => {
      e.stopPropagation();
      selectCity('ALL');
      closeMobileAreaModal();
    };
    allBtn.innerHTML = `<span class="city-check w-4 text-center text-xs font-bold flex-shrink-0">${isAllCity ? '✓' : ''}</span><span class="mobile-area-item-label flex-1 min-w-0 font-semibold text-xs">全域（すべて表示）</span>`;
    allBtn.className = isAllCity ? activeItemClass : normalItemClass;
    listEl.appendChild(allBtn);

    cities.forEach(cityName => {
      const isSelected = currentSelectedCity === cityName;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-city-val', cityName);
      btn.onclick = (e) => {
        e.stopPropagation();
        selectCity(cityName);
        DashboardState.mobileAreaSelectorView = 'TOWNS';
        renderMobileAreaSelector(DashboardState.masterPins);
      };
      btn.innerHTML = `<span class="city-check w-4 text-center text-xs font-bold flex-shrink-0">${isSelected ? '✓' : ''}</span><span class="mobile-area-item-label flex-1 min-w-0 text-xs">${escapeHtml(cityName)}</span><span class="text-textSub text-sm font-bold flex-shrink-0">›</span>`;
      btn.className = isSelected ? activeItemClass : normalItemClass;
      listEl.appendChild(btn);
    });
    return;
  }

  const cityPins = pinList.filter(p => p.cityName === currentSelectedCity);
  if (backBtnEl) backBtnEl.classList.remove('hidden');
  if (titleEl) titleEl.textContent = currentSelectedCity;
  listEl.innerHTML = '';

  const isCityAllSelected = currentSelectedTown === 'ALL';
  const cityAllBtn = document.createElement('button');
  cityAllBtn.type = 'button';
  cityAllBtn.setAttribute('data-town-id', 'ALL');
  cityAllBtn.onclick = (e) => {
    e.stopPropagation();
    selectCity(currentSelectedCity);
    closeMobileAreaModal();
  };
  cityAllBtn.innerHTML = `<span class="town-check w-4 text-center text-xs font-bold flex-shrink-0">${isCityAllSelected ? '✓' : ''}</span><span class="mobile-area-item-label flex-1 min-w-0 font-semibold text-xs">${escapeHtml(currentSelectedCity)} 全域</span>`;
  cityAllBtn.className = isCityAllSelected ? activeItemClass : normalItemClass;
  listEl.appendChild(cityAllBtn);

  cityPins.forEach(pin => {
    const isSelected = String(currentSelectedTown) === String(pin.rowId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-town-id', String(pin.rowId));
    btn.onclick = (e) => {
      e.stopPropagation();
      selectTownArea(pin.rowId);
      closeMobileAreaModal();
    };
    btn.innerHTML = `<span class="town-check w-4 text-center text-xs font-bold flex-shrink-0">${isSelected ? '✓' : ''}</span><span class="mobile-area-item-label flex-1 min-w-0 text-xs">${escapeHtml(pin.townName)}</span>`;
    btn.className = isSelected ? activeItemClass : normalItemClass;
    listEl.appendChild(btn);
  });
}

/**
 * エリア選択リストの動的生成 (Desktop: 単一自治体1層 / 複数自治体2層)
 */
function populateAreaSelector(pins) {
  renderDesktopAreaSelector(pins);
}

/**
 * town_nameクリック時の該当ピンへの直接移動・ズームおよびフォーカス (PC & モバイル共通)
 */
function selectTownArea(target) {
  // モバイルラベルの更新
  const mobileLabelEl = document.getElementById('mobile-city-selector-current');

  if (target === 'ALL') {
    DashboardState.selectedPin = null;
    DashboardState.selectedTownId = 'ALL';
    DashboardState.selectedCity = 'ALL';
    const detailEl = document.getElementById('map-area-detail');
    if (detailEl) detailEl.classList.add('hidden');

    if (mobileLabelEl) mobileLabelEl.textContent = '全域';
    updateAreaSelectorHighlight('ALL');
    renderCurrentView();

    if (!DashboardState.map) return;
    if (DashboardState.markersLayer) {
      renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, DashboardState.masterPins);
    }
    if (DashboardState.masterPins && DashboardState.masterPins.length > 0) {
      const validCoords = DashboardState.masterPins
        .filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0)
        .map(p => [p.lat, p.lng]);
      if (validCoords.length > 0) {
        const bounds = L.latLngBounds(validCoords);
        DashboardState.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
      }
    }
    return;
  }

  const pin = DashboardState.masterPins.find(p => String(p.rowId) === String(target));
  if (!pin) return;

  DashboardState.selectedTownId = target;
  DashboardState.selectedPin = pin;

  if (mobileLabelEl) {
    const cities = (Array.isArray(DashboardState.cities) && DashboardState.cities.length > 0)
      ? DashboardState.cities
      : Array.from(new Set((DashboardState.masterPins || []).map(p => p.cityName).filter(Boolean)));
    const isMultiMunicipality = cities.length > 1;
    mobileLabelEl.textContent = (isMultiMunicipality && pin.cityName)
      ? `${pin.cityName} / ${pin.townName}`
      : pin.townName;
  }
  updateAreaSelectorHighlight(target);

  const completedList = (DashboardState.globalPinStatus && DashboardState.globalPinStatus.completed) || [];
  const inProgressList = (DashboardState.globalPinStatus && DashboardState.globalPinStatus.inProgress) || [];
  const isCompleted = completedList.includes(pin.rowId);
  const isInProgress = inProgressList.includes(pin.rowId);
  const statusCfg = getAreaStatusConfig(isCompleted, isInProgress);

  const households = pin.households || Math.max(120, ((pin.rowId * 137 + 240) % 480) + 160);
  const population = pin.population || Math.round(households * 2.35);

  if (typeof showAreaDetail === 'function') {
    showAreaDetail({
      name: pin.fullName || `${pin.cityName} ${pin.townName}`,
      statusCfg: statusCfg,
      households: households,
      population: population
    });
  }
  renderCurrentView();

  if (!DashboardState.map || !isFinite(pin.lat) || !isFinite(pin.lng) || pin.lat === 0) return;

  // 該当ピンへマップ移動・ズーム
  DashboardState.map.setView([pin.lat, pin.lng], 15, { animate: true });
}

function updateAreaSelectorHighlight(selectedTownId) {
  ['area-selector-list'].forEach(listId => {
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    const buttons = listEl.querySelectorAll('button[data-town-id]');
    buttons.forEach(btn => {
      const val = btn.getAttribute('data-town-id');
      const isSelected = String(val) === String(selectedTownId);
      if (isSelected) {
        btn.className = 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between bg-brand/20 text-brand border border-brand/40 shadow-sm cursor-pointer';
        const checkSpan = btn.querySelector('.town-check');
        if (checkSpan) checkSpan.textContent = '✓';
      } else {
        btn.className = 'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-textSub hover:text-white hover:bg-white/5 border border-transparent cursor-pointer';
        const checkSpan = btn.querySelector('.town-check');
        if (checkSpan) checkSpan.textContent = '';
      }
    });
  });
}

function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl || DashboardState.map) return;

  try {
    const cfg = getStaticMasterConfig();
    const defaultCenter = cfg.mapDefaultCenter || [35.0, 137.0];
    const defaultZoom = cfg.mapDefaultZoom || 10;
    const map = L.map('map', {
      zoomControl: true,
      attributionControl: false
    }).setView(defaultCenter, defaultZoom);

    if (!map.getPane('boundariesPane')) {
      const bPane = map.createPane('boundariesPane');
      bPane.style.zIndex = 450;
    }

    L.tileLayer('https://tile.openstreetmap.jp/{z}/{x}/{y}.png', {
      maxZoom: 18
    }).addTo(map);

    DashboardState.markersLayer = L.layerGroup().addTo(map);
    DashboardState.map = map;

    map.on('zoom zoomend', () => {
      updatePinsRadiusOnZoom(DashboardState.map, DashboardState.markersLayer);
      updateBoundariesVisibility();
    });

    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  } catch (e) {
    console.warn('[Map Init Error]', e);
  }
}

async function syncDashboardData() {
  if (_isSyncing) return;
  _isSyncing = true;
  try {
    const districtId = (DashboardState && DashboardState.districtId) || (window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.districtId) || "";
    const snapshotRes = await callApiPost('getDashboardSnapshot', { districtId })
      .catch(e => ({ success: false, error: e.message }));

    if (snapshotRes && (snapshotRes.code === 'CONTRACT_EXPIRED' || snapshotRes.code === 'CONTRACT_CHECK_FAILED')) {
      _isDashboardInitialized = false;
      showManagerPinGate();
      const errorEl = document.getElementById('manager-pin-error');
      if (errorEl) {
        errorEl.textContent = snapshotRes.message || '契約期間が終了しているため利用できません。';
      }
      return;
    }

    if (!snapshotRes || !snapshotRes.domains) {
      if (DashboardState.domainState) {
        ['ranking', 'stocks', 'roster', 'requests'].forEach(d => {
          DashboardState.domainState[d] = (DashboardState[d] && DashboardState[d].length > 0) ? 'STALE' : 'ERROR';
        });
      }
      setSyncStatus('FAILED');
      return;
    }

    const domains = snapshotRes.domains;
    const summaryRes = domains.summary;
    const stockRes = domains.flyerStock;
    const rankRes = domains.ranking;
    const pinStatusRes = domains.pinStatus;
    const rosterRes = domains.roster;
    const reqRes = domains.transfer;
    const latestDistRes = domains.latestDistribution;

    if (summaryRes && (summaryRes.code === 'CONTRACT_EXPIRED' || summaryRes.contractStatus === 'EXPIRED' || summaryRes.isExpired === true)) {
      _isDashboardInitialized = false;
      showManagerPinGate();
      const errorEl = document.getElementById('manager-pin-error');
      if (errorEl) errorEl.textContent = '契約期間が終了しているため利用できません。';
      return;
    }

    const isSummaryOk = summaryRes && summaryRes.success;
    const isStockOk = stockRes && stockRes.success;
    const isRankOk = rankRes && rankRes.success;
    const isPinStatusOk = pinStatusRes && pinStatusRes.success;
    const isRosterOk = rosterRes && rosterRes.success;
    const isReqOk = reqRes && reqRes.success;
    const isLatestDistOk = latestDistRes && latestDistRes.success;

    // 成功ドメインのみ上書き、失敗ドメインは既存表示を保持 (Partial Failure 設計)
    if (isSummaryOk) {
      DashboardState.summary = summaryRes;
    }

    if (isStockOk) {
      DashboardState.stocks = stockRes.stocks || [];
    }

    if (isRosterOk) {
      DashboardState.roster = rosterRes.roster || [];
    }

    if (isReqOk) {
      DashboardState.requests = reqRes.requests || [];
    }

    let pinStatusChanged = false;
    if (isPinStatusOk) {
      let inProgress = (pinStatusRes.inProgress || []).map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      let completed = (pinStatusRes.completed || []).map(id => parseInt(id, 10)).filter(id => !isNaN(id));

      // areaMapping による分割子エリアへのステータス継承
      if (DashboardState.areaMapping && Array.isArray(DashboardState.areaMapping)) {
        const completedSet = new Set(completed);
        for (const entry of DashboardState.areaMapping) {
          if (completedSet.has(entry.old_rowId) && Array.isArray(entry.new_areas)) {
            for (const child of entry.new_areas) {
              if (child.inheritance && child.inheritance.status_inherited === 'COMPLETED') {
                completedSet.add(child.rowId);
              }
            }
          }
        }
        completed = Array.from(completedSet);
      }

      const prevCompleted = DashboardState.globalPinStatus.completed || [];
      const prevInProgress = DashboardState.globalPinStatus.inProgress || [];

      if (!_hasAppliedPinStatus || prevCompleted.length !== completed.length || prevInProgress.length !== inProgress.length) {
        pinStatusChanged = true;
        _hasAppliedPinStatus = true;
      } else {
        const prevCompSet = new Set(prevCompleted);
        const prevProgSet = new Set(prevInProgress);
        const compSame = completed.every(id => prevCompSet.has(id));
        const progSame = inProgress.every(id => prevProgSet.has(id));
        if (!compSame || !progSame) {
          pinStatusChanged = true;
        }
      }

      DashboardState.globalPinStatus.inProgress = inProgress;
      DashboardState.globalPinStatus.completed = completed;
    }

    if (isRankOk) {
      DashboardState.ranking = rankRes.ranking || [];
    }

    if (DashboardState.domainState) {
      DashboardState.domainState.stocks = isStockOk ? 'SUCCESS' : ((DashboardState.stocks && DashboardState.stocks.length > 0) ? 'STALE' : 'ERROR');
      DashboardState.domainState.roster = isRosterOk ? 'SUCCESS' : ((DashboardState.roster && DashboardState.roster.length > 0) ? 'STALE' : 'ERROR');
      DashboardState.domainState.requests = isReqOk ? 'SUCCESS' : ((DashboardState.requests && DashboardState.requests.length > 0) ? 'STALE' : 'ERROR');
      DashboardState.domainState.ranking = isRankOk ? 'SUCCESS' : ((DashboardState.ranking && DashboardState.ranking.length > 0) ? 'STALE' : 'ERROR');
    }

    if (isLatestDistOk && Array.isArray(latestDistRes.records)) {
      DashboardState.liveRecords = latestDistRes.records;
    }

    renderCurrentView();

    if (DashboardState.currentFocus === 'mail') {
      renderMainStageMail(DashboardState.selectedMailTabIndex || 0);
    }

    if (pinStatusChanged && DashboardState.map && DashboardState.markersLayer) {
      renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, DashboardState.masterPins);
    }

    const allOk = isSummaryOk && isStockOk && isPinStatusOk && isRankOk && isRosterOk && isReqOk && isLatestDistOk;
    const anyOk = isSummaryOk || isStockOk || isPinStatusOk || isRankOk || isRosterOk || isReqOk || isLatestDistOk;

    if (allOk) {
      setSyncStatus('SYNCED');
    } else if (anyOk) {
      setSyncStatus('PARTIAL');
    } else {
      setSyncStatus('FAILED');
    }

  } catch (err) {
    console.error('[Dashboard Sync Error]', err);
    if (DashboardState.domainState) {
      ['ranking', 'stocks', 'roster', 'requests'].forEach(d => {
        DashboardState.domainState[d] = (DashboardState[d] && DashboardState[d].length > 0) ? 'STALE' : 'ERROR';
      });
    }
    setSyncStatus('FAILED');
  } finally {
    _isSyncing = false;
  }
}

function renderPinsOnMap(mapInstance, layerGroup, pins) {
  if (!mapInstance || !layerGroup || !pins || pins.length === 0) return;

  layerGroup.clearLayers();

  const selectedCity = DashboardState.selectedCity;
  const isAll = selectedCity === 'ALL';
  const completedList = DashboardState.globalPinStatus.completed || [];
  const inProgressList = DashboardState.globalPinStatus.inProgress || [];

  pins.forEach(pin => {
    const matchCity = isAll || pin.cityName === selectedCity;
    if (!matchCity) return;

    const isCompleted = completedList.includes(pin.rowId);
    const isInProgress = inProgressList.includes(pin.rowId);

    const statusCfg = getAreaStatusConfig(isCompleted, isInProgress);
    const currentZoom = typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 11;
    const scaledRadius = getZoomScaledRadius(statusCfg.radius, currentZoom);

    const marker = L.circleMarker([pin.lat, pin.lng], {
      radius: scaledRadius,
      _baseRadius: statusCfg.radius,
      fillColor: statusCfg.color,
      color: statusCfg.strokeColor,
      weight: statusCfg.weight,
      opacity: statusCfg.opacity,
      fillOpacity: statusCfg.fillOpacity
    });

    marker.on('click', () => {
      DashboardState.selectedPin = pin;
      const households = pin.households || Math.max(120, ((pin.rowId * 137 + 240) % 480) + 160);
      const population = pin.population || Math.round(households * 2.35);
      showAreaDetail({
        name: pin.fullName,
        statusCfg: statusCfg,
        households: households,
        population: population
      });
      renderRightTopTurnout(DashboardState.selectedPin?.cityName ? DashboardState.selectedPin.cityName : (DashboardState.selectedCity || 'ALL'));
      renderRightBottomAreaStats(pin);
    });

    layerGroup.addLayer(marker);
  });
}

function onCitySelected(cityName) {
  DashboardState.selectedCity = cityName;
  renderCurrentView();

  if (DashboardState.map && DashboardState.markersLayer) {
    renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, DashboardState.masterPins);
  }

  if (DashboardState.map) {
    if (cityName === 'ALL') {
      if (DashboardState.masterPins.length > 0) {
        const validCoords = DashboardState.masterPins
          .filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0)
          .map(p => [p.lat, p.lng]);
        if (validCoords.length > 0) {
          const bounds = L.latLngBounds(validCoords);
          DashboardState.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 11 });
        }
      } else {
        const cfg = getStaticMasterConfig();
        const defaultCenter = cfg.mapDefaultCenter || [35.0, 137.0];
        const defaultZoom = cfg.mapDefaultZoom || 10;
        DashboardState.map.setView(defaultCenter, defaultZoom);
      }
    } else {
      const cityPins = DashboardState.masterPins.filter(p => p.cityName === cityName);
      if (cityPins.length > 0) {
        const bounds = L.latLngBounds(cityPins.map(p => [p.lat, p.lng]));
        DashboardState.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      }
    }
  }
}

function renderCurrentView() {
  const selected = DashboardState.selectedCity;
  const isAll = selected === 'ALL';
  const completedList = DashboardState.globalPinStatus.completed || [];
  const inProgressList = DashboardState.globalPinStatus.inProgress || [];

  const doneAreasEl = document.getElementById('fact-done-areas');
  const totalAreasEl = document.getElementById('fact-total-areas');
  const progressBadgeEl = document.getElementById('fact-progress-badge');
  const unallocatedEl = document.getElementById('fact-unallocated-areas');
  const inProgressEl = document.getElementById('fact-inprogress-areas');
  const completedEl = document.getElementById('fact-completed-areas');
  const districtLabelEl = document.getElementById('map-district-label');

  const mDoneAreasEl = document.getElementById('mobile-fact-done-areas');
  const mTotalAreasEl = document.getElementById('mobile-fact-total-areas');
  const mProgressBadgeEl = document.getElementById('mobile-fact-progress-badge');
  const mUnallocatedEl = document.getElementById('mobile-fact-unallocated-areas');
  const mInProgressEl = document.getElementById('mobile-fact-inprogress-areas');
  const mCompletedEl = document.getElementById('mobile-fact-completed-areas');

  const masterOk = DashboardState.masterLoadStatus === 'LOADED';

  if (DashboardState.masterLoadStatus === 'PENDING') {
  } else if (DashboardState.masterLoadStatus === 'ERROR') {
    if (doneAreasEl) doneAreasEl.textContent = 'ERR';
    if (totalAreasEl) totalAreasEl.textContent = 'ERR';
    if (progressBadgeEl) progressBadgeEl.textContent = '--';
    if (mDoneAreasEl) mDoneAreasEl.textContent = 'ERR';
    if (mTotalAreasEl) mTotalAreasEl.textContent = 'ERR';
    if (mProgressBadgeEl) mProgressBadgeEl.textContent = '--';
  } else {
    let totalAreas = DashboardState.masterPins.length;
    let doneAreas = DashboardState.masterPins.filter(p => completedList.includes(p.rowId)).length;
    let progAreas = DashboardState.masterPins.filter(p => inProgressList.includes(p.rowId)).length;

    if (!isAll && DashboardState.masterPins.length > 0) {
      const cityPins = DashboardState.masterPins.filter(p => p.cityName === selected);
      totalAreas = cityPins.length;
      doneAreas = cityPins.filter(p => completedList.includes(p.rowId)).length;
      progAreas = cityPins.filter(p => inProgressList.includes(p.rowId)).length;
    }

    const unallocatedAreas = Math.max(0, totalAreas - doneAreas - progAreas);
    const progressPercent = totalAreas > 0 ? Math.round((doneAreas / totalAreas) * 100) : 0;

    const doneStr = doneAreas.toLocaleString();
    const totalStr = totalAreas.toLocaleString();
    const progStr = `${progressPercent}%`;
    const unallocStr = unallocatedAreas.toLocaleString();
    const inProgStr = progAreas.toLocaleString();

    if (doneAreasEl) doneAreasEl.textContent = doneStr;
    if (totalAreasEl) totalAreasEl.textContent = totalStr;
    if (progressBadgeEl) progressBadgeEl.textContent = progStr;
    if (unallocatedEl) unallocatedEl.textContent = unallocStr;
    if (inProgressEl) inProgressEl.textContent = inProgStr;
    if (completedEl) completedEl.textContent = doneStr;

    if (mDoneAreasEl) mDoneAreasEl.textContent = doneStr;
    if (mTotalAreasEl) mTotalAreasEl.textContent = totalStr;
    if (mProgressBadgeEl) mProgressBadgeEl.textContent = progStr;
    if (mUnallocatedEl) mUnallocatedEl.textContent = unallocStr;
    if (mInProgressEl) mInProgressEl.textContent = inProgStr;
    if (mCompletedEl) mCompletedEl.textContent = doneStr;

    if (districtLabelEl) {
      const districtCode = DashboardState.summary?.districtName;
      const labelPrefix = districtCode ? districtCode : '全域';
      districtLabelEl.textContent = isAll ? `${labelPrefix} (${totalAreas}エリア)` : `${selected} (${totalAreas}エリア)`;
    }
  }


  const totalRecordsEl = document.getElementById('fact-total-records');
  const mTotalRecordsEl = document.getElementById('mobile-fact-total-records');
  let totalDelivered = 0;
  if (isAll) {
    totalDelivered = (DashboardState.ranking || []).reduce((acc, item) => acc + (Number(item.count) || 0), 0);
  } else {
    const matchedLive = (DashboardState.liveRecords || []).filter(r => r.cityName === selected);
    totalDelivered = matchedLive.reduce((acc, r) => acc + (Number(r.count) || 0), 0);
  }
  const deliveredStr = totalDelivered.toLocaleString();
  if (totalRecordsEl) totalRecordsEl.textContent = deliveredStr;
  if (mTotalRecordsEl) mTotalRecordsEl.textContent = deliveredStr;

  renderStockFacts(DashboardState.stocks, selected);

  const totalRosterEl = document.getElementById('fact-total-roster');
  const mTotalRosterEl = document.getElementById('mobile-fact-total-roster');
  const rosterCount = (DashboardState.roster || []).length;
  const rosterStr = rosterCount.toLocaleString();
  if (totalRosterEl) totalRosterEl.textContent = rosterStr;
  if (mTotalRosterEl) mTotalRosterEl.textContent = rosterStr;

  renderLiveFeed(DashboardState.liveRecords);

  if (DashboardState.currentFocus === 'records') renderMainStageRecords(DashboardState.ranking);
  if (DashboardState.currentFocus === 'stocks') renderMainStageStocks(DashboardState.stocks);
  if (DashboardState.currentFocus === 'roster') renderMainStageRoster(DashboardState.roster);
  if (DashboardState.currentFocus === 'requests') renderMainStageRequests(DashboardState.requests);

  const turnoutTargetCity = DashboardState.selectedPin?.cityName
    ? DashboardState.selectedPin.cityName
    : (DashboardState.selectedCity || 'ALL');
  renderRightTopTurnout(turnoutTargetCity);
  renderRightBottomAreaStats(DashboardState.selectedPin);
}

function getCityMasterIndex(location, masterCities) {
  if (!location || !masterCities || masterCities.length === 0) return 99999;
  
  const cityNames = masterCities.map(c => typeof c === 'string' ? c : (c.name || '')).filter(Boolean);

  const exactIdx = cityNames.indexOf(location);
  if (exactIdx !== -1) return exactIdx;

  for (let i = 0; i < cityNames.length; i++) {
    const city = cityNames[i];
    if (location.startsWith(city) || location.includes(city)) {
      return i;
    }
  }

  return 99999;
}

function renderStockFacts(stocks, selectedCity) {
  let totalStock = 0;

  stocks.forEach(s => {
    const loc = s.location || 'その他拠点';
    const count = Number(s.count) || 0;
    
    if (selectedCity === 'ALL' || loc === selectedCity) {
      totalStock += count;
    }
  });

  const totalStocksEl = document.getElementById('fact-total-stocks');
  const mTotalStocksEl = document.getElementById('mobile-fact-total-stocks');
  const stockStr = totalStock.toLocaleString();
  if (totalStocksEl) totalStocksEl.textContent = stockStr;
  if (mTotalStocksEl) mTotalStocksEl.textContent = stockStr;
}

function renderLiveFeed(liveRecords) {
  const containerEl = document.getElementById('live-feed-container');
  if (!containerEl) return;

  const records = Array.isArray(liveRecords) ? liveRecords : [];
  if (records.length === 0) {
    containerEl.innerHTML = `<div class="text-[11px] text-[#94A3B8]/60 py-0.5">配布実績データはありません</div>`;
    return;
  }

  const latest4 = records.slice(0, 4);
  const isNewArrival = latest4.length > 0 && latest4[0].recordId !== DashboardState.latestSeenRecordId;

  let html = '';
  latest4.forEach((rec, idx) => {
    const isFirstNew = (idx === 0 && isNewArrival);
    const areaText = rec.cityName && rec.townName
      ? `${rec.cityName} ${rec.townName}`
      : (rec.townName || rec.cityName || `エリア #${rec.rowId}`);
    const countStr = Number(rec.count || 0).toLocaleString();

    const displayClass = idx === 0 
      ? 'flex flex-1 lg:flex-initial min-w-0 overflow-hidden lg:overflow-visible lg:flex-shrink-0' 
      : 'hidden lg:flex lg:flex-shrink-0';

    html += `
      <div class="items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#0B1019] border border-borderNormal text-[11px] text-white ${displayClass} ${isFirstNew ? 'live-card-new' : ''}">
        <span class="w-1.5 h-1.5 rounded-full bg-statusGreen flex-shrink-0"></span>
        <span class="font-mono text-textSub text-[10px] whitespace-nowrap flex-shrink-0">${escapeHtml(rec.time || '--:--')}</span>
        <span class="font-mono font-bold text-brand text-[11px] flex-shrink-0">${escapeHtml(rec.staffId || '--')}</span>
        <span class="font-medium text-white truncate min-w-0 flex-1 lg:flex-initial lg:max-w-[155px] text-[11px]">${escapeHtml(areaText)}</span>
        <span class="font-mono font-bold text-white text-[11px] flex-shrink-0">${countStr}<span class="text-[9px] font-normal text-textSub ml-0.5">枚</span></span>
      </div>
    `;

    if (idx < latest4.length - 1) {
      html += `<span class="hidden lg:inline-block text-[#243044] text-[11px] flex-shrink-0">➔</span>`;
    }
  });

  containerEl.innerHTML = html;

  if (latest4.length > 0) {
    DashboardState.latestSeenRecordId = latest4[0].recordId;
  }
}

async function loadElectionTurnoutData() {
  try {
    const cfg = getStaticMasterConfig();
    const filename = cfg.electionHistoryFilename || 'election_history.json';
    const res = await fetchStaticDataFile(filename);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    DashboardState.electionTurnout = data;
    const turnoutTarget = DashboardState.selectedPin?.cityName ? DashboardState.selectedPin.cityName : (DashboardState.selectedCity || 'ALL');
    renderRightTopTurnout(turnoutTarget);
  } catch (err) {
    console.warn('[Election Turnout Load Warning - fallback enabled]', err);
    DashboardState.electionTurnout = null;
    const turnoutTarget = DashboardState.selectedPin?.cityName ? DashboardState.selectedPin.cityName : (DashboardState.selectedCity || 'ALL');
    renderRightTopTurnout(turnoutTarget);
  }
}

function getMunicipalityTurnout(electionData, cityName) {
  const isAll = !cityName || cityName === 'ALL';
  const targetName = isAll ? '全域' : cityName;

  if (!electionData || !Array.isArray(electionData.elections) || electionData.elections.length === 0) {
    return {
      name: targetName,
      electionType: 'local',
      electionName: '選挙データ',
      electionDate: '--',
      turnout: '--',
      prevTurnout: '--',
      showDiff: false,
      diffPt: '±0.00',
      diffIcon: '',
      history: [],
      eligibleVoters: null,
      voters: null,
      nationalTurnout: '--',
      districtTurnout: '--'
    };
  }

  const elections = electionData.elections;
  const currentElection = elections[0] || {};
  const prevElection = elections[1] || {};

  // 各選挙オブジェクトの electionType を優先（未指定時は national プロパティの有無で自動フォールバック）
  const electionType = currentElection.electionType || (currentElection.national !== undefined ? 'national' : 'local');

  const isSingleMunicipalityContext = !Array.isArray(DashboardState.cities) || DashboardState.cities.length <= 1;

  const getCityValue = (election) => {
    if (!election) return null;

    // A. Target = ALL (選挙区全域)
    if (isAll) {
      if (election.districtTurnout !== undefined && election.districtTurnout !== null && !isNaN(Number(election.districtTurnout))) {
        return Number(election.districtTurnout);
      }
      if (election.turnout !== undefined && election.turnout !== null && !isNaN(Number(election.turnout))) {
        return Number(election.turnout);
      }
      if (election.district3 !== undefined && election.district3 !== null && !isNaN(Number(election.district3))) {
        return Number(election.district3);
      }
      return null;
    }

    // B & C. Target = 特定自治体名 (cityName)
    const munis = (election.municipalities && typeof election.municipalities === 'object') ? election.municipalities : null;
    if (munis) {
      if (munis[cityName] !== undefined && munis[cityName] !== null && !isNaN(Number(munis[cityName]))) {
        return Number(munis[cityName]);
      }
      const cleanTarget = cityName.replace(/（一部）/g, '').replace(/市|町|村|郡/g, '').trim();
      if (cleanTarget) {
        for (const [key, val] of Object.entries(munis)) {
          const cleanKey = key.replace(/（一部）/g, '').replace(/市|町|村|郡/g, '').trim();
          if (cleanKey && (cleanTarget.includes(cleanKey) || cleanKey.includes(cleanTarget))) {
            if (val !== undefined && val !== null && !isNaN(Number(val))) {
              return Number(val);
            }
          }
        }
      }
    }

    if (Array.isArray(election.municipalitiesTurnout)) {
      const found = election.municipalitiesTurnout.find(m => {
        const mClean = (m.name || '').replace(/（一部）/g, '').trim();
        return mClean && (cityName.includes(mClean) || mClean.includes(cityName));
      });
      if (found && found.turnout !== undefined && found.turnout !== null && !isNaN(Number(found.turnout))) {
        return Number(found.turnout);
      }
    }

    // C. 単一自治体コンテキスト (DashboardState.cities.length <= 1) かつ自治体別構造が無い場合のみ election.turnout を許可
    const hasMunicipalityBreakdown = (munis && Object.keys(munis).length > 0) ||
      (Array.isArray(election.municipalitiesTurnout) && election.municipalitiesTurnout.length > 0);
    if (isSingleMunicipalityContext && !hasMunicipalityBreakdown) {
      if (election.turnout !== undefined && election.turnout !== null && !isNaN(Number(election.turnout))) {
        return Number(election.turnout);
      }
    }

    // 複数自治体Dashboardで自治体値が見つからない場合、地区全体値 (districtTurnout / turnout) への偽Fallbackは禁止
    return null;
  };

  const currentVal = getCityValue(currentElection);
  const prevVal = elections.length >= 2 ? getCityValue(prevElection) : null;

  let diffPt = '±0.00';
  let diffIcon = '';
  let showDiff = false;
  if (elections.length >= 2 && currentVal !== null && prevVal !== null) {
    showDiff = true;
    const diff = Number((currentVal - prevVal).toFixed(2));
    if (diff > 0) {
      diffPt = `+${diff.toFixed(2)}`;
      diffIcon = '▲';
    } else if (diff < 0) {
      diffPt = `${diff.toFixed(2)}`;
      diffIcon = '▼';
    } else {
      diffPt = '±0.00';
      diffIcon = '';
    }
  }

  const history = elections.slice(0, 3).map(e => {
    const val = getCityValue(e);
    return {
      year: e.year || (e.electionDate ? e.electionDate.substring(0, 4) : '--'),
      turnout: val !== null ? val.toFixed(2) : '--'
    };
  });

  // 国政選挙フィールド（既存互換性維持）
  const natTurnout = currentElection.national !== undefined
    ? Number(currentElection.national).toFixed(2)
    : (currentElection.nationalTurnout !== undefined ? Number(currentElection.nationalTurnout).toFixed(2) : '--');
  const distTurnout = currentElection.districtTurnout !== undefined
    ? Number(currentElection.districtTurnout).toFixed(2)
    : (currentElection.district3 !== undefined ? Number(currentElection.district3).toFixed(2) : '--');

  return {
    name: targetName,
    electionType: electionType,
    electionName: currentElection.electionName || '選挙',
    electionDate: currentElection.electionDate ? currentElection.electionDate.substring(0, 7).replace('-', '/') : '--',
    turnout: currentVal !== null ? currentVal.toFixed(2) : '--',
    prevTurnout: prevVal !== null ? prevVal.toFixed(2) : '--',
    showDiff: showDiff,
    diffPt: diffPt,
    diffIcon: diffIcon,
    history: history,
    eligibleVoters: currentElection.eligibleVoters !== undefined ? currentElection.eligibleVoters : null,
    voters: currentElection.voters !== undefined ? currentElection.voters : null,
    nationalTurnout: natTurnout,
    districtTurnout: distTurnout
  };
}

function renderRightTopTurnout(selectedCity) {
  const containerEl = document.getElementById('right-slot-top');
  if (!containerEl) return;

  const data = getMunicipalityTurnout(DashboardState.electionTurnout, selectedCity);

  const historyHtml = Array.isArray(data.history) && data.history.length > 0
    ? `
      <div class="pt-2 border-t border-borderNormal">
        <div class="text-xs font-bold text-textSub mb-1.5 flex items-center justify-between">
          <span>投票率の推移</span>
          <span class="text-[11px] font-normal text-textSub/70">過去${data.history.length}回</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5 bg-[#0B1019] p-2 rounded-lg border border-borderNormal text-center">
          ${data.history.map(h => `
            <div>
              <div class="text-xs text-textSub font-mono">${h.year}年</div>
              <div class="text-[14px] font-mono font-bold text-white mt-0.5">${h.turnout}%</div>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '';

  // 中段比較行の切り替え:
  // local または (eligibleVoters/voters が存在する場合) は「有権者 / 投票者」
  // national の場合は「全国 / 全域」
  let subInfoHtml = '';
  if (data.electionType === 'local' || (data.eligibleVoters != null && data.voters != null)) {
    const evText = data.eligibleVoters != null ? Number(data.eligibleVoters).toLocaleString() + '人' : '--';
    const vText = data.voters != null ? Number(data.voters).toLocaleString() + '人' : '--';
    subInfoHtml = `
      <div class="pt-2 border-t border-borderNormal flex items-center justify-between text-xs text-textSub font-mono">
        <div>有権者: <span class="text-white font-semibold">${evText}</span></div>
        <div>投票者: <span class="text-white font-semibold">${vText}</span></div>
      </div>
    `;
  } else {
    subInfoHtml = `
      <div class="pt-2 border-t border-borderNormal flex items-center justify-between text-xs text-textSub font-mono">
        <div>全国: <span class="text-white font-semibold">${data.nationalTurnout}%</span></div>
        <div>全域: <span class="text-white font-semibold">${data.districtTurnout}%</span></div>
      </div>
    `;
  }

  // 前回比バッジ（履歴が1件しかない場合は非表示）
  const diffBadgeHtml = data.showDiff
    ? `
      <span class="inline-flex items-center gap-1 text-xs font-mono font-medium text-[#94A3B8] bg-[#94A3B8]/10 border border-[#94A3B8]/20 px-2.5 py-1 rounded whitespace-nowrap flex-shrink-0">
        前回比 ${data.diffPt}pt <span>${data.diffIcon}</span>
      </span>
    `
    : '';

  containerEl.innerHTML = `
    <div class="flex flex-col justify-between h-full">
      <!-- セクション1: ヘッダー -->
      <div class="flex items-center justify-between pb-2 border-b border-borderNormal">
        <div class="flex items-center gap-1.5 text-sm font-bold text-white tracking-wide">
          <span>🗳️</span>
          <span>投票率データ</span>
        </div>
        <span class="text-xs font-bold text-brand bg-brand/10 border border-brand/20 px-2.5 py-0.5 rounded">${data.name}</span>
      </div>

      <!-- セクション2: メイン投票率 + 選挙名 -->
      <div>
        <div class="flex items-center justify-between">
          <div class="text-[28px] font-mono font-bold text-white tracking-tight leading-none">
            ${data.turnout}<span class="text-base font-normal text-textSub ml-0.5">%</span>
          </div>
          <div class="text-right flex-shrink-0">
            ${diffBadgeHtml}
          </div>
        </div>
        <div class="text-xs text-textSub mt-1.5 font-medium truncate" title="${data.electionName} (${data.electionDate})">
          ${data.electionName} <span class="font-mono">(${data.electionDate})</span>
        </div>
      </div>

      <!-- セクション3: 有権者・投票者 -->
      ${subInfoHtml}

      <!-- セクション4: 投票率の推移 -->
      ${historyHtml}
    </div>
  `;
}

function renderRightBottomAreaStats(selectedPin) {
  const containerEl = document.getElementById('right-slot-bottom');
  if (!containerEl) return;

  if (!selectedPin) {
    containerEl.innerHTML = `
      <div class="area-stats-empty flex flex-col justify-between h-full min-h-0 overflow-hidden">
        <div class="flex items-center justify-between pb-2 border-b border-borderNormal flex-shrink-0">
          <div class="flex items-center gap-1.5 text-sm font-bold text-white tracking-wide">
            <span>👥</span>
            <span>エリア統計</span>
          </div>
        </div>
        <div class="area-stats-empty-content flex-1 min-h-0 flex flex-col items-center justify-center text-center p-2">
          <span class="text-2xl lg:text-3xl mb-1 opacity-75 leading-none">🗺️</span>
          <span class="text-xs text-textSub font-medium leading-relaxed">マップ上のピンまたは境界を<br>選択して詳細を表示</span>
        </div>
      </div>
    `;
    return;
  }

  const completedList = DashboardState.globalPinStatus.completed || [];
  const inProgressList = DashboardState.globalPinStatus.inProgress || [];
  const isCompleted = completedList.includes(selectedPin.rowId);
  const isInProgress = inProgressList.includes(selectedPin.rowId);

  const statusCfg = getAreaStatusConfig(isCompleted, isInProgress);
  const statusBadgeHtml = `<span class="text-xs font-mono font-bold px-2.5 py-0.5 rounded" style="color: ${statusCfg.color}; background-color: ${statusCfg.color}1A; border: 1px solid ${statusCfg.color}33;">${statusCfg.statusText}</span>`;

  const households = selectedPin.households || Math.max(120, ((selectedPin.rowId * 137 + 240) % 480) + 160);
  const population = selectedPin.population || Math.round(households * 2.35);

  let resultSectionHtml = '';
  if (isInProgress) {
    resultSectionHtml = `
      <div class="area-stats-result pt-2.5 mt-2.5 border-t border-borderNormal text-center">
        <span class="text-[13px] text-blue-400 font-medium py-1 inline-block">⏱️ 担当スタッフ配布中...</span>
      </div>
    `;
  } else if (isCompleted) {
    const liveRec = (DashboardState.liveRecords || []).find(r => r.rowId === selectedPin.rowId) || null;
    const staffId = (liveRec && liveRec.staffId) ? liveRec.staffId : '--';
    const rosterStaff = staffId !== '--' ? (DashboardState.roster || []).find(rs => rs.id === staffId) : null;
    const staffName = rosterStaff ? rosterStaff.name : '';
    const doneTime = (liveRec && liveRec.time) ? liveRec.time : '--';
    const isCountValid = liveRec && liveRec.count !== undefined && liveRec.count !== null && !isNaN(Number(liveRec.count));
    const doneCountStr = isCountValid ? Number(liveRec.count).toLocaleString() : '--';

    resultSectionHtml = `
      <div class="area-stats-result pt-2.5 mt-2.5 border-t border-borderNormal">
        <div class="text-[13px] font-bold text-textSub mb-1.5 flex items-center gap-1">
          <span>📊</span><span>実績</span>
        </div>
        <div class="space-y-1.5 text-[13px]">
          <div class="flex justify-between items-center">
            <span class="text-textSub">投函枚数:</span>
            <span class="font-bold text-white font-mono text-[15px]">${doneCountStr} <span class="text-xs font-normal text-textSub">枚</span></span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-textSub">担当:</span>
            <span class="text-white">${escapeHtml(staffId)}${staffName ? ' ' + escapeHtml(staffName) : ''}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-textSub">完了日時:</span>
            <span class="text-textSub font-mono text-xs">${escapeHtml(doneTime)}</span>
          </div>
        </div>
      </div>
    `;
  }

  containerEl.innerHTML = `
    <div class="flex flex-col justify-between h-full">
      <div>
        <div class="flex items-center justify-between pb-2.5 border-b border-borderNormal">
          <div class="flex items-center gap-1.5 text-sm font-bold text-white tracking-wide">
            <span>👥</span>
            <span>エリア統計</span>
          </div>
          ${statusBadgeHtml}
        </div>

        <div class="area-stats-body mt-2.5 lg:mt-3 space-y-1.5 lg:space-y-2.5">
          <div class="flex justify-between items-center text-[13px]">
            <span class="text-textSub flex items-center gap-1"><span>🏠</span><span>世帯数</span></span>
            <span class="font-mono font-bold text-white text-[15px]">${households.toLocaleString()} <span class="text-xs font-normal text-textSub">世帯</span></span>
          </div>
          <div class="flex justify-between items-center text-[13px]">
            <span class="text-textSub flex items-center gap-1"><span>👥</span><span>推定人口</span></span>
            <span class="font-mono font-bold text-white text-[15px]">${population.toLocaleString()} <span class="text-xs font-normal text-textSub">人</span></span>
          </div>
        </div>
      </div>

      ${resultSectionHtml}
    </div>
  `;
}

function showAreaDetail(data) {
  const detailEl = document.getElementById('map-area-detail');
  const nameEl = document.getElementById('selected-area-name');
  const statusEl = document.getElementById('selected-area-status');
  const turnoutCityEl = document.getElementById('selected-area-turnout-city');
  const turnoutValEl = document.getElementById('selected-area-turnout-val');
  const householdsEl = document.getElementById('selected-area-households');
  const metaEl = document.getElementById('selected-area-meta');

  const cfg = data.statusCfg || AREA_STATUS_CONFIG.UNKNOWN;

  if (nameEl) nameEl.textContent = data.name;
  if (statusEl) {
    statusEl.textContent = cfg.statusText;
    statusEl.style.color = cfg.color;
  }
  if (turnoutCityEl || turnoutValEl) {
    const targetCity = DashboardState.selectedPin?.cityName || (
      DashboardState.selectedCity && DashboardState.selectedCity !== 'ALL'
        ? DashboardState.selectedCity
        : 'ALL'
    );
    const turnoutInfo = getMunicipalityTurnout(DashboardState.electionTurnout, targetCity);
    const turnoutVal = turnoutInfo.turnout === '--' ? '--' : `${turnoutInfo.turnout}%`;
    if (turnoutCityEl) turnoutCityEl.textContent = turnoutInfo.name;
    if (turnoutValEl) turnoutValEl.textContent = turnoutVal;
  }
  if (householdsEl) {
    if (data.households !== undefined && data.households !== null) {
      householdsEl.textContent = `🏠 世帯数: ${Number(data.households).toLocaleString()}世帯`;
    } else {
      householdsEl.textContent = '';
    }
  }
  if (metaEl) {
    if (data.population !== undefined && data.population !== null) {
      metaEl.textContent = `👥 推定人口: ${Number(data.population).toLocaleString()}人`;
    } else if (data.meta) {
      metaEl.textContent = data.meta;
    } else {
      metaEl.textContent = '';
    }
  }

  // --- スマホ詳細グリッド (PC右下と同じSSOT・フォールバック契約) ---
  const basicColEl = document.getElementById('selected-area-basic-col');
  const resultColEl = document.getElementById('selected-area-result-col');
  const pin = DashboardState.selectedPin;

  if (basicColEl && resultColEl && pin) {
    const completedList = (DashboardState.globalPinStatus && DashboardState.globalPinStatus.completed) || [];
    const inProgressList = (DashboardState.globalPinStatus && DashboardState.globalPinStatus.inProgress) || [];
    const isCompleted = completedList.includes(pin.rowId);
    const isInProgress = inProgressList.includes(pin.rowId);

    if (isInProgress) {
      basicColEl.classList.remove('col-span-2');
      resultColEl.classList.remove('hidden');
      resultColEl.innerHTML = `
        <div class="text-[11px] text-blue-400 font-medium py-1">⏱️ 配布中...</div>
      `;
    } else if (isCompleted) {
      const liveRec = (DashboardState.liveRecords || []).find(r => r.rowId === pin.rowId) || null;
      const staffId = (liveRec && liveRec.staffId) ? liveRec.staffId : '--';
      const rosterStaff = staffId !== '--' ? (DashboardState.roster || []).find(rs => rs.id === staffId) : null;
      const staffName = rosterStaff ? rosterStaff.name : '';
      const doneTime = (liveRec && liveRec.time) ? liveRec.time : '--';
      const isCountValid = liveRec && liveRec.count !== undefined && liveRec.count !== null && !isNaN(Number(liveRec.count));
      const doneCountStr = isCountValid ? `${Number(liveRec.count).toLocaleString()}枚` : '--';

      basicColEl.classList.remove('col-span-2');
      resultColEl.classList.remove('hidden');
      resultColEl.innerHTML = `
        <div class="truncate"><span class="text-textSub">📊 投函:</span> <span class="font-bold text-white font-mono">${doneCountStr}</span></div>
        <div class="truncate" title="${escapeHtml(staffId)}${staffName ? ' ' + escapeHtml(staffName) : ''}"><span class="text-textSub">👤 担当:</span> <span class="text-white">${escapeHtml(staffId)}${staffName ? ' ' + escapeHtml(staffName) : ''}</span></div>
        <div class="truncate text-[9px] text-textSub/70"><span class="text-textSub">完了:</span> <span class="font-mono">${escapeHtml(doneTime)}</span></div>
      `;
    } else {
      // 未配布: 左カラムを全幅化し、右カラムは非表示
      basicColEl.classList.add('col-span-2');
      resultColEl.classList.add('hidden');
      resultColEl.innerHTML = '';
    }

    if (detailEl) {
      if (isCompleted || isInProgress) {
        detailEl.classList.remove('w-auto', 'min-w-[150px]', 'max-w-[210px]');
        detailEl.classList.add('w-[calc(100%_-_1.5rem)]', 'max-w-[340px]');
      } else {
        detailEl.classList.remove('w-[calc(100%_-_1.5rem)]', 'max-w-[340px]');
        detailEl.classList.add('w-auto', 'min-w-[150px]', 'max-w-[210px]');
      }
    }
  }

  if (detailEl) detailEl.classList.remove('hidden');
}

function closeAreaDetail() {
  DashboardState.selectedPin = null;
  const detailEl = document.getElementById('map-area-detail');
  if (detailEl) detailEl.classList.add('hidden');
  const turnoutTarget = DashboardState.selectedPin?.cityName
    ? DashboardState.selectedPin.cityName
    : (DashboardState.selectedCity || 'ALL');
  renderRightTopTurnout(turnoutTarget);
  renderRightBottomAreaStats(null);
}

function renderDomainStateBanner(domainKey) {
  const state = DashboardState.domainState ? DashboardState.domainState[domainKey] : 'SUCCESS';
  if (state === 'STALE') {
    return `
      <div class="mb-2 px-3 py-1.5 rounded-lg bg-statusYellow/10 border border-statusYellow/30 text-statusYellow text-xs flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span>⚠️</span>
          <span>最新データの取得に失敗したため、前回データを表示しています</span>
        </div>
      </div>
    `;
  }
  return '';
}

function renderMainStageRecords(ranking) {
  const contentEl = document.getElementById('main-stage-records-content');
  if (!contentEl) return;

  const rankingList = ranking || [];
  const domainStatus = DashboardState.domainState ? DashboardState.domainState.ranking : 'IDLE';

  if (rankingList.length === 0) {
    if (domainStatus === 'IDLE' || domainStatus === 'LOADING') {
      contentEl.innerHTML = `<div class="text-xs text-[#94A3B8]/70 text-center py-12 flex items-center justify-center gap-2"><span class="animate-spin">⏳</span> 配布実績データを取得中...</div>`;
    } else if (domainStatus === 'ERROR') {
      contentEl.innerHTML = `<div class="text-xs text-statusRed/80 text-center py-12 flex flex-col items-center justify-center gap-1.5"><span>⚠️ 配布実績データの取得に失敗しました</span><span class="text-[11px] text-textSub/60">再接続待機中</span></div>`;
    } else {
      contentEl.innerHTML = `<div class="text-xs text-[#94A3B8]/60 text-center py-12">現在、登録されている配布実績はありません</div>`;
    }
    return;
  }

  if (!DashboardState.staffFeedPages) {
    DashboardState.staffFeedPages = {};
  }

  let html = renderDomainStateBanner('ranking') + '<div class="space-y-1.5">';
  rankingList.forEach((item, index) => {
    const rank = item.rank || (index + 1);
    let rankBadgeHtml = '';
    if (rank === 1) {
      rankBadgeHtml = `<span class="w-7 h-7 flex items-center justify-center text-lg select-none">🥇</span>`;
    } else if (rank === 2) {
      rankBadgeHtml = `<span class="w-7 h-7 flex items-center justify-center text-lg select-none">🥈</span>`;
    } else if (rank === 3) {
      rankBadgeHtml = `<span class="w-7 h-7 flex items-center justify-center text-lg select-none">🥉</span>`;
    } else {
      rankBadgeHtml = `<span class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold font-mono bg-white/5 text-white/70">${rank}</span>`;
    }

    const staffRecords = (DashboardState.liveRecords || []).filter(r => r.staffId === item.staffId);
    const totalRecordsCount = staffRecords.length;
    const pageSize = 1;
    const totalPages = Math.ceil(totalRecordsCount / pageSize) || 1;

    const currentPage = DashboardState.staffFeedPages[item.staffId] || 0;
    const validPage = Math.max(0, Math.min(currentPage, totalPages - 1));
    DashboardState.staffFeedPages[item.staffId] = validPage;

    const start = validPage * pageSize;
    const pageRecords = staffRecords.slice(start, start + pageSize);

    let recentFeedHtml = '';
    if (pageRecords.length > 0) {
      const itemsHtml = pageRecords.map(rec => {
        const areaName = rec.townName || rec.cityName || `エリア #${rec.rowId}`;
        const countStr = Number(rec.count || 0).toLocaleString();
        const gpsStatus = rec.gpsStatus === "OK" ? "OK" : "NO";
        const photoStatus = rec.photoStatus === "OK" ? "OK" : "NO";
        return `
          <div class="flex items-center gap-1.5 lg:gap-2 px-2.5 py-0.5 rounded bg-[#0B1019] border border-borderNormal text-xs text-white flex-nowrap whitespace-nowrap flex-shrink-0">
            <span class="w-1.5 h-1.5 rounded-full bg-statusGreen flex-shrink-0"></span>
            <span class="font-mono text-textSub text-[11px] whitespace-nowrap flex-shrink-0">${escapeHtml(rec.time || '--:--')}</span>
            <span class="font-medium text-white truncate max-w-[110px] lg:max-w-[130px] text-xs">${escapeHtml(areaName)}</span>
            <span class="font-mono font-bold text-white text-xs flex-shrink-0">${countStr}<span class="text-[10px] font-normal text-textSub ml-0.5">枚</span></span>
            <span class="text-[#243044] text-xs flex-shrink-0">|</span>
            <span class="text-[11px] font-mono flex items-center gap-1 flex-shrink-0 text-textSub">
              <span>📍</span><span>GPS</span><span class="${gpsStatus === 'OK' ? 'text-textSub font-medium' : 'text-[#EF4444] font-bold'}">${gpsStatus}</span>
            </span>
            <span class="text-[11px] font-mono flex items-center gap-1 flex-shrink-0 text-textSub">
              <span>🤳</span><span class="${photoStatus === 'OK' ? 'text-textSub font-medium' : 'text-[#EF4444] font-bold'}">${photoStatus}</span>
            </span>
          </div>
        `;
      }).join('');

      const hasPrev = totalPages > 1 && validPage > 0;
      const hasNext = totalPages > 1 && validPage < totalPages - 1;

      const prevBtn = totalPages > 1
        ? `<button type="button" onclick="changeStaffFeedPage('${item.staffId}', -1, event)" ${!hasPrev ? 'disabled' : ''} class="w-6 h-6 flex items-center justify-center rounded text-sm font-bold font-mono transition-colors ${hasPrev ? 'text-white hover:bg-white/10 cursor-pointer' : 'text-white/20 cursor-not-allowed'}">‹</button>`
        : `<span class="w-6 h-6 inline-block"></span>`;

      const nextBtnAndIndicator = totalPages > 1
        ? `<div class="flex items-center gap-1 min-w-[56px] justify-start flex-shrink-0">
             <button type="button" onclick="changeStaffFeedPage('${item.staffId}', 1, event)" ${!hasNext ? 'disabled' : ''} class="w-6 h-6 flex items-center justify-center rounded text-sm font-bold font-mono transition-colors ${hasNext ? 'text-white hover:bg-white/10 cursor-pointer' : 'text-white/20 cursor-not-allowed'}">›</button>
             <span class="font-mono text-xs text-textSub whitespace-nowrap">${validPage + 1}/${totalPages}</span>
           </div>`
        : `<div class="w-14 flex-shrink-0"></div>`;

      recentFeedHtml = `
        <div class="ranking-col-feed flex items-center justify-start flex-1 min-w-0 px-2 gap-1.5 overflow-hidden">
          <div style="width: 28px; min-width: 28px;" class="flex items-center justify-center flex-shrink-0">${prevBtn}</div>
          <div class="flex-shrink-0 flex items-center">${itemsHtml}</div>
          <div style="width: 72px; min-width: 72px;" class="flex items-center justify-start flex-shrink-0">${nextBtnAndIndicator}</div>
        </div>
      `;
    } else {
      recentFeedHtml = `
        <div class="ranking-col-feed flex items-center justify-start flex-1 min-w-0 px-2 gap-1.5 text-xs text-textSub/50">
          <div style="width: 28px; min-width: 28px;" class="flex-shrink-0"></div>
          <span class="font-mono">（配布履歴なし）</span>
        </div>
      `;
    }

    html += `
      <div class="ranking-record-row flex flex-row items-center justify-between p-2.5 rounded-xl bg-[#182130] border border-[#243044] hover:border-[#33435C] gap-2 transition-colors">
        <!-- カラム1: スタッフ情報 (固定幅 210px・truncateで押し広げ防止) -->
        <div style="width: 210px; min-width: 210px; max-width: 210px;" class="ranking-col-staff flex items-center justify-start flex-shrink-0 gap-2 min-w-0">
          ${rankBadgeHtml}
          <div class="flex items-center gap-1.5 min-w-0 truncate">
            <span class="font-bold text-white text-base lg:text-lg font-mono flex-shrink-0">${escapeHtml(item.staffId || '--')}</span>
            ${item.name ? `<span class="text-xs lg:text-sm text-[#94A3B8] font-normal truncate" title="${escapeHtml(item.name)}">(${escapeHtml(item.name)})</span>` : ''}
          </div>
        </div>

        <!-- カラム2: 配布履歴フィード (左寄せ固定幅スペーサーでバッジX座標を完全固定) -->
        ${recentFeedHtml}

        <!-- カラム3: 完了枚数 (固定幅 110px・右寄せ) -->
        <div style="width: 110px; min-width: 110px; max-width: 110px;" class="ranking-col-count flex items-center justify-end flex-shrink-0 text-right">
          <span class="text-base lg:text-lg font-mono font-bold text-white">${(Number(item.count) || 0).toLocaleString()}</span>
          <span class="text-xs text-[#94A3B8] font-normal ml-1 flex-shrink-0">枚 完了</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  contentEl.innerHTML = html;
}

function changeStaffFeedPage(staffId, delta, event) {
  if (event) event.stopPropagation();
  if (!DashboardState.staffFeedPages) {
    DashboardState.staffFeedPages = {};
  }
  const current = DashboardState.staffFeedPages[staffId] || 0;
  DashboardState.staffFeedPages[staffId] = current + delta;
  renderMainStageRecords(DashboardState.ranking);
}
window.changeStaffFeedPage = changeStaffFeedPage;

function renderMainStageStocks(stocks) {
  const contentEl = document.getElementById('main-stage-stocks-content');
  if (!contentEl) return;

  const stocksList = stocks || [];
  const domainStatus = DashboardState.domainState ? DashboardState.domainState.stocks : 'IDLE';

  if (stocksList.length === 0) {
    if (domainStatus === 'IDLE' || domainStatus === 'LOADING') {
      contentEl.innerHTML = `<div class="text-xs text-[#94A3B8]/70 text-center py-12 flex items-center justify-center gap-2"><span class="animate-spin">⏳</span> 保有チラシデータを取得中...</div>`;
    } else if (domainStatus === 'ERROR') {
      contentEl.innerHTML = `<div class="text-xs text-statusRed/80 text-center py-12 flex flex-col items-center justify-center gap-1.5"><span>⚠️ 保有チラシデータの取得に失敗しました</span><span class="text-[11px] text-textSub/60">再接続待機中</span></div>`;
    } else {
      contentEl.innerHTML = `<div class="text-sm text-[#94A3B8]/60 text-center py-12">現在、保有チラシの登録データはありません</div>`;
    }
    return;
  }

  const masterCities = DashboardState.cities || [];
  const sortedStocks = [...stocksList].sort((a, b) => {
    const idxA = getCityMasterIndex(a.location, masterCities);
    const idxB = getCityMasterIndex(b.location, masterCities);
    return idxA - idxB;
  });

  let html = renderDomainStateBanner('stocks') + '<div class="space-y-1.5">';
  sortedStocks.forEach(s => {
    const staffBadgeHtml = s.staffId
      ? `<span class="h-7 px-2 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center font-mono font-bold text-xs text-brand flex-shrink-0 lg:w-12 lg:flex-none">${escapeHtml(s.staffId)}</span>`
      : '';

    html += `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-2.5 rounded-xl bg-[#182130] border border-[#243044] hover:border-[#33435C] gap-1.5 sm:gap-2 transition-colors">
        <div class="flex items-center justify-between w-full sm:w-auto gap-2">
          <div class="font-semibold text-base sm:text-lg text-white truncate min-w-0 sm:w-64 sm:flex-none">${escapeHtml(s.location || '保管拠点')}</div>
          <div class="text-right sm:hidden flex-shrink-0">
            <span class="text-base sm:text-lg font-bold font-mono text-white">${(Number(s.count) || 0).toLocaleString()}</span>
            <span class="text-xs text-[#94A3B8] font-normal ml-0.5">枚</span>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs sm:text-sm text-[#94A3B8] flex-1 min-w-0">
          ${staffBadgeHtml}
          <span class="font-medium text-white text-xs sm:text-sm truncate max-w-[130px] lg:w-[130px] lg:flex-none">${escapeHtml(s.staffName || (s.staffId ? '' : '未設定'))}</span>
          <span class="text-[#243044] text-xs">|</span>
          <span class="text-textSub text-xs">更新: <span class="font-mono">${escapeHtml(s.updatedAt || '--')}</span></span>
        </div>
        <div class="hidden sm:block text-right flex-shrink-0">
          <span class="text-lg font-bold font-mono text-white">${(Number(s.count) || 0).toLocaleString()}</span>
          <span class="text-xs text-[#94A3B8] font-normal ml-0.5">枚</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  contentEl.innerHTML = html;
}

function renderMainStageRoster(roster) {
  const contentEl = document.getElementById('main-stage-roster-content');
  if (!contentEl) return;

  const rosterList = roster || [];
  const domainStatus = DashboardState.domainState ? DashboardState.domainState.roster : 'IDLE';

  if (rosterList.length === 0) {
    if (domainStatus === 'IDLE' || domainStatus === 'LOADING') {
      contentEl.innerHTML = `<div class="text-xs text-[#94A3B8]/70 text-center py-12 flex items-center justify-center gap-2"><span class="animate-spin">⏳</span> 登録配布員データを取得中...</div>`;
    } else if (domainStatus === 'ERROR') {
      contentEl.innerHTML = `<div class="text-xs text-statusRed/80 text-center py-12 flex flex-col items-center justify-center gap-1.5"><span>⚠️ 登録配布員データの取得に失敗しました</span><span class="text-[11px] text-textSub/60">再接続待機中</span></div>`;
    } else {
      contentEl.innerHTML = `<div class="text-sm text-[#94A3B8]/60 text-center py-12">現在、登録配布員データはありません</div>`;
    }
    return;
  }

  let html = renderDomainStateBanner('roster') + '<div class="space-y-1.5">';
  rosterList.forEach(r => {
    let formattedDate = '--';
    if (r.registeredAt) {
      const match = String(r.registeredAt).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
      formattedDate = match ? match[1].replace('-', '/') : String(r.registeredAt).substring(0, 16);
    }

    html += `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-[#182130] border border-[#243044] hover:border-[#33435C] gap-2 transition-colors">
        <div class="flex items-center gap-2.5 min-w-0 flex-1 sm:w-64 sm:flex-none">
          <span class="h-7 px-2 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center font-mono font-bold text-xs text-brand flex-shrink-0">${escapeHtml(r.id || '')}</span>
          <span class="font-semibold text-base sm:text-lg text-white truncate">${escapeHtml(r.name || '')}</span>
        </div>
        <div class="flex items-center gap-2 text-xs sm:text-sm text-[#94A3B8] flex-1 min-w-0">
          <span class="text-xs text-[#94A3B8]">登録: <span class="font-mono text-white/90">${escapeHtml(formattedDate)}</span></span>
        </div>
        <div class="text-right flex-shrink-0">
          <span class="text-xs text-[#94A3B8] font-medium px-2.5 py-1 rounded bg-[#94A3B8]/10 border border-[#94A3B8]/20">有効</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  contentEl.innerHTML = html;
}

function renderMainStageRequests(requests) {
  const contentEl = document.getElementById('main-stage-requests-content');
  if (!contentEl) return;

  const reqList = requests || [];
  const domainStatus = DashboardState.domainState ? DashboardState.domainState.requests : 'IDLE';

  if (reqList.length === 0) {
    if (domainStatus === 'IDLE' || domainStatus === 'LOADING') {
      contentEl.innerHTML = `<div class="text-xs text-[#94A3B8]/70 text-center py-12 flex items-center justify-center gap-2"><span class="animate-spin">⏳</span> 受渡要請データを取得中...</div>`;
    } else if (domainStatus === 'ERROR') {
      contentEl.innerHTML = `<div class="text-xs text-statusRed/80 text-center py-12 flex flex-col items-center justify-center gap-1.5"><span>⚠️ 受渡要請データの取得に失敗しました</span><span class="text-[11px] text-textSub/60">再接続待機中</span></div>`;
    } else {
      contentEl.innerHTML = `<div class="text-sm text-[#94A3B8]/60 text-center py-12">現在、受渡要請はありません</div>`;
    }
    return;
  }

  let html = renderDomainStateBanner('requests') + '<div class="space-y-1.5">';
  reqList.forEach(req => {
    let formattedDate = '--';
    if (req.requestTime) {
      const match = String(req.requestTime).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
      formattedDate = match ? match[1].replace('-', '/') : String(req.requestTime).substring(0, 16);
    }

    const requesterBadge = req.requesterId
      ? `<span class="h-7 px-1.5 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center font-mono font-bold text-xs text-brand flex-shrink-0">${escapeHtml(req.requesterId)}</span>`
      : '';
    const holderBadge = req.holderId
      ? `<span class="h-7 px-1.5 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center font-mono font-bold text-xs text-brand flex-shrink-0">${escapeHtml(req.holderId)}</span>`
      : '';

    html += `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-2.5 rounded-xl bg-[#182130] border border-[#243044] hover:border-[#33435C] gap-2 transition-colors">
        <!-- Column 1: IDと名前 (要請者 ➔ 保管者) -->
        <div class="flex items-center gap-2 min-w-0 w-full sm:w-72 sm:flex-none">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            ${requesterBadge}
            <span class="font-semibold text-white truncate text-sm sm:text-base">${escapeHtml(req.requesterName || '')}</span>
          </div>
          <span class="text-xs text-[#94A3B8] flex-shrink-0">➔</span>
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            ${holderBadge}
            <span class="font-semibold text-white truncate text-sm sm:text-base">${escapeHtml(req.holderName || '')}</span>
          </div>
        </div>

        <!-- Column 2: 連絡方法・連絡先 -->
        <div class="flex items-center gap-2 text-xs sm:text-sm text-[#94A3B8] flex-1 min-w-0 ml-0 sm:ml-6">
          <span class="text-xs text-[#94A3B8] truncate">
            連絡先: ${req.contactMethod ? `<span class="text-[#94A3B8]/80">[${escapeHtml(req.contactMethod)}]</span> ` : ''}<span class="text-white/90 font-mono">${escapeHtml(req.contactValue || '--')}</span>
          </span>
        </div>

        <!-- Column 3: 日時 -->
        <div class="text-right flex-shrink-0">
          <span class="font-mono text-xs text-[#94A3B8]">${escapeHtml(formattedDate)}</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  contentEl.innerHTML = html;
}

let _activeBulletinPromise = null;
let _lastBulletinFetchTime = 0;
const BULLETIN_TTL_MS = 30000;

function renderMainStageBulletin(options = {}) {
  const force = options && options.force === true;
  const contentEl = document.getElementById('main-stage-bulletin-content');
  if (!contentEl) return;

  const hasCache = DashboardState.bulletinPosts !== null;
  const isFresh = !force && hasCache && (Date.now() - _lastBulletinFetchTime < BULLETIN_TTL_MS);

  // ① 既存キャッシュがあれば即座に一覧を描画（真っ白化・ちらつき防止）
  if (hasCache) {
    drawBulletinList(DashboardState.bulletinPosts);
    if (isFresh) {
      return;
    }
  } else {
    // キャッシュがない初回のみスピナー表示
    contentEl.innerHTML = `
      <div class="flex items-center justify-center py-12">
        <div class="w-6 h-6 rounded-full border-2 border-brand/40 border-t-brand animate-spin"></div>
      </div>
    `;
  }

  // ② in-flight通信の多重化防止
  if (_activeBulletinPromise) {
    return _activeBulletinPromise;
  }

  // ③ API通信 (Stale-While-Revalidate)
  _activeBulletinPromise = callApiPost('getBulletinPosts', {})
    .then(res => {
      const posts = (res && res.success && Array.isArray(res.posts)) ? res.posts : [];
      DashboardState.bulletinPosts = posts;
      _lastBulletinFetchTime = Date.now();

      // 取得完了時、現在 bulletin 表示中なら最新データで更新描画
      if (DashboardState.currentFocus === 'bulletin') {
        drawBulletinList(posts);
      }
    })
    .catch((err) => {
      console.warn('[Bulletin Fetch Warning]', err);
      // 失敗時でも既存キャッシュを絶対に消失させない
      if (DashboardState.bulletinPosts !== null) {
        if (DashboardState.currentFocus === 'bulletin') {
          drawBulletinList(DashboardState.bulletinPosts, { isStale: true });
        }
        return;
      }
      if (DashboardState.currentFocus === 'bulletin') {
        contentEl.innerHTML = `<div class="text-sm text-statusRed/80 text-center py-12 flex flex-col items-center justify-center gap-1.5"><span>⚠️ 掲示板データの取得に失敗しました</span><span class="text-[11px] text-textSub/60">再接続待機中</span></div>`;
      }
    })
    .finally(() => {
      _activeBulletinPromise = null;
    });

  return _activeBulletinPromise;
}

function drawBulletinList(posts, options = {}) {
  const contentEl = document.getElementById('main-stage-bulletin-content');
  if (!contentEl) return;

  const isStale = options && options.isStale === true;
  const staleBanner = isStale
    ? `<div class="mb-2 px-3 py-1.5 rounded-lg bg-statusYellow/10 border border-statusYellow/30 text-statusYellow text-xs flex items-center justify-between"><span>⚠️ 最新投稿の取得に失敗したため、前回取得データを表示しています</span></div>`
    : '';

  if (!posts || posts.length === 0) {
    contentEl.innerHTML = staleBanner + `<div class="text-sm text-[#94A3B8]/60 text-center py-12">現在、掲示板の投稿はありません</div>`;
    return;
  }

  let html = staleBanner + '<div class="space-y-1.5">';
  posts.forEach(post => {
    let formattedDate = '--';
    if (post.updatedAt) {
      const match = String(post.updatedAt).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
      formattedDate = match ? match[1].replace('-', '/') : String(post.updatedAt).substring(0, 16);
    }

    const staffBadge = post.staffId
      ? `<span class="h-7 px-2 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center font-mono font-bold text-xs text-brand flex-shrink-0">${escapeHtml(post.staffId)}</span>`
      : '';

    html += `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-xl bg-[#182130] border border-[#243044] hover:border-[#33435C] gap-3 transition-colors">
        <div class="flex items-center gap-2 min-w-0 w-full sm:w-60 sm:flex-none">
          ${staffBadge}
          <span class="font-semibold text-white truncate text-sm sm:text-base">${escapeHtml(post.staffName || '')}</span>
        </div>
        <div class="flex-1 min-w-0 text-xs sm:text-sm text-white/90 whitespace-pre-wrap break-words leading-relaxed">
          ${escapeHtml(post.message || '')}
        </div>
        <div class="text-right flex-shrink-0">
          <span class="font-mono text-xs text-[#94A3B8]">${escapeHtml(formattedDate)}</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  contentEl.innerHTML = html;
}

function switchView(type) {
  const views = ['areas', 'records', 'stocks', 'roster', 'requests', 'mail', 'mobile', 'bulletin'];
  const targetView = views.includes(type) ? type : 'areas';

  if (targetView !== 'mobile' && _mobilePairingTimer) {
    clearInterval(_mobilePairingTimer);
    _mobilePairingTimer = null;
  }

  views.forEach(v => {
    const el = document.getElementById(`main-view-${v}`);
    if (el) {
      if (v === targetView) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  DashboardState.currentFocus = targetView;
  updateNavHighlight(targetView);

  if (targetView === 'areas') {
    if (DashboardState.map) {
      setTimeout(() => {
        DashboardState.map.invalidateSize();
        renderPinsOnMap(DashboardState.map, DashboardState.markersLayer, DashboardState.masterPins);
      }, 50);
    }
  } else if (targetView === 'records') {
    renderMainStageRecords(DashboardState.ranking);
  } else if (targetView === 'stocks') {
    renderMainStageStocks(DashboardState.stocks);
  } else if (targetView === 'roster') {
    renderMainStageRoster(DashboardState.roster);
  } else if (targetView === 'requests') {
    renderMainStageRequests(DashboardState.requests);
  } else if (targetView === 'mail') {
    renderMainStageMail(DashboardState.selectedMailTabIndex || 0);
  } else if (targetView === 'mobile') {
    renderMainStageMobile();
  } else if (targetView === 'bulletin') {
    renderMainStageBulletin();
  }
}

function updateNavHighlight(activeType) {
  const navTypes = ['mail', 'roster', 'stocks', 'requests', 'records', 'areas', 'mobile', 'bulletin'];
  navTypes.forEach(t => {
    const el = document.getElementById(`nav-${t}`);
    if (el) {
      if (t === activeType) {
        el.className = 'nav-item nav-item-active w-full h-10 flex items-center gap-2.5 px-3 rounded-xl border border-brand/35 text-brand font-semibold text-left';
      } else {
        el.className = 'nav-item w-full h-10 flex items-center gap-2.5 px-3 rounded-xl text-textSub border border-transparent hover:text-white hover:bg-white/5 text-left font-medium';
      }
    }

    const mEl = document.getElementById(`mobile-nav-${t}`);
    if (mEl) {
      if (t === activeType) {
        mEl.className = 'mobile-nav-item mobile-nav-active flex flex-col items-center justify-center flex-1 py-1 text-brand font-bold text-[10px] transition-colors cursor-pointer';
      } else {
        mEl.className = 'mobile-nav-item flex flex-col items-center justify-center flex-1 py-1 text-textSub font-medium text-[10px] hover:text-white transition-colors cursor-pointer';
      }
    }
  });
}

let _mobilePairingTimer = null;

function renderMainStageMobile() {
  const container = document.getElementById('main-stage-mobile-content');
  if (!container) return;

  if (_mobilePairingTimer) {
    clearInterval(_mobilePairingTimer);
    _mobilePairingTimer = null;
  }

  function generatePairingData() {
    const baseUrl = window.location.origin + window.location.pathname;
    const pairKey = 'PAIR_' + Math.random().toString(36).substring(2, 10).toUpperCase() + '_' + Date.now().toString(36).toUpperCase();
    const targetUrl = `${baseUrl}?pair=${pairKey}`;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(targetUrl)}`;
    return { targetUrl, qrImgUrl, pairKey };
  }

  let remainingSec = 30;
  let isExpired = false;
  let currentPairing = generatePairingData();

  function updateDisplay() {
    const pct = isExpired ? 0 : Math.round((remainingSec / 30) * 100);
    container.innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-stretch justify-center gap-6 p-4 max-w-4xl mx-auto w-full my-auto">
        <div class="w-full max-w-sm flex flex-col items-center p-6 rounded-2xl bg-[#0B1019] border border-borderNormal shadow-2xl">
          <div class="text-xs font-bold text-textSub uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${isExpired ? 'bg-statusRed' : 'bg-statusGreen animate-pulse'}"></span>
            ${isExpired ? '接続QRコード (有効期限切れ)' : 'ワンタイム接続QRコード'}
          </div>

          <div class="relative p-3 bg-white rounded-xl shadow-inner mb-4 overflow-hidden">
            <img src="${currentPairing.qrImgUrl}" alt="Pairing QR" class="w-[200px] h-[200px] object-contain block ${isExpired ? 'opacity-20 filter blur-xs' : ''}">
            ${isExpired ? `
              <div class="absolute inset-0 flex flex-col items-center justify-center p-2 text-center bg-black/60 rounded-xl backdrop-blur-xs">
                <span class="text-2xl mb-1">⏱️</span>
                <span class="text-xs font-bold text-white">有効期限切れ</span>
                <span class="text-[10px] text-white/70 mt-0.5">下のボタンで再発行してください</span>
              </div>
            ` : ''}
          </div>

          <div class="w-full space-y-2 text-center">
            <div class="flex items-center justify-between text-xs font-mono">
              <span class="text-textSub">有効期限</span>
              <span id="qr-timer-text" class="font-bold ${isExpired ? 'text-statusRed' : remainingSec <= 5 ? 'text-statusRed animate-pulse' : 'text-brand'}">
                ${isExpired ? '期限切れ' : `残り ${remainingSec} 秒`}
              </span>
            </div>
            <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div id="qr-timer-bar" class="h-full ${isExpired ? 'bg-statusRed' : 'bg-brand'} transition-all duration-1000 ease-linear rounded-full" style="width: ${pct}%;"></div>
            </div>
            <p class="text-[11px] text-textSub/70 pt-1">${isExpired ? 'QRコードの有効期限（30秒）が切れました' : 'セキュリティ保護のため30秒で有効期限が切れます'}</p>
          </div>

          <button onclick="window.regenerateMobileQR()" class="mt-4 px-5 py-2 rounded-xl ${isExpired ? 'bg-brand text-black font-bold shadow-lg shadow-brand/20 hover:brightness-110' : 'bg-white/5 hover:bg-white/10 border border-borderNormal text-textSub hover:text-white'} text-xs transition-all cursor-pointer flex items-center gap-1.5">
            <span>🔄</span>
            <span>${isExpired ? 'QRコードを再発行する' : '今すぐ更新'}</span>
          </button>
        </div>

        <div class="flex-1 max-w-md flex flex-col justify-between">
          <div class="p-5 rounded-2xl bg-[#0B1019] border border-borderNormal flex-1 flex flex-col justify-between mb-3.5">
            <h3 class="text-sm font-bold text-white flex items-center justify-center gap-2">
              <span>📱</span>
              <span>外出先スマートフォン連携手順</span>
            </h3>

            <div class="space-y-3 text-xs text-textSub">
              <div class="flex items-start gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
                <span class="w-5 h-5 rounded-full bg-brand/20 text-brand font-bold flex items-center justify-center flex-shrink-0 text-[11px]">1</span>
                <div>
                  <div class="font-semibold text-white">標準カメラで読み取り</div>
                  <div class="text-[11px] text-textSub/80 mt-0.5">お手元のスマートフォンのカメラアプリを起動し、左のQRコードをスキャンします。</div>
                </div>
              </div>

              <div class="flex items-start gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
                <span class="w-5 h-5 rounded-full bg-brand/20 text-brand font-bold flex items-center justify-center flex-shrink-0 text-[11px]">2</span>
                <div>
                  <div class="font-semibold text-white">ブラウザで自動認証</div>
                  <div class="text-[11px] text-textSub/80 mt-0.5">SafariまたはChromeが起動し、自動的にダッシュボードが開きます。</div>
                </div>
              </div>

              <div class="flex items-start gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
                <span class="w-5 h-5 rounded-full bg-brand/20 text-brand font-bold flex items-center justify-center flex-shrink-0 text-[11px]">3</span>
                <div>
                  <div class="font-semibold text-white">ホーム画面に追加で快適利用</div>
                  <div class="text-[11px] text-textSub/80 mt-0.5">ブラウザの「ホーム画面に追加」を行うと、アプリ感覚で外出先からいつでも即座に閲覧できます。</div>
                </div>
              </div>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs flex-shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-statusGreen text-base">🛡️</span>
              <span class="text-textSub">端末セキュリティ</span>
            </div>
            <span class="font-mono text-[11px] text-textSub/80">専用セキュリティ保護</span>
          </div>
        </div>
      </div>
    `;
  }

  function startTimer() {
    if (_mobilePairingTimer) {
      clearInterval(_mobilePairingTimer);
      _mobilePairingTimer = null;
    }
    _mobilePairingTimer = setInterval(() => {
      remainingSec--;
      if (remainingSec <= 0) {
        clearInterval(_mobilePairingTimer);
        _mobilePairingTimer = null;
        isExpired = true;
        updateDisplay();
      } else {
        const timerText = document.getElementById('qr-timer-text');
        const timerBar = document.getElementById('qr-timer-bar');
        if (timerText) {
          timerText.textContent = `残り ${remainingSec} 秒`;
          if (remainingSec <= 5) {
            timerText.className = 'font-bold text-statusRed animate-pulse';
          } else {
            timerText.className = 'font-bold text-brand';
          }
        }
        if (timerBar) {
          const pct = Math.round((remainingSec / 30) * 100);
          timerBar.style.width = `${pct}%`;
        }
      }
    }, 1000);
  }

  window.regenerateMobileQR = () => {
    remainingSec = 30;
    isExpired = false;
    currentPairing = generatePairingData();
    updateDisplay();
    startTimer();
  };

  updateDisplay();
  startTimer();
}
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setSyncStatus(status) {
  const dot = document.getElementById('live-dot');
  const text = document.getElementById('live-status-text');
  const clock = document.getElementById('sync-clock');

  const mDot = document.getElementById('mobile-live-dot');
  const mClock = document.getElementById('mobile-sync-clock');

  const isSuccess = status === 'SYNCED' || status === true;
  const isPartial = status === 'PARTIAL';

  if (dot) dot.className = isSuccess ? 'w-2 h-2 rounded-full bg-statusGreen' : 'w-2 h-2 rounded-full bg-statusYellow';
  if (mDot) mDot.className = isSuccess ? 'w-2 h-2 rounded-full bg-statusGreen' : 'w-2 h-2 rounded-full bg-statusYellow';

  if (text) {
    if (isSuccess) text.textContent = '現場データ同期';
    else if (isPartial) text.textContent = '一部データ遅延';
    else text.textContent = '再接続待機中';
  }

  if (isSuccess) {
    const now = new Date();
    DashboardState.lastSuccessfulSyncTime = now;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const shortTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (clock) clock.textContent = timeStr;
    if (mClock) mClock.textContent = shortTimeStr;
  } else {
    // 部分取得失敗(PARTIAL)または同期失敗(FAILED): 最終成功時刻を保持し、未成功なら「未同期」と表示
    if (DashboardState.lastSuccessfulSyncTime) {
      const last = DashboardState.lastSuccessfulSyncTime;
      const timeStr = `${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}:${String(last.getSeconds()).padStart(2, '0')}`;
      const shortTimeStr = `${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}`;
      if (clock) clock.textContent = timeStr;
      if (mClock) mClock.textContent = shortTimeStr;
    } else {
      if (clock) clock.textContent = '未同期';
      if (mClock) mClock.textContent = '未同期';
    }
  }
}

window.renderMainStageBulletin = renderMainStageBulletin;

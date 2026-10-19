/**
 * GAS v2（最強安定・統合版） - 設定モジュール
 * - 全体の動作パラメータ管理
 * - Phase 14: Runtime Config System (OS化)
 */

// ==========================================
// RUNTIME OS CONFIGURATION
// ==========================================

const DEFAULT_STORE = {
  "DEFAULT": {
    VERSION: "2.2.0 (Mobile & Pro Integrated)",
    MODE: "production",
    PATH: {
      CSV: "/reference/",
      CORE: "v2_core.gs",
      API: "v2_api.gs"
    },

    // ファイル名設定
    TARGET_GOAL: 300000,

    // シート名設定
    SHEET_GUIDE: "初めての方「使い方ガイド」",
    SHEET_ROSTER: "名簿",
    SHEET_TEMPLATE: "原本",
    SHEET_POSTAL: "郵便番号",
    SHEET_DISTRICT: "区割り",
    SHEET_MASTER_EXPORT: "📥 集計用マスターデータ",
    SHEET_REPORT: "📄 活動報告書",
    SHEET_MANUAL: "📖 らくらくマニュアル",
    SHEET_SYSTEM_CACHE: "__SYSTEM_CACHE__",
    SHEET_STORAGE: "保有チラシ枚数",
    SHEET_ADMIN: "管理者ID",
    SHEET_HANDOVER_HISTORY: "受渡要請履歴",

    // 動作設定
    CHUNK_SIZE: 10,
    ROW_HEIGHT_STAFF: 60,
    DEFAULTS: {},

    // 参照データソース基盤 (REFERENCE_FILES)
    REFERENCE_FILES: {},

    // Phase 15: Strategic Engine Map
    DISTRICT_MAP: {}
  }
};

function loadConfigStore() {
  try {
    const cache = CacheService.getScriptCache().get("CONFIG_STORE");
    if (cache) return JSON.parse(cache);

    const storeRaw = PropertiesService.getScriptProperties().getProperty("CONFIG_STORE");

    let parsed;
    if (!storeRaw) {
      parsed = DEFAULT_STORE;
    } else {
      parsed = JSON.parse(storeRaw);
    }

    CacheService.getScriptCache().put("CONFIG_STORE", JSON.stringify(parsed), 300);
    return parsed;
  } catch (e) {
    // 🔥 フェイルセーフ（OS停止防止）
    return DEFAULT_STORE;
  }
}

function getConfig() {
  const store = loadConfigStore();
  // 地区固有の設定合成(tenantId)を廃止。常にDEFAULT(システム共通)を返す。
  return store.DEFAULT || {};
}

// ==========================================
// GLOBAL ACCESSOR (OS CONFIG)
// ==========================================
const CONFIG = {
  get: function(path) {
    const cfg = getConfig();
    return path.split(".").reduce((obj, key) => obj?.[key], cfg);
  },
  
  // 地区ID設定
  get DISTRICT_ID() {
    try {
      return PropertiesService.getScriptProperties().getProperty('DISTRICT_ID') || '';
    } catch (e) {
      return '';
    }
  },

  // スプレッドシートID設定（TARGET_SPREADSHEET_ID 優先、SPREADSHEET_ID 後方互換）
  get TARGET_SPREADSHEET_ID() {
    try {
      const props = PropertiesService.getScriptProperties();
      return props.getProperty('TARGET_SPREADSHEET_ID') || props.getProperty('SPREADSHEET_ID') || '';
    } catch (e) {
      return '';
    }
  },

  // ストレージ設定
  // ⚠️ STORAGE_PARENT_ID は PropertiesService で管理（スクリプトプロパティ: STORAGE_PARENT_ID）
  get STORAGE_PARENT_ID() {
    try {
      return PropertiesService.getScriptProperties().getProperty('STORAGE_PARENT_ID') || '';
    } catch (e) {
      return '';
    }
  }
};

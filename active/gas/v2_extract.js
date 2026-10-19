/**
 * GAS v2 - 住所抽出モジュール
 * - CSVからの選挙区・住所データの抽出
 * - 住所文字列の正規化
 */

// =============================
// ② 自治体順序解決 (SSOT)
// =============================
/**
 * 指定したキーワード（パターン）を含むファイルをドライブから検索する。
 * なければ fallbackName で完全一致検索する。
 */
function findFileByPattern(pattern, fallbackName) {
  try {
    const query = `title contains '${pattern}' and trashed = false`;
    const files = DriveApp.searchFiles(query);
    if (files.hasNext()) {
      return files.next();
    }
  } catch (e) {
    // 検索エラー時はログを残しフォールバックへ
  }
  
  // フォールバック
  const files = DriveApp.getFilesByName(fallbackName);
  if (files.hasNext()) {
    return files.next();
  }
  return null;
}

/**
 * ファイルオブジェクトからCSVまたはGoogleスプレッドシートのデータをパースして取得する
 */
function getCsvOrSheetDataFromFile(file) {
  if (!file) return null;
  const mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_SHEETS) {
    const ss = SpreadsheetApp.open(file);
    return ss.getSheets()[0].getDataRange().getValues();
  } else {
    const blob = file.getBlob();
    let text;
    try {
      text = blob.getDataAsString("UTF-8");
      if (text.indexOf("\uFFFD") !== -1) throw new Error();
    } catch (e) {
      text = blob.getDataAsString("Shift_JIS");
    }
    try {
      return Utilities.parseCsv(text);
    } catch (e) {
      return text.split("\n").map((line) => line.split(","));
    }
  }
}

// 地区判定・クレンジング処理はデータ(SSOT)側に委譲したため、
// detectRegionFromSpreadsheetName, matchDistrict, YOKKAICHI_DISTRICT_MASTER は削除されました。

/**
 * ドライブ上の municipality_master.csv から自治体順を動的に取得する（SSOT）
 * CacheService による派生データキャッシュ高速化層（SSOTは常にCSV）
 * @return {string[]} 自治体順の配列
 */
function getMunicipalityOrder() {
  const CACHE_KEY = "MUNICIPALITY_ORDER_CACHE";
  const CACHE_TTL = 21600; // 6時間 (GAS CacheService 最大保持期間)

  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (e) {
    // キャッシュ取得エラー時は正本取得へフォールバック
  }

  const fileName = "municipality_master.csv";
  let file = findFileByPattern("municipality_master", fileName);
  
  const defaultList = [];
  
  if (!file) {
    try {
      const csvContent = "priority,city_name\n";
      const parentId = typeof CONFIG !== 'undefined' ? CONFIG.get("STORAGE_PARENT_ID") : null;
      let folder = DriveApp.getRootFolder();
      if (parentId) {
        try {
          folder = DriveApp.getFolderById(parentId);
        } catch (fErr) {}
      }
      file = folder.createFile(fileName, csvContent, MimeType.PLAIN_TEXT);
      console.warn("municipality_master.csv が見つからないため、ドライブ上に空ファイルで自動生成しました。");
    } catch (err) {
      console.error("municipality_master.csv の自動生成に失敗しました: " + err.message);
      return defaultList; // エラー時はデフォルトをそのまま返す
    }
  }
  
  try {
    const data = getCsvOrSheetDataFromFile(file);
    if (!data || data.length <= 1) {
      return defaultList;
    }
    
    const cities = [];
    // 1行目はヘッダー (priority,city_name)
    for (let i = 1; i < data.length; i++) {
      const cityName = String(data[i][1] || "").trim(); // 2列目 (city_name)
      if (cityName) {
        cities.push(cityName);
      }
    }

    // 正本からの取得成功時、CacheServiceへ保存 (派生データ高速化)
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && cities.length > 0) {
        CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(cities), CACHE_TTL);
      }
    } catch (cErr) {}

    return cities;
  } catch (e) {
    console.error("municipality_master.csv のパースに失敗しました: " + e.message);
    return defaultList;
  }
}



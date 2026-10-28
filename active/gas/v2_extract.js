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
  const CACHE_KEY = "MUNICIPALITY_ORDER_CACHE_V2";
  const CACHE_TTL = 21600; // 6時間 (GAS CacheService 最大保持期間)

  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((c) => typeof c === "string" && c.trim().length > 0 && !/^\d+$/.test(c.trim()))
        ) {
          return parsed;
        }
      }
    }
  } catch (e) {
    // キャッシュ取得エラー時は正本取得へフォールバック
  }

  const fileName = "municipality_master.csv";
  const file = findFileByPattern("municipality_master", fileName);
  const defaultList = [];

  if (!file) {
    console.warn("municipality_master.csv が見つかりません（Fail-Closed: 空リストを返却）。");
    return defaultList;
  }

  try {
    const data = getCsvOrSheetDataFromFile(file);
    if (!Array.isArray(data) || data.length <= 1 || !Array.isArray(data[0])) {
      return defaultList;
    }

    const headerRow = data[0].map((col, idx) => {
      const raw = String(col ?? "");
      return (idx === 0 ? raw.replace(/^\uFEFF/, "") : raw).trim();
    });

    const cityNameColIndices = [];
    for (let c = 0; c < headerRow.length; c++) {
      if (headerRow[c] === "city_name") {
        cityNameColIndices.push(c);
      }
    }

    if (cityNameColIndices.length !== 1) {
      console.error("municipality_master.csv に一意な city_name ヘッダーが存在しません（Fail-Closed）。");
      return defaultList;
    }

    const cityNameColIdx = cityNameColIndices[0];
    const cities = [];
    const seen = new Set();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!Array.isArray(row)) {
        return defaultList;
      }
      // 末尾の完全空行はスキップ
      if (row.length === 1 && String(row[0] ?? "").trim() === "") {
        continue;
      }
      const cityName = String(row[cityNameColIdx] ?? "").trim();
      if (!cityName || /^\d+$/.test(cityName) || seen.has(cityName)) {
        console.error("municipality_master.csv に不正または重複した city_name 行が含まれています（Fail-Closed）。");
        return defaultList;
      }
      seen.add(cityName);
      cities.push(cityName);
    }

    if (cities.length === 0) {
      return defaultList;
    }

    // 正本からの取得・検証成功時のみ V2 CacheKey へ保存
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(cities), CACHE_TTL);
      }
    } catch (cErr) {}

    return cities;
  } catch (e) {
    console.error("municipality_master.csv のパースに失敗しました: " + e.message);
    return defaultList;
  }
}



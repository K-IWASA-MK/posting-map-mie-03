/**
 * Business Layer - Area Repository Module
 * 
 * Domain: Area Domain
 * Layer: Business Layer
 * Responsibility: エリア情報、ポイントデータ、都市データの取得とデータ構造マッピング
 */

if (typeof AreaRepository === 'undefined') {
  AreaRepository = class AreaRepository {
    constructor() {
      this.spreadsheetAdapter = (typeof SpreadsheetAdapter !== 'undefined') ? new SpreadsheetAdapter() : null;
      this.cacheProvider = (typeof CacheServiceProvider !== 'undefined') ? CacheServiceProvider.getInstance() : null;
    }

    static getInstance() {
      if (!AreaRepository.instance) {
        AreaRepository.instance = new AreaRepository();
      }
      return AreaRepository.instance;
    }

    findAreaPoints(areaName, districtId = "") {
      if (!areaName) return { success: false, message: "Area name required" };

      let distSheet = null;
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        distSheet = MonthlySheetResolver.getInstance().getCurrentSheet("distribution", districtId);
      }
      if (!distSheet) return { success: false, message: "Distribution sheet not found" };

      const lastRow = distSheet.getLastRow();
      if (lastRow < 2) return { success: true, points: [] };

      // 新アーキテクチャ: A〜O列 (ID, 市町村, 町域, 配布完了日時, 配布枚数, 担当者ID, 担当者名, GPS, 写真, 緯度, 経度, GPS日時, 写真ファイルID, 写真URL, 写真日時)
      const values = distSheet.getRange(2, 1, lastRow - 1, 15).getValues();
      const points = [];

      for (let i = 0; i < values.length; i++) {
        const r = values[i];
        const cityName = r[1] ? String(r[1]).trim() : "";
        if (cityName !== areaName) continue;

        const isComplete = (r[3] !== null && r[3] !== "");
        const completedAtStr = (r[3] && typeof r[3].getMonth === 'function')
          ? Utilities.formatDate(r[3], "JST", "MM/dd HH:mm")
          : (r[3] ? String(r[3]).trim() : "");

        points.push({
          rowId: parseInt(r[0], 10) || (i + 2), // A列がID
          address: r[2] || "",                  // C列が町域 (Tier2のaddress)
          memo: "",                             // 新アーキテクチャでは通常メモ列なし
          isDone: isComplete,
          completedAt: completedAtStr,
          count: parseFloat(r[4]) || 0,         // E列が配布枚数
          staffName: r[6] || "",                // G列が担当者名
          staffId: r[5] || "",                  // F列が担当者ID
          gps: r[7] || "",                      // H列がGPS
          photoUrl: r[13] || ""                 // N列が写真URL
        });
      }

      return { success: true, points: points };
    }
  };
  AreaRepository.instance = null;
}

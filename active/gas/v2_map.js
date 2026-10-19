/**
 * GAS v2 - マップデータ管理モジュール
 * - 地図表示用データの集計
 * - パフォーマンス向上のためのキャッシュ管理
 */

/**
 * 戦況マップダッシュボード用：全体サマリー取得（爆速キャッシュ版）
 */
function getDashboardData() {
  const cache = CacheService.getScriptCache();
  const fastCached = cache.get("AREA_SUMMARY_FAST_CACHE");
  if (fastCached) return JSON.parse(fastCached);

  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty("AREA_SUMMARY_CACHE");

  if (cached) {
    try {
      const data = JSON.parse(cached);
      cache.put("AREA_SUMMARY_FAST_CACHE", cached, 1800);
      return data;
    } catch (e) {}
  }
  return { success: true, summary: [] };
}

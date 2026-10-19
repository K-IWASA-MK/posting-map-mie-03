/**
 * Business Layer - Distribution Domain Model
 * 
 * Target Domain: Distribution Management
 * Owner Layer: Business Layer
 * Responsibility: 配布実績イベントおよび配布レコードのドメイン構造定義
 */

if (typeof DistributionEvent === 'undefined') {
  DistributionEvent = class DistributionEvent {
    constructor(params) {
      this.id = params ? params.id : "";
      this.timestamp = (params && params.timestamp) || Date.now();
      this.tenantId = params ? params.tenantId : "";
      this.branchId = params ? params.branchId : "";
      this.prefectureId = (params && params.prefectureId) || "";
      this.blockId = params ? params.blockId : "";
      this.userId = params ? params.userId : "";
      this.actionType = params ? params.actionType : "distribute";
      this.count = (params && params.count !== undefined) ? params.count : 1;
      this.lat = (params && params.lat) || 0;
      this.lng = (params && params.lng) || 0;
      this.meta = (params && params.meta) || {};
    }

    toDict() {
      return {
        id: this.id,
        timestamp: this.timestamp,
        tenantId: this.tenantId,
        branchId: this.branchId,
        prefectureId: this.prefectureId,
        blockId: this.blockId,
        userId: this.userId,
        actionType: this.actionType,
        count: this.count,
        lat: this.lat,
        lng: this.lng,
        meta: this.meta
      };
    }
  };
}

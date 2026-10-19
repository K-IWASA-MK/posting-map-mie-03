/**
 * Business Layer - Area Service Module
 * 
 * Domain: Area Domain
 * Layer: Business Layer
 * Responsibility: Area トランザクション管理、エリア・都市別データ集計サービス
 */

if (typeof AreaService === 'undefined') {
  AreaService = class AreaService {
    constructor() {
      this.repository = AreaRepository.getInstance();
    }

    static getInstance() {
      if (!AreaService.instance) {
        AreaService.instance = new AreaService();
      }
      return AreaService.instance;
    }

    getAreaDetails(areaName, districtId = "") {
      return this.repository.findAreaPoints(areaName, districtId);
    }
  };
  AreaService.instance = null;
}

/**
 * Business Layer - Distribution Service
 * 
 * Target Domain: Distribution Management
 * Owner Layer: Business Layer
 * Responsibility: 配布実績登録・取消トランザクションおよび配布統計・ランキング集計サービスの提供
 */

if (typeof DistributionService === 'undefined') {
  DistributionService = class DistributionService {
    constructor() {
      this.repository = DistributionRepository.getInstance();
    }

    static getInstance() {
      if (!DistributionService.instance) {
        DistributionService.instance = new DistributionService();
      }
      return DistributionService.instance;
    }

    submitDistribution(data) {
      if (!data) {
        return { success: false, message: "Invalid request payload" };
      }

      const self = this;
      const executeCoreLogic = function() {
        try {
          const isComplete = data.isDone === 'true' || data.isDone === true;
          const actType = isComplete ? "distribute" : "revert_distribute";
          const actCount = isComplete ? (parseFloat(data.count) || 1) : -(parseFloat(data.count) || 1);

          let uuid = "";
          if (typeof Utilities !== 'undefined' && typeof Utilities.getUuid === 'function') {
            uuid = Utilities.getUuid();
          } else {
            uuid = 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          }

          const defaultTenant = (typeof CONFIG !== 'undefined' && typeof CONFIG.get === 'function') ? CONFIG.get("DEFAULT_TENANT_ID") : "DEFAULT";
          const defaultBranch = (typeof CONFIG !== 'undefined' && typeof CONFIG.get === 'function') ? CONFIG.get("DEFAULT_BRANCH_ID", data.tenantId) : "DEFAULT";

          const event = new DistributionEvent({
            id: uuid,
            timestamp: Date.now(),
            tenantId: data.tenantId || defaultTenant,
            branchId: data.branchId || defaultBranch,
            prefectureId: data.prefectureId || "",
            blockId: data.blockId || data.areaName,
            userId: data.userId || data.staffId,
            actionType: actType,
            count: actCount,
            lat: data.lat || 0,
            lng: data.lng || 0,
            meta: data.meta || {
              legacyRow: data.rowId,
              staffName: data.staffName,
              legacySheetName: data.legacySheetName
            }
          });

          return { success: true, status: "ok", id: event.id };
        } catch (e) {
          return { success: false, message: e.toString() };
        }
      };

      if (typeof LockServiceProvider !== 'undefined' && typeof LockServiceProvider.getInstance === 'function' && typeof LockServiceProvider.getInstance().executeWithLock === 'function') {
        return LockServiceProvider.getInstance().executeWithLock(executeCoreLogic);
      } else {
        const lock = (typeof LockService !== 'undefined') ? LockService.getScriptLock() : null;
        if (lock) {
          try {
            lock.waitLock(15000);
            return executeCoreLogic();
          } catch (e) {
            return { success: false, message: "サーバーが混雑しています。時間をおいて再度お試しください。" };
          } finally {
            try {
              lock.releaseLock();
            } catch (el) {}
          }
        } else {
          return executeCoreLogic();
        }
      }
    }

    getDeliveryStats(districtId = "") {
      return this.repository.fetchDeliveryStats(districtId);
    }

    getRankingPayload(requestLineUserId = "", districtId = "") {
      return this.repository.fetchRankingPayload(requestLineUserId, districtId);
    }
  };
  DistributionService.instance = null;
}

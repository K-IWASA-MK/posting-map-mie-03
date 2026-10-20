/**
 * Business Layer - Distribution Repository
 * 
 * Target Domain: Distribution Management
 * Owner Layer: Business Layer
 * Responsibility: 配布実績のシャドー書き込みおよび統計・ランキングデータアクセス
 */

if (typeof DistributionRepository === 'undefined') {
  DistributionRepository = class DistributionRepository {
    constructor() {
      // Data source access via Infrastructure Adapter
    }

    static getInstance() {
      if (!DistributionRepository.instance) {
        DistributionRepository.instance = new DistributionRepository();
      }
      return DistributionRepository.instance;
    }

    getSS(districtId = "") {
      if (typeof SpreadsheetAdapter !== 'undefined' && typeof SpreadsheetAdapter.getSS === 'function') {
        return SpreadsheetAdapter.getSS(districtId);
      } else if (typeof getSS === 'function') {
        return getSS(districtId);
      }
      return null;
    }

    fetchDeliveryStats(districtId = "") {
      const sheet = this.getDistributionSheet(districtId);
      if (!sheet) return { totalDistributed: 0, areasCount: 0 };

      let totalDistributed = 0;
      let areasCount = 0;
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const values = sheet.getRange(2, 4, lastRow - 1, 2).getValues();
        for (let j = 0; j < values.length; j++) {
          const completedAt = values[j][0];
          const count = parseFloat(values[j][1]) || 0;
          if (completedAt && count > 0) {
            totalDistributed += count;
            areasCount++;
          }
        }
      }

      return {
        totalDistributed: totalDistributed,
        areasCount: areasCount
      };
    }

    getDistributionSheet(districtId = "") {
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        return MonthlySheetResolver.getInstance().getCurrentSheet("distribution", districtId);
      }
      return null;
    }

    fetchRankingData(requestLineUserId = "", districtId = "", cachedRoster = null) {
      const sheet = this.getDistributionSheet(districtId);
      if (!sheet) return [];

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];

      // A: rowId, B: cityName, C: townName, D: completedAt, E: count, F: staffId, G: staffName ... P: lineUserId (col 16)
      const numCols = Math.max(sheet.getLastColumn(), 16);
      const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      const staffMap = {};
      const cleanReqLineId = String(requestLineUserId || "").trim();

      // 名簿逆引き用キャッシュ（P列が空のレガシー行の安全な補完のため）
      let rosterList = Array.isArray(cachedRoster) ? cachedRoster : [];
      if (rosterList.length === 0) {
        try {
          if (typeof StaffService !== 'undefined' && StaffService.getInstance) {
            rosterList = StaffService.getInstance().getRoster(districtId) || [];
          }
        } catch (eRoster) {}
      }

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const rawCompletedAt = row[3];
        const count = parseFloat(row[4]) || 0;
        const staffId = row[5] ? String(row[5]).trim() : "";
        const staffName = row[6] ? String(row[6]).trim() : "";
        let rowLineUserId = row[15] ? String(row[15]).trim() : "";

        // P列が空の場合、名簿と照合（staffId と名前が完全一致する場合のみ安全に解決）
        if (!rowLineUserId && staffId) {
          const matched = rosterList.find(m => m.id === staffId && (!staffName || m.name === staffName));
          if (matched && matched.lineUserId) {
            rowLineUserId = matched.lineUserId;
          }
        }

        // 集計の内部識別キー: lineUserId を最優先。なければ staffId。
        const groupKey = rowLineUserId || staffId;

        // 必須条件: completedAt が存在、groupKey が存在、count > 0
        if (!rawCompletedAt || !groupKey || count <= 0) continue;

        // 日時正規化処理
        let timeVal = 0;
        if (rawCompletedAt instanceof Date && !isNaN(rawCompletedAt.getTime())) {
          timeVal = rawCompletedAt.getTime();
        } else if (typeof rawCompletedAt === 'string') {
          const trimmedDate = rawCompletedAt.trim();
          if (trimmedDate !== "") {
            const parsed = Date.parse(trimmedDate.replace(/-/g, '/'));
            if (!isNaN(parsed)) {
              timeVal = parsed;
            }
          }
        } else if (typeof rawCompletedAt === 'number' && rawCompletedAt > 0) {
          timeVal = rawCompletedAt;
        }

        if (!staffMap[groupKey]) {
          staffMap[groupKey] = {
            groupKey: groupKey,
            lineUserId: rowLineUserId,
            staffId: staffId,
            name: staffName || staffId,
            count: 0,
            latestTimestamp: timeVal
          };
        }

        staffMap[groupKey].count += count;

        // 最新の表示用 staffName / staffId を採用
        if (timeVal > staffMap[groupKey].latestTimestamp) {
          staffMap[groupKey].latestTimestamp = timeVal;
          if (staffName) staffMap[groupKey].name = staffName;
          if (staffId) staffMap[groupKey].staffId = staffId;
        }
      }

      const list = Object.values(staffMap);

      // ソート: ① count 降順, ② 同数時は staffId 昇順
      list.sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return (a.staffId || "").localeCompare(b.staffId || "");
      });

      let currentRank = 0;
      let previousCount = null;

      return list.map((item, index) => {
        if (previousCount === null || item.count !== previousCount) {
          currentRank = index + 1;
        }
        previousCount = item.count;

        const isMe = !!(cleanReqLineId && item.lineUserId && item.lineUserId === cleanReqLineId);

        // APIレスポンスには lineUserId を一切含めない（isMe と表示用ラベルのみ）
        return {
          rank: currentRank,
          staffId: item.staffId,
          name: item.name,
          count: item.count,
          isMe: isMe
        };
      });
    }

    fetchRankingPayload(requestLineUserId = "", districtId = "") {
      const ranking = this.fetchRankingData(requestLineUserId, districtId);
      let mySummary = null;
      for (let i = 0; i < ranking.length; i++) {
        if (ranking[i].isMe) {
          mySummary = {
            rank: ranking[i].rank,
            count: ranking[i].count
          };
          break;
        }
      }
      return {
        mySummary: mySummary,
        ranking: ranking
      };
    }

    /**
     * 最新の配布実績レコードを取得（SSOT配布実績固定マスターシートの全行から、D列タイムスタンプ降順で最大 limit 件）
     */
    fetchLatestRecords(limit = 20, requestLineUserId = "", districtId = "") {
      const sheet = this.getDistributionSheet(districtId);
      if (!sheet) return [];

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];

      const numCols = Math.max(sheet.getLastColumn(), 16);
      const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      const records = [];
      const cleanReqLineId = String(requestLineUserId || "").trim();

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const rowId = row[0];
        const cityName = row[1] ? String(row[1]).trim() : "";
        const townName = row[2] ? String(row[2]).trim() : "";
        const rawCompletedAt = row[3];
        const count = parseFloat(row[4]) || 0;
        const staffId = row[5] ? String(row[5]).trim() : "";
        const staffName = row[6] ? String(row[6]).trim() : "";
        const gpsStatus = row[7] === "OK" ? "OK" : "NO";
        const photoStatus = row[8] === "OK" ? "OK" : "NO";
        const rowLineId = row[15] ? String(row[15]).trim() : "";

        // D列（配布日時）が存在する完了レコードのみを対象
        if (!rawCompletedAt) continue;

        let timeStr = "";
        let timeVal = 0;

        if (rawCompletedAt instanceof Date && !isNaN(rawCompletedAt.getTime())) {
          timeVal = rawCompletedAt.getTime();
          const month = String(rawCompletedAt.getMonth() + 1).padStart(2, '0');
          const day = String(rawCompletedAt.getDate()).padStart(2, '0');
          const hours = String(rawCompletedAt.getHours()).padStart(2, '0');
          const minutes = String(rawCompletedAt.getMinutes()).padStart(2, '0');
          timeStr = `${month}/${day} ${hours}:${minutes}`;
        } else if (typeof rawCompletedAt === 'string') {
          const trimmed = rawCompletedAt.trim();
          const parsed = Date.parse(trimmed.replace(/-/g, '/'));
          if (!isNaN(parsed)) {
            timeVal = parsed;
            const d = new Date(parsed);
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            timeStr = `${month}/${day} ${hours}:${minutes}`;
          } else {
            timeVal = i + 2;
            timeStr = trimmed;
          }
        } else {
          timeVal = i + 2;
          timeStr = "--:--";
        }

        const isMe = !!(cleanReqLineId && rowLineId && rowLineId === cleanReqLineId);

        // APIレスポンスには lineUserId を含めない
        records.push({
          recordId: `REC_${timeVal}_${staffId || 'STAFF'}_${rowId}`,
          rowId: rowId,
          cityName: cityName,
          townName: townName,
          time: timeStr,
          timestamp: timeVal,
          count: count,
          staffId: staffId || 'S001',
          staffName: staffName || staffId || 'S001',
          gpsStatus: gpsStatus,
          photoStatus: photoStatus,
          isMe: isMe
        });
      }

      records.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return (parseInt(b.rowId, 10) || 0) - (parseInt(a.rowId, 10) || 0);
      });

      return (typeof limit === 'number' && limit > 0) ? records.slice(0, limit) : records;
    }
  };
  DistributionRepository.instance = null;
}

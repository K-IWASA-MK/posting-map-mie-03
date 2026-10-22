/**
 * v2_migration.js
 * Backend -> Dashboard Identity連携 スキーマ拡張 & データ移行プロトコル
 * 
 * 原則:
 * 1. 既存列を移動・削除・変更せず、末尾に新設列を append
 *    - 保有チラシ枚数: G列 (lineUserId)
 *    - 配布実績: P列 (16列目 lineUserId)
 *    - 掲示板: E列 (lineUserId)
 *    - 受渡要請履歴: 13列目 (requesterLineUserId), 14列目 (holderLineUserId)
 * 2. 既存データ行の補完は「staffId と名前が名簿と完全一致し、一意に確定できる行のみ」
 * 3. 矛盾・不一致・不明な行（例: ST001: staffId=S001, name=K. IWASA）は空欄のまま保全し、推測で補正しない。
 */

function migrateIdentityColumns(isDryRun) {
  if (typeof isDryRun === 'undefined') isDryRun = true;
  const opts = (arguments.length > 1 && typeof arguments[1] === 'object' && arguments[1] !== null)
    ? arguments[1]
    : (typeof isDryRun === 'object' && isDryRun !== null ? isDryRun : {});
  const cleanDistrictId = String((arguments.length > 2 && arguments[2]) || opts.districtId || "").trim().toUpperCase();

  let ss = null;
  try {
    ss = (typeof getSS === 'function') ? getSS(cleanDistrictId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  } catch (eSS) {
    return { success: false, code: "SPREADSHEET_NOT_FOUND", message: eSS.message };
  }
  if (!ss) {
    return { success: false, code: "SPREADSHEET_NOT_FOUND", message: "Spreadsheet not found" };
  }

  const report = {
    isDryRun: isDryRun,
    districtId: cleanDistrictId,
    sheets: {},
    summary: { updatedRows: 0, skippedRows: 0, headersAdded: 0 }
  };

  // 1. 名簿の取得
  let roster = [];
  try {
    if (typeof StaffService !== 'undefined' && StaffService.getInstance) {
      roster = StaffService.getInstance().getRoster(cleanDistrictId) || [];
    } else {
      const rSheet = (typeof MonthlySheetResolver !== 'undefined') ? MonthlySheetResolver.getInstance().getCurrentSheet("staff", cleanDistrictId) : ss.getSheetByName("スタッフ名簿");
      if (rSheet && rSheet.getLastRow() >= 2) {
        const rVals = rSheet.getRange(2, 1, rSheet.getLastRow() - 1, 4).getValues();
        roster = rVals.map(r => ({ id: String(r[0] || '').trim(), name: String(r[1] || '').trim(), lineUserId: String(r[2] || '').trim() }));
      }
    }
  } catch (eRoster) {
    return { success: false, message: "Failed to load roster: " + eRoster.toString() };
  }

  // 2. 「保有チラシ枚数」シートのマイグレーション
  try {
    const flyerSheet = (typeof MonthlySheetResolver !== 'undefined') ? MonthlySheetResolver.getInstance().getCurrentSheet("flyer", cleanDistrictId) : ss.getSheetByName("保有チラシ枚数");
    if (flyerSheet) {
      const lr = flyerSheet.getLastRow();
      const lc = flyerSheet.getLastColumn();
      const sheetReport = { name: flyerSheet.getName(), headerAdded: false, rowsUpdated: [], rowsSkipped: [] };

      // G列（7列目）ヘッダー確認・追加
      if (lc < 7 || String(flyerSheet.getRange(1, 7).getValue()).trim() !== "lineUserId") {
        sheetReport.headerAdded = true;
        if (!isDryRun) {
          flyerSheet.getRange(1, 7).setValue("lineUserId");
          flyerSheet.getRange(1, 7).setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        }
        report.summary.headersAdded++;
      }

      if (lr >= 2) {
        const numCols = Math.max(lc, 7);
        const vals = flyerSheet.getRange(2, 1, lr - 1, numCols).getValues();
        for (let i = 0; i < vals.length; i++) {
          const rowNum = i + 2;
          const recId = vals[i][0];
          const staffId = String(vals[i][1] || '').trim();
          const staffName = String(vals[i][2] || '').trim();
          const existingLineId = String(vals[i][6] || '').trim();

          if (existingLineId) {
            sheetReport.rowsSkipped.push({ row: rowNum, id: recId, reason: "Already has lineUserId" });
            continue;
          }

          // 名簿照合: staffId と名前の双方が完全一致する場合のみ特定
          const matched = roster.filter(m => m.id === staffId && m.name === staffName);
          if (matched.length === 1 && matched[0].lineUserId) {
            sheetReport.rowsUpdated.push({ row: rowNum, id: recId, staffId: staffId, name: staffName, lineUserId: matched[0].lineUserId });
            if (!isDryRun) {
              flyerSheet.getRange(rowNum, 7).setValue(matched[0].lineUserId);
            }
            report.summary.updatedRows++;
          } else {
            // ST001 のように矛盾がある、または一意に確定できない場合は空欄のまま保全
            const reason = matched.length === 0 ? "Staff ID and Name mismatch or not in roster" : "Multiple roster matches";
            sheetReport.rowsSkipped.push({ row: rowNum, id: recId, staffId: staffId, name: staffName, reason: reason });
            report.summary.skippedRows++;
          }
        }
      }
      report.sheets["flyer"] = sheetReport;
    }
  } catch (eFlyer) {
    report.sheets["flyer"] = { error: eFlyer.toString() };
  }

  // 3. 「配布実績」シートのマイグレーション
  try {
    const distSheet = (typeof MonthlySheetResolver !== 'undefined') ? MonthlySheetResolver.getInstance().getCurrentSheet("distribution", cleanDistrictId) : ss.getSheetByName("配布実績");
    if (distSheet) {
      const lr = distSheet.getLastRow();
      const lc = distSheet.getLastColumn();
      const sheetReport = { name: distSheet.getName(), headerAdded: false, rowsUpdated: [], rowsSkipped: [] };

      // P列（16列目）ヘッダー確認・追加
      if (lc < 16 || String(distSheet.getRange(1, 16).getValue()).trim() !== "lineUserId") {
        sheetReport.headerAdded = true;
        if (!isDryRun) {
          distSheet.getRange(1, 16).setValue("lineUserId");
          distSheet.getRange(1, 16).setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        }
        report.summary.headersAdded++;
      }

      if (lr >= 2) {
        const numCols = Math.max(lc, 16);
        const vals = distSheet.getRange(2, 1, lr - 1, numCols).getValues();
        for (let i = 0; i < vals.length; i++) {
          const rowNum = i + 2;
          const rowId = vals[i][0];
          const completedAt = vals[i][3];
          const staffId = String(vals[i][5] || '').trim();
          const staffName = String(vals[i][6] || '').trim();
          const existingLineId = String(vals[i][15] || '').trim();

          if (!completedAt || !staffId) continue;
          if (existingLineId) {
            sheetReport.rowsSkipped.push({ row: rowNum, id: rowId, reason: "Already has lineUserId" });
            continue;
          }

          const matched = roster.filter(m => m.id === staffId && m.name === staffName);
          if (matched.length === 1 && matched[0].lineUserId) {
            sheetReport.rowsUpdated.push({ row: rowNum, id: rowId, staffId: staffId, name: staffName, lineUserId: matched[0].lineUserId });
            if (!isDryRun) {
              distSheet.getRange(rowNum, 16).setValue(matched[0].lineUserId);
            }
            report.summary.updatedRows++;
          } else {
            sheetReport.rowsSkipped.push({ row: rowNum, id: rowId, staffId: staffId, name: staffName, reason: "Mismatch or unresolved" });
            report.summary.skippedRows++;
          }
        }
      }
      report.sheets["distribution"] = sheetReport;
    }
  } catch (eDist) {
    report.sheets["distribution"] = { error: eDist.toString() };
  }

  // 4. 「掲示板」シートのマイグレーション
  try {
    const bSheet = ss.getSheetByName("掲示板");
    if (bSheet) {
      const lr = bSheet.getLastRow();
      const lc = bSheet.getLastColumn();
      const sheetReport = { name: bSheet.getName(), headerAdded: false, rowsUpdated: [], rowsSkipped: [] };

      // E列（5列目）ヘッダー確認・追加
      if (lc < 5 || String(bSheet.getRange(1, 5).getValue()).trim() !== "lineUserId") {
        sheetReport.headerAdded = true;
        if (!isDryRun) {
          bSheet.getRange(1, 5).setValue("lineUserId");
          bSheet.getRange(1, 5).setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        }
        report.summary.headersAdded++;
      }

      if (lr >= 2) {
        const numCols = Math.max(lc, 5);
        const vals = bSheet.getRange(2, 1, lr - 1, numCols).getValues();
        for (let i = 0; i < vals.length; i++) {
          const rowNum = i + 2;
          const staffId = String(vals[i][1] || '').trim();
          const staffName = String(vals[i][2] || '').trim();
          const existingLineId = String(vals[i][4] || '').trim();

          if (existingLineId) {
            sheetReport.rowsSkipped.push({ row: rowNum, reason: "Already has lineUserId" });
            continue;
          }

          const matched = roster.filter(m => m.id === staffId && m.name === staffName);
          if (matched.length === 1 && matched[0].lineUserId) {
            sheetReport.rowsUpdated.push({ row: rowNum, staffId: staffId, name: staffName, lineUserId: matched[0].lineUserId });
            if (!isDryRun) {
              bSheet.getRange(rowNum, 5).setValue(matched[0].lineUserId);
            }
            report.summary.updatedRows++;
          } else {
            sheetReport.rowsSkipped.push({ row: rowNum, staffId: staffId, name: staffName, reason: "Mismatch or unresolved" });
            report.summary.skippedRows++;
          }
        }
      }
      report.sheets["bulletin"] = sheetReport;
    }
  } catch (eB) {
    report.sheets["bulletin"] = { error: eB.toString() };
  }

  // 5. 「受渡要請履歴」シートのマイグレーション
  try {
    const trSheet = (typeof MonthlySheetResolver !== 'undefined') ? MonthlySheetResolver.getInstance().getCurrentSheet("transfer", cleanDistrictId) : ss.getSheetByName("受渡要請履歴");
    if (trSheet) {
      const lc = trSheet.getLastColumn();
      const sheetReport = { name: trSheet.getName(), headerAdded: false };

      // 列13, 14 ヘッダー確認・追加
      if (lc < 14 || String(trSheet.getRange(1, 13).getValue()).trim() !== "requesterLineUserId") {
        sheetReport.headerAdded = true;
        if (!isDryRun) {
          trSheet.getRange(1, 13, 1, 2).setValues([["requesterLineUserId", "holderLineUserId"]]);
          trSheet.getRange(1, 13, 1, 2).setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
        }
        report.summary.headersAdded++;
      }
      report.sheets["transfer"] = sheetReport;
    }
  } catch (eTr) {
    report.sheets["transfer"] = { error: eTr.toString() };
  }

  report.success = true;
  return report;
}

/**
 * healSchemaHeaders
 * 既存スプレッドシートの全スキーマヘッダーを安全に検査・補完する。
 * 
 * 責務:
 * - Provisioning (新規生成) とは完全に分離された「既存シート修復 (Healing)」専用
 * - 2-Phase Scan-before-Mutate
 * - OUT_OF_GRID 列は Phase 1 で getRange を呼ばず計画登録のみ
 * - 非空異種値（0, false等含む）の衝突時は mutation 0 で即時停止 (HEADER_COLLISION)
 * - isDryRun: true 時は mutation 0（API呼出 0 回）
 * - データ行（2行目以降）は一切不可侵
 * 
 * @param {Object} [options]
 * @param {boolean} [options.isDryRun=true]
 * @param {string} [options.targetMonth] - 当月解決用 (YYYY-MM)
 * @return {Object} レポートオブジェクト
 */
function healSchemaHeaders(options, districtId) {
  const opts = options || {};
  const isDryRun = opts.isDryRun !== false; // デフォルト true (安全第一)
  const cleanDistrictId = String(districtId || opts.districtId || "").trim().toUpperCase();

  // targetSpreadsheetId 直接指定や Client spreadsheet object は禁止（必ず getSS(cleanDistrictId) による解決）
  let ss = null;
  try {
    ss = (typeof getSS === 'function') ? getSS(cleanDistrictId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  } catch (eSS) {
    return { success: false, code: "SPREADSHEET_NOT_FOUND", message: eSS.message, mutationsCount: 0 };
  }
  if (!ss) {
    return { success: false, code: "SPREADSHEET_NOT_FOUND", message: "Spreadsheet not found", mutationsCount: 0 };
  }

  let month = opts.targetMonth || (
    typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance
      ? MonthlySheetResolver.getInstance().getCurrentMonth()
      : Utilities.formatDate(new Date(), "JST", "yyyy-MM")
  );

  // ELECTION モードの場合は Active Dataset Key を解決
  const sysSheet = ss.getSheetByName("SYSTEM_INFO");
  if (sysSheet && typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
    try {
      const mode = SystemInfoService.getInstance().getOperationMode(sysSheet);
      if (mode === 'ELECTION') {
        const activeKey = SystemInfoService.getInstance().getActiveDatasetKey(sysSheet);
        if (activeKey) month = activeKey;
      }
    } catch (e) {}
  }

  // 契約ヘッダーSSOT定義（Runtime業務Dataset 5種 + 掲示板）
  const schemas = [
    // 当月/運用5種
    {
      category: "monthly",
      sheetName: `配布実績${month}`,
      required: true,
      missingCode: "MISSING_CURRENT_MONTH_SHEET",
      headers: ["ID", "市町村", "町域", "配布完了日時", "配布枚数", "担当者ID", "担当者名", "GPS", "写真", "緯度", "経度", "GPS日時", "写真ファイルID", "写真URL", "写真日時", "lineUserId", "requestId"]
    },
    {
      category: "monthly",
      sheetName: `名簿${month}`,
      required: true,
      missingCode: "MISSING_CURRENT_MONTH_SHEET",
      headers: ["ID", "名前", "LINE_USER_ID", "登録日時"]
    },
    {
      category: "monthly",
      sheetName: `保有チラシ枚数${month}`,
      required: true,
      missingCode: "MISSING_CURRENT_MONTH_SHEET",
      headers: ["ID", "担当者ID", "担当者名", "保管場所", "保有枚数", "最終更新日時", "lineUserId"]
    },
    {
      category: "monthly",
      sheetName: `受渡要請履歴${month}`,
      required: true,
      missingCode: "MISSING_CURRENT_MONTH_SHEET",
      headers: ["日時", "要請者", "要請者ID", "保管者", "保管者ID", "連絡方法", "連絡先", "状態", "requestId", "LINE送信状態", "LINE HTTP status", "LINE送信日時", "requesterLineUserId", "holderLineUserId"]
    },
    {
      category: "monthly",
      sheetName: `PinStatus${month}`,
      required: true,
      missingCode: "MISSING_CURRENT_MONTH_SHEET",
      headers: ["rowId", "status", "lineUserId", "lockId", "startedAt"]
    },
    // 掲示板系2種 (任意: 不在時はSKIP)
    {
      category: "bulletin",
      sheetName: "掲示板",
      required: false,
      headers: ["日時", "投稿者ID", "投稿者名", "メッセージ", "lineUserId"]
    },
    {
      category: "bulletin",
      sheetName: "掲示板連絡履歴",
      required: false,
      headers: ["日時", "送信者ID", "送信者名", "相手ID", "連絡方法", "連絡先", "requestId", "LINE送信状態", "LINE HTTP status", "LINE送信日時"]
    },
    // システム管理
    {
      category: "system",
      sheetName: "SYSTEM_INFO",
      required: true,
      missingCode: "MISSING_SYSTEM_INFO_SHEET",
      headers: ["項目", "内容"]
    }
  ];

  // 欠落シート検証 (Missing Sheet Policy)
  for (const item of schemas) {
    const s = ss.getSheetByName(item.sheetName);
    if (!s) {
      if (item.required) {
        return {
          success: false,
          code: item.missingCode,
          message: `Required sheet "${item.sheetName}" does not exist. Healing aborted.`,
          sheetName: item.sheetName,
          mutationsCount: 0
        };
      }
    }
  }

  // Phase 1: 全シート走査 (Scan-before-Mutate)
  const allPlans = [];
  const allCollisions = [];
  const skippedSheets = [];

  for (const item of schemas) {
    const sheet = ss.getSheetByName(item.sheetName);
    if (!sheet) {
      skippedSheets.push(item.sheetName);
      continue;
    }

    const maxCols = typeof sheet.getMaxColumns === 'function' ? sheet.getMaxColumns() : item.headers.length;
    const lastCol = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
    const lastRow = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 0;

    const sheetPlan = {
      sheetName: item.sheetName,
      sheet: sheet,
      maxCols: maxCols,
      columnsToAdd: 0,
      setHeaders: []
    };

    if (maxCols < item.headers.length) {
      sheetPlan.columnsToAdd = item.headers.length - maxCols;
    }

    // 既存ヘッダー行の取得（maxCols内のみ安全に取得、OUT_OF_GRIDはgetRange対象外）
    const scanCols = Math.min(lastCol, maxCols);
    let existingHeaderRow = [];
    if (lastRow >= 1 && scanCols >= 1) {
      const headerRange = sheet.getRange(1, 1, 1, scanCols);
      existingHeaderRow = (headerRange && typeof headerRange.getValues === 'function')
        ? headerRange.getValues()[0]
        : [];
    }

    for (let col = 1; col <= item.headers.length; col++) {
      const expected = item.headers[col - 1];
      if (lastRow === 0) {
        sheetPlan.setHeaders.push({ col, expected });
      } else if (col > maxCols) {
        // OUT_OF_GRID: getRange は呼ばず計画登録のみ
        sheetPlan.setHeaders.push({ col, expected, outOfGrid: true });
      } else if (col <= lastCol) {
        const val = existingHeaderRow[col - 1];
        const isBlank = (val === undefined || val === null || String(val).trim() === "");
        if (isBlank) {
          sheetPlan.setHeaders.push({ col, expected });
        } else {
          const strVal = String(val).trim();
          if (strVal !== expected) {
            allCollisions.push({
              sheetName: item.sheetName,
              col: col,
              expected: expected,
              actual: val
            });
          }
        }
      } else {
        // col > lastCol && col <= maxCols
        sheetPlan.setHeaders.push({ col, expected });
      }
    }

    if (sheetPlan.columnsToAdd > 0 || sheetPlan.setHeaders.length > 0) {
      allPlans.push(sheetPlan);
    }
  }

  // 衝突検出時は即時停止 (Fail-Closed, mutation 0)
  if (allCollisions.length > 0) {
    const details = allCollisions.map(c => `[${c.sheetName}] Col ${c.col}: expected "${c.expected}", found "${c.actual}"`).join('; ');
    return {
      success: false,
      code: "HEADER_COLLISION",
      message: `Header collisions detected across ${allCollisions.length} column(s). Mutations aborted: ${details}`,
      collisions: allCollisions,
      mutationsCount: 0
    };
  }

  // Dry-run 判定
  if (isDryRun) {
    return {
      success: true,
      isDryRun: true,
      message: `Dry-run completed. ${allPlans.length} sheet(s) require header healing. Mutations executed: 0.`,
      plans: allPlans.map(p => ({
        sheetName: p.sheetName,
        columnsToAdd: p.columnsToAdd,
        headersToSet: p.setHeaders.map(h => ({ col: h.col, expected: h.expected, outOfGrid: !!h.outOfGrid }))
      })),
      skippedSheets: skippedSheets,
      mutationsCount: 0
    };
  }

  // Phase 2: 適用 (Mutate)
  let mutationsCount = 0;
  for (const plan of allPlans) {
    const sheet = plan.sheet;
    if (plan.columnsToAdd > 0 && typeof sheet.insertColumnsAfter === 'function') {
      sheet.insertColumnsAfter(plan.maxCols, plan.columnsToAdd);
      mutationsCount++;
    }

    for (const h of plan.setHeaders) {
      const r = sheet.getRange(1, h.col);
      if (r) {
        if (typeof r.setValue === 'function') {
          r.setValue(h.expected);
        } else if (typeof r.setValues === 'function') {
          r.setValues([[h.expected]]);
        }
        if (typeof r.setBackground === 'function') r.setBackground("#1e293b");
        if (typeof r.setFontColor === 'function') r.setFontColor("#ffffff");
        if (typeof r.setFontWeight === 'function') r.setFontWeight("bold");
      }
      mutationsCount++;
    }
  }

  return {
    success: true,
    isDryRun: false,
    message: `Header healing applied successfully across ${allPlans.length} sheet(s).`,
    plans: allPlans.map(p => ({
      sheetName: p.sheetName,
      columnsToAdd: p.columnsToAdd,
      headersSet: p.setHeaders.map(h => ({ col: h.col, expected: h.expected }))
    })),
    skippedSheets: skippedSheets,
    mutationsCount: mutationsCount
  };
}

/**
 * inspectSystemInfoKeys
 * SYSTEM_INFO シートのヘッダーおよび11標準設定キーの存在を検査する。
 * 既存値・未知キーは絶対に変更・クリア・削除しない。
 * 
 * @param {Object} [options]
 * @return {Object} 検査結果
 */
function inspectSystemInfoKeys(options, districtId) {
  const opts = options || {};
  const cleanDistrictId = String(districtId || opts.districtId || "").trim().toUpperCase();

  let ss = null;
  try {
    ss = (typeof getSS === 'function') ? getSS(cleanDistrictId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  } catch (eSS) {
    return { success: false, code: "SPREADSHEET_NOT_FOUND", message: eSS.message };
  }
  if (!ss) {
    return { success: false, code: "SPREADSHEET_NOT_FOUND", message: "Spreadsheet not found" };
  }

  const sheet = ss.getSheetByName("SYSTEM_INFO");
  if (!sheet) {
    return {
      success: false,
      code: "MISSING_SYSTEM_INFO_SHEET",
      message: 'Sheet "SYSTEM_INFO" does not exist.'
    };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastCol < 2 || lastRow < 1) {
    return {
      success: false,
      code: "INVALID_SYSTEM_INFO_STRUCTURE",
      message: 'SYSTEM_INFO must have at least 2 columns and 1 header row.'
    };
  }

  const hRange = sheet.getRange(1, 1, 1, 2);
  const hVals = (hRange && typeof hRange.getValues === 'function') ? hRange.getValues()[0] : ["", ""];
  const hCol1 = String(hVals[0] || '').trim();
  const hCol2 = String(hVals[1] || '').trim();
  if (hCol1 !== "項目" || hCol2 !== "内容") {
    return {
      success: false,
      code: "INVALID_SYSTEM_INFO_HEADER",
      message: `SYSTEM_INFO header mismatch: expected ["項目", "内容"], got ["${hCol1}", "${hCol2}"]`
    };
  }

  const standardKeys = [
    "地区コード", "地区名", "HアプリURL", "Dashboard URL",
    "LIFFアプリ名", "LIFF ID", "LIFF URL", "Endpoint URL",
    "Manager認証パスワード", "状態", "契約終了日"
  ];

  const existingKeys = {};
  const extraKeys = [];

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    values.forEach((row, idx) => {
      const k = String(row[0] || '').trim();
      const v = row[1];
      if (k) {
        existingKeys[k] = { row: idx + 2, value: v };
        if (!standardKeys.includes(k)) {
          extraKeys.push({ key: k, row: idx + 2, value: v });
        }
      }
    });
  }

  const missingKeys = standardKeys.filter(k => !(k in existingKeys));

  return {
    success: true,
    sheetName: "SYSTEM_INFO",
    lastRow: lastRow,
    lastCol: lastCol,
    standardKeysTotal: standardKeys.length,
    foundStandardKeysCount: standardKeys.length - missingKeys.length,
    missingStandardKeys: missingKeys,
    extraKeys: extraKeys,
    allExistingKeysCount: Object.keys(existingKeys).length
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    migrateIdentityColumns,
    healSchemaHeaders,
    inspectSystemInfoKeys
  };
}
if (typeof globalThis !== 'undefined') {
  globalThis.migrateIdentityColumns = migrateIdentityColumns;
  globalThis.healSchemaHeaders = healSchemaHeaders;
  globalThis.inspectSystemInfoKeys = inspectSystemInfoKeys;
}

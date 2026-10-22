import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log("====================================================");
console.log("🧪 TEST SUITE: SCHEMA PROVISIONING & HEALING (14 CASES)");
console.log("====================================================");

// --- インメモリ Spreadsheet モック定義 ---

class MockRange {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const res = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) {
        const rIdx = (this.row - 1) + r;
        const cIdx = (this.col - 1) + c;
        const val = (this.sheet.grid[rIdx] && this.sheet.grid[rIdx][cIdx] !== undefined)
          ? this.sheet.grid[rIdx][cIdx]
          : "";
        rowArr.push(val);
      }
      res.push(rowArr);
    }
    return res;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  setValues(vals) {
    this.sheet.ss.mutationCount++;
    this.sheet.mutationCount++;
    for (let r = 0; r < vals.length; r++) {
      for (let c = 0; c < vals[r].length; c++) {
        const rIdx = (this.row - 1) + r;
        const cIdx = (this.col - 1) + c;
        if (!this.sheet.grid[rIdx]) this.sheet.grid[rIdx] = [];
        this.sheet.grid[rIdx][cIdx] = vals[r][c];
      }
    }
    return this;
  }

  setValue(v) {
    this.sheet.ss.mutationCount++;
    this.sheet.mutationCount++;
    const rIdx = this.row - 1;
    const cIdx = this.col - 1;
    if (!this.sheet.grid[rIdx]) this.sheet.grid[rIdx] = [];
    this.sheet.grid[rIdx][cIdx] = v;
    return this;
  }

  clearContent() {
    this.sheet.ss.mutationCount++;
    this.sheet.mutationCount++;
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        const rIdx = (this.row - 1) + r;
        const cIdx = (this.col - 1) + c;
        if (this.sheet.grid[rIdx] && this.sheet.grid[rIdx][cIdx] !== undefined) {
          this.sheet.grid[rIdx][cIdx] = "";
        }
      }
    }
    return this;
  }

  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class MockSheet {
  constructor(ss, name, initialGrid = [], maxColumns = 20) {
    this.ss = ss;
    this.name = name;
    this.grid = initialGrid.map(row => [...row]);
    this.maxColumns = maxColumns;
    this.mutationCount = 0;
    this.outOfGridAccessCount = 0;
  }

  getName() { return this.name; }
  setName(n) {
    if (this.ss && this.ss.sheets) {
      delete this.ss.sheets[this.name];
      this.ss.sheets[n] = this;
    }
    this.name = n;
    return this;
  }

  getMaxColumns() { return this.maxColumns; }

  getLastRow() {
    let last = 0;
    for (let r = 0; r < this.grid.length; r++) {
      const hasVal = this.grid[r] && this.grid[r].some(v => v !== "" && v !== undefined && v !== null);
      if (hasVal) last = r + 1;
    }
    return last;
  }

  getLastColumn() {
    let maxCol = 0;
    for (let r = 0; r < this.grid.length; r++) {
      if (!this.grid[r]) continue;
      for (let c = 0; c < this.grid[r].length; c++) {
        const v = this.grid[r][c];
        if (v !== "" && v !== undefined && v !== null) {
          if (c + 1 > maxCol) maxCol = c + 1;
        }
      }
    }
    return maxCol;
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    // OUT_OF_GRID 検出: 物理列数を超えて getRange された場合は記録
    if (col > this.maxColumns || (col + numCols - 1) > this.maxColumns) {
      this.outOfGridAccessCount++;
    }
    return new MockRange(this, row, col, numRows, numCols);
  }

  insertColumnsAfter(afterCol, howMany) {
    this.ss.mutationCount++;
    this.mutationCount++;
    this.maxColumns += howMany;
    return this;
  }

  copyTo(targetSS) {
    this.ss.mutationCount++;
    const copiedGrid = this.grid.map(row => [...row]);
    const copiedSheet = new MockSheet(targetSS, `Copy of ${this.name}`, copiedGrid, this.maxColumns);
    targetSS.sheets[copiedSheet.name] = copiedSheet;
    return copiedSheet;
  }

  appendRow(rowArr) {
    this.ss.mutationCount++;
    this.mutationCount++;
    this.grid.push([...rowArr]);
    return this;
  }

  setFrozenRows() { return this; }
}

class MockSpreadsheet {
  constructor(name = "TEST_DISTRICT") {
    this.name = name;
    this.sheets = {};
    this.mutationCount = 0;
  }

  getName() { return this.name; }

  getSheetByName(name) {
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    this.mutationCount++;
    const sheet = new MockSheet(this, name, []);
    this.sheets[name] = sheet;
    return sheet;
  }

  getSheets() {
    return Object.values(this.sheets);
  }

  addSheet(name, grid = [], maxColumns = 20) {
    const s = new MockSheet(this, name, grid, maxColumns);
    this.sheets[name] = s;
    return s;
  }
}

// --- VM サンドボックス環境ロード ---
function createVmContext(ss) {
  const sandbox = {
    console,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    Error,
    RegExp,
    Utilities: {
      formatDate(d, tz, fmt) {
        if (fmt === "yyyy-MM") return "2026-10";
        if (fmt === "yyyy/MM/dd HH:mm:ss") return "2026/10/01 10:00:00";
        if (fmt === "yyyy/MM/dd HH:mm") return "2026/10/01 10:00";
        if (fmt === "yyyy-MM-dd") return "2026-10-01";
        return "2026-10-01";
      }
    },
    Logger: { log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet() { return ss; },
      flush() {}
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          releaseLock() {}
        };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get() { return null; },
          put() {}
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty() { return ""; }
        };
      }
    },
    UrlFetchApp: {
      fetch(url) {
        return {
          getResponseCode() { return 200; },
          getContentText() {
            return "rowId,cityName,townName\n1,CITY_A,AREA_A\n";
          }
        };
      }
    },
    ScriptApp: {
      newTrigger() {
        return {
          timeBased() { return this; },
          everyDays() { return this; },
          atHour() { return this; },
          create() {}
        };
      }
    },
    lastResolvedDistrict: null,
    getSS(dist) {
      sandbox.lastResolvedDistrict = dist;
      if (dist === "INVALID_DIST") return null;
      return ss;
    }
  };

  const context = vm.createContext(sandbox);

  // 0. system_info_service.js & monthly_sheet_resolver.js
  const systemInfoCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/system/system_info_service.js'), 'utf8');
  vm.runInContext(systemInfoCode, context);
  const monthlyResolverCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/system/monthly_sheet_resolver.js'), 'utf8');
  vm.runInContext(monthlyResolverCode, context);

  // 1. district_provisioner.js
  const provisionerCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/system/district_provisioner.js'), 'utf8');
  vm.runInContext(provisionerCode, context);

  // 2. transfer_service.js
  const transferCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/transfer/transfer_service.js'), 'utf8');
  vm.runInContext(transferCode, context);

  // 3. bulletin_service.js
  const bulletinCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/bulletin/bulletin_service.js'), 'utf8');
  vm.runInContext(bulletinCode, context);

  // 4. v2_migration.js
  const migrationCode = fs.readFileSync(path.join(REPO_ROOT, 'active/gas/v2_migration.js'), 'utf8');
  vm.runInContext(migrationCode, context);

  return context;
}

// ====================================================
// テストケース実行
// ====================================================

let passCount = 0;

function runCase(name, fn) {
  process.stdout.write(`▶ ${name.padEnd(55)} ... `);
  try {
    fn();
    console.log("✅ PASS");
    passCount++;
  } catch (err) {
    console.log("❌ FAIL");
    console.error(err);
    process.exit(1);
  }
}

// --- Case 1-A: Operational Dataset Provisioning SSOT (17/4/7/14/5 cols, 原本なし) ---
runCase("Case 1-A: Operational Dataset Provisioning SSOT (17/4/7/14/5 cols)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [
    { rowId: 1, cityName: "CITY_A", townName: "AREA_A" },
    { rowId: 2, cityName: "CITY_A", townName: "AREA_B" }
  ];

  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);

  // 1. 配布実績2026-10: 17列 (P列 = lineUserId, Q列 = requestId)
  const distSheet = ss.getSheetByName("配布実績2026-10");
  assert.ok(distSheet, "配布実績2026-10 must exist");
  assert.equal(distSheet.getLastColumn(), 17, "配布実績 must have 17 cols");
  assert.equal(distSheet.grid[0][15], "lineUserId", "P列 must be lineUserId");
  assert.equal(distSheet.grid[0][16], "requestId", "Q列 must be requestId");
  assert.equal(distSheet.grid[1].length, 17, "Data row 1 must have 17 elements");
  assert.equal(distSheet.grid[1][15], "", "Data row 1 lineUserId must be empty string");
  assert.equal(distSheet.grid[1][16], "", "Data row 1 requestId must be empty string");

  // 2. 名簿2026-10: 4列
  const staffSheet = ss.getSheetByName("名簿2026-10");
  assert.ok(staffSheet);
  assert.equal(staffSheet.getLastColumn(), 4);
  assert.equal(staffSheet.grid[0][2], "LINE_USER_ID");

  // 3. チラシ2026-10: 7列 (G列 = lineUserId)
  const flyerSheet = ss.getSheetByName("保有チラシ枚数2026-10");
  assert.ok(flyerSheet);
  assert.equal(flyerSheet.getLastColumn(), 7);
  assert.equal(flyerSheet.grid[0][6], "lineUserId");

  // 4. 受渡2026-10: 14列 (13=requesterLineUserId, 14=holderLineUserId)
  const transferSheet = ss.getSheetByName("受渡要請履歴2026-10");
  assert.ok(transferSheet);
  assert.equal(transferSheet.getLastColumn(), 14);
  assert.equal(transferSheet.grid[0][7], "状態");
  assert.equal(transferSheet.grid[0][8], "requestId");
  assert.equal(transferSheet.grid[0][12], "requesterLineUserId");
  assert.equal(transferSheet.grid[0][13], "holderLineUserId");

  // 5. PinStatus2026-10: 5列
  const pinSheet = ss.getSheetByName("PinStatus2026-10");
  assert.ok(pinSheet);
  assert.equal(pinSheet.getLastColumn(), 5);
  assert.equal(pinSheet.grid[0][0], "rowId");
  assert.equal(pinSheet.grid[0][1], "status");
  assert.equal(pinSheet.grid[0][2], "lineUserId");
  assert.equal(pinSheet.grid[0][3], "lockId");
  assert.equal(pinSheet.grid[0][4], "startedAt");

  // 原本5種が一切生成されていないこと
  assert.equal(ss.getSheetByName("配布実績の原本"), null);
  assert.equal(ss.getSheetByName("名簿の原本"), null);
  assert.equal(ss.getSheetByName("保有チラシ枚数の原本"), null);
  assert.equal(ss.getSheetByName("受渡要請履歴の原本"), null);
  assert.equal(ss.getSheetByName("PinStatusの原本"), null);
});

// --- Case 1-B: Rollover Monthly Provisioning (0/5 生成 & 当月配布実績17列化) ---
runCase("Case 1-B: Rollover Monthly Provisioning (0/5 -> 17 cols)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  ss.addSheet("SYSTEM_INFO", [
    ["項目", "内容"],
    ["地区コード", "TEST_DISTRICT"],
    ["運用モード", "SUBSCRIPTION"],
    ["HアプリURL", "https://test.postingmap.jp"]
  ]);
  const ctx = createVmContext(ss);

  const sampleAddresses = [
    { rowId: 1, cityName: "CITY_A", townName: "AREA_A" }
  ];

  const res = ctx.DistrictProvisioner.getInstance().rolloverMonthlySheets("2026-10", { addresses: sampleAddresses });
  assert.equal(res.success, true);
  assert.equal(res.created.length, 5);

  const monthlyDist = ss.getSheetByName("配布実績2026-10");
  assert.ok(monthlyDist);
  assert.equal(monthlyDist.getLastColumn(), 17, "Monthly dist must have 17 cols");
  assert.equal(monthlyDist.grid[0][15], "lineUserId", "Col 16 must be lineUserId");
  assert.equal(monthlyDist.grid[0][16], "requestId", "Col 17 must be requestId");

  assert.equal(monthlyDist.grid[1][0], 1, "rowId must be preserved");
  assert.equal(monthlyDist.grid[1][1], "CITY_A", "cityName must be preserved");
  assert.equal(monthlyDist.grid[1][2], "AREA_A", "townName must be preserved");
});

// --- Case 2: Two-Phase Scan / Collision Fail-Closed (mutation 0) ---
runCase("Case 2: Collision Fail-Closed with mutation 0 (Scan-before-Mutate)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  // 当月5シートを用意し、flyer当月シートの7列目に異種値 0 を配置
  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  const flyerSheet = ss.getSheetByName("保有チラシ枚数2026-10");
  flyerSheet.grid[0][6] = 0; // 異種値衝突 (0 is a falsy non-blank value)

  const initialMutations = ss.mutationCount;
  const res = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10" });

  assert.equal(res.success, false);
  assert.equal(res.code, "HEADER_COLLISION");
  assert.equal(res.mutationsCount, 0, "No mutations should be executed on collision");
  assert.equal(ss.mutationCount, initialMutations, "Spreadsheet mutation API calls must be exactly 0");

  flyerSheet.grid[0][6] = "lineUserId"; // 復帰

  // 追加反例: 旧 alias 表記（受渡要請履歴の1列目に "要請日時"）に対する厳格な Collision 判定
  const trMonthly = ss.getSheetByName("受渡要請履歴2026-10");
  trMonthly.grid[0][0] = "要請日時"; // 旧 alias (expected: "日時")
  const mutationsBeforeTr = ss.mutationCount;
  const resAliasTr = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10" });
  assert.equal(resAliasTr.success, false);
  assert.equal(resAliasTr.code, "HEADER_COLLISION");
  assert.equal(resAliasTr.mutationsCount, 0);
  assert.equal(ss.mutationCount, mutationsBeforeTr, "Legacy alias in transfer sheet must trigger collision with 0 mutations");
  trMonthly.grid[0][0] = "日時"; // 復帰

  // 追加反例: 名簿当月シートの3列目に旧 alias "LINE USER ID"
  const staffMonthly = ss.getSheetByName("名簿2026-10");
  staffMonthly.grid[0][2] = "LINE USER ID"; // 旧 alias (expected: "LINE_USER_ID")
  const mutationsBeforeStaff = ss.mutationCount;
  const resAliasStaff = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10" });
  assert.equal(resAliasStaff.success, false);
  assert.equal(resAliasStaff.code, "HEADER_COLLISION");
  assert.equal(resAliasStaff.mutationsCount, 0);
  assert.equal(ss.mutationCount, mutationsBeforeStaff, "Legacy alias in staff monthly must trigger collision with 0 mutations");
  staffMonthly.grid[0][2] = "LINE_USER_ID"; // 復帰
});

// --- Case 3: Dry-run Safety (mutation 0 API calls) ---
runCase("Case 3: Dry-run Safety Guarantee (API mutation call count = 0)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  // チラシ当月シートの7列目を意図的に空にする
  const flyerSheet = ss.getSheetByName("保有チラシ枚数2026-10");
  flyerSheet.grid[0][6] = "";

  const initialMutations = ss.mutationCount;
  const res = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-10" });

  assert.equal(res.success, true);
  assert.equal(res.isDryRun, true);
  assert.equal(res.mutationsCount, 0);
  assert.equal(ss.mutationCount, initialMutations, "Spreadsheet must not be mutated in dry-run");
  assert.equal(flyerSheet.grid[0][6], "", "Header value must remain untouched in dry-run");
});

// --- Case 4: Identity Migration Safety (STF001 / TEST_USER_A 完全一致照合 & 矛盾行保全) ---
runCase("Case 4: migrateIdentityColumns Name-Match Verification & ST001 Untouched", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  // 名簿シート
  ss.addSheet("名簿2026-10", [
    ["ID", "名前", "LINE_USER_ID", "登録日時"],
    ["STF001", "TEST_USER_A", "U11111", "2026/10/01"],
    ["STF002", "TEST_USER_B", "U22222", "2026/10/01"]
  ]);

  // 配布実績シート
  const distGrid = [
    ["ID", "市町村", "町域", "配布完了日時", "配布枚数", "担当者ID", "担当者名", "GPS", "写真", "緯度", "経度", "GPS日時", "写真ファイルID", "写真URL", "写真日時", "lineUserId"],
    [1, "CITY_A", "AREA_A", "2026/10/01 10:00", 500, "STF001", "TEST_USER_A", "", "", "", "", "", "", "", "", ""], // 完全一致
    [2, "CITY_A", "AREA_B", "2026/10/01 11:00", 300, "STF001", "TEST_USER_X", "", "", "", "", "", "", "", "", ""], // 名前不一致
    [3, "CITY_A", "AREA_C", "2026/10/01 12:00", 200, "STF999", "UNKNOWN_USER", "", "", "", "", "", "", "", "", ""] // 名簿不在
  ];
  const distSheet = ss.addSheet("配布実績2026-10", distGrid);

  // Resolver モック
  ctx.MonthlySheetResolver = {
    getInstance() {
      return {
        getCurrentSheet(type) {
          if (type === "staff") return ss.getSheetByName("名簿2026-10");
          if (type === "distribution") return distSheet;
          return null;
        }
      };
    }
  };

  const rep = ctx.migrateIdentityColumns(false);
  assert.equal(rep.success, true);

  assert.equal(distSheet.grid[1][15], "U11111", "Row 2: STF001 with TEST_USER_A must be resolved to U11111");
  assert.equal(distSheet.grid[2][15], "", "Row 3: STF001 with mismatched name must remain blank");
  assert.equal(distSheet.grid[3][15], "", "Row 4: STF999 not in roster must remain blank");
});

// --- Case 5: Missing Sheet Policy (Monthly fail-closed) ---
runCase("Case 5: Missing Sheet Policy (Monthly fail-closed)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  // 運用当月シートが足りない状態 (名簿のみ存在、配布実績等欠損)
  ss.addSheet("名簿2026-10", [["ID", "名前", "LINE_USER_ID", "登録日時"]]);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);
  const res = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-10" });
  assert.equal(res.success, false);
  assert.equal(res.code, "MISSING_CURRENT_MONTH_SHEET");
});

// --- Case 6: Missing Sheet Policy (Bulletin sheets skipped gracefully) ---
runCase("Case 6: Missing Sheet Policy (Bulletin sheets skipped gracefully)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  // 掲示板シート・連絡履歴シートは存在しない
  assert.equal(ss.getSheetByName("掲示板"), null);

  const res = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-10" });
  assert.equal(res.success, true);
  assert.ok(res.skippedSheets.includes("掲示板"), "掲示板 should be skipped gracefully");
  assert.ok(res.skippedSheets.includes("掲示板連絡履歴"), "掲示板連絡履歴 should be skipped gracefully");
});

// --- Case 7: Data Row Immutability (2行目以降不可侵) ---
runCase("Case 7: Data Row Immutability (Row >= 2 untouched by healSchemaHeaders)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  const flyerSheet = ss.getSheetByName("保有チラシ枚数2026-10");
  flyerSheet.grid[0][6] = ""; // 7列目欠損
  flyerSheet.grid.push([1, "STF001", "TEST_USER_A", "CITY_A", 500, "10/01 10:00", "ORIGINAL_DATA"]);

  const res = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10" });
  assert.equal(res.success, true);
  assert.equal(flyerSheet.grid[0][6], "lineUserId", "Header must be healed");
  assert.deepEqual(
    flyerSheet.grid[1],
    [1, "STF001", "TEST_USER_A", "CITY_A", 500, "10/01 10:00", "ORIGINAL_DATA"],
    "Data row 2 must be 100% untouched"
  );
});

// --- Case 8: Past Month Immutability (過去月シート不可侵) ---
runCase("Case 8: Past Month Immutability (Past months ignored and untouched)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  // 過去月シートを配置
  const pastDist = ss.addSheet("配布実績2026-09", [
    ["ID", "市町村", "町域"],
    [1, "CITY_A", "AREA_A"]
  ]);

  const initialPastMutations = pastDist.mutationCount;
  ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10" });

  assert.equal(pastDist.mutationCount, initialPastMutations, "Past month sheet must have 0 mutations");
});

// --- Case 9: TransferService ensureHeaders (14列保証 & 異種値衝突Fail) ---
runCase("Case 9: TransferService.ensureHeaders (14 cols healed & collision fail)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  // 1. 12列の旧シートに対して実行 -> 14列に拡張補完
  const oldHeaders = [["日時", "要請者", "要請者ID", "保管者", "保管者ID", "連絡方法", "連絡先", "状態", "requestId", "LINE送信状態", "LINE HTTP status", "LINE送信日時"]];
  const trSheet1 = ss.addSheet("受渡要請履歴2026-10", oldHeaders, 12);

  const res1 = ctx.TransferService.getInstance().ensureHeaders(trSheet1);
  assert.equal(res1.success, true);
  assert.equal(trSheet1.getLastColumn(), 14);
  assert.equal(trSheet1.grid[0][12], "requesterLineUserId");
  assert.equal(trSheet1.grid[0][13], "holderLineUserId");

  // 2. 異種値衝突 (13列目に false) -> 例外スロー & 書込0回
  const conflictHeaders = [["日時", "要請者", "要請者ID", "保管者", "保管者ID", "連絡方法", "連絡先", "状態", "requestId", "LINE送信状態", "LINE HTTP status", "LINE送信日時", false]];
  const trSheet2 = ss.addSheet("受渡要請履歴_衝突", conflictHeaders, 14);

  const initialMutations = trSheet2.mutationCount;
  assert.throws(() => {
    ctx.TransferService.getInstance().ensureHeaders(trSheet2);
  }, /HEADER_COLLISION/);
  assert.equal(trSheet2.mutationCount, initialMutations, "Must not mutate sheet on collision");

  // 3. 追加反例: 旧 alias 表記（"要請日時", "LINE状態" 等）に対する HEADER_COLLISION 例外スロー
  const aliasHeaders = [["要請日時", "要請者名", "要請者ID", "保管者", "保管者ID", "連絡方法", "連絡先", "状態", "requestId", "LINE状態", "LINE HTTP", "LINE送信日時", "requesterLineUserId", "holderLineUserId"]];
  const trSheet3 = ss.addSheet("受渡要請履歴_旧表記", aliasHeaders, 14);
  const mutationsBeforeAlias = trSheet3.mutationCount;
  assert.throws(() => {
    ctx.TransferService.getInstance().ensureHeaders(trSheet3);
  }, /HEADER_COLLISION/);
  assert.equal(trSheet3.mutationCount, mutationsBeforeAlias, "Must not mutate sheet on legacy alias collision");
});

// --- Case 10: OUT_OF_GRID Handling (当月17列専用 & Phase 1 getRange呼出0回) ---
runCase("Case 10: OUT_OF_GRID Handling (Monthly 17-col only & no getRange in Phase 1)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  // 配布実績2026-10 を 16列 (maxColumns: 16) に設定し、17列目 requestId を OUT_OF_GRID とする
  const distMonthly = ss.getSheetByName("配布実績2026-10");
  distMonthly.maxColumns = 16;
  distMonthly.grid[0] = distMonthly.grid[0].slice(0, 16);
  distMonthly.outOfGridAccessCount = 0;

  // Phase 1 (Dry-run) 実行
  const dryRes = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-10" });
  assert.equal(dryRes.success, true);
  assert.equal(distMonthly.outOfGridAccessCount, 0, "Phase 1 must NOT call getRange for OUT_OF_GRID col 17");

  // Phase 2 実行
  const mutateRes = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10" });
  assert.equal(mutateRes.success, true);
  assert.equal(distMonthly.maxColumns, 17, "Max columns must be expanded to 17");
  assert.equal(distMonthly.grid[0][16], "requestId", "Col 17 must be set to requestId");
});

// --- Case 11: Rollover State Machine (5/5 No-op & 1-4/5 Fail-Closed) ---
runCase("Case 11: Rollover State Machine (5/5 complete No-op & 1-4/5 Fail-Closed)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  ss.addSheet("SYSTEM_INFO", [
    ["項目", "内容"],
    ["地区コード", "TEST_DISTRICT"],
    ["運用モード", "SUBSCRIPTION"],
    ["HアプリURL", "https://test.postingmap.jp"]
  ]);
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];

  // 1. 初回 0/5 -> 5シート生成
  const res1 = ctx.DistrictProvisioner.getInstance().rolloverMonthlySheets("2026-10", { addresses: sampleAddresses });
  assert.equal(res1.success, true);
  assert.equal(res1.created.length, 5);

  // 2. 5/5 存在時の再実行 -> 完全 No-op (API呼出0回)
  const mutationsBefore = ss.mutationCount;
  const res2 = ctx.DistrictProvisioner.getInstance().rolloverMonthlySheets("2026-10");
  assert.equal(res2.success, true);
  assert.equal(res2.noop, true);
  assert.equal(res2.created.length, 0);
  assert.equal(ss.mutationCount, mutationsBefore, "Rollover 5/5 must be 100% No-op with 0 API calls");

  // 3. 1〜4/5 の破損状態 (1シート削除して 4/5 状態にする)
  delete ss.sheets["PinStatus2026-10"];
  const mutationsBeforeCorrupt = ss.mutationCount;
  const res3 = ctx.DistrictProvisioner.getInstance().rolloverMonthlySheets("2026-10");
  assert.equal(res3.success, false);
  assert.equal(res3.code, "PARTIAL_MONTHLY_SHEETS_CORRUPTION");
  assert.equal(ss.mutationCount, mutationsBeforeCorrupt, "Rollover partial corruption must have 0 mutations");
});

// --- Case 12: BulletinService 5-col Initial ---
runCase("Case 12: BulletinService.getBulletinSheet initial 5-col creation", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  assert.equal(ss.getSheetByName("掲示板"), null);
  const sheet = ctx.BulletinService.getInstance().getBulletinSheet();
  assert.ok(sheet);
  assert.equal(sheet.getLastColumn(), 5);
  assert.equal(sheet.grid[0][4], "lineUserId", "5th column must be lineUserId");
});

// --- Case 13: SYSTEM_INFO SSOT & Immutability ---
runCase("Case 13: inspectSystemInfoKeys (11 standard keys inspection & custom key preserved)", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sysGrid = [
    ["項目", "内容"],
    ["地区コード", "TEST_DISTRICT"],
    ["地区名", "TEST_DISTRICT_NAME"],
    ["HアプリURL", "https://test.example.invalid/"],
    ["Dashboard URL", "https://test.example.invalid/active/manager/"],
    ["LIFFアプリ名", "POSTING MAP TEST"],
    ["LIFF ID", "1234567890-dummy"],
    ["LIFF URL", "https://liff.line.me/1234567890-dummy"],
    ["Endpoint URL", "https://test.example.invalid/"],
    ["Manager認証パスワード", "999999"],
    ["状態", "ACTIVE"],
    ["契約終了日", "2026-12-31"],
    ["CUSTOM_OPERATOR", "TEST_OPERATOR_VAL"] // 未知キー
  ];
  const sysSheet = ss.addSheet("SYSTEM_INFO", sysGrid);

  const initialMutations = sysSheet.mutationCount;
  const res = ctx.inspectSystemInfoKeys();

  assert.equal(res.success, true);
  assert.equal(res.standardKeysTotal, 11);
  assert.equal(res.foundStandardKeysCount, 11);
  assert.equal(res.missingStandardKeys.length, 0);
  assert.equal(res.extraKeys.length, 1);
  assert.equal(res.extraKeys[0].key, "CUSTOM_OPERATOR");
  assert.equal(res.extraKeys[0].value, "TEST_OPERATOR_VAL");
  assert.equal(sysSheet.mutationCount, initialMutations, "SYSTEM_INFO must not be mutated during inspection");

  // 不在時の検証
  delete ss.sheets["SYSTEM_INFO"];
  const resMissing = ctx.inspectSystemInfoKeys();
  assert.equal(resMissing.success, false);
  assert.equal(resMissing.code, "MISSING_SYSTEM_INFO_SHEET");
});

// --- Case 15: healSchemaHeaders District-Aware Resolution ---
runCase("Case 15: healSchemaHeaders district-aware resolution", () => {
  const ss = new MockSpreadsheet("TEST_DISTRICT");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "CITY_A", townName: "AREA_A" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "TEST_DISTRICT"], ["運用モード", "SUBSCRIPTION"]]);

  // 1. 正常な地区指定
  const resValid = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-10", districtId: "TEST_DISTRICT" });
  assert.equal(resValid.success, true);
  assert.equal(ctx.lastResolvedDistrict, "TEST_DISTRICT", "districtId must be passed to getSS");

  // 2. 無効な地区指定 (getSS が null を返す)
  const resInvalid = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-10", districtId: "INVALID_DIST" });
  assert.equal(resInvalid.success, false);
  assert.equal(resInvalid.code, "SPREADSHEET_NOT_FOUND");
  assert.equal(ctx.lastResolvedDistrict, "INVALID_DIST");
});

// --- Case 16: healSchemaHeaders Plan A (2026-09 15-col -> 17-col, P=lineUserId, Q=requestId, data rows mutation 0) ---
runCase("Case 16: healSchemaHeaders Plan A (2026-09 15-col -> 17-col, data rows mutation 0)", () => {
  const ss = new MockSpreadsheet("KUWANA");
  const ctx = createVmContext(ss);

  // 2026-09 を 15列 (Generation 1 旧構造)、既存データ行ありで作成
  const pastDistGrid = [
    ["ID", "市町村", "町域", "配布完了日時", "配布枚数", "担当者ID", "担当者名", "GPS", "写真", "緯度", "経度", "GPS日時", "写真ファイルID", "写真URL", "写真日時"],
    [1, "KUWANA", "AREA_1", "2026/09/15 10:00", 50, "S001", "Taro", "35.0,136.0", "img.jpg", 35.0, 136.0, "2026/09/15 10:00", "fid1", "http://url", "2026/09/15 10:00"]
  ];
  const dist202609 = ss.addSheet("配布実績2026-09", pastDistGrid, 15);
  // 他の当月シートも 2026-09 で用意
  ss.addSheet("名簿2026-09", [["ID", "名前", "LINE_USER_ID", "登録日時"]]);
  ss.addSheet("保有チラシ枚数2026-09", [["ID", "担当者ID", "担当者名", "保管場所", "保有枚数", "最終更新日時", "lineUserId"]]);
  ss.addSheet("受渡要請履歴2026-09", [["日時", "要請者", "要請者ID", "保管者", "保管者ID", "連絡方法", "連絡先", "状態", "requestId", "LINE送信状態", "LINE HTTP status", "LINE送信日時", "requesterLineUserId", "holderLineUserId"]]);
  const pin202609 = ss.addSheet("PinStatus2026-09", [["rowId", "status"]], 2);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "KUWANA"], ["運用モード", "SUBSCRIPTION"]]);

  assert.equal(dist202609.getMaxColumns(), 15);
  assert.equal(dist202609.grid[1].length, 15);
  assert.equal(pin202609.getMaxColumns(), 2);

  // Phase 1: DryRun
  const dryRes = ctx.healSchemaHeaders({ isDryRun: true, targetMonth: "2026-09", districtId: "KUWANA" });
  assert.equal(dryRes.success, true);
  assert.equal(dryRes.isDryRun, true);
  assert.equal(dist202609.getMaxColumns(), 15, "DryRun must not mutate columns");
  assert.equal(pin202609.getMaxColumns(), 2, "DryRun must not mutate PinStatus columns");

  // Phase 2: Actual Heal
  const healRes = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-09", districtId: "KUWANA" });
  assert.equal(healRes.success, true);
  assert.equal(dist202609.getMaxColumns(), 17, "2026-09 must be expanded to 17 columns");
  assert.equal(dist202609.grid[0][15], "lineUserId", "Col 16 (P) must be lineUserId");
  assert.equal(dist202609.grid[0][16], "requestId", "Col 17 (Q) must be requestId");
  assert.equal(pin202609.getMaxColumns(), 5, "PinStatus2026-09 must be expanded from 2 to 5 columns");
  assert.deepEqual(pin202609.grid[0], ["rowId", "status", "lineUserId", "lockId", "startedAt"], "PinStatus headers must be healed to 5 columns");

  // 【厳格検証】データ行 (2行目) は一切不可侵 (mutation 0、requestId は補完されない)
  assert.equal(dist202609.grid[1][0], 1);
  assert.equal(dist202609.grid[1][1], "KUWANA");
  assert.equal(dist202609.grid[1][5], "S001");
  assert.equal(dist202609.grid[1][15] || "", "", "Data row col 16 must remain untouched/empty");
  assert.equal(dist202609.grid[1][16] || "", "", "Data row col 17 (requestId) must remain untouched/empty");
});

// --- Case 17: healSchemaHeaders (2026-10 17-col with blank P-col healed, data rows mutation 0) ---
runCase("Case 17: healSchemaHeaders (2026-10 17-col blank P healed, data rows mutation 0)", () => {
  const ss = new MockSpreadsheet("KUWANA");
  const ctx = createVmContext(ss);

  const sampleAddresses = [{ rowId: 1, cityName: "KUWANA", townName: "AREA_1" }];
  ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, "2026-10", sampleAddresses);
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "KUWANA"], ["運用モード", "SUBSCRIPTION"]]);

  const dist202610 = ss.getSheetByName("配布実績2026-10");
  // 本番 KUWANA の実態を再現: 17列で P列(16)が空文字、Q列(17)が "requestId"
  dist202610.grid[0][15] = "";
  dist202610.grid[0][16] = "requestId";
  // データ行追加
  dist202610.grid[1] = [1, "KUWANA", "AREA_1", "2026/10/01 09:00", 30, "S001", "Taro", "", "", "", "", "", "", "", "", "", "req-123"];

  const healRes = ctx.healSchemaHeaders({ isDryRun: false, targetMonth: "2026-10", districtId: "KUWANA" });
  assert.equal(healRes.success, true);
  assert.equal(dist202610.grid[0][15], "lineUserId", "Col 16 (P) must be healed to lineUserId");
  assert.equal(dist202610.grid[0][16], "requestId", "Col 17 (Q) must remain requestId");

  // データ行 (2行目) の整合確認
  assert.equal(dist202610.grid[1][16], "req-123", "Existing requestId in data row must be preserved");
});

// --- Case 18: inspectSystemInfoKeys District-Aware ---
runCase("Case 18: inspectSystemInfoKeys district-aware resolution", () => {
  const ss = new MockSpreadsheet("KUWANA");
  const ctx = createVmContext(ss);

  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "KUWANA"]]);

  const res = ctx.inspectSystemInfoKeys({ districtId: "KUWANA" });
  assert.equal(res.success, true);
  assert.equal(ctx.lastResolvedDistrict, "KUWANA");

  const resInvalid = ctx.inspectSystemInfoKeys({ districtId: "INVALID_DIST" });
  assert.equal(resInvalid.success, false);
  assert.equal(resInvalid.code, "SPREADSHEET_NOT_FOUND");
});

// --- Case 19: migrateIdentityColumns District-Aware ---
runCase("Case 19: migrateIdentityColumns district-aware resolution", () => {
  const ss = new MockSpreadsheet("KUWANA");
  ss.addSheet("SYSTEM_INFO", [["項目", "内容"], ["地区コード", "KUWANA"], ["運用モード", "SUBSCRIPTION"]]);
  const ctx = createVmContext(ss);

  const res = ctx.migrateIdentityColumns(true, { districtId: "KUWANA" });
  assert.equal(res.success, true);
  assert.equal(ctx.lastResolvedDistrict, "KUWANA");

  const resInvalid = ctx.migrateIdentityColumns(true, { districtId: "INVALID_DIST" });
  assert.equal(resInvalid.success, false);
});

console.log("\n====================================================");
console.log(`🎉 ALL 19 TEST CASES PASSED PERFECTLY! (${passCount}/19)`);
console.log("====================================================");


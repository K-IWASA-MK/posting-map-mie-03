import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { extractDistrictTokens } from '../scripts/check-universal-invariants.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('🛡️ DISTRICT APP DEPLOYMENT SKILL & GOVERNANCE SUITE');
console.log('====================================================');

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  process.stdout.write(`▶ ${name} ... `);
  try {
    fn();
    console.log('✅ PASS');
    passedCount++;
  } catch (e) {
    console.log('❌ FAIL');
    console.error(e);
    process.exit(1);
  }
}

const skillPath = path.join(REPO_ROOT, '.agents/skills/district-app-deployment/SKILL.md');
const registryPath = path.join(REPO_ROOT, '.agents/os-registry.json');
const deployerAgentPath = path.join(REPO_ROOT, '.agents/agents/deployer/agent.md');
const executionAgentPath = path.join(REPO_ROOT, '.agents/agents/execution/agent.md');
const authorityRulePath = path.join(REPO_ROOT, '.agents/rules/agent-authority.md');
const runbookPath = path.join(REPO_ROOT, 'docs/operations/DISTRICT_PROVISIONING_RUNBOOK.md');

const skillText = fs.readFileSync(skillPath, 'utf8');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const deployerText = fs.readFileSync(deployerAgentPath, 'utf8');
const executionText = fs.readFileSync(executionAgentPath, 'utf8');
const authorityText = fs.readFileSync(authorityRulePath, 'utf8');
const runbookText = fs.readFileSync(runbookPath, 'utf8');

runTest('D1: Skill file exists with valid frontmatter and 13 canonical sections', () => {
  assert.match(skillText, /^---\nname:\s*district-app-deployment\n/);
  for (let i = 1; i <= 13; i++) {
    assert.match(skillText, new RegExp(`## ${i}\\.\\s+`), `Missing Section ${i} in SKILL.md`);
  }
});

runTest('D2: Zero district literals, zero @1/@2 generation numbers, zero 64-char SHA-256 hex', () => {
  const dynamicTokens = extractDistrictTokens(path.join(REPO_ROOT, 'data'));
  const cnamePath = path.join(REPO_ROOT, 'CNAME');
  if (fs.existsSync(cnamePath)) {
    const cname = fs.readFileSync(cnamePath, 'utf8').trim();
    if (cname) dynamicTokens.push(cname);
  }

  for (const token of dynamicTokens) {
    if (!token || token.length < 3) continue;
    assert.equal(
      skillText.toLowerCase().includes(token.toLowerCase()),
      false,
      `Forbidden district literal "${token}" found in district-app-deployment/SKILL.md`
    );
  }

  // Must not hardcode @1 or @2 deployment generation numbers
  assert.equal(/@1\b/.test(skillText), false, 'Forbidden fixed generation @1 found in SKILL.md');
  assert.equal(/@2\b/.test(skillText), false, 'Forbidden fixed generation @2 found in SKILL.md');
  assert.ok(skillText.includes('<NEW_DEPLOYMENT>'), 'Missing <NEW_DEPLOYMENT> placeholder');
  assert.ok(skillText.includes('<LEGACY_DEPLOYMENT>'), 'Missing <LEGACY_DEPLOYMENT> placeholder');

  // Must not contain 64-char hex strings
  assert.equal(/[a-f0-9]{64}/i.test(skillText), false, 'Forbidden 64-char SHA-256 hex found in SKILL.md');
});

runTest('D3: Human Input Contract (MASTER direct input B4/B16, AI READ ONLY, Normal Path A4/A16 existing check, no syncSystemInfo)', () => {
  assert.ok(skillText.includes('SYSTEM_INFO!B4'), 'Missing SYSTEM_INFO!B4');
  assert.ok(skillText.includes('SYSTEM_INFO!B16'), 'Missing SYSTEM_INFO!B16');
  assert.match(skillText, /MASTER\s*が直接入力し、Execution AI\s*は両セルを\s*\*\*読むだけ（READ ONLY）\*\*/);
  assert.match(skillText, /Normal Path.*A4:\s*HアプリURL.*A16:\s*GOOGLE_MAPS_API_KEY.*既に存在する/s);
  assert.match(skillText, /AI\s*が勝手に入力欄を新設・上書きしてはならない/);
  assert.match(skillText, /syncSystemInfo\(\).*実行は絶対禁止/);
});

runTest('D4: District Initialization Contract (Normal Path indivisible unit + 5 criteria + Recovery Path + zero migration)', () => {
  assert.ok(skillText.includes('Normal Path'), 'Missing Normal Path');
  assert.ok(skillText.includes('Recovery Path'), 'Missing Recovery Path');
  assert.match(skillText, /Precondition（前提条件）/);
  assert.match(skillText, /単一不可分の「District Initialization（地区初期化）」作業単位/);
  assert.match(skillText, /A2:C\(N\+1\)/);
  assert.match(skillText, /D2:Q\(N\+1\)/);
  assert.match(skillText, /Migration.*一切行わない/);
});

runTest('D5: Script Properties 3-Tier Matrix (Tier 1 9 standard keys, Tier 2 Runtime references, Tier 3 Human vs AI)', () => {
  const requiredKeys = [
    'TARGET_SPREADSHEET_ID',
    'SPREADSHEET_ID',
    'DISTRICT_ID',
    'GOOGLE_MAPS_API_KEY_<DISTRICT_ID>',
    'LINE_LIFF_ID',
    'PRODUCTION_LIFF_URL',
    'BRANCH_ROOT_FOLDER_ID',
    'STORAGE_PARENT_ID',
    'LINE_CHANNEL_ACCESS_TOKEN'
  ];
  for (const key of requiredKeys) {
    assert.ok(skillText.includes(key), `Missing standard Script Property key: ${key}`);
  }
  assert.ok(skillText.includes('Tier 1:'), 'Missing Tier 1 classification');
  assert.ok(skillText.includes('Tier 2:'), 'Missing Tier 2 classification');
  assert.ok(skillText.includes('Tier 3:'), 'Missing Tier 3 classification');
  assert.ok(skillText.includes('SYSTEM_INFO!B10'), 'Missing SYSTEM_INFO!B10 Manager PIN SSOT note');
});

runTest('D6: switchDistrictSpreadsheet verification uses 3 semantic invariants without exact error string fixation', () => {
  assert.ok(skillText.includes('switchDistrictSpreadsheet'), 'Missing switchDistrictSpreadsheet verification');
  assert.match(skillText, /特定のエラーメッセージ文言に依存せず/);
  assert.match(skillText, /1\.\s*`success:\s*true`\s*を返さないこと/);
  assert.match(skillText, /2\.\s*旧共用親\s*GAS\s*の\s*`Provisioning token is missing`\s*ルートに入らないこと/);
  assert.match(skillText, /3\.\s*Spreadsheet DB\s*および\s*Script Properties\s*に一切の副作用（変更）が発生しないこと/);
  assert.equal(skillText.includes('Missing liffToken'), false, 'Must not fixate on exact Missing liffToken error string in Universal Skill');
});

runTest('D7: Cutover, Stage 7 Audit (<BASE>..<TARGET>), Push, and Legacy Deployment Retirement exact order', () => {
  const idxScopeCommit = skillText.indexOf('Scope Lock Commit 作成 ➔ このコミット SHA を <BASE> とする');
  const idxConfigUpdate = skillText.indexOf('data/config.js の api.gasWebAppUrl 1行のみを <NEW_DEPLOYMENT> URL へ更新');
  const idxImplCommit = skillText.indexOf('Implementation Commit 作成 ➔ このコミット SHA を <TARGET> とする (<BASE> !== <TARGET>)');
  const idxAuditor = skillText.indexOf('Stage 7 Independent Auditor 起動 (監査対象: <BASE>..<TARGET>)');
  const idxGateAuditor = skillText.indexOf('npm run gate:auditor -- --base <BASE> --target <TARGET>');
  const idxPush = skillText.indexOf('git push origin main');
  const idxProdVerify = skillText.indexOf('本番配信反映確認 & H-App / Manager Dashboard 実機疎通確認');
  const idxUndeploy = skillText.indexOf('Legacy Deployment Retirement (<LEGACY_DEPLOYMENT> の clasp undeploy)');

  assert.ok(idxScopeCommit > 0, 'Missing Scope Lock Commit (<BASE>) step');
  assert.ok(idxConfigUpdate > idxScopeCommit, 'data/config.js update must follow Scope Lock Commit');
  assert.ok(idxImplCommit > idxConfigUpdate, 'Implementation Commit (<TARGET>) must follow data/config.js update');
  assert.ok(idxAuditor > idxImplCommit, 'Stage 7 Independent Auditor must follow Implementation Commit (<TARGET>)');
  assert.ok(idxGateAuditor > idxAuditor, 'gate:auditor must follow Independent Auditor');
  assert.ok(idxPush > idxGateAuditor, 'git push must follow gate:auditor');
  assert.ok(idxProdVerify > idxPush, 'Production verification must follow git push');
  assert.ok(idxUndeploy > idxProdVerify, 'Legacy Deployment Retirement (undeploy) must follow Production verification');

  assert.match(skillText, /GAS プロジェクト恒久削除の絶対禁止/);
});

runTest('D8: OS Registry, Agent frontmatter, Authority Rule, and Runbook pointer synchronization', () => {
  assert.ok(registry.capabilityPacks['district-app-deployment'], 'Missing district-app-deployment in os-registry.json capabilityPacks');
  assert.ok(registry.rolePackAssignments.execution.includes('district-app-deployment'), 'Missing district-app-deployment in execution rolePackAssignments');
  assert.ok(registry.rolePackAssignments.deployer.includes('district-app-deployment'), 'Missing district-app-deployment in deployer rolePackAssignments');
  assert.ok(deployerText.includes('- district-app-deployment'), 'Missing district-app-deployment in deployer/agent.md');
  assert.ok(executionText.includes('- district-app-deployment'), 'Missing district-app-deployment in execution/agent.md');

  // Authority rule: No Unsolicited Architecture / Runtime Expansion
  assert.ok(
    authorityText.includes('No Unsolicited Architecture / Runtime Expansion'),
    'Missing No Unsolicited Architecture / Runtime Expansion rule in agent-authority.md'
  );

  // Runbook pointer without duplicating the 13 skill sections
  assert.ok(
    runbookText.includes('.agents/skills/district-app-deployment/SKILL.md'),
    'Missing Companion Activation Skill pointer in DISTRICT_PROVISIONING_RUNBOOK.md'
  );
  assert.equal(
    runbookText.includes('## 7. Script Properties Contract (3区分マトリクス)'),
    false,
    'Runbook must not duplicate the 13 sections of district-app-deployment/SKILL.md'
  );
});

// --- Runtime Sanitization & District Initialization Mock Infrastructure ---
class SanitizationMockSheet {
  constructor(ss, name, initialGrid = [], metadata = {}) {
    this.ss = ss;
    this.name = name;
    this.grid = initialGrid.map(r => [...r]);
    this.mutationCount = 0;
    this.clearCallCount = 0;
    this.clearContentCallCount = 0;
    this.renameCallCount = 0;
    this.formatting = metadata.formatting || { headerBg: '#1e293b', colWidths: [100, 120, 150], conditionalRules: ['rule1'], frozenRows: 1, protections: ['prot1'] };
  }
  getName() { return this.name; }
  setName(newName) {
    this.renameCallCount++;
    this.ss.renameSheetCallCount++;
    this.name = newName;
    return this;
  }
  getLastRow() {
    let last = 0;
    for (let r = 0; r < this.grid.length; r++) {
      if (this.grid[r] && this.grid[r].some(v => v !== '' && v !== null && v !== undefined)) {
        last = r + 1;
      }
    }
    return last;
  }
  getLastColumn() {
    let maxC = 0;
    for (let r = 0; r < this.grid.length; r++) {
      if (!this.grid[r]) continue;
      for (let c = 0; c < this.grid[r].length; c++) {
        const v = this.grid[r][c];
        if (v !== '' && v !== null && v !== undefined && (c + 1) > maxC) {
          maxC = c + 1;
        }
      }
    }
    return maxC;
  }
  clear() {
    this.clearCallCount++;
    this.ss.clearCallCount++;
    this.mutationCount++;
    this.ss.mutationCount++;
    this.grid = [];
    this.formatting = {};
    return this;
  }
  setFrozenRows(n) {
    this.formatting.frozenRows = n;
    return this;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    if (typeof row === 'string') {
      return {
        setBackground() { return this; },
        setFontColor() { return this; },
        setFontWeight() { return this; }
      };
    }
    return {
      getValues() {
        const res = [];
        for (let r = 0; r < numRows; r++) {
          const rIdx = row - 1 + r;
          const rowArr = [];
          for (let c = 0; c < numCols; c++) {
            const cIdx = col - 1 + c;
            const val = (sheet.grid[rIdx] && sheet.grid[rIdx][cIdx] !== undefined) ? sheet.grid[rIdx][cIdx] : '';
            rowArr.push(val);
          }
          res.push(rowArr);
        }
        return res;
      },
      setValues(vals) {
        sheet.mutationCount++;
        sheet.ss.mutationCount++;
        for (let r = 0; r < vals.length; r++) {
          const rIdx = row - 1 + r;
          while (sheet.grid.length <= rIdx) sheet.grid.push([]);
          for (let c = 0; c < vals[r].length; c++) {
            const cIdx = col - 1 + c;
            while (sheet.grid[rIdx].length <= cIdx) sheet.grid[rIdx].push('');
            sheet.grid[rIdx][cIdx] = vals[r][c];
          }
        }
        return this;
      },
      clearContent() {
        sheet.mutationCount++;
        sheet.ss.mutationCount++;
        sheet.clearContentCallCount++;
        for (let r = 0; r < numRows; r++) {
          const rIdx = row - 1 + r;
          if (!sheet.grid[rIdx]) continue;
          for (let c = 0; c < numCols; c++) {
            const cIdx = col - 1 + c;
            if (cIdx < sheet.grid[rIdx].length) {
              sheet.grid[rIdx][cIdx] = '';
            }
          }
        }
        return this;
      },
      clear() {
        sheet.clearCallCount++;
        sheet.ss.clearCallCount++;
        return this;
      },
      setBackground() { return this; },
      setFontColor() { return this; },
      setFontWeight() { return this; }
    };
  }
}

class SanitizationMockSpreadsheet {
  constructor(name = 'TARGET_DIST') {
    this.name = name;
    this.sheets = [];
    this.mutationCount = 0;
    this.deleteSheetCallCount = 0;
    this.clearCallCount = 0;
    this.renameSheetCallCount = 0;
  }
  getName() { return this.name; }
  getSheets() { return [...this.sheets]; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  addSheet(name, grid = [], metadata = {}) {
    const s = new SanitizationMockSheet(this, name, grid, metadata);
    this.sheets.push(s);
    return s;
  }
  insertSheet(name) {
    this.mutationCount++;
    return this.addSheet(name, []);
  }
  deleteSheet(sheet) {
    this.deleteSheetCallCount++;
    this.mutationCount++;
    this.sheets = this.sheets.filter(s => s !== sheet);
  }
}

function createProvisionerVm(ss) {
  const logs = [];
  const sandbox = {
    console: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' '))
    },
    Math, Date, String, Number, Array, Object, Error, RegExp, JSON,
    SpreadsheetApp: {
      openById: () => ss,
      getActiveSpreadsheet: () => ss,
      flush: () => {}
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        releaseLock: () => {},
        tryLock: () => true
      })
    },
    ScriptApp: {
      newTrigger: () => ({
        timeBased: function() { return this; },
        everyDays: function() { return this; },
        atHour: function() { return this; },
        create: function() { return {}; }
      })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        if (fmt === 'yyyy-MM') return '2026-04';
        return '2026-04-01 10:00:00';
      }
    },
    verifyProvisioningToken: (token) => token === 'valid-token'
      ? { success: true }
      : { success: false, code: 'UNAUTHORIZED', message: 'Invalid token' },
    cleanupPinStatusForDistrict: () => ({ success: true, count: 0 }),
    deleteTriggers: () => {},
    getSS: () => ss
  };
  const ctx = vm.createContext(sandbox);
  const provCode = fs.readFileSync(path.join(REPO_ROOT, 'active/business/system/district_provisioner.js'), 'utf8');
  vm.runInContext(provCode, ctx);
  return { ctx, logs };
}

function countRow2PlusNonEmpty(sheet) {
  let count = 0;
  for (let r = 1; r < sheet.grid.length; r++) {
    const row = sheet.grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] !== null && row[c] !== undefined) {
        count++;
      }
    }
  }
  return count;
}

runTest('D9: createOperationalDataset 5/5 No-op is strictly preserved (0 mutations when called directly)', () => {
  const ss = new SanitizationMockSpreadsheet('TARGET_DIST');
  const distHeaders = ['ID', '市町村', '町域', '配布完了日時', '配布枚数', '担当者ID', '担当者名', 'GPS', '写真', '緯度', '経度', 'GPS日時', '写真ファイルID', '写真URL', '写真日時', 'lineUserId', 'requestId'];
  ss.addSheet('配布実績2026-04', [distHeaders, [1, 'OLD_CITY', 'OLD_TOWN', '2026/04/01', 100, 'ST01', 'Old Staff', '', '', '', '', '', '', '', '', 'U_OLD', 'req_1']]);
  ss.addSheet('名簿2026-04', [['ID', '名前', 'LINE_USER_ID', '登録日時'], ['ST01', 'Old Staff', 'U_OLD', '2026/04/01']]);
  ss.addSheet('保有チラシ枚数2026-04', [['ID', '担当者ID', '担当者名', '保管場所', '保有枚数', '最終更新日時', 'lineUserId'], [1, 'ST01', 'Old Staff', 'Old Place', 500, '2026/04/01', 'U_OLD']]);
  ss.addSheet('受渡要請履歴2026-04', [['日時', '要請者', '要請者ID', '保管者', '保管者ID', '連絡方法', '連絡先', '状態', 'requestId', 'LINE送信状態', 'LINE HTTP status', 'LINE送信日時', 'requesterLineUserId', 'holderLineUserId']]);
  ss.addSheet('PinStatus2026-04', [['rowId', 'status'], [1, 'done']]);

  const { ctx } = createProvisionerVm(ss);
  const res = ctx.DistrictProvisioner.getInstance().createOperationalDataset(ss, '2026-04', [
    { rowId: 1, cityName: 'NEW_CITY', townName: 'NEW_TOWN_1' }
  ]);

  assert.equal(res.success, true);
  assert.equal(res.noop, true);
  assert.equal(ss.mutationCount, 0, 'createOperationalDataset 5/5 must remain 100% No-op');
  assert.equal(ss.getSheetByName('名簿2026-04').grid[1][1], 'Old Staff', 'Existing data untouched by direct createOperationalDataset');
});

runTest('D10: provisionNewDistrict Completed-Copy Sanitization & Master Sync (Requirements A-J, M)', () => {
  const ss = new SanitizationMockSpreadsheet('TARGET_DIST');
  const secretApiKey = 'AIzaSy_DUMMY_SECRET_DO_NOT_EXPOSE_999';
  const sysGrid = [
    ['項目', '内容'],
    ['地区コード', 'TARGET_DIST'],
    ['地区名', 'ターゲット支部'],
    ['HアプリURL', 'https://target.example.invalid/'],
    ['Dashboard URL', 'https://target.example.invalid/active/manager/'],
    ['LIFFアプリ名', 'POSTING MAP TARGET'],
    ['LIFF ID', '123456-target'],
    ['LIFF URL', 'https://liff.line.me/123456-target'],
    ['Endpoint URL', 'https://target.example.invalid/'],
    ['Manager認証パスワード', '123456'],
    ['状態', 'ACTIVE'],
    ['契約終了日', '2026-12-31'],
    ['運用モード', 'ELECTION'],
    ['Active Dataset Key', '2026-02'],
    ['契約開始日時', '2026-02-01 00:00:00'],
    ['GOOGLE_MAPS_API_KEY', secretApiKey]
  ];
  const sysSheet = ss.addSheet('SYSTEM_INFO', sysGrid);

  const distHeaders = ['ID', '市町村', '町域', '配布完了日時', '配布枚数', '担当者ID', '担当者名', 'GPS', '写真', '緯度', '経度', 'GPS日時', '写真ファイルID', '写真URL', '写真日時', 'lineUserId', 'requestId'];
  // コピー元は 4行のデータ (新地区は 2行 -> 3,4行目は余剰旧行)
  const distSheet = ss.addSheet('配布実績2026-02', [
    distHeaders,
    [1, 'COPY_SRC_CITY', 'COPY_TOWN_1', '2026/02/10 10:00', 200, 'ST01', 'Copy Staff 1', 'done', 'ok', 35.0, 136.0, '2026/02/10', 'fid1', 'url1', '2026/02/10', 'U_COPY_1', 'req_1'],
    [2, 'COPY_SRC_CITY', 'COPY_TOWN_2', '2026/02/11 11:00', 150, 'ST02', 'Copy Staff 2', 'done', 'ok', 35.1, 136.1, '2026/02/11', 'fid2', 'url2', '2026/02/11', 'U_COPY_2', 'req_2'],
    [3, 'COPY_SRC_CITY', 'COPY_TOWN_3', '2026/02/12 12:00', 300, 'ST01', 'Copy Staff 1', '', '', '', '', '', '', '', '', 'U_COPY_1', 'req_3'],
    [4, 'COPY_SRC_CITY', 'COPY_TOWN_4', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
  ]);

  // その他すべての既存シート (非Active過月 配布実績* 及び未知シートを含む)
  ss.addSheet('名簿2026-02', [
    ['ID', '名前', 'LINE_USER_ID', '登録日時'],
    ['ST01', 'Copy Staff 1', 'U_COPY_1', '2026/02/01'],
    ['ST02', 'Copy Staff 2', 'U_COPY_2', '2026/02/02']
  ]);
  ss.addSheet('保有チラシ枚数2026-02', [
    ['ID', '担当者ID', '担当者名', '保管場所', '保有枚数', '最終更新日時', 'lineUserId'],
    [1, 'ST01', 'Copy Staff 1', 'Copy Storage', 1200, '2026/02/05', 'U_COPY_1']
  ]);
  ss.addSheet('受渡要請履歴2026-02', [
    ['日時', '要請者', '要請者ID', '保管者', '保管者ID', '連絡方法', '連絡先', '状態', 'requestId', 'LINE送信状態', 'LINE HTTP status', 'LINE送信日時', 'requesterLineUserId', 'holderLineUserId'],
    ['2026/02/06', 'Copy Staff 2', 'ST02', 'Copy Staff 1', 'ST01', 'LINE', '090-0000', '完了', 'tr_1', 'SENT', 200, '2026/02/06', 'U_COPY_2', 'U_COPY_1']
  ]);
  ss.addSheet('PinStatus2026-02', [
    ['rowId', 'status'],
    [1, 'completed'],
    [2, 'in_progress']
  ]);
  ss.addSheet('掲示板', [
    ['投稿日時', '投稿者ID', '投稿者名', '内容', 'lineUserId'],
    ['2026/02/07', 'ST01', 'Copy Staff 1', 'Copy source message', 'U_COPY_1']
  ]);
  ss.addSheet('掲示板連絡履歴', [
    ['日時', '送信者', '内容'],
    ['2026/02/08', 'Admin', 'Copy notice']
  ]);
  ss.addSheet('端末管理', [
    ['端末ID', 'スタッフID', '状態'],
    ['DEV_COPY_1', 'ST01', 'ACTIVE']
  ]);
  ss.addSheet('配布実績2026-01', [
    distHeaders,
    [1, 'COPY_SRC_CITY', 'PAST_MONTH_TOWN', '2026/01/15', 100, 'ST01', 'Copy Staff 1', '', '', '', '', '', '', '', '', 'U_COPY_1', 'req_old']
  ]);
  ss.addSheet('任意拡張シート', [
    ['CustomCol1', 'CustomCol2'],
    ['CopyVal1', 'CopyVal2']
  ]);

  const sheetCountBefore = ss.getSheets().length;
  const sheetNamesBefore = ss.getSheets().map(s => s.getName());
  const headersBefore = Object.fromEntries(ss.getSheets().map(s => [s.getName(), [...s.grid[0]]]));
  const sysGridBefore = JSON.stringify(sysSheet.grid);
  const formattingBefore = Object.fromEntries(ss.getSheets().map(s => [s.getName(), JSON.stringify(s.formatting)]));

  const newDistrictAddresses = [
    { rowId: 1, city_name: '新地区市A', town_name: '新町1丁目' },
    { rowId: 2, city_name: '新地区市B', town_name: '新町2丁目' }
  ];

  const { ctx, logs } = createProvisionerVm(ss);
  const res = ctx.DistrictProvisioner.getInstance().provisionNewDistrict(
    newDistrictAddresses,
    {
      provisioningToken: 'valid-token',
      operationMode: 'ELECTION',
      skipSystemInfo: true
    },
    'TARGET_DIST'
  );

  assert.equal(res.success, true);
  assert.equal(res.activeDatasetKey, '2026-02');

  // A. SYSTEM_INFO Before == After (mutation = 0)
  assert.equal(sysSheet.mutationCount, 0, 'SYSTEM_INFO must have 0 mutations');
  assert.equal(JSON.stringify(sysSheet.grid), sysGridBefore, 'SYSTEM_INFO grid must be 100% identical Before == After');

  // B & J. 配布実績<Active Dataset Key> A:C == 新地区 address_master (N = 2 rows)
  assert.equal(distSheet.getLastRow(), 3, '配布実績2026-02 lastRow must equal N + 1 (3)');
  assert.deepEqual(distSheet.grid[1].slice(0, 3), [1, '新地区市A', '新町1丁目']);
  assert.deepEqual(distSheet.grid[2].slice(0, 3), [2, '新地区市B', '新町2丁目']);

  // C & I. 配布実績<Active Dataset Key> D:Q non-empty == 0 & N超過余剰行 non-empty == 0
  for (let r = 1; r < distSheet.grid.length; r++) {
    const row = distSheet.grid[r] || [];
    for (let c = 3; c < row.length; c++) {
      assert.equal(row[c], '', `配布実績2026-02 row ${r + 1} col ${c + 1} must be empty`);
    }
    if (r >= 3) {
      for (let c = 0; c < row.length; c++) {
        assert.equal(row[c], '', `Surplus row ${r + 1} col ${c + 1} must be empty`);
      }
    }
  }

  // D. その他全sheet (非Active過月 配布実績2026-01 含む) Row 2+ non-empty == 0
  for (const sheet of ss.getSheets()) {
    const sName = sheet.getName();
    if (sName === 'SYSTEM_INFO' || sName === '配布実績2026-02') continue;
    assert.equal(countRow2PlusNonEmpty(sheet), 0, `Sheet "${sName}" must have 0 non-empty cells in Row 2+`);
    assert.equal(sheet.getLastRow(), 1, `Sheet "${sName}" lastRow must be 1 (header only)`);
  }

  // E, F, G, H. Sheet count, names, headers, formatting metadata Before == After
  assert.equal(ss.getSheets().length, sheetCountBefore, 'Sheet count must be unchanged');
  assert.deepEqual(ss.getSheets().map(s => s.getName()), sheetNamesBefore, 'Sheet names and order must be unchanged');
  assert.equal(ss.deleteSheetCallCount, 0, 'deleteSheet() must never be called');
  assert.equal(ss.clearCallCount, 0, 'clear() must never be called');
  assert.equal(ss.renameSheetCallCount, 0, 'Sheet rename must never be called');
  for (const sheet of ss.getSheets()) {
    assert.deepEqual(sheet.grid[0], headersBefore[sheet.getName()], `Header row of "${sheet.getName()}" must be unchanged`);
    assert.equal(JSON.stringify(sheet.formatting), formattingBefore[sheet.getName()], `Formatting metadata of "${sheet.getName()}" must be unchanged`);
  }

  // M. SYSTEM_INFO raw secret exposure == 0
  const serializedResult = JSON.stringify(res);
  const joinedLogs = logs.join('\n');
  assert.equal(serializedResult.includes(secretApiKey), false, 'Return value must not expose raw GOOGLE_MAPS_API_KEY');
  assert.equal(joinedLogs.includes(secretApiKey), false, 'Logs must not expose raw GOOGLE_MAPS_API_KEY');
});

runTest('D11: provisionNewDistrict handles N > oldLastRow expansion cleanly', () => {
  const ss = new SanitizationMockSpreadsheet('TARGET_DIST');
  ss.addSheet('SYSTEM_INFO', [
    ['項目', '内容'],
    ['地区コード', 'TARGET_DIST'],
    ['運用モード', 'ELECTION'],
    ['Active Dataset Key', '2026-04']
  ]);
  const distHeaders = ['ID', '市町村', '町域', '配布完了日時', '配布枚数', '担当者ID', '担当者名', 'GPS', '写真', '緯度', '経度', 'GPS日時', '写真ファイルID', '写真URL', '写真日時', 'lineUserId', 'requestId'];
  ss.addSheet('配布実績2026-04', [
    distHeaders,
    [1, 'OLD_CITY', 'OLD_1', '2026/04/01', 50, 'ST01', 'Old', '', '', '', '', '', '', '', '', 'U1', 'r1']
  ]);
  ss.addSheet('名簿2026-04', [['ID', '名前', 'LINE_USER_ID', '登録日時'], ['ST01', 'Old', 'U1', '2026/04/01']]);
  ss.addSheet('保有チラシ枚数2026-04', [['ID', '担当者ID', '担当者名', '保管場所', '保有枚数', '最終更新日時', 'lineUserId']]);
  ss.addSheet('受渡要請履歴2026-04', [['日時', '要請者', '要請者ID', '保管者', '保管者ID', '連絡方法', '連絡先', '状態', 'requestId', 'LINE送信状態', 'LINE HTTP status', 'LINE送信日時', 'requesterLineUserId', 'holderLineUserId']]);
  ss.addSheet('PinStatus2026-04', [['rowId', 'status']]);

  const { ctx } = createProvisionerVm(ss);
  const newAddrs = [
    { rowId: 1, city_name: 'NEW_CITY', town_name: 'T1' },
    { rowId: 2, city_name: 'NEW_CITY', town_name: 'T2' },
    { rowId: 3, city_name: 'NEW_CITY', town_name: 'T3' }
  ];
  const res = ctx.DistrictProvisioner.getInstance().provisionNewDistrict(
    newAddrs,
    { provisioningToken: 'valid-token', operationMode: 'ELECTION', skipSystemInfo: true },
    'TARGET_DIST'
  );
  assert.equal(res.success, true);
  const distSheet = ss.getSheetByName('配布実績2026-04');
  assert.equal(distSheet.getLastRow(), 4, 'Must have header + 3 new rows');
  assert.deepEqual(distSheet.grid[3].slice(0, 3), [3, 'NEW_CITY', 'T3']);
  assert.equal(countRow2PlusNonEmpty(ss.getSheetByName('名簿2026-04')), 0);
});

runTest('D12: Fail-Closed Guards (Cross-district mismatch & missing header contract -> mutation 0)', () => {
  // 1. Cross-district mismatch (Requirement L)
  const ssMismatch = new SanitizationMockSpreadsheet('OTHER_DIST');
  ssMismatch.addSheet('SYSTEM_INFO', [
    ['項目', '内容'],
    ['地区コード', 'OTHER_DIST'],
    ['運用モード', 'ELECTION'],
    ['Active Dataset Key', '2026-04']
  ]);
  ssMismatch.addSheet('名簿2026-04', [['ID', '名前', 'LINE_USER_ID', '登録日時'], ['ST01', 'Keep Me', 'U1', '2026/04/01']]);

  const { ctx: ctx1 } = createProvisionerVm(ssMismatch);
  assert.throws(() => {
    ctx1.DistrictProvisioner.getInstance().provisionNewDistrict(
      [{ rowId: 1, city_name: 'C', town_name: 'T' }],
      { provisioningToken: 'valid-token', operationMode: 'ELECTION', skipSystemInfo: true },
      'TARGET_DIST'
    );
  }, /DISTRICT_MISMATCH/);
  assert.equal(ssMismatch.mutationCount, 0, 'Cross-district Spreadsheet mutation must be 0');
  assert.equal(ssMismatch.getSheetByName('名簿2026-04').grid[1][1], 'Keep Me');

  // 2. Missing Row 1 Header on sheet with Row 2+ data (Requirement K)
  const ssBadHeader = new SanitizationMockSpreadsheet('TARGET_DIST');
  ssBadHeader.addSheet('SYSTEM_INFO', [
    ['項目', '内容'],
    ['地区コード', 'TARGET_DIST'],
    ['運用モード', 'ELECTION'],
    ['Active Dataset Key', '2026-04']
  ]);
  ssBadHeader.addSheet('破損シート', [
    ['', ''],
    ['DataWithoutHeader1', 'DataWithoutHeader2']
  ]);
  const { ctx: ctx2 } = createProvisionerVm(ssBadHeader);
  assert.throws(() => {
    ctx2.DistrictProvisioner.getInstance().provisionNewDistrict(
      [{ rowId: 1, city_name: 'C', town_name: 'T' }],
      { provisioningToken: 'valid-token', operationMode: 'ELECTION', skipSystemInfo: true },
      'TARGET_DIST'
    );
  }, /INVALID_SHEET_HEADER_CONTRACT/);
  assert.equal(ssBadHeader.mutationCount, 0, 'Invalid header contract must abort with 0 mutations');
});

console.log('====================================================');
console.log(`📊 DISTRICT APP DEPLOYMENT SKILL TESTS: ${passedCount} / ${totalCount} PASSED (100%)`);
console.log('====================================================\n');

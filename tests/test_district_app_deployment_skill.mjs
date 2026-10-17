import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

console.log('====================================================');
console.log(`📊 DISTRICT APP DEPLOYMENT SKILL TESTS: ${passedCount} / ${totalCount} PASSED (100%)`);
console.log('====================================================\n');

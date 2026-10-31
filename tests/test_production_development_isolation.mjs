import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILENAME,
  captureSourceConnectionFingerprint,
  evaluateConfigJsCode,
  evaluateConfigJsFile,
  listBaselineTrackedFiles,
  runCommandSafe,
  runGateA,
  runGateB
} from '../scripts/check-development-isolation-gate.mjs';
import {
  cleanupProofWorkspace,
  sanitizeConfigJsContent,
  spawnIsolatedWorkspace
} from '../scripts/spawn-isolated-development-workspace.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function createSyntheticProductionRepo(baseTempDir) {
  const sourceDir = path.join(baseTempDir, 'synthetic-prod-source');
  fs.mkdirSync(sourceDir, { recursive: true });

  // Tracked directories
  fs.mkdirSync(path.join(sourceDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'active', 'h-app', 'modules'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'active', 'manager'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'docs', 'manuals'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, '.agents'), { recursive: true });

  // Tracked dotfiles & templates (TEST A, B, C)
  fs.writeFileSync(
    path.join(sourceDir, '.gitignore'),
    '.clasp.json\nactive/.clasp.json\ndeployment.json\n.env\n.env.local\n.env.production\n.secrets/\n',
    'utf8'
  );
  fs.writeFileSync(path.join(sourceDir, '.claspignore'), '**/**\n!active/**\n', 'utf8');
  fs.writeFileSync(
    path.join(sourceDir, '.clasp.json.template'),
    '{"scriptId":"__SCRIPT_ID__","rootDir":"."}\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'deployment.template.json'),
    '{"resources":{"webAppUrl":"","productionLiffUrl":""}}\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, '.github', 'workflows', 'ci.yml'),
    'name: CI\non: [push]\n',
    'utf8'
  );
  fs.writeFileSync(path.join(sourceDir, '.nojekyll'), '', 'utf8');
  fs.writeFileSync(path.join(sourceDir, '.env.example'), 'EXAMPLE_TOKEN=placeholder\n', 'utf8');
  fs.writeFileSync(path.join(sourceDir, '.agents', 'placeholder.json'), '{"ok":true}\n', 'utf8');

  // Tracked production config (Canonical window.PMS_CLIENT_CONFIG nested schema) & CNAME
  fs.writeFileSync(
    path.join(sourceDir, 'data', 'config.js'),
    [
      'window.PMS_CLIENT_CONFIG = {',
      '  version: "2.0.0",',
      '  districtId: "SYNTH-DISTRICT-01",',
      '  status: "ACTIVE",',
      '  environment: "production",',
      '  api: {',
      '    gasWebAppUrl: "https://script.google.com/macros/s/AKfycb_SYNTH_PROD_DEP_ID_999/exec"',
      '  },',
      '  staticMaster: {',
      '    addressCsvFilename: "address_master.csv",',
      '    boundariesGeojsonFilename: "boundaries.geojson",',
      '    electionHistoryFilename: "election_history.json"',
      '  },',
      '  line: {',
      '    liffId: "2009999999-SynthProdLiff"',
      '  },',
      '  features: {',
      '    photoUpload: true,',
      '    gpsTracking: true',
      '  }',
      '};',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(path.join(sourceDir, 'CNAME'), 'synth-prod.example.org\n', 'utf8');

  // Tracked 4 canonical master data artifacts
  fs.writeFileSync(
    path.join(sourceDir, 'data', 'address_master.csv'),
    'rowId,city_name,town_name,lat,lng,total_pop,households,target_copies\n01001,テスト市,一丁目,35.0,136.0,100,50,40\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'data', 'boundaries.geojson'),
    '{"type":"FeatureCollection","features":[]}\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'data', 'municipality_master.csv'),
    'city_code,city_name,pref_name\n99001,テスト市,テスト県\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'data', 'storage_locations.json'),
    '{"locations":["テスト市"]}\n',
    'utf8'
  );

  // Tracked runtime files with Canonical window.PMS_CLIENT_CONFIG Fail-Closed guards
  fs.writeFileSync(
    path.join(sourceDir, 'active', 'h-app', 'app.js'),
    'export function bootApp() { if (!window.PMS_CLIENT_CONFIG || !window.PMS_CLIENT_CONFIG.line || !window.PMS_CLIENT_CONFIG.line.liffId) { throw new Error("LIFF missing"); } }\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'active', 'h-app', 'modules', 'api.js'),
    [
      'function getApiUrl() {',
      "  if (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.api && window.PMS_CLIENT_CONFIG.api.gasWebAppUrl) {",
      '    return window.PMS_CLIENT_CONFIG.api.gasWebAppUrl;',
      '  }',
      "  throw new Error('[H-App Config Error] PMS_CLIENT_CONFIG.api.gasWebAppUrl が未設定です。config.js を確認してください。');",
      '}',
      'const API_URL = getApiUrl();',
      'export const apiReady = Boolean(API_URL);',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'active', 'manager', 'manager.js'),
    [
      'function getApiUrl() {',
      "  if (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.api && window.PMS_CLIENT_CONFIG.api.gasWebAppUrl) {",
      '    return window.PMS_CLIENT_CONFIG.api.gasWebAppUrl;',
      '  }',
      "  throw new Error('[Dashboard Config Error] PMS_CLIENT_CONFIG.api.gasWebAppUrl が未設定です。config.js を確認してください。');",
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'index.html'),
    [
      '<!DOCTYPE html><html><head>',
      '<script src="./data/config.js"></script>',
      '<script>',
      '  const liffId = (window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.line && window.PMS_CLIENT_CONFIG.line.liffId) || null;',
      '  if (!liffId) { console.error("LIFF ID not configured in config.js"); }',
      '</script>',
      '</head><body></body></html>',
      ''
    ].join('\n'),
    'utf8'
  );

  // Copy real validate-gas-endpoint-ssot.mjs into synthetic repo
  const realSsotValidator = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'validate-gas-endpoint-ssot.mjs'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'scripts', 'validate-gas-endpoint-ssot.mjs'),
    realSsotValidator,
    'utf8'
  );

  // Tracked TEST_FIXTURE and DOCUMENTATION containing production-derived strings (TEST 1 & TEST 2)
  fs.writeFileSync(
    path.join(sourceDir, 'tests', 'fixture_sample.mjs'),
    "// Synthetic test fixture referencing '2009999999-SynthProdLiff' and 'SYNTH_PROD_SCRIPT_ID_777'\nexport const MOCK_LIFF = '2009999999-SynthProdLiff';\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'docs', 'architecture_example.md'),
    '# Architecture Example\nSample domain: `synth-prod.example.org` and endpoint `https://script.google.com/macros/s/AKfycb_SYNTH_PROD_DEP_ID_999/exec`.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'docs', 'manuals', 'Sample Operational Guide.md'),
    '# Sample Operational Guide\nASCII filename with spaces.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'docs', 'manuals', 'サンプル ご利用ガイド.md'),
    '# サンプル ご利用ガイド\n日本語・濁点・空白を含むドキュメント。\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'docs', 'manuals', '手引き データ確認表.pdf'),
    '%PDF-1.4 synthetic pdf content\n',
    'utf8'
  );

  // Initialize git repo and commit baseline
  runCommandSafe('git', ['init', '-b', 'main'], { cwd: sourceDir });
  runCommandSafe('git', ['remote', 'add', 'origin', 'https://example.org/synth-prod-origin.git'], { cwd: sourceDir });
  runCommandSafe('git', ['add', '-A'], { cwd: sourceDir });
  runCommandSafe(
    'git',
    [
      '-c', 'user.name=Synth Setup',
      '-c', 'user.email=synth@example.org',
      'commit',
      '-m', 'Initial synthetic production baseline'
    ],
    { cwd: sourceDir }
  );

  // Create gitignored local production binding files (.clasp.json, active/.clasp.json, deployment.json)
  fs.writeFileSync(
    path.join(sourceDir, '.clasp.json'),
    '{"scriptId":"SYNTH_PROD_SCRIPT_ID_777","rootDir":"."}\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'active', '.clasp.json'),
    '{"scriptId":"SYNTH_PROD_SCRIPT_ID_777","rootDir":"active"}\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(sourceDir, 'deployment.json'),
    JSON.stringify({
      scriptId: 'SYNTH_PROD_SCRIPT_ID_777',
      deploymentId: 'AKfycb_SYNTH_PROD_DEP_ID_999',
      spreadsheetId: 'SYNTH_PROD_SHEET_ID_888',
      webAppUrl: 'https://script.google.com/macros/s/AKfycb_SYNTH_PROD_DEP_ID_999/exec'
    }, null, 2),
    'utf8'
  );

  return sourceDir;
}

console.log('🧪 Running Production Development Isolation Suite (21 Core Cases + 9 Regression Cases = 30 Cases)...');

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posting-map-iso-test-'));

try {
  const sourceDir = createSyntheticProductionRepo(rootTmp);

  // T-01: Multi-Path Portability & Happy Path
  {
    const targetAlpha = path.join(rootTmp, 'alpha-dev');
    const targetBeta = path.join(rootTmp, 'deep', 'nested', 'beta-workspace-proof');

    const resAlpha = spawnIsolatedWorkspace({
      sourceRoot: sourceDir,
      targetRoot: targetAlpha,
      mode: 'final',
      runId: 'run-alpha-12345678'
    });
    assert.equal(resAlpha.pass, true, 'T-01 alpha spawn must pass');

    const resBeta = spawnIsolatedWorkspace({
      sourceRoot: sourceDir,
      targetRoot: targetBeta,
      mode: 'proof',
      runId: 'run-beta-12345678'
    });
    assert.equal(resBeta.pass, true, 'T-01 beta spawn must pass');
    console.log('  ✅ T-01: Multi-path portability & Happy Path passed.');
  }

  // T-02: Non-Empty Target Rejection
  {
    const nonEmptyTarget = path.join(rootTmp, 'non-empty-target');
    fs.mkdirSync(nonEmptyTarget, { recursive: true });
    const sentinelFile = path.join(nonEmptyTarget, 'existing.txt');
    fs.writeFileSync(sentinelFile, 'keep-me', 'utf8');

    assert.throws(
      () => spawnIsolatedWorkspace({
        sourceRoot: sourceDir,
        targetRoot: nonEmptyTarget,
        mode: 'final'
      }),
      /Target directory is not empty/
    );
    assert.equal(fs.readFileSync(sentinelFile, 'utf8'), 'keep-me', 'Existing file must not be touched');
    console.log('  ✅ T-02: Non-empty target rejection passed.');
  }

  // T-03: Dirty Source Rejection
  {
    const dirtyFile = path.join(sourceDir, 'untracked_dirty.txt');
    fs.writeFileSync(dirtyFile, 'dirty', 'utf8');
    try {
      const dirtyTarget = path.join(rootTmp, 'should-not-spawn');
      assert.throws(
        () => spawnIsolatedWorkspace({
          sourceRoot: sourceDir,
          targetRoot: dirtyTarget,
          mode: 'final'
        }),
        /Source repository working tree is dirty/
      );
      assert.equal(fs.existsSync(dirtyTarget), false);
    } finally {
      fs.unlinkSync(dirtyFile);
    }
    console.log('  ✅ T-03: Dirty source rejection passed.');
  }

  // Prepare a clean spawned workspace for Gate A / Gate B inspection tests
  const inspectTarget = path.join(rootTmp, 'inspect-workspace');
  const inspectSpawn = spawnIsolatedWorkspace({
    sourceRoot: sourceDir,
    targetRoot: inspectTarget,
    mode: 'final',
    runId: 'run-inspect-12345678'
  });

  // T-04 (TEST A): Baseline tracked .github/workflows/** preserved -> PASS
  {
    assert.equal(
      fs.existsSync(path.join(inspectTarget, '.github', 'workflows', 'ci.yml')),
      true,
      'Tracked .github/workflows/ci.yml must be preserved'
    );
    assert.equal(inspectSpawn.gateA.checks.A03.pass, true);
    console.log('  ✅ T-04 (TEST A): Tracked .github/workflows/** preservation passed.');
  }

  // T-05 (TEST B): Baseline tracked .nojekyll preserved -> PASS
  {
    assert.equal(
      fs.existsSync(path.join(inspectTarget, '.nojekyll')),
      true,
      'Tracked .nojekyll must be preserved'
    );
    console.log('  ✅ T-05 (TEST B): Tracked .nojekyll preservation passed.');
  }

  // T-06 (TEST C): Baseline tracked .env.example preserved -> PASS
  {
    assert.equal(
      fs.existsSync(path.join(inspectTarget, '.env.example')),
      true,
      'Tracked .env.example must be preserved'
    );
    console.log('  ✅ T-06 (TEST C): Tracked .env.example preservation passed.');
  }

  // T-07 (TEST D): Injecting .env.local into Target -> Gate A FAIL
  {
    const envLocalPath = path.join(inspectTarget, '.env.local');
    fs.writeFileSync(envLocalPath, 'SECRET=123\n', 'utf8');
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A02.pass, false, 'A-02 must fail on .env.local');
      assert.equal(gateA.checks.A03.pass, false, 'A-03 must fail on extra file .env.local');
    } finally {
      fs.unlinkSync(envLocalPath);
    }
    console.log('  ✅ T-07 (TEST D): .env.local injection rejection passed.');
  }

  // T-08 (TEST E): Injecting arbitrary untracked dotfile into Target -> Gate A FAIL
  {
    const rogueDotfile = path.join(inspectTarget, '.rogue-untracked');
    fs.writeFileSync(rogueDotfile, 'rogue\n', 'utf8');
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A03.pass, false, 'A-03 must fail on arbitrary untracked dotfile');
      assert.equal(gateA.checks.A03.extraFiles.includes('.rogue-untracked'), true);
    } finally {
      fs.unlinkSync(rogueDotfile);
    }
    console.log('  ✅ T-08 (TEST E): Untracked dotfile injection rejection passed.');
  }

  // T-09 (TEST F): Deleting 1 Baseline tracked file from Target -> Gate A FAIL
  {
    const nojekyllPath = path.join(inspectTarget, '.nojekyll');
    const backup = fs.readFileSync(nojekyllPath);
    fs.unlinkSync(nojekyllPath);
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A03.pass, false, 'A-03 must fail when a tracked file is deleted');
      assert.equal(gateA.checks.A03.missingTracked.includes('.nojekyll'), true);
    } finally {
      fs.writeFileSync(nojekyllPath, backup);
    }
    console.log('  ✅ T-09 (TEST F): Missing baseline tracked file rejection passed.');
  }

  // T-10 (TEST 1): Production LIFF ID in tests/** classified as TEST_FIXTURE -> Gate A PASS
  {
    const a07 = inspectSpawn.gateA.checks.A07;
    assert.equal(a07.pass, true);
    assert.equal(a07.counts.RUNTIME_BINDING, 0);
    assert.equal(a07.counts.DEPLOYMENT_BINDING, 0);
    assert.equal(a07.counts.LOCAL_BINDING, 0);
    assert.equal(a07.counts.TEST_FIXTURE >= 1, true, 'Fixture in tests/** must be classified as TEST_FIXTURE');
    console.log('  ✅ T-10 (TEST 1): Production LIFF ID in tests/** allowed as TEST_FIXTURE.');
  }

  // T-11 (TEST 2): Production Domain in docs/** classified as DOCUMENTATION -> Gate A PASS
  {
    const a07 = inspectSpawn.gateA.checks.A07;
    assert.equal(a07.pass, true);
    assert.equal(a07.counts.DOCUMENTATION >= 1, true, 'Example in docs/** must be classified as DOCUMENTATION');
    console.log('  ✅ T-11 (TEST 2): Production Domain in docs/** allowed as DOCUMENTATION.');
  }

  // T-12 (TEST 3): Production LIFF ID in data/config.js -> Gate A FAIL
  {
    const cfgPath = path.join(inspectTarget, 'data', 'config.js');
    const cleanCfg = fs.readFileSync(cfgPath, 'utf8');
    fs.writeFileSync(
      cfgPath,
      cleanCfg.replace('liffId: ""', 'liffId: "2009999999-SynthProdLiff"'),
      'utf8'
    );
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A06.pass, false, 'A-06 must fail when liffId is non-empty');
      assert.equal(gateA.checks.A07.pass, false, 'A-07 must fail with RUNTIME_BINDING > 0');
      assert.equal(gateA.checks.A07.counts.RUNTIME_BINDING > 0, true);
    } finally {
      fs.writeFileSync(cfgPath, cleanCfg, 'utf8');
    }
    console.log('  ✅ T-12 (TEST 3): Production LIFF ID in data/config.js rejected (RUNTIME_BINDING).');
  }

  // T-13 (TEST 4): Production Domain in CNAME -> Gate A FAIL
  {
    const cnamePath = path.join(inspectTarget, 'CNAME');
    fs.writeFileSync(cnamePath, 'synth-prod.example.org\n', 'utf8');
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A06.pass, false, 'A-06 must fail when CNAME is non-empty');
      assert.equal(gateA.checks.A07.pass, false, 'A-07 must fail with RUNTIME_BINDING > 0');
      assert.equal(gateA.checks.A07.counts.RUNTIME_BINDING > 0, true);
    } finally {
      fs.writeFileSync(cnamePath, '', 'utf8');
    }
    console.log('  ✅ T-13 (TEST 4): Production Domain in CNAME rejected (RUNTIME_BINDING).');
  }

  // T-14 (TEST 5): Production ID in .clasp.json / deployment.json -> Gate A FAIL
  {
    const claspPath = path.join(inspectTarget, '.clasp.json');
    const depPath = path.join(inspectTarget, 'deployment.json');
    fs.writeFileSync(claspPath, '{"scriptId":"SYNTH_PROD_SCRIPT_ID_777"}\n', 'utf8');
    fs.writeFileSync(depPath, '{"deploymentId":"AKfycb_SYNTH_PROD_DEP_ID_999"}\n', 'utf8');
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A02.pass, false, 'A-02 must fail on .clasp.json and deployment.json');
      assert.equal(gateA.checks.A07.pass, false, 'A-07 must fail with DEPLOYMENT_BINDING > 0');
      assert.equal(gateA.checks.A07.counts.DEPLOYMENT_BINDING >= 2, true);
    } finally {
      fs.unlinkSync(claspPath);
      fs.unlinkSync(depPath);
    }
    console.log('  ✅ T-14 (TEST 5): Production ID in .clasp.json / deployment.json rejected (DEPLOYMENT_BINDING).');
  }

  // T-15: Runtime-Linked Fixture Rejection (active/** importing tests/**) -> Gate A FAIL
  {
    const appPath = path.join(inspectTarget, 'active', 'h-app', 'app.js');
    const origApp = fs.readFileSync(appPath, 'utf8');
    fs.writeFileSync(
      appPath,
      `import { MOCK_LIFF } from '../../tests/fixture_sample.mjs';\n${origApp}`,
      'utf8'
    );
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A04.pass, false, 'A-04 must fail when active/** imports from tests/**');
      assert.equal(gateA.checks.A07.pass, false, 'A-07 must promote runtime-linked fixture to RUNTIME_BINDING');
      assert.equal(gateA.checks.A07.counts.RUNTIME_BINDING > 0, true);
    } finally {
      fs.writeFileSync(appPath, origApp, 'utf8');
    }
    console.log('  ✅ T-15: Runtime-linked fixture promoted to RUNTIME_BINDING and rejected.');
  }

  // T-16: Master Data Tampering Rejection -> Gate A FAIL
  {
    const masterPath = path.join(inspectTarget, 'data', 'address_master.csv');
    const origMaster = fs.readFileSync(masterPath, 'utf8');
    fs.writeFileSync(masterPath, `${origMaster}01002,改ざん市,二丁目,35.0,136.0,10,5,5\n`, 'utf8');
    try {
      const gateA = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateA.checks.A03.pass, false, 'A-03 must fail on master data modification');
      assert.equal(gateA.checks.A08.pass, false, 'A-08 must fail on master data SHA-256 mismatch');
    } finally {
      fs.writeFileSync(masterPath, origMaster, 'utf8');
    }
    console.log('  ✅ T-16: Master data tampering rejection passed.');
  }

  // T-17: Target Git Remote Injection -> Gate B FAIL
  {
    runCommandSafe('git', ['remote', 'add', 'origin', 'https://example.org/synth-prod-origin.git'], {
      cwd: inspectTarget
    });
    try {
      const gateB = runGateB({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateB.pass, false);
      assert.equal(gateB.checks.B02.pass, false, 'B-02 must fail when git remote exists in Target');
    } finally {
      runCommandSafe('git', ['remote', 'remove', 'origin'], { cwd: inspectTarget });
    }
    console.log('  ✅ T-17: Target git remote injection rejection passed.');
  }

  // T-18: Extra Commit in Target -> Gate B FAIL
  {
    const extraTarget = path.join(rootTmp, 'extra-commit-target');
    spawnIsolatedWorkspace({
      sourceRoot: sourceDir,
      targetRoot: extraTarget,
      mode: 'final'
    });
    runCommandSafe(
      'git',
      [
        '-c', 'user.name=Test',
        '-c', 'user.email=test@example.org',
        'commit',
        '--allow-empty',
        '-m', 'second commit'
      ],
      { cwd: extraTarget }
    );
    const gateB = runGateB({ sourceRoot: sourceDir, targetRoot: extraTarget });
    assert.equal(gateB.pass, false);
    assert.equal(gateB.checks.B03.pass, false, 'B-03 must fail when commit count !== 1');
    console.log('  ✅ T-18: Extra commit in Target rejection passed.');
  }

  // T-19: Source .git/config Mutation Detection -> Gate B FAIL (Rectification 2)
  {
    const beforeFp = captureSourceConnectionFingerprint(sourceDir);
    runCommandSafe('git', ['config', '--local', 'isolation.testMutation', 'mutated-value'], {
      cwd: sourceDir
    });
    try {
      const gateB = runGateB({
        sourceRoot: sourceDir,
        targetRoot: inspectTarget,
        expectedSourceFingerprint: beforeFp
      });
      assert.equal(gateB.pass, false);
      assert.equal(gateB.checks.B08.pass, false, 'B-08 must fail when Source .git/config changes');
      assert.equal(
        gateB.checks.B08.diffs.some(d => d.startsWith('gitConfigLocal:')),
        true
      );
    } finally {
      runCommandSafe('git', ['config', '--local', '--unset', 'isolation.testMutation'], {
        cwd: sourceDir
      });
    }
    console.log('  ✅ T-19: Source .git/config mutation detection passed.');
  }

  // T-20: Source .clasp.json & deployment.json Mutation Detection -> Gate B FAIL (Rectification 2)
  {
    const beforeFp = captureSourceConnectionFingerprint(sourceDir);
    const srcClaspPath = path.join(sourceDir, '.clasp.json');
    const origClasp = fs.readFileSync(srcClaspPath, 'utf8');
    fs.writeFileSync(srcClaspPath, '{"scriptId":"MUTATED_SCRIPT_ID"}\n', 'utf8');
    try {
      const gateBClasp = runGateB({
        sourceRoot: sourceDir,
        targetRoot: inspectTarget,
        expectedSourceFingerprint: beforeFp
      });
      assert.equal(gateBClasp.pass, false);
      assert.equal(gateBClasp.checks.B08.pass, false, 'B-08 must fail when Source .clasp.json changes');
      assert.equal(
        gateBClasp.checks.B08.diffs.some(d => d.startsWith('rootClaspJson:')),
        true
      );
    } finally {
      fs.writeFileSync(srcClaspPath, origClasp, 'utf8');
    }

    const srcDepPath = path.join(sourceDir, 'deployment.json');
    const origDep = fs.readFileSync(srcDepPath, 'utf8');
    fs.writeFileSync(srcDepPath, '{"deploymentId":"MUTATED_DEP_ID"}\n', 'utf8');
    try {
      const gateBDep = runGateB({
        sourceRoot: sourceDir,
        targetRoot: inspectTarget,
        expectedSourceFingerprint: beforeFp
      });
      assert.equal(gateBDep.pass, false);
      assert.equal(gateBDep.checks.B08.pass, false, 'B-08 must fail when Source deployment.json changes');
      assert.equal(
        gateBDep.checks.B08.diffs.some(d => d.startsWith('deploymentJson:')),
        true
      );
    } finally {
      fs.writeFileSync(srcDepPath, origDep, 'utf8');
    }
    console.log('  ✅ T-20: Source .clasp.json & deployment.json mutation detection passed.');
  }

  // T-21: Proof Cleanup 7-Condition Guard Verification (Rectification 2 & 3)
  {
    const proofDir = path.join(rootTmp, 'cleanup-test-proof');
    const finalDir = path.join(rootTmp, 'cleanup-test-final');
    const proofRunId = 'proof-run-id-99887766';

    const proofSpawn = spawnIsolatedWorkspace({
      sourceRoot: sourceDir,
      targetRoot: proofDir,
      mode: 'proof',
      runId: proofRunId
    });
    spawnIsolatedWorkspace({
      sourceRoot: sourceDir,
      targetRoot: finalDir,
      mode: 'final',
      runId: 'final-run-id-11223344'
    });

    const baselineSha = proofSpawn.sourceBaselineSha;

    // Violation of Condition 1: passing finalDir as --target
    assert.throws(
      () => cleanupProofWorkspace({
        sourceRoot: sourceDir,
        proofTarget: finalDir,
        finalTarget: finalDir,
        expectedRunId: 'final-run-id-11223344',
        expectedBaselineSha: baselineSha
      }),
      /Condition 1/
    );

    // Violation of Condition 2: wrong runId
    assert.throws(
      () => cleanupProofWorkspace({
        sourceRoot: sourceDir,
        proofTarget: proofDir,
        finalTarget: finalDir,
        expectedRunId: 'wrong-run-id-00000000',
        expectedBaselineSha: baselineSha
      }),
      /Condition 2/
    );

    // Violation of Condition 7: passing proofDir as --final-target
    assert.throws(
      () => cleanupProofWorkspace({
        sourceRoot: sourceDir,
        proofTarget: proofDir,
        finalTarget: proofDir,
        expectedRunId: proofRunId,
        expectedBaselineSha: baselineSha
      }),
      /Condition 7/
    );

    // All 7 conditions satisfied -> proofDir deleted, finalDir preserved
    const cleanRes = cleanupProofWorkspace({
      sourceRoot: sourceDir,
      proofTarget: proofDir,
      finalTarget: finalDir,
      expectedRunId: proofRunId,
      expectedBaselineSha: baselineSha
    });
    assert.equal(cleanRes.cleaned, true);
    assert.equal(cleanRes.conditionsVerified, 7);
    assert.equal(fs.existsSync(proofDir), false, 'Proof directory must be removed');
    assert.equal(fs.existsSync(finalDir), true, 'Final directory must remain intact');
    assert.equal(fs.existsSync(path.join(finalDir, MANIFEST_FILENAME)), true);
    console.log('  ✅ T-21: Proof Cleanup 7-condition guard passed.');
  }

  // ─────────────────────────────────────────────────────────────
  // Regression Tests R1..R7 (Transaction A2 Canonical PMS_CLIENT_CONFIG Contract)
  // ─────────────────────────────────────────────────────────────

  // R1: PMS_CLIENT_CONFIG nested schema parsed accurately (both synthetic & real repo data/config.js)
  {
    const parsedSynth = evaluateConfigJsFile(path.join(sourceDir, 'data', 'config.js'));
    assert.equal(parsedSynth.districtId, 'SYNTH-DISTRICT-01');
    assert.equal(parsedSynth.gasWebAppUrl, 'https://script.google.com/macros/s/AKfycb_SYNTH_PROD_DEP_ID_999/exec');
    assert.equal(parsedSynth.liffId, '2009999999-SynthProdLiff');

    const parsedRealRepo = evaluateConfigJsFile(path.join(REPO_ROOT, 'data', 'config.js'));
    assert.equal(typeof parsedRealRepo.districtId, 'string');
    assert.equal(parsedRealRepo.districtId.trim().length > 0, true);
    assert.equal(typeof parsedRealRepo.gasWebAppUrl, 'string');
    assert.equal(typeof parsedRealRepo.liffId, 'string');
    console.log('  ✅ R1: PMS_CLIENT_CONFIG nested schema parsed accurately.');
  }

  // R2: After Sanitization -> api.gasWebAppUrl === "", line.liffId === "", districtId & sibling fields preserved
  {
    const rawRealConfig = fs.readFileSync(path.join(REPO_ROOT, 'data', 'config.js'), 'utf8');
    const beforeEval = evaluateConfigJsCode(rawRealConfig, 'real data/config.js before');
    const sanitizedText = sanitizeConfigJsContent(rawRealConfig);
    const afterEval = evaluateConfigJsCode(sanitizedText, 'real data/config.js after');

    assert.equal(afterEval.gasWebAppUrl, '');
    assert.equal(afterEval.liffId, '');
    assert.equal(afterEval.raw.api.gasWebAppUrl, '');
    assert.equal(afterEval.raw.line.liffId, '');
    assert.equal(afterEval.districtId, beforeEval.districtId);
    assert.equal(afterEval.raw.version, beforeEval.raw.version);
    assert.equal(afterEval.raw.status, beforeEval.raw.status);
    assert.equal(afterEval.raw.environment, beforeEval.raw.environment);
    assert.equal(JSON.stringify(afterEval.raw.staticMaster), JSON.stringify(beforeEval.raw.staticMaster));
    assert.equal(JSON.stringify(afterEval.raw.features), JSON.stringify(beforeEval.raw.features));
    console.log('  ✅ R2: Sanitization clears api.gasWebAppUrl & line.liffId while preserving districtId and all other fields.');
  }

  // R3: Legacy window.CONFIG-only schema -> FAIL (No legacy fallback allowed)
  {
    const legacyConfigCode = [
      'const CONFIG = { districtId: "LEGACY-01", gasWebAppUrl: "", liffId: "" };',
      'window.CONFIG = CONFIG;'
    ].join('\n');
    assert.throws(
      () => evaluateConfigJsCode(legacyConfigCode, 'legacy-window-CONFIG'),
      /window\.PMS_CLIENT_CONFIG is missing or invalid/
    );
    console.log('  ✅ R3: Legacy window.CONFIG-only schema rejected (Fail-Closed).');
  }

  // R4: PMS_CLIENT_CONFIG.api missing or api.gasWebAppUrl property missing -> FAIL
  {
    const missingApiObj = 'window.PMS_CLIENT_CONFIG = { districtId: "D1", line: { liffId: "" } };';
    assert.throws(
      () => evaluateConfigJsCode(missingApiObj, 'missing-api'),
      /window\.PMS_CLIENT_CONFIG\.api is missing or invalid/
    );

    const missingGasProp = 'window.PMS_CLIENT_CONFIG = { districtId: "D1", api: {}, line: { liffId: "" } };';
    assert.throws(
      () => evaluateConfigJsCode(missingGasProp, 'missing-gasWebAppUrl'),
      /window\.PMS_CLIENT_CONFIG\.api\.gasWebAppUrl property is missing/
    );
    console.log('  ✅ R4: PMS_CLIENT_CONFIG.api / gasWebAppUrl missing rejected (Fail-Closed).');
  }

  // R5: PMS_CLIENT_CONFIG.line missing or line.liffId property missing -> FAIL
  {
    const missingLineObj = 'window.PMS_CLIENT_CONFIG = { districtId: "D1", api: { gasWebAppUrl: "" } };';
    assert.throws(
      () => evaluateConfigJsCode(missingLineObj, 'missing-line'),
      /window\.PMS_CLIENT_CONFIG\.line is missing or invalid/
    );

    const missingLiffProp = 'window.PMS_CLIENT_CONFIG = { districtId: "D1", api: { gasWebAppUrl: "" }, line: {} };';
    assert.throws(
      () => evaluateConfigJsCode(missingLiffProp, 'missing-liffId'),
      /window\.PMS_CLIENT_CONFIG\.line\.liffId property is missing/
    );
    console.log('  ✅ R5: PMS_CLIENT_CONFIG.line / liffId missing rejected (Fail-Closed).');
  }

  // R6: PMS_CLIENT_CONFIG.districtId missing or empty -> FAIL
  {
    const missingDistrict = 'window.PMS_CLIENT_CONFIG = { api: { gasWebAppUrl: "" }, line: { liffId: "" } };';
    assert.throws(
      () => evaluateConfigJsCode(missingDistrict, 'missing-districtId'),
      /window\.PMS_CLIENT_CONFIG\.districtId is missing or empty/
    );

    const emptyDistrict = 'window.PMS_CLIENT_CONFIG = { districtId: "   ", api: { gasWebAppUrl: "" }, line: { liffId: "" } };';
    assert.throws(
      () => evaluateConfigJsCode(emptyDistrict, 'empty-districtId'),
      /window\.PMS_CLIENT_CONFIG\.districtId is missing or empty/
    );
    console.log('  ✅ R6: PMS_CLIENT_CONFIG.districtId missing/empty rejected (Fail-Closed).');
  }

  // R7: Real Runtime guard verification (Gate B B-06) verifies PMS_CLIENT_CONFIG contract and rejects legacy window.CONFIG guard
  {
    const gateBPass = runGateB({ sourceRoot: sourceDir, targetRoot: inspectTarget });
    assert.equal(gateBPass.checks.B06.pass, true, 'B-06 must pass on canonical PMS_CLIENT_CONFIG runtime');

    const apiPath = path.join(inspectTarget, 'active', 'h-app', 'modules', 'api.js');
    const origApi = fs.readFileSync(apiPath, 'utf8');
    fs.writeFileSync(
      apiPath,
      'if (!window.CONFIG || !window.CONFIG.gasWebAppUrl) { throw new Error("legacy"); }\n',
      'utf8'
    );
    try {
      const gateBFail = runGateB({ sourceRoot: sourceDir, targetRoot: inspectTarget });
      assert.equal(gateBFail.checks.B06.pass, false, 'B-06 must fail if api.js uses legacy window.CONFIG instead of PMS_CLIENT_CONFIG');
    } finally {
      fs.writeFileSync(apiPath, origApi, 'utf8');
    }
    console.log('  ✅ R7: Runtime guard verification enforces PMS_CLIENT_CONFIG contract.');
  }

  // R8: NUL-safe Git Path Fidelity for Japanese (with dakuten) + Space + ASCII tracked filenames (Transaction A3)
  {
    const trackedList = listBaselineTrackedFiles(sourceDir, 'HEAD');
    assert.equal(
      trackedList.includes('docs/manuals/Sample Operational Guide.md'),
      true,
      'R8 must preserve ASCII space-containing tracked path'
    );
    assert.equal(
      trackedList.includes('docs/manuals/サンプル ご利用ガイド.md'),
      true,
      'R8 must preserve raw UTF-8 Japanese + dakuten + space tracked path without octal C-quoting'
    );
    assert.equal(
      trackedList.includes('docs/manuals/手引き データ確認表.pdf'),
      true,
      'R8 must preserve raw UTF-8 Japanese + dakuten + space PDF path without octal C-quoting'
    );
    assert.equal(
      trackedList.some(p => p.includes('\\3')),
      false,
      'R8 tracked path list must contain zero octal C-escaped sequences'
    );

    const gateARes = runGateA({ sourceRoot: sourceDir, targetRoot: inspectTarget });
    assert.equal(gateARes.checks.A03.pass, true, 'A-03 must pass with Japanese and space-containing paths');
    assert.equal(gateARes.checks.A03.missingTracked.length, 0, 'A-03 missingTracked must be 0');
    assert.equal(gateARes.checks.A03.extraFiles.length, 0, 'A-03 extraFiles must be 0');
    assert.equal(gateARes.checks.A03.modifiedNonSanitized.length, 0, 'A-03 modifiedNonSanitized must be 0');
    console.log('  ✅ R8: NUL-safe Git path extraction preserves ASCII, space, and Japanese (dakuten) tracked paths (missing=0, extra=0, modified=0).');
  }

  // R9: Formal Skill Registration & OS Registry Active Wiring (Finish Mission)
  {
    const skillPath = path.join(REPO_ROOT, '.agents', 'skills', 'production-development-isolation', 'SKILL.md');
    assert.equal(fs.existsSync(skillPath), true, 'R9: .agents/skills/production-development-isolation/SKILL.md must exist');
    const skillText = fs.readFileSync(skillPath, 'utf8');
    assert.equal(skillText.includes('name: production-development-isolation'), true, 'R9: SKILL.md must declare name: production-development-isolation');
    assert.equal(skillText.includes('CANONICAL / ACTIVE'), true, 'R9: SKILL.md must declare Status: CANONICAL / ACTIVE');
    assert.equal(skillText.includes('<SOURCE_PRODUCTION_ROOT>'), true, 'R9: SKILL.md must use <SOURCE_PRODUCTION_ROOT> placeholder');
    assert.equal(skillText.includes('<PROOF_TARGET>'), true, 'R9: SKILL.md must use <PROOF_TARGET> placeholder');
    assert.equal(skillText.includes('<FINAL_DEVELOPMENT_TARGET>'), true, 'R9: SKILL.md must use <FINAL_DEVELOPMENT_TARGET> placeholder');
    assert.equal(skillText.includes('<SOURCE_BASELINE_SHA>'), true, 'R9: SKILL.md must use <SOURCE_BASELINE_SHA> placeholder');

    const regPath = path.join(REPO_ROOT, '.agents', 'os-registry.json');
    const regObj = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    assert.equal(Boolean(regObj.capabilityPacks['production-development-isolation']), true, 'R9: capabilityPacks must include production-development-isolation');
    assert.equal(
      regObj.rolePackAssignments.execution.includes('production-development-isolation'),
      true,
      'R9: rolePackAssignments.execution must include production-development-isolation'
    );
    assert.equal(
      regObj.operationalKnowledgeSurfaces.includes('.agents/skills/production-development-isolation/SKILL.md'),
      true,
      'R9: operationalKnowledgeSurfaces must include .agents/skills/production-development-isolation/SKILL.md'
    );
    console.log('  ✅ R9: Formal Skill (production-development-isolation) & OS Registry active wiring verified.');
  }

  console.log('🎉 All 30 Production Development Isolation test cases (T-01..T-21 + R1..R9) PASSED!');
} finally {
  fs.rmSync(rootTmp, { recursive: true, force: true });
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MANIFEST_FILENAME = '.isolated-dev-manifest.json';
export const MANIFEST_MARKER_TYPE = 'ISOLATED_DEV_WORKSPACE_MANIFEST';

export const FINGERPRINT_KEYS = Object.freeze([
  'headSha',
  'gitStatusPorcelain',
  'gitRemoteVerbose',
  'gitConfigLocal',
  'rootClaspJson',
  'activeClaspJson',
  'deploymentJson',
  'dataConfigJs',
  'cnameFile'
]);

const EXPLICIT_DENY_RELATIVE_PATHS = new Set([
  '.clasp.json',
  'active/.clasp.json',
  'deployment.json',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test'
]);

const TRACKED_ENV_TEMPLATES = new Set([
  '.env.example',
  '.env.template',
  '.env.sample'
]);

export function sha256Buffer(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

export function sha256Text(text) {
  return sha256Buffer(Buffer.from(String(text), 'utf8'));
}

export function sha256FileOrMissing(filePath) {
  if (!fs.existsSync(filePath)) {
    return 'MISSING';
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) {
    return 'MISSING';
  }
  return sha256Buffer(fs.readFileSync(filePath));
}

export function runCommandSafe(binary, argsArray, options = {}) {
  const result = spawnSync(binary, argsArray, {
    shell: false,
    encoding: options.encoding !== undefined ? options.encoding : 'utf8',
    maxBuffer: options.maxBuffer || 100 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env || process.env,
    input: options.input
  });
  if (result.error) {
    throw new Error(`Command execution failed (${binary}): ${result.error.message}`);
  }
  return result;
}

export function resolveCommitSha(repoRoot, ref = 'HEAD') {
  if (!ref || typeof ref !== 'string' || !/^[A-Za-z0-9._\-/~^]+$/.test(ref)) {
    throw new Error(`Fail-Closed: Invalid git commit ref format: ${String(ref)}`);
  }
  const res = runCommandSafe('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoRoot });
  if (res.status !== 0) {
    throw new Error(`Fail-Closed: Unable to resolve git commit ref "${ref}" in ${repoRoot}`);
  }
  const sha = (res.stdout || '').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Fail-Closed: Resolved commit SHA is not a valid 40-char hex string: ${sha}`);
  }
  return sha;
}

/**
 * Captures the 9-item Source Connection Fingerprint without exposing any raw secret/ID/URL values.
 */
export function captureSourceConnectionFingerprint(sourceRoot) {
  const absSource = path.resolve(sourceRoot);
  const headSha = resolveCommitSha(absSource, 'HEAD');

  const statusRes = runCommandSafe('git', ['status', '--porcelain'], { cwd: absSource });
  if (statusRes.status !== 0) {
    throw new Error('Fail-Closed: Failed to execute git status --porcelain on source repository.');
  }
  const remoteRes = runCommandSafe('git', ['remote', '-v'], { cwd: absSource });
  if (remoteRes.status !== 0) {
    throw new Error('Fail-Closed: Failed to execute git remote -v on source repository.');
  }
  const configRes = runCommandSafe('git', ['config', '--local', '--list'], { cwd: absSource });
  if (configRes.status !== 0) {
    throw new Error('Fail-Closed: Failed to execute git config --local --list on source repository.');
  }

  return {
    headSha,
    gitStatusPorcelain: sha256Text(statusRes.stdout || ''),
    gitRemoteVerbose: sha256Text(remoteRes.stdout || ''),
    gitConfigLocal: sha256Text(configRes.stdout || ''),
    rootClaspJson: sha256FileOrMissing(path.join(absSource, '.clasp.json')),
    activeClaspJson: sha256FileOrMissing(path.join(absSource, 'active', '.clasp.json')),
    deploymentJson: sha256FileOrMissing(path.join(absSource, 'deployment.json')),
    dataConfigJs: sha256FileOrMissing(path.join(absSource, 'data', 'config.js')),
    cnameFile: sha256FileOrMissing(path.join(absSource, 'CNAME'))
  };
}

export function compareSourceFingerprints(beforeFp, afterFp) {
  if (!beforeFp || typeof beforeFp !== 'object' || !afterFp || typeof afterFp !== 'object') {
    return { match: false, diffs: ['Missing or invalid fingerprint object'] };
  }
  const diffs = [];
  for (const key of FINGERPRINT_KEYS) {
    const bVal = beforeFp[key];
    const aVal = afterFp[key];
    if (bVal !== aVal) {
      diffs.push(`${key}: before=${String(bVal)} !== after=${String(aVal)}`);
    }
  }
  return {
    match: diffs.length === 0,
    diffs
  };
}

export function evaluateConfigJsCode(code, label = 'data/config.js') {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error(`Fail-Closed: Empty or invalid config.js content in ${label}`);
  }
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { timeout: 2000 });
  } catch (err) {
    throw new Error(`Fail-Closed: config.js evaluation error in ${label}: ${err.message}`);
  }

  const pmsConfig = sandbox.window && sandbox.window.PMS_CLIENT_CONFIG;
  if (!pmsConfig || typeof pmsConfig !== 'object' || Array.isArray(pmsConfig)) {
    throw new Error(`Fail-Closed: window.PMS_CLIENT_CONFIG is missing or invalid in ${label}`);
  }
  if (typeof pmsConfig.districtId !== 'string' || pmsConfig.districtId.trim() === '') {
    throw new Error(`Fail-Closed: window.PMS_CLIENT_CONFIG.districtId is missing or empty in ${label}`);
  }
  if (!pmsConfig.api || typeof pmsConfig.api !== 'object' || Array.isArray(pmsConfig.api)) {
    throw new Error(`Fail-Closed: window.PMS_CLIENT_CONFIG.api is missing or invalid in ${label}`);
  }
  if (
    !Object.prototype.hasOwnProperty.call(pmsConfig.api, 'gasWebAppUrl') ||
    typeof pmsConfig.api.gasWebAppUrl !== 'string'
  ) {
    throw new Error(`Fail-Closed: window.PMS_CLIENT_CONFIG.api.gasWebAppUrl property is missing or not a string in ${label}`);
  }
  if (!pmsConfig.line || typeof pmsConfig.line !== 'object' || Array.isArray(pmsConfig.line)) {
    throw new Error(`Fail-Closed: window.PMS_CLIENT_CONFIG.line is missing or invalid in ${label}`);
  }
  if (
    !Object.prototype.hasOwnProperty.call(pmsConfig.line, 'liffId') ||
    typeof pmsConfig.line.liffId !== 'string'
  ) {
    throw new Error(`Fail-Closed: window.PMS_CLIENT_CONFIG.line.liffId property is missing or not a string in ${label}`);
  }

  return {
    districtId: pmsConfig.districtId,
    gasWebAppUrl: pmsConfig.api.gasWebAppUrl,
    liffId: pmsConfig.line.liffId,
    raw: pmsConfig
  };
}

export function evaluateConfigJsFile(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Fail-Closed: Missing config.js at ${configPath}`);
  }
  const code = fs.readFileSync(configPath, 'utf8');
  return evaluateConfigJsCode(code, configPath);
}

function safeParseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Dynamically extracts non-empty Source Production identifiers in memory ONLY.
 * Raw values are never printed or persisted.
 */
export function extractSourceProductionIdentifiers(sourceRoot) {
  const absSource = path.resolve(sourceRoot);
  const identifiers = [];
  const seen = new Set();

  function addIdentifier(type, rawValue) {
    if (typeof rawValue !== 'string') return;
    const trimmed = rawValue.trim();
    if (trimmed.length < 4) return;
    const key = `${type}:::${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    identifiers.push({ type, value: trimmed });
  }

  const configPath = path.join(absSource, 'data', 'config.js');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = evaluateConfigJsFile(configPath);
      addIdentifier('PROD_GAS_WEBAPP_URL', cfg.gasWebAppUrl);
      addIdentifier('PROD_LIFF_ID', cfg.liffId);
      if (typeof cfg.gasWebAppUrl === 'string') {
        const matchDep = cfg.gasWebAppUrl.match(/\/macros\/s\/([^/'"`\s]+)\/exec/);
        if (matchDep && matchDep[1]) {
          addIdentifier('PROD_DEPLOYMENT_ID', matchDep[1]);
        }
      }
    } catch (_) {
      // Handled by structural checks
    }
  }

  const cnamePath = path.join(absSource, 'CNAME');
  if (fs.existsSync(cnamePath)) {
    const cnameVal = fs.readFileSync(cnamePath, 'utf8').trim();
    addIdentifier('PROD_DOMAIN', cnameVal);
  }

  for (const relClasp of ['.clasp.json', path.join('active', '.clasp.json')]) {
    const parsed = safeParseJsonFile(path.join(absSource, relClasp));
    if (parsed && typeof parsed === 'object') {
      addIdentifier('PROD_SCRIPT_ID', parsed.scriptId);
    }
  }

  const depParsed = safeParseJsonFile(path.join(absSource, 'deployment.json'));
  if (depParsed && typeof depParsed === 'object') {
    addIdentifier('PROD_GAS_WEBAPP_URL', depParsed.webAppUrl);
    addIdentifier('PROD_GAS_WEBAPP_URL', depParsed.gasWebAppUrl);
    addIdentifier('PROD_SCRIPT_ID', depParsed.scriptId);
    addIdentifier('PROD_DEPLOYMENT_ID', depParsed.deploymentId);
    addIdentifier('PROD_SPREADSHEET_ID', depParsed.spreadsheetId);
    addIdentifier('PROD_SPREADSHEET_ID', depParsed.targetSpreadsheetId);
  }

  return identifiers;
}

export function listBaselineTrackedFiles(sourceRoot, baselineSha) {
  const res = runCommandSafe(
    'git',
    ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', baselineSha],
    { cwd: sourceRoot }
  );
  if (res.status !== 0) {
    throw new Error(`Fail-Closed: git ls-tree failed for ${baselineSha}`);
  }
  return (res.stdout || '')
    .split('\0')
    .filter(entry => entry.length > 0);
}

export function readBaselineBlobBuffer(sourceRoot, baselineSha, relPath, sourceHeadMatchesBaseline = false) {
  if (sourceHeadMatchesBaseline) {
    const directPath = path.join(sourceRoot, relPath);
    if (fs.existsSync(directPath) && fs.lstatSync(directPath).isFile()) {
      return fs.readFileSync(directPath);
    }
  }
  const res = runCommandSafe('git', ['show', `${baselineSha}:${relPath}`], {
    cwd: sourceRoot,
    encoding: null
  });
  if (res.status !== 0) {
    throw new Error(`Fail-Closed: Unable to read blob ${baselineSha}:${relPath}`);
  }
  return Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '');
}

export function walkTargetFiles(targetRoot, options = { ignoreGitDir: false }) {
  const results = [];
  function walk(currentDir, relPrefix) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (options.ignoreGitDir && (relPath === '.git' || relPath.startsWith('.git/'))) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        results.push(relPath);
      }
    }
  }
  if (fs.existsSync(targetRoot)) {
    walk(targetRoot, '');
  }
  return results.sort();
}

export function isExplicitDeniedLocalOrSecretPath(relPath, isBaselineTracked = false) {
  if (EXPLICIT_DENY_RELATIVE_PATHS.has(relPath)) return true;
  if (relPath === '.secrets' || relPath.startsWith('.secrets/')) return true;

  const base = path.basename(relPath);
  if (base.startsWith('.env') && !TRACKED_ENV_TEMPLATES.has(base)) {
    return true;
  }
  if (!isBaselineTracked) {
    if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
    if (/(secret|credential|service-account)/i.test(base)) return true;
  }
  return false;
}

/**
 * Scans runtime files (index.html, data/config.js, active/**) for references to tests/** or docs/**.
 * Any referenced path in tests/** or docs/** is returned in linkedPaths and causes A-04 failure + A-07 promotion to RUNTIME_BINDING.
 */
export function detectRuntimeToFixtureLinks(targetRoot, targetFiles) {
  const runtimeFiles = targetFiles.filter(
    rel => rel === 'index.html' || rel === 'data/config.js' || (rel.startsWith('active/') && rel !== 'active/.clasp.json')
  );
  const violations = [];
  const linkedPaths = new Set();

  const refPattern = /(?:import\s+[^'"]*['"]|import\s*\(\s*['"]|src\s*=\s*['"]|href\s*=\s*['"]|fetch\s*\(\s*['"])([^'"]*(?:^|\/)(?:tests|docs)\/[^'"]+)['"]/g;

  for (const rel of runtimeFiles) {
    const fullPath = path.join(targetRoot, rel);
    if (!fs.existsSync(fullPath)) continue;
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch (_) {
      continue;
    }
    let match;
    while ((match = refPattern.exec(content)) !== null) {
      const rawRef = match[1];
      const normalized = rawRef.replace(/^(\.\.?\/)+/, '');
      violations.push(`${rel} -> ${rawRef}`);
      linkedPaths.add(normalized);
      for (const candidate of targetFiles) {
        if (candidate === normalized || candidate.endsWith(`/${normalized}`)) {
          linkedPaths.add(candidate);
        }
      }
    }
  }

  return { violations, linkedPaths };
}

export function classifySurfaceCategory(relPath, runtimeLinkedPaths = new Set()) {
  if (relPath === '.git/config' || relPath.startsWith('.git/')) {
    return 'LOCAL_BINDING';
  }
  if (runtimeLinkedPaths.has(relPath)) {
    return 'RUNTIME_BINDING';
  }
  if (
    relPath === 'data/config.js' ||
    relPath === 'CNAME' ||
    relPath === 'index.html' ||
    (relPath.startsWith('active/') && relPath !== 'active/.clasp.json') ||
    relPath.startsWith('data/')
  ) {
    return 'RUNTIME_BINDING';
  }
  if (
    relPath === '.clasp.json' ||
    relPath === 'active/.clasp.json' ||
    relPath === 'deployment.json' ||
    relPath.startsWith('.secrets/') ||
    isExplicitDeniedLocalOrSecretPath(relPath, false)
  ) {
    return 'DEPLOYMENT_BINDING';
  }
  if (relPath.startsWith('tests/')) {
    return 'TEST_FIXTURE';
  }
  if (
    relPath.startsWith('docs/') ||
    relPath.startsWith('.agents/') ||
    relPath.startsWith('.github/') ||
    relPath === 'AGENTS.md' ||
    /^README/i.test(path.basename(relPath)) ||
    relPath.endsWith('.template') ||
    relPath.endsWith('.template.json') ||
    TRACKED_ENV_TEMPLATES.has(path.basename(relPath))
  ) {
    return 'DOCUMENTATION';
  }
  return 'DEPLOYMENT_BINDING';
}

export function runGateA({ sourceRoot, targetRoot, baselineSha }) {
  const absSource = path.resolve(sourceRoot);
  const absTarget = path.resolve(targetRoot);
  const resolvedBaseline = resolveCommitSha(absSource, baselineSha || 'HEAD');

  const sourceStatusRes = runCommandSafe('git', ['status', '--porcelain'], { cwd: absSource });
  const sourceHeadSha = resolveCommitSha(absSource, 'HEAD');
  const sourceHeadMatchesBaseline = (
    sourceHeadSha === resolvedBaseline &&
    sourceStatusRes.status === 0 &&
    (sourceStatusRes.stdout || '').trim() === ''
  );

  const checks = {};
  const allFilesPhaseA = walkTargetFiles(absTarget, { ignoreGitDir: false });
  const nonGitFiles = walkTargetFiles(absTarget, { ignoreGitDir: true });

  // A-01: .git absent in pre-git-init phase
  const gitDirPath = path.join(absTarget, '.git');
  const gitDirExists = fs.existsSync(gitDirPath);
  checks.A01 = {
    pass: !gitDirExists,
    message: gitDirExists
      ? 'A-01 FAIL: .git directory/file exists in Target during Gate A.'
      : 'A-01 PASS: .git is absent in Target.'
  };

  // Baseline tracked set resolution
  const baselineTrackedList = listBaselineTrackedFiles(absSource, resolvedBaseline);
  const baselineTrackedSet = new Set(baselineTrackedList);

  // A-02: Explicit Local / Secret Binding Deny
  const deniedFound = [];
  for (const rel of nonGitFiles) {
    if (isExplicitDeniedLocalOrSecretPath(rel, baselineTrackedSet.has(rel))) {
      deniedFound.push(rel);
    }
  }
  checks.A02 = {
    pass: deniedFound.length === 0,
    deniedFound,
    message: deniedFound.length === 0
      ? 'A-02 PASS: Zero prohibited local/secret binding files in Target.'
      : `A-02 FAIL: Prohibited local/secret binding file(s) found: ${deniedFound.join(', ')}`
  };

  // A-03: Baseline Tracked File Preservation + Zero Extra/Missing Files
  const expectedSet = new Set([...baselineTrackedList, MANIFEST_FILENAME]);
  const actualSet = new Set(nonGitFiles);
  const missingTracked = baselineTrackedList.filter(f => !actualSet.has(f));
  const extraFiles = nonGitFiles.filter(f => !expectedSet.has(f));
  const modifiedNonSanitized = [];

  for (const rel of baselineTrackedList) {
    if (!actualSet.has(rel)) continue;
    if (rel === 'data/config.js' || rel === 'CNAME') continue;
    const targetBuf = fs.readFileSync(path.join(absTarget, rel));
    const sourceBuf = readBaselineBlobBuffer(absSource, resolvedBaseline, rel, sourceHeadMatchesBaseline);
    if (sha256Buffer(targetBuf) !== sha256Buffer(sourceBuf)) {
      modifiedNonSanitized.push(rel);
    }
  }

  const a03Pass = (
    missingTracked.length === 0 &&
    extraFiles.length === 0 &&
    modifiedNonSanitized.length === 0
  );
  checks.A03 = {
    pass: a03Pass,
    missingTracked,
    extraFiles,
    modifiedNonSanitized,
    message: a03Pass
      ? `A-03 PASS: All ${baselineTrackedList.length} baseline tracked files preserved (zero missing, zero extra, zero unauthorized content mutations).`
      : `A-03 FAIL: missing=[${missingTracked.join(', ')}] extra=[${extraFiles.join(', ')}] modified=[${modifiedNonSanitized.join(', ')}]`
  };

  // A-04: Runtime-to-Fixture Isolation
  const { violations: runtimeLinkViolations, linkedPaths: runtimeLinkedPaths } = detectRuntimeToFixtureLinks(absTarget, nonGitFiles);
  checks.A04 = {
    pass: runtimeLinkViolations.length === 0,
    violations: runtimeLinkViolations,
    message: runtimeLinkViolations.length === 0
      ? 'A-04 PASS: Runtime files have zero import/fetch/src links to tests/** or docs/**.'
      : `A-04 FAIL: Runtime links to fixture/docs detected: ${runtimeLinkViolations.join('; ')}`
  };

  // A-05: Concrete GAS Exec URL Scan on Runtime & Deployment Surfaces
  const gasExecUrlRegex = /https:\/\/script\.google\.com\/macros\/s\/[^/'"`\s]+\/exec/;
  const gasExecHits = [];
  for (const rel of nonGitFiles) {
    if (rel === MANIFEST_FILENAME) continue;
    const category = classifySurfaceCategory(rel, runtimeLinkedPaths);
    if (category !== 'RUNTIME_BINDING' && category !== 'DEPLOYMENT_BINDING') continue;
    if (rel.startsWith('scripts/')) continue;
    const fullPath = path.join(absTarget, rel);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (gasExecUrlRegex.test(content)) {
        gasExecHits.push(rel);
      }
    } catch (_) {
      // ignore binary
    }
  }
  checks.A05 = {
    pass: gasExecHits.length === 0,
    hits: gasExecHits,
    message: gasExecHits.length === 0
      ? 'A-05 PASS: Zero concrete GAS exec URLs on Runtime/Deployment surfaces.'
      : `A-05 FAIL: Concrete GAS exec URL found in: ${gasExecHits.join(', ')}`
  };

  // A-06: Canonical Runtime Config Values (gasWebAppUrl === "", liffId === "", CNAME === "")
  let a06Pass = false;
  let a06Details = '';
  let targetDistrictId = null;
  try {
    const cfg = evaluateConfigJsFile(path.join(absTarget, 'data', 'config.js'));
    targetDistrictId = cfg.districtId;
    const cnamePath = path.join(absTarget, 'CNAME');
    const cnameExists = fs.existsSync(cnamePath);
    const cnameContent = cnameExists ? fs.readFileSync(cnamePath, 'utf8') : null;
    if (cfg.gasWebAppUrl === '' && cfg.liffId === '' && cnameExists && cnameContent === '') {
      a06Pass = true;
      a06Details = 'A-06 PASS: CONFIG.gasWebAppUrl === "", CONFIG.liffId === "", CNAME === "" (0 bytes).';
    } else {
      a06Details = `A-06 FAIL: gasWebAppUrlEmpty=${cfg.gasWebAppUrl === ''}, liffIdEmpty=${cfg.liffId === ''}, cnameEmpty=${cnameContent === ''}`;
    }
  } catch (err) {
    a06Details = `A-06 FAIL: ${err.message}`;
  }
  checks.A06 = {
    pass: a06Pass,
    message: a06Details
  };

  // A-07: Production Runtime Binding = 0 (5-Category Classification)
  const prodIdentifiers = extractSourceProductionIdentifiers(absSource);
  const classifications = {
    RUNTIME_BINDING: [],
    DEPLOYMENT_BINDING: [],
    LOCAL_BINDING: [],
    TEST_FIXTURE: [],
    DOCUMENTATION: []
  };

  for (const rel of nonGitFiles) {
    if (rel === MANIFEST_FILENAME) continue;
    const fullPath = path.join(absTarget, rel);
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch (_) {
      continue;
    }
    const category = classifySurfaceCategory(rel, runtimeLinkedPaths);
    for (const idObj of prodIdentifiers) {
      if (content.includes(idObj.value)) {
        classifications[category].push({
          file: rel,
          identifierType: idObj.type
        });
      }
    }
  }

  // Also check .git/config if .git exists
  const targetGitConfigPath = path.join(absTarget, '.git', 'config');
  if (fs.existsSync(targetGitConfigPath)) {
    try {
      const gitCfgContent = fs.readFileSync(targetGitConfigPath, 'utf8');
      for (const idObj of prodIdentifiers) {
        if (gitCfgContent.includes(idObj.value)) {
          classifications.LOCAL_BINDING.push({
            file: '.git/config',
            identifierType: idObj.type
          });
        }
      }
    } catch (_) {
      // ignore
    }
  }

  const a07Pass = (
    classifications.RUNTIME_BINDING.length === 0 &&
    classifications.DEPLOYMENT_BINDING.length === 0 &&
    classifications.LOCAL_BINDING.length === 0
  );
  checks.A07 = {
    pass: a07Pass,
    counts: {
      RUNTIME_BINDING: classifications.RUNTIME_BINDING.length,
      DEPLOYMENT_BINDING: classifications.DEPLOYMENT_BINDING.length,
      LOCAL_BINDING: classifications.LOCAL_BINDING.length,
      TEST_FIXTURE: classifications.TEST_FIXTURE.length,
      DOCUMENTATION: classifications.DOCUMENTATION.length
    },
    classifications,
    message: a07Pass
      ? `A-07 PASS: RUNTIME_BINDING=0, DEPLOYMENT_BINDING=0, LOCAL_BINDING=0 (TEST_FIXTURE=${classifications.TEST_FIXTURE.length}, DOCUMENTATION=${classifications.DOCUMENTATION.length}).`
      : `A-07 FAIL: RUNTIME_BINDING=${classifications.RUNTIME_BINDING.length}, DEPLOYMENT_BINDING=${classifications.DEPLOYMENT_BINDING.length}, LOCAL_BINDING=${classifications.LOCAL_BINDING.length}.`
  };

  // A-08: Canonical Data Fixture Preservation
  const requiredDataFiles = [
    'data/address_master.csv',
    'data/boundaries.geojson',
    'data/municipality_master.csv',
    'data/storage_locations.json'
  ];
  const dataMismatches = [];
  for (const relData of requiredDataFiles) {
    const targetDataPath = path.join(absTarget, relData);
    if (!fs.existsSync(targetDataPath)) {
      dataMismatches.push(`${relData}:missing`);
      continue;
    }
    const targetHash = sha256Buffer(fs.readFileSync(targetDataPath));
    const sourceHash = sha256Buffer(readBaselineBlobBuffer(absSource, resolvedBaseline, relData, sourceHeadMatchesBaseline));
    if (targetHash !== sourceHash) {
      dataMismatches.push(`${relData}:sha256_mismatch`);
    }
  }
  let sourceDistrictId = null;
  try {
    const srcCfgCode = readBaselineBlobBuffer(absSource, resolvedBaseline, 'data/config.js', sourceHeadMatchesBaseline).toString('utf8');
    const srcEvaluated = evaluateConfigJsCode(srcCfgCode, 'Source baseline data/config.js');
    sourceDistrictId = srcEvaluated.districtId;
  } catch (_) {
    sourceDistrictId = null;
  }
  if (!targetDistrictId || typeof targetDistrictId !== 'string' || !sourceDistrictId || targetDistrictId !== sourceDistrictId) {
    dataMismatches.push('data/config.js:districtId_mismatch');
  }
  checks.A08 = {
    pass: dataMismatches.length === 0,
    mismatches: dataMismatches,
    message: dataMismatches.length === 0
      ? 'A-08 PASS: All 4 canonical master data artifacts and districtId match baseline.'
      : `A-08 FAIL: Master data fixture mismatch: ${dataMismatches.join(', ')}`
  };

  // A-09: Template Mode SSOT Validator PASS
  const ssotScriptPath = path.join(absTarget, 'scripts', 'validate-gas-endpoint-ssot.mjs');
  let a09Pass = false;
  let a09Message = '';
  if (fs.existsSync(ssotScriptPath)) {
    const ssotRes = runCommandSafe(process.execPath, [ssotScriptPath], { cwd: absTarget });
    const ssotOut = `${ssotRes.stdout || ''}\n${ssotRes.stderr || ''}`;
    a09Pass = ssotRes.status === 0 && (ssotOut.includes('Pure Template: Empty') || ssotOut.includes('template mode'));
    a09Message = a09Pass
      ? 'A-09 PASS: validate-gas-endpoint-ssot.mjs passed in Template Mode.'
      : `A-09 FAIL: validate-gas-endpoint-ssot.mjs status=${ssotRes.status}`;
  } else {
    a09Message = 'A-09 FAIL: scripts/validate-gas-endpoint-ssot.mjs missing in Target.';
  }
  checks.A09 = {
    pass: a09Pass,
    message: a09Message
  };

  // A-10: Isolation Manifest Integrity
  const manifestPath = path.join(absTarget, MANIFEST_FILENAME);
  let a10Pass = false;
  let a10Message = '';
  const manifest = safeParseJsonFile(manifestPath);
  if (manifest && typeof manifest === 'object') {
    const realTarget = fs.existsSync(absTarget) ? fs.realpathSync(absTarget) : absTarget;
    const fpObj = manifest.sourceFingerprintBefore;
    const hasAllFpKeys = fpObj && typeof fpObj === 'object' && FINGERPRINT_KEYS.every(k => typeof fpObj[k] === 'string' && fpObj[k].length > 0);
    if (
      manifest.markerType === MANIFEST_MARKER_TYPE &&
      (manifest.mode === 'proof' || manifest.mode === 'final') &&
      typeof manifest.runId === 'string' &&
      manifest.runId.length >= 8 &&
      manifest.sourceBaselineSha === resolvedBaseline &&
      manifest.targetRealpath === realTarget &&
      hasAllFpKeys
    ) {
      a10Pass = true;
      a10Message = 'A-10 PASS: Isolation manifest schema, baseline SHA, targetRealpath, and sourceFingerprintBefore verified.';
    } else {
      a10Message = 'A-10 FAIL: Isolation manifest fields mismatch or incomplete.';
    }
  } else {
    a10Message = `A-10 FAIL: Missing or invalid ${MANIFEST_FILENAME}.`;
  }
  checks.A10 = {
    pass: a10Pass,
    manifest,
    message: a10Message
  };

  const overallPass = Object.values(checks).every(c => c.pass);
  return {
    phase: 'A',
    pass: overallPass,
    checks,
    allFilesCount: allFilesPhaseA.length
  };
}

export function runGateB({ sourceRoot, targetRoot, baselineSha, expectedSourceFingerprint = null }) {
  const absSource = path.resolve(sourceRoot);
  const absTarget = path.resolve(targetRoot);
  const resolvedBaseline = resolveCommitSha(absSource, baselineSha || 'HEAD');
  const realTarget = fs.existsSync(absTarget) ? fs.realpathSync(absTarget) : absTarget;

  const checks = {};

  // B-01: Independent Git Root exact match
  const topRes = runCommandSafe('git', ['rev-parse', '--show-toplevel'], { cwd: absTarget });
  let topReal = '';
  if (topRes.status === 0 && (topRes.stdout || '').trim()) {
    const rawTop = (topRes.stdout || '').trim();
    topReal = fs.existsSync(rawTop) ? fs.realpathSync(rawTop) : rawTop;
  }
  const b01Pass = topRes.status === 0 && topReal === realTarget;
  checks.B01 = {
    pass: b01Pass,
    message: b01Pass
      ? 'B-01 PASS: Target git top-level matches Target realpath.'
      : `B-01 FAIL: Target git top-level (${topReal}) !== Target realpath (${realTarget}).`
  };

  // B-02: git remote -v empty (LOCAL_BINDING === 0)
  const remoteRes = runCommandSafe('git', ['remote', '-v'], { cwd: absTarget });
  const remoteOut = (remoteRes.stdout || '').trim();
  const b02Pass = remoteRes.status === 0 && remoteOut === '';
  checks.B02 = {
    pass: b02Pass,
    message: b02Pass
      ? 'B-02 PASS: Target has zero git remotes (git remote -v is empty).'
      : 'B-02 FAIL: Target has git remote bindings configured.'
  };

  // B-03: Commit count === 1 and HEAD SHA !== baselineSha
  const countRes = runCommandSafe('git', ['rev-list', '--count', 'HEAD'], { cwd: absTarget });
  const commitCount = (countRes.stdout || '').trim();
  let targetHeadSha = '';
  try {
    targetHeadSha = resolveCommitSha(absTarget, 'HEAD');
  } catch (_) {
    targetHeadSha = '';
  }
  const b03Pass = countRes.status === 0 && commitCount === '1' && targetHeadSha !== '' && targetHeadSha !== resolvedBaseline;
  checks.B03 = {
    pass: b03Pass,
    commitCount,
    targetHeadSha,
    message: b03Pass
      ? `B-03 PASS: Target has exactly 1 initial commit (${targetHeadSha.slice(0, 7)} !== ${resolvedBaseline.slice(0, 7)}).`
      : `B-03 FAIL: commitCount=${commitCount}, targetHead=${targetHeadSha}, baseline=${resolvedBaseline}.`
  };

  // B-04: Target working tree clean
  const statusRes = runCommandSafe('git', ['status', '--porcelain'], { cwd: absTarget });
  const statusOut = (statusRes.stdout || '').trim();
  const b04Pass = statusRes.status === 0 && statusOut === '';
  checks.B04 = {
    pass: b04Pass,
    message: b04Pass
      ? 'B-04 PASS: Target working tree is clean.'
      : `B-04 FAIL: Target working tree is dirty: ${statusOut}`
  };

  // B-05: Re-verify Gate A checks A-02..A-10 (ignoring .git directory)
  const gateAResult = runGateA({ sourceRoot: absSource, targetRoot: absTarget, baselineSha: resolvedBaseline });
  const a02ToA10Keys = ['A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'];
  const failedSubChecks = a02ToA10Keys.filter(k => !gateAResult.checks[k] || !gateAResult.checks[k].pass);
  const b05Pass = failedSubChecks.length === 0 && b02Pass;
  checks.B05 = {
    pass: b05Pass,
    failedSubChecks,
    gateAChecks: gateAResult.checks,
    message: b05Pass
      ? 'B-05 PASS: All Gate A checks (A-02..A-10) remain PASS post-git-init.'
      : `B-05 FAIL: Post-git-init subchecks failed: ${failedSubChecks.join(', ')}`
  };

  // B-06: Runtime Fail-Closed & District Data Gate Verification (Canonical window.PMS_CLIENT_CONFIG Contract)
  let b06Pass = false;
  const b06Errors = [];
  try {
    const targetCfg = evaluateConfigJsFile(path.join(absTarget, 'data', 'config.js'));
    const apiPath = path.join(absTarget, 'active', 'h-app', 'modules', 'api.js');
    const managerPath = path.join(absTarget, 'active', 'manager', 'manager.js');
    const indexPath = path.join(absTarget, 'index.html');

    if (fs.existsSync(apiPath)) {
      const apiCode = fs.readFileSync(apiPath, 'utf8');
      if (!apiCode.includes('PMS_CLIENT_CONFIG.api.gasWebAppUrl')) {
        b06Errors.push('active/h-app/modules/api.js does not reference canonical PMS_CLIENT_CONFIG.api.gasWebAppUrl');
      } else {
        const executableApiSnippet = apiCode.replace(/^\s*export\s+/gm, '');
        const sandbox = { window: { PMS_CLIENT_CONFIG: targetCfg.raw } };
        vm.createContext(sandbox);
        let threwExpected = false;
        try {
          vm.runInContext(executableApiSnippet, sandbox, { timeout: 2000 });
        } catch (err) {
          if (err && String(err.message).includes('PMS_CLIENT_CONFIG.api.gasWebAppUrl')) {
            threwExpected = true;
          }
        }
        if (!threwExpected) {
          b06Errors.push('active/h-app/modules/api.js did not throw Fail-Closed error when PMS_CLIENT_CONFIG.api.gasWebAppUrl is empty');
        }
      }
    } else {
      b06Errors.push('active/h-app/modules/api.js missing');
    }

    if (fs.existsSync(managerPath)) {
      const mgrCode = fs.readFileSync(managerPath, 'utf8');
      if (!mgrCode.includes('PMS_CLIENT_CONFIG.api.gasWebAppUrl')) {
        b06Errors.push('active/manager/manager.js missing Fail-Closed PMS_CLIENT_CONFIG.api.gasWebAppUrl guard');
      }
    } else {
      b06Errors.push('active/manager/manager.js missing');
    }

    if (fs.existsSync(indexPath)) {
      const idxCode = fs.readFileSync(indexPath, 'utf8');
      if (!idxCode.includes('PMS_CLIENT_CONFIG.line.liffId')) {
        b06Errors.push('index.html missing Fail-Closed PMS_CLIENT_CONFIG.line.liffId guard');
      }
    } else {
      b06Errors.push('index.html missing');
    }

    const districtGatePath = path.join(absTarget, 'scripts', 'validate-district-data-gate.mjs');
    if (fs.existsSync(districtGatePath)) {
      const dgRes = runCommandSafe(process.execPath, [districtGatePath], { cwd: absTarget });
      if (dgRes.status !== 0) {
        b06Errors.push(`validate-district-data-gate.mjs exited with status ${dgRes.status}`);
      }
    }
  } catch (err) {
    b06Errors.push(err.message);
  }
  b06Pass = b06Errors.length === 0;
  checks.B06 = {
    pass: b06Pass,
    errors: b06Errors,
    message: b06Pass
      ? 'B-06 PASS: Runtime Fail-Closed guards (H-App API, Manager API, LIFF init) and District Data Gate verified.'
      : `B-06 FAIL: ${b06Errors.join('; ')}`
  };

  // B-07: Source Baseline Consistency
  const srcHeadNow = resolveCommitSha(absSource, 'HEAD');
  const srcStatusRes = runCommandSafe('git', ['status', '--porcelain'], { cwd: absSource });
  const srcStatusOut = (srcStatusRes.stdout || '').trim();
  const b07Pass = srcHeadNow === resolvedBaseline && srcStatusRes.status === 0 && srcStatusOut === '';
  checks.B07 = {
    pass: b07Pass,
    message: b07Pass
      ? `B-07 PASS: Source HEAD remains at ${resolvedBaseline.slice(0, 7)} with clean working tree.`
      : `B-07 FAIL: Source HEAD=${srcHeadNow} (expected ${resolvedBaseline}), statusClean=${srcStatusOut === ''}.`
  };

  // B-08: Source Connection Fingerprint Before === After (9 items)
  const manifest = safeParseJsonFile(path.join(absTarget, MANIFEST_FILENAME));
  const beforeFp = expectedSourceFingerprint || (manifest && manifest.sourceFingerprintBefore) || null;
  const afterFp = captureSourceConnectionFingerprint(absSource);
  const fpComparison = compareSourceFingerprints(beforeFp, afterFp);
  checks.B08 = {
    pass: fpComparison.match,
    diffs: fpComparison.diffs,
    sourceFingerprintAfter: afterFp,
    message: fpComparison.match
      ? 'B-08 PASS: SOURCE_FINGERPRINT_BEFORE === SOURCE_FINGERPRINT_AFTER across all 9 connection items.'
      : `B-08 FAIL: Source Connection Fingerprint mismatch: ${fpComparison.diffs.join(' | ')}`
  };

  const overallPass = Object.values(checks).every(c => c.pass);
  return {
    phase: 'B',
    pass: overallPass,
    checks
  };
}

// CLI Entrypoint
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const args = process.argv.slice(2);
  let sourceRoot = process.cwd();
  let targetRoot = null;
  let baselineSha = 'HEAD';
  let phase = 'ALL';
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source' && args[i + 1]) {
      sourceRoot = args[++i];
    } else if (arg === '--target' && args[i + 1]) {
      targetRoot = args[++i];
    } else if (arg === '--baseline' && args[i + 1]) {
      baselineSha = args[++i];
    } else if (arg === '--phase' && args[i + 1]) {
      phase = args[++i].toUpperCase();
    } else if (arg === '--json') {
      jsonOutput = true;
    }
  }

  if (!targetRoot) {
    console.error('🛑 [Hard Stop] Isolation Gate Failed: Missing required argument --target <ABSOLUTE_TARGET_PATH>.');
    process.exit(1);
  }
  if (!path.isAbsolute(targetRoot)) {
    console.error('🛑 [Hard Stop] Isolation Gate Failed: --target must be an absolute path.');
    process.exit(1);
  }

  try {
    if (phase === 'A') {
      const resA = runGateA({ sourceRoot, targetRoot, baselineSha });
      if (jsonOutput) {
        console.log(JSON.stringify(resA, null, 2));
      } else {
        for (const [k, v] of Object.entries(resA.checks)) {
          console.log(`[Gate A:${k}] ${v.message}`);
        }
      }
      process.exit(resA.pass ? 0 : 1);
    } else if (phase === 'B' || phase === 'ALL') {
      const resB = runGateB({ sourceRoot, targetRoot, baselineSha });
      if (jsonOutput) {
        console.log(JSON.stringify(resB, null, 2));
      } else {
        for (const [k, v] of Object.entries(resB.checks)) {
          console.log(`[Gate B:${k}] ${v.message}`);
        }
      }
      process.exit(resB.pass ? 0 : 1);
    } else {
      console.error(`🛑 [Hard Stop] Unknown --phase "${phase}". Expected A, B, or ALL.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`🛑 [Hard Stop] Isolation Gate Error: ${err.message}`);
    process.exit(1);
  }
}

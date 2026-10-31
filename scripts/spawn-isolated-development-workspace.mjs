import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILENAME,
  MANIFEST_MARKER_TYPE,
  captureSourceConnectionFingerprint,
  evaluateConfigJsFile,
  resolveCommitSha,
  runCommandSafe,
  runGateA,
  runGateB
} from './check-development-isolation-gate.mjs';

function resolveRealOrParentRealpath(targetPath) {
  const abs = path.resolve(targetPath);
  if (fs.existsSync(abs)) {
    return fs.realpathSync(abs);
  }
  const parentDir = path.dirname(abs);
  if (fs.existsSync(parentDir)) {
    return path.join(fs.realpathSync(parentDir), path.basename(abs));
  }
  return abs;
}

export function arePathsOverlappingOrEqual(pathA, pathB) {
  const realA = resolveRealOrParentRealpath(pathA);
  const realB = resolveRealOrParentRealpath(pathB);
  if (realA === realB) return true;
  const withSepA = realA.endsWith(path.sep) ? realA : `${realA}${path.sep}`;
  const withSepB = realB.endsWith(path.sep) ? realB : `${realB}${path.sep}`;
  return realA.startsWith(withSepB) || realB.startsWith(withSepA);
}

export function sanitizeConfigJsContent(rawText) {
  let updated = String(rawText);
  updated = updated.replace(/(gasWebAppUrl\s*:\s*)(['"`])[^'"`]*\2/g, '$1""');
  updated = updated.replace(/(liffId\s*:\s*)(['"`])[^'"`]*\2/g, '$1""');
  return updated;
}

export function spawnIsolatedWorkspace({
  sourceRoot = process.cwd(),
  targetRoot,
  baselineRef = 'HEAD',
  mode = 'final',
  runId = crypto.randomUUID()
}) {
  if (!targetRoot || typeof targetRoot !== 'string' || !path.isAbsolute(targetRoot)) {
    throw new Error('Fail-Closed: --target <ABSOLUTE_TARGET_PATH> must be a non-empty absolute path.');
  }
  if (mode !== 'proof' && mode !== 'final') {
    throw new Error(`Fail-Closed: Invalid --mode "${mode}". Must be "proof" or "final".`);
  }

  const absSource = path.resolve(sourceRoot);
  const absTarget = path.resolve(targetRoot);

  if (arePathsOverlappingOrEqual(absSource, absTarget)) {
    throw new Error('Fail-Closed: Target path must not equal or overlap (parent/child) with Source repository.');
  }

  if (mode === 'proof') {
    const baseName = path.basename(absTarget);
    if (!baseName.endsWith('-proof')) {
      throw new Error('Fail-Closed: In --mode proof, target directory basename must end with "-proof".');
    }
  }

  // Step 1: Source Precheck (READ ONLY) & Source Connection Fingerprint Capture
  const statusRes = runCommandSafe('git', ['status', '--porcelain'], { cwd: absSource });
  if (statusRes.status !== 0 || (statusRes.stdout || '').trim() !== '') {
    throw new Error('Fail-Closed: Source repository working tree is dirty. Clean working tree is strictly required before spawn.');
  }

  const headSha = resolveCommitSha(absSource, 'HEAD');
  const baselineSha = resolveCommitSha(absSource, baselineRef);
  if (headSha !== baselineSha) {
    throw new Error(`Fail-Closed: Source HEAD (${headSha.slice(0, 7)}) does not match requested baseline (${baselineSha.slice(0, 7)}).`);
  }

  const sourceFingerprintBefore = captureSourceConnectionFingerprint(absSource);

  // Step 2: Target Directory Creation & Empty Verification
  if (fs.existsSync(absTarget)) {
    const stat = fs.lstatSync(absTarget);
    if (!stat.isDirectory()) {
      throw new Error('Fail-Closed: Target path exists and is not a directory.');
    }
    const existingEntries = fs.readdirSync(absTarget);
    if (existingEntries.length > 0) {
      throw new Error(`Fail-Closed: Target directory is not empty (${existingEntries.length} entries found). Refusing to overwrite.`);
    }
  } else {
    fs.mkdirSync(absTarget, { recursive: true });
  }

  const realTarget = fs.realpathSync(absTarget);
  const realSource = fs.realpathSync(absSource);
  if (arePathsOverlappingOrEqual(realSource, realTarget)) {
    throw new Error('Fail-Closed: Resolved Target realpath overlaps with Source realpath.');
  }

  // Step 3: Clean Export via git archive <baselineSha> | tar -x -C <target> (shell: false)
  const archiveRes = runCommandSafe('git', ['archive', '--format=tar', baselineSha], {
    cwd: realSource,
    encoding: null
  });
  if (archiveRes.status !== 0 || !archiveRes.stdout || archiveRes.stdout.length === 0) {
    throw new Error(`Fail-Closed: git archive failed for baseline ${baselineSha}.`);
  }

  const tarRes = runCommandSafe('tar', ['-x', '-C', realTarget], {
    input: archiveRes.stdout
  });
  if (tarRes.status !== 0) {
    throw new Error(`Fail-Closed: tar extraction failed into target directory: ${tarRes.stderr || ''}`);
  }

  // Step 4: Target-Only Production Connection Sanitization (Canonical window.PMS_CLIENT_CONFIG Contract)
  const targetConfigPath = path.join(realTarget, 'data', 'config.js');
  if (!fs.existsSync(targetConfigPath)) {
    throw new Error('Fail-Closed: Exported target is missing data/config.js.');
  }
  const beforeTargetCfg = evaluateConfigJsFile(targetConfigPath);
  const rawConfig = fs.readFileSync(targetConfigPath, 'utf8');
  const sanitizedConfig = sanitizeConfigJsContent(rawConfig);
  fs.writeFileSync(targetConfigPath, sanitizedConfig, 'utf8');

  const evaluatedTargetCfg = evaluateConfigJsFile(targetConfigPath);
  if (evaluatedTargetCfg.gasWebAppUrl !== '' || evaluatedTargetCfg.liffId !== '') {
    throw new Error('Fail-Closed: Target data/config.js sanitization failed to clear PMS_CLIENT_CONFIG.api.gasWebAppUrl or PMS_CLIENT_CONFIG.line.liffId.');
  }
  if (
    typeof evaluatedTargetCfg.districtId !== 'string' ||
    evaluatedTargetCfg.districtId.trim() === '' ||
    evaluatedTargetCfg.districtId !== beforeTargetCfg.districtId
  ) {
    throw new Error('Fail-Closed: Target data/config.js PMS_CLIENT_CONFIG.districtId was lost or altered during sanitization.');
  }

  const targetCnamePath = path.join(realTarget, 'CNAME');
  fs.writeFileSync(targetCnamePath, '', 'utf8');

  const manifestPayload = {
    schemaVersion: '1.0',
    markerType: MANIFEST_MARKER_TYPE,
    mode,
    runId,
    spawnedAt: new Date().toISOString(),
    sourceBaselineSha: baselineSha,
    targetRealpath: realTarget,
    sourceFingerprintBefore,
    sanitizedFields: [
      'data/config.js:PMS_CLIENT_CONFIG.api.gasWebAppUrl',
      'data/config.js:PMS_CLIENT_CONFIG.line.liffId',
      'CNAME'
    ]
  };
  fs.writeFileSync(
    path.join(realTarget, MANIFEST_FILENAME),
    `${JSON.stringify(manifestPayload, null, 2)}\n`,
    'utf8'
  );

  // Step 5: Gate A (Pre-Git-Init Isolation Gate)
  const gateAResult = runGateA({
    sourceRoot: realSource,
    targetRoot: realTarget,
    baselineSha
  });
  if (!gateAResult.pass) {
    const failedKeys = Object.entries(gateAResult.checks)
      .filter(([, v]) => !v.pass)
      .map(([k, v]) => `${k}: ${v.message}`);
    throw new Error(`Fail-Closed: Gate A FAILED: ${failedKeys.join(' | ')}`);
  }

  // Step 6: New Independent Git Repository Initialization (Global Git Config Independent)
  let initRes = runCommandSafe('git', ['init', '-b', 'main'], { cwd: realTarget });
  if (initRes.status !== 0) {
    initRes = runCommandSafe('git', ['init'], { cwd: realTarget });
    if (initRes.status !== 0) {
      throw new Error(`Fail-Closed: git init failed in Target: ${initRes.stderr || ''}`);
    }
    runCommandSafe('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: realTarget });
  }

  const addRes = runCommandSafe('git', ['add', '-A'], { cwd: realTarget });
  if (addRes.status !== 0) {
    throw new Error(`Fail-Closed: git add -A failed in Target: ${addRes.stderr || ''}`);
  }

  const commitRes = runCommandSafe(
    'git',
    [
      '-c', 'user.name=POSTING MAP Isolation Agent',
      '-c', 'user.email=isolation-agent@posting-map.local',
      'commit',
      '-m', `chore(isolation): initialize isolated development workspace from ${baselineSha.slice(0, 7)}`
    ],
    { cwd: realTarget }
  );
  if (commitRes.status !== 0) {
    throw new Error(`Fail-Closed: Initial git commit failed in Target: ${commitRes.stderr || ''}`);
  }

  const targetInitialCommitSha = resolveCommitSha(realTarget, 'HEAD');

  // Step 7: Gate B (Post-Git-Init & Source Connection Fingerprint Exact Match Gate)
  const gateBResult = runGateB({
    sourceRoot: realSource,
    targetRoot: realTarget,
    baselineSha,
    expectedSourceFingerprint: sourceFingerprintBefore
  });
  if (!gateBResult.pass) {
    const failedKeys = Object.entries(gateBResult.checks)
      .filter(([, v]) => !v.pass)
      .map(([k, v]) => `${k}: ${v.message}`);
    throw new Error(`Fail-Closed: Gate B FAILED: ${failedKeys.join(' | ')}`);
  }

  return {
    pass: true,
    mode,
    runId,
    sourceBaselineSha: baselineSha,
    targetInitialCommitSha,
    targetRealpath: realTarget,
    sourceFingerprintBefore,
    sourceFingerprintAfter: gateBResult.checks.B08.sourceFingerprintAfter,
    gateA: gateAResult,
    gateB: gateBResult
  };
}

/**
 * Enforces the 7-condition Proof Target Cleanup Guard before deleting <PROOF_TARGET>.
 */
export function cleanupProofWorkspace({
  sourceRoot = process.cwd(),
  proofTarget,
  finalTarget,
  expectedRunId,
  expectedBaselineSha
}) {
  if (!proofTarget || !path.isAbsolute(proofTarget)) {
    throw new Error('Fail-Closed [Cleanup Guard]: Missing or non-absolute --target <PROOF_TARGET>.');
  }
  if (!finalTarget || !path.isAbsolute(finalTarget)) {
    throw new Error('Fail-Closed [Cleanup Guard]: Missing or non-absolute --final-target <FINAL_DEVELOPMENT_TARGET>.');
  }
  if (!expectedRunId || typeof expectedRunId !== 'string' || expectedRunId.trim().length < 8) {
    throw new Error('Fail-Closed [Cleanup Guard]: Missing or invalid --run-id <RUN_ID>.');
  }
  if (!expectedBaselineSha || typeof expectedBaselineSha !== 'string') {
    throw new Error('Fail-Closed [Cleanup Guard]: Missing --baseline <SOURCE_BASELINE_SHA>.');
  }

  if (!fs.existsSync(proofTarget)) {
    throw new Error('Fail-Closed [Cleanup Guard]: Proof target directory does not exist.');
  }
  if (!fs.existsSync(finalTarget)) {
    throw new Error('Fail-Closed [Cleanup Guard]: Final development target directory does not exist.');
  }

  const realSource = fs.realpathSync(path.resolve(sourceRoot));
  const realProof = fs.realpathSync(path.resolve(proofTarget));
  const realFinal = fs.realpathSync(path.resolve(finalTarget));
  const resolvedExpectedBaseline = resolveCommitSha(realSource, expectedBaselineSha);

  const manifestPath = path.join(realProof, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Fail-Closed [Cleanup Guard]: Missing ${MANIFEST_FILENAME} in Proof target.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Condition 1: markerType / mode match
  const cond1 = (
    manifest &&
    manifest.markerType === MANIFEST_MARKER_TYPE &&
    manifest.mode === 'proof'
  );
  if (!cond1) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 1]: Manifest markerType or mode !== "proof".');
  }

  // Condition 2: runId match
  const cond2 = manifest.runId === expectedRunId;
  if (!cond2) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 2]: Manifest runId does not match --run-id.');
  }

  // Condition 3: sourceBaselineSha match
  const cond3 = manifest.sourceBaselineSha === resolvedExpectedBaseline;
  if (!cond3) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 3]: Manifest sourceBaselineSha does not match --baseline.');
  }

  // Condition 4: targetPath realpath match
  const cond4 = manifest.targetRealpath === realProof;
  if (!cond4) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 4]: Manifest targetRealpath does not match Proof target realpath.');
  }

  // Condition 5: proof suffix match (-proof)
  const cond5 = path.basename(realProof).endsWith('-proof');
  if (!cond5) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 5]: Proof target directory basename does not end with "-proof".');
  }

  // Condition 6: Not identical or parent/child with Source
  const cond6 = !arePathsOverlappingOrEqual(realProof, realSource);
  if (!cond6) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 6]: Proof target overlaps with Source repository.');
  }

  // Condition 7: Not identical or parent/child with Final Development Target (and Final Target is verified mode="final")
  const finalManifestPath = path.join(realFinal, MANIFEST_FILENAME);
  let finalManifest = null;
  if (fs.existsSync(finalManifestPath)) {
    try {
      finalManifest = JSON.parse(fs.readFileSync(finalManifestPath, 'utf8'));
    } catch (_) {
      finalManifest = null;
    }
  }
  const cond7 = (
    !arePathsOverlappingOrEqual(realProof, realFinal) &&
    finalManifest &&
    finalManifest.markerType === MANIFEST_MARKER_TYPE &&
    finalManifest.mode === 'final' &&
    finalManifest.targetRealpath === realFinal
  );
  if (!cond7) {
    throw new Error('Fail-Closed [Cleanup Guard Condition 7]: Proof target overlaps with Final Development Target or Final Target manifest is not verified.');
  }

  fs.rmSync(realProof, { recursive: true, force: false });
  if (fs.existsSync(realProof)) {
    throw new Error('Fail-Closed [Cleanup Guard]: Proof target still exists after rmSync.');
  }

  return {
    cleaned: true,
    removedProofRealpath: realProof,
    preservedFinalRealpath: realFinal,
    conditionsVerified: 7
  };
}

// CLI Entrypoint
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const args = process.argv.slice(2);
  let isCleanupMode = false;
  let sourceRoot = process.cwd();
  let targetRoot = null;
  let finalTarget = null;
  let baselineRef = 'HEAD';
  let mode = 'final';
  let runId = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cleanup-proof') {
      isCleanupMode = true;
    } else if (arg === '--source' && args[i + 1]) {
      sourceRoot = args[++i];
    } else if (arg === '--target' && args[i + 1]) {
      targetRoot = args[++i];
    } else if (arg === '--final-target' && args[i + 1]) {
      finalTarget = args[++i];
    } else if (arg === '--baseline' && args[i + 1]) {
      baselineRef = args[++i];
    } else if (arg === '--mode' && args[i + 1]) {
      mode = args[++i];
    } else if (arg === '--run-id' && args[i + 1]) {
      runId = args[++i];
    }
  }

  try {
    if (isCleanupMode) {
      const cleanupRes = cleanupProofWorkspace({
        sourceRoot,
        proofTarget: targetRoot,
        finalTarget,
        expectedRunId: runId,
        expectedBaselineSha: baselineRef
      });
      console.log(`🟢 [Proof Cleanup] PASSED: Verified all ${cleanupRes.conditionsVerified} guard conditions and removed proof target.`);
      process.exit(0);
    } else {
      const spawnRes = spawnIsolatedWorkspace({
        sourceRoot,
        targetRoot,
        baselineRef,
        mode,
        runId
      });
      console.log(JSON.stringify({
        status: 'PASS',
        mode: spawnRes.mode,
        runId: spawnRes.runId,
        sourceBaselineSha: spawnRes.sourceBaselineSha,
        targetInitialCommitSha: spawnRes.targetInitialCommitSha,
        fingerprintMatch: true
      }, null, 2));
      process.exit(0);
    }
  } catch (err) {
    console.error(`🛑 [Hard Stop] Isolation Spawn Error: ${err.message}`);
    process.exit(1);
  }
}

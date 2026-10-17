import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkUniversalInvariants, extractDistrictTokens } from '../scripts/check-universal-invariants.mjs';
import { verifyAuditorGate } from '../scripts/check-auditor-gate.mjs';

console.log('====================================================');
console.log('🔬 INDEPENDENT AUDITOR EFFECTIVENESS REGRESSION SUITE');
console.log('   (Hermetic Synthetic Sentinels - Zero Real District Hardcodes)');
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

// Setup hermetic temporary directory with synthetic data/** fixtures
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditor-regression-'));
const synthDataDir = path.join(tempDir, 'data');
fs.mkdirSync(synthDataDir, { recursive: true });

try {
  // 1. Synthetic data/config.js
  fs.writeFileSync(
    path.join(synthDataDir, 'config.js'),
    `window.PMS_CLIENT_CONFIG = { districtId: "TEST-DISTRICT-A" };\n`
  );

  // 2. Synthetic data/election_history.json
  fs.writeFileSync(
    path.join(synthDataDir, 'election_history.json'),
    JSON.stringify({
      districtId: 'TEST-DISTRICT-A',
      districtName: 'TEST-DISTRICT-NAME-A',
      elections: []
    }, null, 2)
  );

  // 3. Synthetic data/municipality_master.csv
  fs.writeFileSync(
    path.join(synthDataDir, 'municipality_master.csv'),
    'city_name,city_code,total_towns\nTEST-MUNICIPALITY-A,12345,10\nTEST-MUNICIPALITY-B,67890,20\n'
  );

  runTest('T1: SSOT Dynamic Token Extraction (Synthetic Sentinels)', () => {
    const tokens = extractDistrictTokens(synthDataDir);
    assert.ok(tokens.includes('TEST-DISTRICT-A'));
    assert.ok(tokens.includes('TEST-DISTRICT-NAME-A'));
    assert.ok(tokens.includes('TEST-MUNICIPALITY-A'));
    assert.ok(tokens.includes('TEST-MUNICIPALITY-B'));
    assert.ok(tokens.includes('12345'));
    assert.ok(tokens.includes('67890'));
  });

  runTest('T2: Failure A — Synthetic District Literal in Test Fixture triggers Scanner FAIL', () => {
    const dirtyTestPath = path.join(tempDir, 'test_dirty_phase.mjs');
    fs.writeFileSync(dirtyTestPath, `
      import assert from 'node:assert';
      // Regression bug: hardcoding synthetic district identifier directly in test
      assert.ok(!content.includes("TEST-DISTRICT-A-INVALID"), "checking district");
    `);

    const res = checkUniversalInvariants({
      changedFiles: [dirtyTestPath],
      baseDir: tempDir,
      dataDir: synthDataDir
    });

    assert.equal(res.pass, false);
    assert.ok(res.violations.length >= 1);
    assert.equal(res.violations[0].token, 'TEST-DISTRICT-A');
    assert.match(res.violations[0].snippet, /TEST-DISTRICT-A/);
  });

  runTest('T3: Failure A — Synthetic Municipality Code Hardcoded in Script triggers Scanner FAIL', () => {
    const dirtyScriptPath = path.join(tempDir, 'dirty_script.mjs');
    fs.writeFileSync(dirtyScriptPath, `
      const targetCode = 12345;
      console.log("Processing code:", targetCode);
    `);

    const res = checkUniversalInvariants({
      changedFiles: [dirtyScriptPath],
      baseDir: tempDir,
      dataDir: synthDataDir
    });

    assert.equal(res.pass, false);
    assert.ok(res.violations.length >= 1);
    assert.equal(res.violations[0].token, '12345');
  });

  runTest('T4: Boundary Robustness — Long Hex Hashes and Unrelated Identifiers do NOT False-Positive', () => {
    const cleanHashPath = path.join(tempDir, 'clean_hashes.mjs');
    fs.writeFileSync(cleanHashPath, `
      // Commit hash containing target code inside longer alphanumeric sequence
      const commitA = "a12345f7890b0c";
      // Variable name with suffix
      const varName = "PREFIX_1234567_SUFFIX";
      const districtSuperSet = "TEST-DISTRICT-ALL";
    `);

    const res = checkUniversalInvariants({
      changedFiles: [cleanHashPath],
      baseDir: tempDir,
      dataDir: synthDataDir
    });

    assert.equal(res.pass, true);
    assert.equal(res.violations.length, 0);
  });

  runTest('T5: Failure B — Mechanical Test PASS without Semantic Review Evidence is REJECTED by Auditor Gate', () => {
    const B1 = '1111111';
    const T1 = '2222222';
    const AUD_CONV = 'a1234567-89ab-cdef-0123-456789abcdef';

    // Mock transcript where Auditor only executed npm test / git diff / check-scope,
    // but omitted Semantic Review (Full-File & Diff Review, Universal Invariants & Falsification)
    const transcriptLines = [
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{
          name: 'invoke_subagent',
          args: {
            Subagents: JSON.stringify([{
              Model: 'inherit',
              Role: 'Independent Auditor',
              Prompt: `Base Commit: ${B1}\nTarget Commit: ${T1}\nScope: test.mjs`
            }])
          }
        }]
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created the following subagents:\n{\n  "conversationId": "${AUD_CONV}"\n}`
      }),
      JSON.stringify({
        step_index: 3,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        content: `<SYSTEM_MESSAGE>\n[Message] sender=${AUD_CONV} content=[AUDITOR VERDICT]\nBase Commit: ${B1}\nTarget Commit: ${T1}\nApproved Scope: VERIFIED\nIndependent Commands Executed:\n- git diff: executed (PASS)\n- npm test: executed (PASS)\n- node scripts/check-scope.mjs: executed (PASS)\nBlocking Findings: none\nFinal Verdict: PASS\n</SYSTEM_MESSAGE>`
      })
    ];

    const mockGit = (ref) => {
      if (ref === B1) return '1111111111111111111111111111111111111111';
      if (ref === T1) return '2222222222222222222222222222222222222222';
      return ref + '000000000000000000000000000000000';
    };
    const mockDiff = () => ['test.mjs'];

    const res = verifyAuditorGate({
      baseCommit: B1,
      targetCommit: T1,
      transcriptLines,
      gitResolver: mockGit,
      diffResolver: mockDiff
    });

    assert.equal(res.pass, false);
    assert.match(res.error, /missing mandatory semantic review evidence/i);
    assert.match(res.error, /Full-File & Diff Review/);
    assert.match(res.error, /Universal Invariants & Falsification/);
  });

  runTest('T6: Success — Dynamic Derivation and Complete Semantic Review PASSES both Scanner and Gate', () => {
    // 1. Clean dynamic fixture
    const cleanDynamicPath = path.join(tempDir, 'clean_dynamic.mjs');
    fs.writeFileSync(cleanDynamicPath, `
      import fs from 'node:fs';
      // Dynamic derivation from data SSOT without hardcoded literals
      const munData = fs.readFileSync('data/municipality_master.csv', 'utf8');
      const config = fs.readFileSync('data/config.js', 'utf8');
    `);

    const scannerRes = checkUniversalInvariants({
      changedFiles: [cleanDynamicPath],
      baseDir: tempDir,
      dataDir: synthDataDir
    });

    assert.equal(scannerRes.pass, true);
    assert.equal(scannerRes.violations.length, 0);

    // 2. Complete Auditor Verdict with Semantic Review
    const B1 = '1111111';
    const T1 = '2222222';
    const AUD_CONV = 'a1234567-89ab-cdef-0123-456789abcdef';

    const transcriptLines = [
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{
          name: 'invoke_subagent',
          args: {
            Subagents: JSON.stringify([{
              Model: 'inherit',
              Role: 'Independent Auditor',
              Prompt: `Base Commit: ${B1}\nTarget Commit: ${T1}\nScope: test.mjs`
            }])
          }
        }]
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created the following subagents:\n{\n  "conversationId": "${AUD_CONV}"\n}`
      }),
      JSON.stringify({
        step_index: 3,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        content: `<SYSTEM_MESSAGE>\n[Message] sender=${AUD_CONV} content=[AUDITOR VERDICT]\nBase Commit: ${B1}\nTarget Commit: ${T1}\nApproved Scope: VERIFIED\nSemantic Review:\n- Full-File & Diff Review: executed (PASS)\n- Universal Invariants & Falsification: verified (PASS)\nIndependent Commands Executed:\n- git diff: executed (PASS)\n- npm test: executed (PASS)\n- node scripts/check-scope.mjs: executed (PASS)\nBlocking Findings: none\nFinal Verdict: PASS\n</SYSTEM_MESSAGE>`
      })
    ];

    const mockGit = (ref) => {
      if (ref === B1) return '1111111111111111111111111111111111111111';
      if (ref === T1) return '2222222222222222222222222222222222222222';
      return ref + '000000000000000000000000000000000';
    };
    const mockDiff = () => ['test.mjs'];

    const gateRes = verifyAuditorGate({
      baseCommit: B1,
      targetCommit: T1,
      transcriptLines,
      gitResolver: mockGit,
      diffResolver: mockDiff
    });

    assert.equal(gateRes.pass, true);
    assert.equal(gateRes.chain.verdict, 'PASS');
  });

} finally {
  // Clean up temporary synthetic directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}
}

console.log('====================================================');
console.log(`📊 REGRESSION SUITE SUMMARY: ${passedCount} / ${totalCount} PASSED (100%)`);
console.log('====================================================\n');

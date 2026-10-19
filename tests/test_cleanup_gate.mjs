import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCleanupGate, resolveTranscriptPath } from '../scripts/check-cleanup-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('🛡️ STEP 9 CLEANUP DISPATCH COMPLETION GATE TEST SUITE');
console.log('====================================================');

// ダミー gitResolver (決定論的テスト用)
const mockGitResolver = (ref) => {
  const table = {
    'BASE_001': '1111111111111111111111111111111111111111',
    'TARGET_001': '2222222222222222222222222222222222222222',
    'TARGET_002': '3333333333333333333333333333333333333333',
    'OLD_TARGET': '9999999999999999999999999999999999999999'
  };
  if (table[ref]) return table[ref];
  if (/^[a-f0-9]{40}$/.test(ref)) return ref;
  if (/^[a-f0-9]{7}$/.test(ref)) return ref + '000000000000000000000000000000000';
  throw new Error(`Invalid git ref: ${ref}`);
};

const B1 = '1111111';
const T1 = '2222222';
const T2 = '3333333';
const CHILD_CONV = '9677b677-121f-4a72-9579-3702fea81271';

function makeEventA(step, base, target, withDiff = true) {
  return JSON.stringify({
    step_index: step,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    tool_calls: [{
      name: 'invoke_subagent',
      args: {
        Subagents: JSON.stringify([{
          Model: 'inherit',
          Role: 'Residual Cleanup Auditor',
          Prompt: `Base Commit: ${base}\nTarget Commit: ${target}\n${withDiff ? 'APPROVED_DIFF: dummy diff' : ''}`
        }]),
        toolAction: 'Invoking Residual Cleanup Auditor'
      }
    }]
  });
}

function makeEventB(step, convId) {
  return JSON.stringify({
    step_index: step,
    source: 'MODEL',
    type: 'GENERIC',
    content: `Created At: 2026-10-09\nCreated the following subagents:\n{\n  "conversationId": "${convId}"\n}`
  });
}

function makeEventC(step, sender, base, target, delCount, verdict, source = 'SYSTEM', type = 'SYSTEM_MESSAGE', govCount = 0) {
  const govLine = (govCount !== null && govCount !== undefined) ? `GOVERNANCE-RESIDUAL: ${govCount}件\n` : '';
  return JSON.stringify({
    step_index: step,
    source,
    type,
    content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-09T04:16:54Z sender=${sender} priority=MESSAGE_PRIORITY_HIGH content=[CLEANUP REPORT]\nAudited Mission: Test\nBase Commit: ${base}\nTarget Commit: ${target}\n--- SUMMARY ---\nDELETE-CANDIDATE: ${delCount}件\n${govLine}Overall Verdict: ${verdict}\n</SYSTEM_MESSAGE>`
  });
}

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

// ─────────────────────────────────────────────────────────────
// 反例テスト (N1 - N15)
// ─────────────────────────────────────────────────────────────

runTest('N1: stale Cleanup Report (古いステップでの発生)', () => {
  // 順序が逆転している異常系 (stepC < stepA)
  const lines = [
    makeEventC(10, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED'),
    makeEventA(20, B1, T1),
    makeEventB(21, CHILD_CONV)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
});

runTest('N2: 別MissionのCleanup Report (Commit範囲不一致)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, 'OTHER_BASE', 'OTHER_TARGET', 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.match(res.error, /commit range does not match/);
});

runTest('N3: Event A 三者不一致 (Prompt内コミット指定不一致)', () => {
  const lines = [
    makeEventA(10, 'WRONG_BASE', T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
});

runTest('N4: 親Execution貼付の偽Report (source: MODEL)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'MODEL', 'PLANNER_RESPONSE')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
});

runTest('N5: MASTER貼付の偽Report (source: USER_EXPLICIT)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'USER_EXPLICIT', 'USER_INPUT')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
});

runTest('N6: wrong child conversationId (未承認 Worker ID)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, 'UNAUTHORIZED_CONVERSATION_ID', B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
});

runTest('N7: multi-commit 最終非product (Stage 9 必須強制・未監査拒否)', () => {
  const lines = [
    // invoke_subagent が存在しない状態
    JSON.stringify({ step_index: 10, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'docs updated' })
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.match(res.error, /NOT invoked/);
});

runTest('N8: 古い成功へのfallback禁止 (最新チェーン評価原則)', () => {
  const lines = [
    // 1回目: 過去の成功チェーン
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED'),
    // 2回目: 最新のチェーンで残骸 2件検出
    makeEventA(20, B1, T1),
    makeEventB(21, 'new-child-id-999'),
    makeEventC(22, 'new-child-id-999', B1, T1, 2, 'CLEANUP_RECOMMENDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.equal(res.deleteCandidates, 2);
  assert.match(res.error, /DELETE-CANDIDATE: 2 detected/);
});

runTest('N9: ANTIGRAVITY_APP_DATA_DIR 欠損 (Fail-Closed)', () => {
  assert.throws(() => {
    resolveTranscriptPath({ ANTIGRAVITY_APP_DATA_DIR: '', ANTIGRAVITY_CONVERSATION_ID: 'conv-123' });
  }, /Missing required environment variable ANTIGRAVITY_APP_DATA_DIR/);
});

runTest('N10: ANTIGRAVITY_CONVERSATION_ID 欠損 (Fail-Closed)', () => {
  assert.throws(() => {
    resolveTranscriptPath({ ANTIGRAVITY_APP_DATA_DIR: '/some/dir', ANTIGRAVITY_CONVERSATION_ID: '' });
  }, /Missing required environment variable ANTIGRAVITY_CONVERSATION_ID/);
});

runTest('N11: transcript ファイル不存在 (Fail-Closed)', () => {
  assert.throws(() => {
    resolveTranscriptPath({ ANTIGRAVITY_APP_DATA_DIR: '/non/existent/path', ANTIGRAVITY_CONVERSATION_ID: 'conv-missing' });
  }, /Transcript file not found/);
});

runTest('N12: JSONL 構文破損 (Fail-Closed)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    '{ malformed json entry :::'
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.match(res.error, /Malformed JSONL entry/);
});

runTest('N13: DELETE-CANDIDATE 0 かつ Overall Verdict 不一致 (FAIL)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'REJECT')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.match(res.error, /Overall Verdict is 'REJECT'\. Expected NO_CLEANUP_NEEDED/);
});

runTest('N14: CLI --target 未指定時の拒否 (Fail-Closed)', () => {
  // 1. verifyCleanupGate 直接呼出しにおける targetCommit 欠損
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: '', transcriptLines: [] });
  assert.equal(res.pass, false);
  assert.match(res.error, /Missing required targetCommit/);

  // 2. CLI 実行における --target 未指定
  const cliRes = spawnSync(process.execPath, ['scripts/check-cleanup-gate.mjs', '--base', B1], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(cliRes.status, 1);
  assert.match(cliRes.stderr || cliRes.stdout, /Missing required argument: --target/);
});

runTest('N15: Event A 直後に無関係なGENERIC介在 (Event B 相関 Fail-Closed)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    // step 11: 無関係な GENERIC (例: run_command 実行結果など)
    JSON.stringify({
      step_index: 11,
      source: 'MODEL',
      type: 'GENERIC',
      content: 'Command executed successfully.'
    }),
    // step 12: 後から来た Event B (stepIndex !== stepA + 1 のため無効)
    makeEventB(12, CHILD_CONV),
    // step 13: Event C
    makeEventC(13, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.match(res.error, /Cleanup Worker .* was NOT invoked/);
});

// ─────────────────────────────────────────────────────────────
// 正常系テスト (P1 - P3)
// ─────────────────────────────────────────────────────────────

runTest('P1: Cleanup後の再Stage9 (累積全差分 B1..T2 での合格)', () => {
  const lines = [
    // 1回目 (B1..T1): 残骸 1件検出
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 1, 'CLEANUP_RECOMMENDED'),
    // 2回目 (累積範囲 B1..T2): 削除完了後、0件残骸
    makeEventA(20, B1, T2),
    makeEventB(21, 're-audit-child-888'),
    makeEventC(22, 're-audit-child-888', B1, T2, 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T2, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, true);
  assert.equal(res.chain.deleteCandidates, 0);
  assert.equal(res.chain.verdict, 'NO_CLEANUP_NEEDED');
});

runTest('P2: 正常完了パス (三者完全一致 & 0件残骸での合格)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, true);
  assert.equal(res.chain.deleteCandidates, 0);
  assert.equal(res.chain.verdict, 'NO_CLEANUP_NEEDED');
});

runTest('P3: 非プロダクト変更でも監査実施合格 (全Mission一律執行の検証)', () => {
  // ドキュメントや設定のみの変更でも Cleanup Worker が起動され 0件報告を返せば合格
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, true);
});

// ─────────────────────────────────────────────────────────────
// GOVERNANCE-RESIDUAL 追加検証 (N16 - N20, P4)
// ─────────────────────────────────────────────────────────────

runTest('N16: GOVERNANCE-RESIDUAL 欠損 (FAIL)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', null)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.match(res.error, /does not contain a valid GOVERNANCE-RESIDUAL count/);
});

runTest('N17: GOVERNANCE-RESIDUAL > 0 (FAIL)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', 1)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.equal(res.governanceResiduals, 1);
  assert.match(res.error, /GOVERNANCE-RESIDUAL: 1 detected/);
});

runTest('N18: DELETE 0 / GOV > 0 (FAIL)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', 3)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.equal(res.governanceResiduals, 3);
  assert.match(res.error, /GOVERNANCE-RESIDUAL: 3 detected/);
});

runTest('N19: DELETE > 0 / GOV 0 (FAIL)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 2, 'CLEANUP_RECOMMENDED', 'SYSTEM', 'SYSTEM_MESSAGE', 0)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.equal(res.deleteCandidates, 2);
  assert.match(res.error, /DELETE-CANDIDATE: 2 detected/);
});

runTest('N20: stale clean report fallback禁止 (最新がGOV > 0)', () => {
  const lines = [
    // 1回目: 過去の合格レポート
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', 0),
    // 2回目: 最新レポートで GOV > 0
    makeEventA(20, B1, T1),
    makeEventB(21, 'latest-child-777'),
    makeEventC(22, 'latest-child-777', B1, T1, 0, 'CLEANUP_RECOMMENDED', 'SYSTEM', 'SYSTEM_MESSAGE', 2)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, false);
  assert.equal(res.governanceResiduals, 2);
  assert.match(res.error, /GOVERNANCE-RESIDUAL: 2 detected/);
});

runTest('P4: both zero only PASS (DELETE 0 / GOV 0 合格)', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', 0)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, true);
  assert.equal(res.chain.deleteCandidates, 0);
  assert.equal(res.chain.governanceResiduals, 0);
  assert.equal(res.chain.verdict, 'NO_CLEANUP_NEEDED');
});

// ─────────────────────────────────────────────────────────────
// Event B 単数/複数互換性 & 反例厳格検証 (GOVERNANCE-GATE-001)
// ─────────────────────────────────────────────────────────────

runTest('P5: Cleanup Event B — singular ("Created the following subagent:") => PASS', () => {
  const lines = [
    makeEventA(10, B1, T1),
    JSON.stringify({
      step_index: 11,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      content: `Created At: 2026-10-20\nCreated the following subagent:\n{\n  "conversationId": "${CHILD_CONV}"\n}`
    }),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', 0)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, true);
  assert.equal(res.chain.childConversationId, CHILD_CONV);
  assert.equal(res.chain.verdict, 'NO_CLEANUP_NEEDED');
});

runTest('P6: Cleanup Event B — plural ("Created the following subagents:") => PASS', () => {
  const lines = [
    makeEventA(10, B1, T1),
    makeEventB(11, CHILD_CONV),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED', 'SYSTEM', 'SYSTEM_MESSAGE', 0)
  ];
  const res = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: lines, gitResolver: mockGitResolver });
  assert.equal(res.pass, true);
  assert.equal(res.chain.childConversationId, CHILD_CONV);
  assert.equal(res.chain.verdict, 'NO_CLEANUP_NEEDED');
});

runTest('N21: Cleanup Event B — counterexamples (malformed Event B / missing colon / missing conversationId / non-immediate) => FAIL', () => {
  // 1. malformed Event B ("Created some subagent:")
  const linesMalformed = [
    makeEventA(10, B1, T1),
    JSON.stringify({
      step_index: 11,
      source: 'MODEL',
      type: 'GENERIC',
      content: `Created At: 2026-10-20\nCreated some subagent:\n{\n  "conversationId": "${CHILD_CONV}"\n}`
    }),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const resMalformed = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: linesMalformed, gitResolver: mockGitResolver });
  assert.equal(resMalformed.pass, false);

  // 2. missing canonical colon ("Created the following subagent")
  const linesNoColon = [
    makeEventA(10, B1, T1),
    JSON.stringify({
      step_index: 11,
      source: 'MODEL',
      type: 'GENERIC',
      content: `Created At: 2026-10-20\nCreated the following subagent\n{\n  "conversationId": "${CHILD_CONV}"\n}`
    }),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const resNoColon = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: linesNoColon, gitResolver: mockGitResolver });
  assert.equal(resNoColon.pass, false);

  // 3. missing conversationId
  const linesNoConvId = [
    makeEventA(10, B1, T1),
    JSON.stringify({
      step_index: 11,
      source: 'MODEL',
      type: 'GENERIC',
      content: `Created At: 2026-10-20\nCreated the following subagent:\n{\n  "status": "ok"\n}`
    }),
    makeEventC(12, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const resNoConvId = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: linesNoConvId, gitResolver: mockGitResolver });
  assert.equal(resNoConvId.pass, false);

  // 4. non-immediate Event B (stepB !== stepA + 1)
  const linesNonImmediate = [
    makeEventA(10, B1, T1),
    JSON.stringify({
      step_index: 12,
      source: 'MODEL',
      type: 'GENERIC',
      content: `Created At: 2026-10-20\nCreated the following subagent:\n{\n  "conversationId": "${CHILD_CONV}"\n}`
    }),
    makeEventC(13, CHILD_CONV, B1, T1, 0, 'NO_CLEANUP_NEEDED')
  ];
  const resNonImmediate = verifyCleanupGate({ baseCommit: B1, targetCommit: T1, transcriptLines: linesNonImmediate, gitResolver: mockGitResolver });
  assert.equal(resNonImmediate.pass, false);
});

console.log('====================================================');
console.log(`📊 CLEANUP GATE TESTS SUMMARY: ${passedCount} / ${totalCount} PASSED (100%)`);
console.log('====================================================\n');

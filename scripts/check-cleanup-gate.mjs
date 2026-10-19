import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();

function exitFail(message) {
  console.error(`\n🛑 [Hard Stop] Cleanup Gate FAILED: ${message}`);
  process.exit(1);
}

function exitPass(message) {
  console.log(`\n🟢 [Cleanup Gate] PASSED: ${message}`);
  process.exit(0);
}

/**
 * Transcript パス解決ヘルパー (Fail-Closed 環境変数検証)
 */
export function resolveTranscriptPath(env = process.env) {
  const appDataDir = env.ANTIGRAVITY_APP_DATA_DIR;
  const convId = env.ANTIGRAVITY_CONVERSATION_ID;

  if (!appDataDir || !appDataDir.trim()) {
    throw new Error('Fail-Closed: Missing required environment variable ANTIGRAVITY_APP_DATA_DIR.');
  }
  if (!convId || !convId.trim()) {
    throw new Error('Fail-Closed: Missing required environment variable ANTIGRAVITY_CONVERSATION_ID.');
  }

  const transcriptPath = path.join(appDataDir, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');

  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Fail-Closed: Transcript file not found at ${transcriptPath}`);
  }

  return transcriptPath;
}

/**
 * 構造化相関チェーン検証コアロジック (Unit/Negative Test からも直接呼び出し可能)
 */
export function verifyCleanupGate({
  baseCommit,
  targetCommit,
  transcriptLines,
  gitResolver = null
}) {
  if (!baseCommit || typeof baseCommit !== 'string') {
    return { pass: false, error: 'Missing required baseCommit (--base <ORIGINAL_BASE>)' };
  }
  if (!targetCommit || typeof targetCommit !== 'string') {
    return { pass: false, error: 'Missing required targetCommit (--target <TARGET>)' };
  }

  // 1. コミット解決
  const resolveHash = gitResolver || ((ref) => {
    try {
      return execSync(`git rev-parse --verify "${ref}^{commit}"`, { cwd: rootDir }).toString().trim();
    } catch (e) {
      throw new Error(`Invalid git commit reference: ${ref}`);
    }
  });

  let fullBase, fullTarget;
  try {
    fullBase = resolveHash(baseCommit);
    fullTarget = resolveHash(targetCommit);
  } catch (e) {
    return { pass: false, error: e.message };
  }

  const shortBase = fullBase.substring(0, 7);
  const shortTarget = fullTarget.substring(0, 7);

  // 2. Transcript 行の走査・相関チェーン抽出
  if (!Array.isArray(transcriptLines)) {
    return { pass: false, error: 'transcriptLines must be an array of JSON strings' };
  }

  const invocationChains = [];
  let pendingInvocation = null;
  let pendingToolResult = null;

  for (let idx = 0; idx < transcriptLines.length; idx++) {
    const rawLine = transcriptLines[idx].trim();
    if (!rawLine) continue;

    let entry;
    try {
      entry = JSON.parse(rawLine);
    } catch (e) {
      return { pass: false, error: `Malformed JSONL entry at line ${idx + 1}: ${e.message}` };
    }

    const stepIndex = entry.step_index !== undefined ? entry.step_index : idx;

    // --- Event A: invoke_subagent tool_call ---
    if (entry.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE' && entry.tool_calls) {
      if (pendingInvocation) {
        pendingInvocation = null; // 直後に Event B を得られなかったため破棄 (Fail-Closed)
      }
      for (const tc of entry.tool_calls) {
        if (tc.name === 'invoke_subagent' && tc.args) {
          const rawArgs = JSON.stringify(tc.args);
          const isCleanupAuditor = rawArgs.includes('Residual Cleanup Auditor') || rawArgs.includes('残骸監査専任プロファイル');

          if (isCleanupAuditor) {
            // Event A Prompt 内の三者バインド確認 (ORIGINAL_BASE, TARGET, APPROVED_DIFF)
            const hasBase = rawArgs.includes(shortBase) || rawArgs.includes(fullBase) || rawArgs.includes(baseCommit);
            const hasTarget = rawArgs.includes(shortTarget) || rawArgs.includes(fullTarget) || rawArgs.includes(targetCommit);
            const hasDiff = rawArgs.includes('APPROVED_DIFF') || rawArgs.includes('確定差分');

            pendingInvocation = {
              stepA: stepIndex,
              hasBase,
              hasTarget,
              hasDiff,
              rawArgs
            };
            pendingToolResult = null;
          }
        }
      }
      continue;
    }

    // --- Event B: invoke_subagent tool_result ---
    // ※実Transcript schema準拠: Event A の直後ステップ (stepB === stepA + 1) かつ MODEL/GENERIC のみ受理
    if (pendingInvocation) {
      const isImmediateStep = (stepIndex === pendingInvocation.stepA + 1);
      const isEventBFormat = (
        entry.source === 'MODEL' &&
        entry.type === 'GENERIC' &&
        (entry.status === undefined || entry.status === 'DONE') &&
        entry.content &&
        /Created the following subagents?:/.test(entry.content)
      );

      if (isImmediateStep && isEventBFormat) {
        const matchConv = entry.content.match(/"conversationId":\s*"([^"]+)"/);
        if (matchConv) {
          pendingToolResult = {
            stepB: stepIndex,
            childConversationId: matchConv[1],
            invocation: pendingInvocation
          };
          pendingInvocation = null; // matched
          continue;
        }
      }

      // 直後で不一致、または別イベントが介在した場合は直ちに破棄 (Fail-Closed)
      pendingInvocation = null;
      continue;
    }

    // --- Event C: child Worker incoming message ---
    // ※親Execution (source: MODEL) や MASTER (source: USER_EXPLICIT) を物理排除
    if (pendingToolResult && entry.source === 'SYSTEM' && entry.type === 'SYSTEM_MESSAGE' && entry.content) {
      const content = entry.content;
      if (content.includes('[CLEANUP REPORT]')) {
        // sender 抽出
        const matchSender = content.match(/\[Message\].*sender=([^\s]+)/);
        const sender = matchSender ? matchSender[1] : null;

        if (sender && sender === pendingToolResult.childConversationId) {
          // Report 内の Base / Target commit 抽出
          const matchBase = content.match(/Base Commit:\s*([a-f0-9]+)/i);
          const matchTarget = content.match(/Target Commit:\s*([a-f0-9]+)/i);
          const repBase = matchBase ? matchBase[1] : null;
          const repTarget = matchTarget ? matchTarget[1] : null;

          const reportBaseMatches = repBase && (fullBase.startsWith(repBase) || repBase.startsWith(shortBase));
          const reportTargetMatches = repTarget && (fullTarget.startsWith(repTarget) || repTarget.startsWith(shortTarget));

          // 候補数・判定抽出
          const matchDel = content.match(/DELETE-CANDIDATE:\s*(\d+)/i);
          const matchGov = content.match(/GOVERNANCE-RESIDUAL:\s*(\d+)/i);
          const matchVer = content.match(/Overall Verdict:\s*([A-Za-z_]+)/i);

          const chain = {
            stepA: pendingToolResult.invocation.stepA,
            stepB: pendingToolResult.stepB,
            stepC: stepIndex,
            childConversationId: sender,
            promptHasBase: pendingToolResult.invocation.hasBase,
            promptHasTarget: pendingToolResult.invocation.hasTarget,
            promptHasDiff: pendingToolResult.invocation.hasDiff,
            reportBaseMatches,
            reportTargetMatches,
            deleteCandidates: matchDel ? parseInt(matchDel[1], 10) : null,
            governanceResiduals: matchGov ? parseInt(matchGov[1], 10) : null,
            verdict: matchVer ? matchVer[1] : null,
            fullReportText: content
          };

          invocationChains.push(chain);
          pendingToolResult = null; // chain completed
        }
      }
    }
  }

  // 3. チェーン評価 (指定 BASE/TARGET に対する最新 Invocation Chain 評価原則)
  if (invocationChains.length === 0) {
    if (pendingInvocation && !pendingToolResult) {
      return { pass: false, error: 'Cleanup Worker was invoked, but tool result (conversationId) was not received.' };
    }
    if (pendingToolResult) {
      return { pass: false, error: `Waiting for [CLEANUP REPORT] from child Worker (${pendingToolResult.childConversationId}).` };
    }
    return { pass: false, error: `Cleanup Worker (Residual Cleanup Auditor Profile) was NOT invoked for range ${shortBase}..${shortTarget}.` };
  }

  // 最も新しいチェーンを取得 (古い成功チェーンへのフォールバック禁止)
  const latestChain = invocationChains[invocationChains.length - 1];

  // 順序の厳格検証 (stepA < stepB < stepC)
  if (!(latestChain.stepA < latestChain.stepB && latestChain.stepB < latestChain.stepC)) {
    return { pass: false, error: `Invalid event sequence in transcript: stepA (${latestChain.stepA}) < stepB (${latestChain.stepB}) < stepC (${latestChain.stepC}) violated.` };
  }

  // 三者完全一致の検証
  if (!latestChain.promptHasBase || !latestChain.promptHasTarget) {
    return { pass: false, error: `Event A invocation prompt did not bind exact BASE (${shortBase}) or TARGET (${shortTarget}).` };
  }
  if (!latestChain.promptHasDiff) {
    return { pass: false, error: 'Event A invocation prompt did not include APPROVED_DIFF.' };
  }
  if (!latestChain.reportBaseMatches || !latestChain.reportTargetMatches) {
    return { pass: false, error: `Event C report commit range does not match requested range ${shortBase}..${shortTarget}.` };
  }

  // 残骸判定
  if (latestChain.deleteCandidates === null) {
    return { pass: false, error: '[CLEANUP REPORT] does not contain a valid DELETE-CANDIDATE count.' };
  }
  if (latestChain.governanceResiduals === null) {
    return { pass: false, error: '[CLEANUP REPORT] does not contain a valid GOVERNANCE-RESIDUAL count.' };
  }
  if (latestChain.deleteCandidates > 0) {
    return {
      pass: false,
      deleteCandidates: latestChain.deleteCandidates,
      governanceResiduals: latestChain.governanceResiduals,
      error: `DELETE-CANDIDATE: ${latestChain.deleteCandidates} detected. Mission CANNOT be CLOSED. MASTER approval required for cleanup cycle.`
    };
  }
  if (latestChain.governanceResiduals > 0) {
    return {
      pass: false,
      deleteCandidates: latestChain.deleteCandidates,
      governanceResiduals: latestChain.governanceResiduals,
      error: `GOVERNANCE-RESIDUAL: ${latestChain.governanceResiduals} detected. Mission CANNOT be CLOSED. MASTER approval required for governance remediation cycle.`
    };
  }
  if (latestChain.verdict !== 'NO_CLEANUP_NEEDED') {
    return { pass: false, error: `Overall Verdict is '${latestChain.verdict}'. Expected NO_CLEANUP_NEEDED.` };
  }

  return {
    pass: true,
    chain: latestChain,
    message: `Verified Cleanup Worker execution and [CLEANUP REPORT] (Chain: step ${latestChain.stepA} -> ${latestChain.stepB} -> ${latestChain.stepC}, child: ${latestChain.childConversationId}, DELETE-CANDIDATE: 0, GOVERNANCE-RESIDUAL: 0, NO_CLEANUP_NEEDED).`
  };
}

// ─────────────────────────────────────────────────────────────
// CLI エントリーポイント
// ─────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  let baseCommit = null;
  let targetCommit = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseCommit = args[++i];
    } else if (args[i] === '--target' && args[i + 1]) {
      targetCommit = args[++i];
    }
  }

  if (!baseCommit) {
    exitFail('Missing required argument: --base <ORIGINAL_BASE>');
  }
  if (!targetCommit) {
    exitFail('Missing required argument: --target <TARGET>');
  }

  // Repository Boundary 専用極小例外 & Fail-Closed 検証 (resolveTranscriptPath ヘルパー)
  let transcriptPath;
  try {
    transcriptPath = resolveTranscriptPath(process.env);
  } catch (e) {
    exitFail(e.message);
  }

  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  } catch (e) {
    exitFail(`Fail-Closed: Failed to read transcript file: ${e.message}`);
  }

  const result = verifyCleanupGate({
    baseCommit,
    targetCommit,
    transcriptLines: lines
  });

  if (!result.pass) {
    exitFail(result.error);
  }

  exitPass(result.message);
}

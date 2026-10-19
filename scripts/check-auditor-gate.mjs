import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { verifyEntranceGate, resolveScopeMission } from './check-entrance-gate.mjs';

const rootDir = process.cwd();

function exitFail(message) {
  console.error(`\n🛑 [Hard Stop] Auditor Gate FAILED: ${message}`);
  process.exit(1);
}

function exitPass(message) {
  console.log(`\n🟢 [Auditor Gate] PASSED: ${message}`);
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
 * 変更系コマンドかどうかの判定 (Post-Audit Mutation 検出用)
 */
export function isMutatingCommand(commandLine) {
  if (!commandLine || typeof commandLine !== 'string') return false;
  let cmd = commandLine.trim();

  if (
    cmd.length >= 2 &&
    (
      (cmd.startsWith('"') && cmd.endsWith('"')) ||
      (cmd.startsWith("'") && cmd.endsWith("'"))
    )
  ) {
    cmd = cmd.slice(1, -1).trim();
  }


  // 読み取り専用・非破壊コマンドのホワイトリスト判定
  const readOnlyPrefixes = [
    'git status',
    'git log',
    'git rev-parse',
    'git diff',
    'git show',
    'git branch',
    'node scripts/check-entrance-gate.mjs',
    'npm run gate:entrance',
    'node scripts/check-auditor-gate.mjs',
    'npm run gate:auditor',
    'node scripts/check-scope.mjs',
    'npm run audit:gate',
    'node scripts/check-universal-invariants.mjs',
    'npm test'
  ];

  // リダイレクトによるファイル書き込みがあれば変更系
  if (/>/.test(cmd)) {
    return true;
  }

  // 明示的な変更・破壊操作
  const mutatingPatterns = [
    /\b(rm|mv|cp|mkdir|touch|sed|awk|patch|truncate)\b/,
    /\bgit\s+(add|commit|push|checkout\s+-b|branch\s+-[dD]|reset|rebase|merge|stash)\b/,
    /\bnpm\s+(install|i|update|audit\s+fix)\b/
  ];

  for (const pattern of mutatingPatterns) {
    if (pattern.test(cmd)) return true;
  }

  // ホワイトリストで始まっているか確認
  const isReadOnly = readOnlyPrefixes.some(prefix => cmd.startsWith(prefix));
  if (!isReadOnly) {
    return true; // 未知コマンドは安全側（Fail-Closed）で mutation 判定
  }

  return false;
}

/**
 * 構造化相関チェーン検証コアロジック (Unit/Negative Test からも直接呼び出し可能)
 */
export function verifyAuditorGate({
  baseCommit,
  targetCommit,
  transcriptLines,
  gitResolver = null,
  diffResolver = null,
  mission = null,
  enforceEntranceGate = false
}) {
  if (!baseCommit || typeof baseCommit !== 'string') {
    return { pass: false, error: 'Missing required baseCommit (--base <BASE>)' };
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

  // 1.1. BASE === TARGET 遮断 (Fail-Closed)
  if (fullBase === fullTarget) {
    return {
      pass: false,
      error: `Fail-Closed: BASE (${shortBase}) and TARGET (${shortTarget}) resolve to the same commit (${fullBase}). Auditor Gate requires a non-empty committed diff range (<BASE>..<TARGET>).`
    };
  }

  // 1.2. 変更ファイル実在検証 (架空 fallback 禁止・custom gitResolver 時は diffResolver 必須)
  if (gitResolver && typeof diffResolver !== 'function') {
    return {
      pass: false,
      error: 'Fail-Closed: Custom gitResolver provided without explicit diffResolver. Fake changedFiles fallback is prohibited.'
    };
  }

  const resolveDiff = diffResolver || ((base, target) => {
    try {
      const out = execSync(`git diff --name-only "${base}..${target}"`, { cwd: rootDir }).toString().trim();
      return out ? out.split('\n').map(s => s.trim()).filter(Boolean) : [];
    } catch (e) {
      throw new Error(`Failed to compute git diff --name-only for ${base}..${target}: ${e.message}`);
    }
  });

  let changedFiles;
  try {
    changedFiles = resolveDiff(fullBase, fullTarget);
  } catch (e) {
    return { pass: false, error: `Fail-Closed: ${e.message}` };
  }

  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return {
      pass: false,
      error: `Fail-Closed: Zero changed tracked files in range ${shortBase}..${shortTarget} (changedFiles === 0).`
    };
  }

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
          const isAuditor = (
            rawArgs.includes('Independent Auditor') ||
            rawArgs.includes('auditor') ||
            rawArgs.includes('独立検品')
          );

          if (isAuditor) {
            // Event A Prompt 内の三者バインド確認 (BASE, TARGET, SCOPE)
            const hasBase = rawArgs.includes(shortBase) || rawArgs.includes(fullBase) || rawArgs.includes(baseCommit);
            const hasTarget = rawArgs.includes(shortTarget) || rawArgs.includes(fullTarget) || rawArgs.includes(targetCommit);
            const hasScope = rawArgs.includes('MISSION_SCOPE') || rawArgs.includes('Approved Scope') || /Scope:\s*[^\\"\s\n\r]+/.test(rawArgs);

            pendingInvocation = {
              stepA: stepIndex,
              hasBase,
              hasTarget,
              hasScope,
              rawArgs
            };
            pendingToolResult = null;
          }
        }
      }
      continue;
    }

    // --- Event B: invoke_subagent tool_result ---
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

      pendingInvocation = null;
      continue;
    }

    // --- Event C: child Auditor incoming message ---
    if (pendingToolResult && entry.source === 'SYSTEM' && entry.type === 'SYSTEM_MESSAGE' && entry.content) {
      const content = entry.content;
      if (content.includes('[AUDITOR VERDICT]')) {
        const matchSender = content.match(/\[Message\].*sender=([^\s]+)/);
        const sender = matchSender ? matchSender[1] : null;

        if (sender && sender === pendingToolResult.childConversationId) {
          const matchBase = content.match(/Base(?:\s*Commit)?:\s*([a-f0-9]+)/i);
          const matchTarget = content.match(/Target(?:\s*Commit)?:\s*([a-f0-9]+)/i);
          const repBase = matchBase ? matchBase[1] : null;
          const repTarget = matchTarget ? matchTarget[1] : null;

          const reportBaseMatches = repBase && (fullBase.startsWith(repBase) || repBase.startsWith(shortBase));
          const reportTargetMatches = repTarget && (fullTarget.startsWith(repTarget) || repTarget.startsWith(shortTarget));

          const hasScopeReport = /Scope(?:\s*Verified)?:\s*(.+)/i.test(content) || /Approved Scope:/i.test(content);

          // Semantic Review Evidence
          const hasFullFileReview = /Full-File(?:\s*&\s*Diff)?\s*Review/i.test(content);
          const hasFalsification = /Universal\s*Invariants(?:\s*&\s*Falsification)?/i.test(content) || /Falsification/i.test(content);
          const hasSemanticReview = hasFullFileReview && hasFalsification;

          // Independent Commands Executed
          const hasGitDiff = /git diff/i.test(content);
          const hasNpmTest = /npm test/i.test(content);
          const hasCheckScope = /check-scope\.mjs/i.test(content);
          const hasIndependentCommands = hasGitDiff && hasNpmTest && hasCheckScope;

          // Findings & Verdict
          const matchVerdict = content.match(/(?:Final\s+)?Verdict:\s*([A-Za-z_]+)/i);
          const verdict = matchVerdict ? matchVerdict[1] : null;

          const matchBlocking = content.match(/Blocking Findings:\s*(\d+|none)/i);
          const hasBlockingFindings = matchBlocking ? (matchBlocking[1].toLowerCase() !== '0' && matchBlocking[1].toLowerCase() !== 'none') : false;

          const chain = {
            stepA: pendingToolResult.invocation.stepA,
            stepB: pendingToolResult.stepB,
            stepC: stepIndex,
            childConversationId: sender,
            promptHasBase: pendingToolResult.invocation.hasBase,
            promptHasTarget: pendingToolResult.invocation.hasTarget,
            promptHasScope: pendingToolResult.invocation.hasScope,
            reportBaseMatches,
            reportTargetMatches,
            hasScopeReport,
            hasSemanticReview,
            hasFullFileReview,
            hasFalsification,
            hasIndependentCommands,
            hasGitDiff,
            hasNpmTest,
            hasCheckScope,
            hasBlockingFindings,
            verdict,
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
      return { pass: false, error: 'Independent Auditor was invoked, but tool result (conversationId) was not received.' };
    }
    if (pendingToolResult) {
      return { pass: false, error: `Waiting for [AUDITOR VERDICT] from child Auditor (${pendingToolResult.childConversationId}).` };
    }
    return { pass: false, error: `Independent Auditor was NOT invoked for range ${shortBase}..${shortTarget}.` };
  }

  const latestChain = invocationChains[invocationChains.length - 1];

  // 順序の厳格検証 (stepA < stepB < stepC)
  if (!(latestChain.stepA < latestChain.stepB && latestChain.stepB < latestChain.stepC)) {
    return { pass: false, error: `Invalid event sequence in transcript: stepA (${latestChain.stepA}) < stepB (${latestChain.stepB}) < stepC (${latestChain.stepC}) violated.` };
  }

  // 三者完全一致の検証
  if (!latestChain.promptHasBase || !latestChain.promptHasTarget) {
    return { pass: false, error: `Event A invocation prompt did not bind exact BASE (${shortBase}) or TARGET (${shortTarget}).` };
  }
  if (!latestChain.promptHasScope) {
    return { pass: false, error: 'Event A invocation prompt did not bind MISSION_SCOPE.' };
  }
  if (!latestChain.reportBaseMatches || !latestChain.reportTargetMatches) {
    return { pass: false, error: `Event C report commit range does not match requested range ${shortBase}..${shortTarget}.` };
  }
  if (!latestChain.hasScopeReport) {
    return { pass: false, error: 'Event C report did not confirm approved Scope verification.' };
  }

  // コマンド実行証跡
  if (!latestChain.hasIndependentCommands) {
    const missing = [];
    if (!latestChain.hasGitDiff) missing.push('git diff');
    if (!latestChain.hasNpmTest) missing.push('npm test');
    if (!latestChain.hasCheckScope) missing.push('node scripts/check-scope.mjs');
    return { pass: false, error: `Event C [AUDITOR VERDICT] missing mandatory independent command evidence: ${missing.join(', ')}.` };
  }

  // 意味的全文検品証跡 (Semantic Review Evidence)
  if (!latestChain.hasSemanticReview) {
    const missing = [];
    if (!latestChain.hasFullFileReview) missing.push('Full-File & Diff Review');
    if (!latestChain.hasFalsification) missing.push('Universal Invariants & Falsification');
    return { pass: false, error: `Event C [AUDITOR VERDICT] missing mandatory semantic review evidence: ${missing.join(', ')}.` };
  }

  // ブロッキング課題と Verdict
  if (latestChain.hasBlockingFindings) {
    return { pass: false, error: 'Event C [AUDITOR VERDICT] contains blocking findings.' };
  }
  if (latestChain.verdict !== 'PASS') {
    return { pass: false, error: `Event C [AUDITOR VERDICT] Final Verdict is '${latestChain.verdict}'. Expected PASS.` };
  }

  // 3.5. STAGE 0 ENTRANCE GATE DUAL DEFENSE 検証 (取り逃し防止)
  if (enforceEntranceGate || (mission && typeof mission === 'string' && mission.trim())) {
    if (!mission || typeof mission !== 'string' || !mission.trim()) {
      return {
        pass: false,
        error: 'Stage 0 Entrance Gate check in Auditor Gate failed: Missing canonical mission from .agents/current-scope.json.'
      };
    }
    const entranceCheck = verifyEntranceGate({
      mission: mission.trim(),
      transcriptLines,
      maxStepIndex: latestChain.stepA
    });
    if (!entranceCheck.pass) {
      return {
        pass: false,
        error: `Stage 0 Entrance Gate verification failed in Auditor Gate: ${entranceCheck.error}`
      };
    }
  }

  // 4. POST-AUDIT ZERO MUTATION 検証 (Event C 直後から末尾までのtranscript走査)
  for (let idx = 0; idx < transcriptLines.length; idx++) {
    const rawLine = transcriptLines[idx].trim();
    if (!rawLine) continue;

    let entry;
    try {
      entry = JSON.parse(rawLine);
    } catch (e) {
      continue;
    }

    const stepIndex = entry.step_index !== undefined ? entry.step_index : idx;
    if (stepIndex > latestChain.stepC) {
      if (entry.source === 'MODEL' && entry.tool_calls) {
        for (const tc of entry.tool_calls) {
          if (tc.name === 'write_to_file' || tc.name === 'replace_file_content') {
            return {
              pass: false,
              error: `Post-Audit Mutation detected at step ${stepIndex} (${tc.name}). Auditor PASS is VOID.`
            };
          }
          if (tc.name === 'run_command' && tc.args && isMutatingCommand(tc.args.CommandLine)) {
            return {
              pass: false,
              error: `Post-Audit Mutating Command detected at step ${stepIndex} (${tc.args.CommandLine}). Auditor PASS is VOID.`
            };
          }
        }
      }
    }
  }

  return {
    pass: true,
    chain: latestChain,
    message: `Verified Independent Auditor execution, [AUDITOR VERDICT] PASS, and Post-Audit Zero Mutation (Chain: step ${latestChain.stepA} -> ${latestChain.stepB} -> ${latestChain.stepC}, child: ${latestChain.childConversationId}, Verdict: PASS).`
  };
}

// ─────────────────────────────────────────────────────────────
// CLI エントリーポイント
// ─────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  let baseCommit = null;
  let targetCommit = null;
  let missionArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseCommit = args[++i];
    } else if (args[i] === '--target' && args[i + 1]) {
      targetCommit = args[++i];
    } else if (args[i] === '--mission' && args[i + 1]) {
      missionArg = args[++i];
    }
  }

  if (!baseCommit) {
    exitFail('Missing required argument: --base <BASE>');
  }
  if (!targetCommit) {
    exitFail('Missing required argument: --target <TARGET>');
  }

  if (!missionArg) {
    try {
      missionArg = resolveScopeMission(rootDir);
    } catch (e) {
      exitFail(e.message);
    }
  }

  // Preflight Gate: Static Secret Scanner must PASS across all tracked files
  try {
    execSync('node scripts/check-secrets.mjs', { cwd: rootDir, stdio: 'inherit' });
  } catch (err) {
    exitFail('Preflight Secret Scan FAILED. Plaintext secrets detected in tracked files.');
  }

  // Preflight Gate 2: Universal Invariants Scanner must PASS across changed non-data files
  try {
    execSync(`node scripts/check-universal-invariants.mjs --base "${baseCommit}" --target "${targetCommit}"`, { cwd: rootDir, stdio: 'inherit' });
  } catch (err) {
    exitFail('Preflight Universal Invariants Check FAILED. Current district literals detected in changed non-data files.');
  }

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

  const result = verifyAuditorGate({
    baseCommit,
    targetCommit,
    transcriptLines: lines,
    mission: missionArg,
    enforceEntranceGate: true
  });

  if (!result.pass) {
    exitFail(result.error);
  }

  exitPass(result.message);
}

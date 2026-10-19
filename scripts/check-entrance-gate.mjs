import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function exitFail(message) {
  console.error(`\n🛑 [Hard Stop] Entrance Gate FAILED: ${message}`);
  process.exit(1);
}

function exitPass(message) {
  console.log(`\n🟢 [Entrance Gate] PASSED: ${message}`);
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
 * .agents/current-scope.json から正本 mission 名を取得するヘルパー
 */
export function resolveScopeMission(repoRoot = rootDir) {
  const scopePath = path.join(repoRoot, '.agents', 'current-scope.json');
  if (!fs.existsSync(scopePath)) {
    throw new Error('Fail-Closed: .agents/current-scope.json not found.');
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(scopePath, 'utf8'));
  } catch (e) {
    throw new Error(`Fail-Closed: Invalid JSON in .agents/current-scope.json: ${e.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Fail-Closed: .agents/current-scope.json is not in structured object format { mission, files }.');
  }
  if (typeof parsed.mission !== 'string' || !parsed.mission.trim()) {
    throw new Error('Fail-Closed: .agents/current-scope.json is missing a non-empty "mission" field.');
  }
  return parsed.mission.trim();
}

/**
 * Stage 0 Entrance Gatekeeper 構造化相関チェーン検証コアロジック
 *
 * 必須検証4条件:
 * 1. transcript.jsonl に architect (Entrance Gatekeeper) の起動証跡がある (Event A -> Event B)
 * 2. 子 architect からの [GATEKEEPER VERDICT] が存在する (Event C)
 * 3. Final Verdict = PASS (かつ Violations = 0 / none)
 * 4. その PASS が現在の Mission (mission) に対応している (過去 Mission の PASS 使い回し禁止・最新チェーンのみ評価)
 */
export function verifyEntranceGate({
  mission,
  transcriptLines,
  maxStepIndex = Infinity
}) {
  if (!mission || typeof mission !== 'string' || !mission.trim()) {
    return { pass: false, error: 'Missing required mission identifier (--mission "<MISSION_NAME>" or .agents/current-scope.json mission).' };
  }

  const targetMission = mission.trim();
  const targetMissionLower = targetMission.toLowerCase();

  if (!Array.isArray(transcriptLines)) {
    return { pass: false, error: 'transcriptLines must be an array of JSON strings.' };
  }

  const attempts = [];
  let activeAttempt = null;
  let awaitingEventB = false;

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
    if (stepIndex > maxStepIndex) {
      break;
    }

    // --- Event A: invoke_subagent tool_call for architect (Entrance Gatekeeper) ---
    if (entry.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE' && entry.tool_calls) {
      if (awaitingEventB) {
        awaitingEventB = false;
      }

      for (const tc of entry.tool_calls) {
        if (tc.name === 'invoke_subagent' && tc.args) {
          const rawArgs = JSON.stringify(tc.args);
          const isGatekeeperArchitect = (
            /"TypeName"\s*:\s*"architect"/i.test(rawArgs) ||
            rawArgs.includes('Stage 0 Entrance Gatekeeper') ||
            rawArgs.includes('Entrance Gatekeeper')
          );

          if (isGatekeeperArchitect) {
            const promptHasMission = rawArgs.toLowerCase().includes(targetMissionLower);
            const attempt = {
              stepA: stepIndex,
              stepB: null,
              stepC: null,
              childConversationId: null,
              promptHasMission,
              hasEventB: false,
              hasEventC: false,
              reportedMission: null,
              reportMissionMatches: false,
              verdict: null,
              hasViolations: false,
              nextAction: null
            };
            attempts.push(attempt);
            activeAttempt = attempt;
            awaitingEventB = true;
          }
        }
      }
      continue;
    }

    // --- Event B: invoke_subagent tool_result (must be immediate next step: stepB === stepA + 1) ---
    if (awaitingEventB && activeAttempt) {
      const isImmediateStep = (stepIndex === activeAttempt.stepA + 1);
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
          activeAttempt.stepB = stepIndex;
          activeAttempt.childConversationId = matchConv[1];
          activeAttempt.hasEventB = true;
          awaitingEventB = false;
          continue;
        }
      }

      awaitingEventB = false;
      continue;
    }

    // --- Event C: child architect SYSTEM_MESSAGE with [GATEKEEPER VERDICT] ---
    if (activeAttempt && activeAttempt.hasEventB && !activeAttempt.hasEventC) {
      if (entry.source === 'SYSTEM' && entry.type === 'SYSTEM_MESSAGE' && entry.content) {
        const content = entry.content;
        if (content.includes('[GATEKEEPER VERDICT]')) {
          const matchSender = content.match(/\[Message\].*sender=([^\s]+)/);
          const sender = matchSender ? matchSender[1] : null;

          if (sender && sender === activeAttempt.childConversationId) {
            const matchAuditedMission = content.match(/Audited Mission:\s*([^\r\n]+)/i);
            const matchMission = content.match(/(?:^|\n)Mission:\s*([^\r\n]+)/i);
            const rawReportedMission = matchAuditedMission
              ? matchAuditedMission[1].trim()
              : (matchMission ? matchMission[1].trim() : null);

            const reportMissionMatches = Boolean(
              rawReportedMission &&
              rawReportedMission.toLowerCase() === targetMissionLower
            );

            const matchVerdict = content.match(/Final Verdict:\s*([A-Za-z_]+)/i);
            const verdict = matchVerdict ? matchVerdict[1].trim() : null;

            const matchBlocking = content.match(/Blocking Violations:\s*([^\r\n]+)/i);
            const matchViolations = content.match(/(?:^|\n)Violations:\s*([^\r\n]+)/i);
            const violationStr = matchBlocking
              ? matchBlocking[1].trim().toLowerCase()
              : (matchViolations ? matchViolations[1].trim().toLowerCase() : 'none');
            const hasViolations = !(
              violationStr === '0' ||
              violationStr === 'none' ||
              violationStr === 'none (0)' ||
              violationStr === '0 (none)'
            );

            const matchNextAction = content.match(/Next Action:\s*([A-Za-z_]+)/i);
            const nextAction = matchNextAction ? matchNextAction[1].trim() : null;

            activeAttempt.stepC = stepIndex;
            activeAttempt.hasEventC = true;
            activeAttempt.reportedMission = rawReportedMission;
            activeAttempt.reportMissionMatches = reportMissionMatches;
            activeAttempt.verdict = verdict;
            activeAttempt.hasViolations = hasViolations;
            activeAttempt.nextAction = nextAction;
          }
        }
      }
    }
  }

  // Filter attempts that belong to the target mission (either by Event A prompt or Event C report)
  const missionAttempts = attempts.filter(a => a.promptHasMission || a.reportMissionMatches);

  if (missionAttempts.length === 0) {
    if (attempts.length > 0) {
      const lastOther = attempts[attempts.length - 1];
      const otherLabel = lastOther.reportedMission || 'another mission';
      return {
        pass: false,
        error: `Stage 0 Entrance Gatekeeper (architect) was NOT invoked for mission "${targetMission}" (found prior Gatekeeper record for "${otherLabel}"; cross-mission PASS reuse is prohibited).`
      };
    }
    return {
      pass: false,
      error: `Stage 0 Entrance Gatekeeper (architect) was NOT invoked for mission "${targetMission}".`
    };
  }

  // Evaluate ONLY the latest attempt for this mission (no fallback to stale prior PASS)
  const latest = missionAttempts[missionAttempts.length - 1];

  if (!latest.promptHasMission) {
    return {
      pass: false,
      error: `Stage 0 Event A invocation prompt at step ${latest.stepA} did not bind mission "${targetMission}".`
    };
  }

  if (!latest.hasEventB || !latest.childConversationId) {
    return {
      pass: false,
      error: `Stage 0 Entrance Gatekeeper was invoked at step ${latest.stepA}, but immediate Event B tool result (conversationId) was not received.`
    };
  }

  if (!latest.hasEventC) {
    return {
      pass: false,
      error: `Waiting for [GATEKEEPER VERDICT] from child Gatekeeper (${latest.childConversationId}) invoked at step ${latest.stepA}. Fallback to older PASS is prohibited.`
    };
  }

  if (!(latest.stepA < latest.stepB && latest.stepB < latest.stepC)) {
    return {
      pass: false,
      error: `Invalid Stage 0 event sequence: stepA (${latest.stepA}) < stepB (${latest.stepB}) < stepC (${latest.stepC}) violated.`
    };
  }

  if (!latest.reportMissionMatches) {
    return {
      pass: false,
      error: `Stage 0 [GATEKEEPER VERDICT] Mission mismatch: expected "${targetMission}", got "${latest.reportedMission || 'MISSING'}".`
    };
  }

  if (latest.hasViolations) {
    return {
      pass: false,
      error: `Stage 0 [GATEKEEPER VERDICT] reported principle violations for mission "${targetMission}".`
    };
  }

  if (latest.nextAction && latest.nextAction.toUpperCase() === 'HARD_STOP_AND_RETURN') {
    return {
      pass: false,
      error: `Stage 0 [GATEKEEPER VERDICT] returned Next Action: HARD_STOP_AND_RETURN for mission "${targetMission}".`
    };
  }

  if (latest.verdict !== 'PASS') {
    return {
      pass: false,
      error: `Stage 0 [GATEKEEPER VERDICT] Final Verdict is '${latest.verdict || 'MISSING'}'. Expected PASS.`
    };
  }

  return {
    pass: true,
    chain: latest,
    message: `Verified Stage 0 Entrance Gatekeeper execution and [GATEKEEPER VERDICT] PASS for mission "${targetMission}" (Chain: step ${latest.stepA} -> ${latest.stepB} -> ${latest.stepC}, child: ${latest.childConversationId}, Verdict: PASS).`
  };
}

// ─────────────────────────────────────────────────────────────
// CLI エントリーポイント
// ─────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  let missionArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mission' && args[i + 1]) {
      missionArg = args[++i];
    }
  }

  if (!missionArg) {
    try {
      missionArg = resolveScopeMission(rootDir);
    } catch (e) {
      exitFail(`Missing --mission "<MISSION_NAME>" and could not resolve mission from .agents/current-scope.json (${e.message})`);
    }
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

  const result = verifyEntranceGate({
    mission: missionArg,
    transcriptLines: lines
  });

  if (!result.pass) {
    exitFail(result.error);
  }

  exitPass(result.message);
}

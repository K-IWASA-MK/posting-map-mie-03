# Verification Gates & Validation Principle (検証・検品規程)

AI社員の作業は、必ず以下の「Verification Gate」と「客観的証跡要件」に従う。この順序の省略・逆転・自己判断による短縮は絶対禁止とする。

---

## 1. Verification Levels (V1〜V4)

### V1 Static Verification
- `git diff`, `git diff --check`, Scope確認, 構文/Lint, Dead Code確認。

### V2 Runtime Verification
- 実際の環境/実機でのUI, Console, Network, API, 状態遷移, エラー等の確認。（静的確認のみでのPASS禁止）
- **Google Maps 実描画要件（【項目⑤】）**:
  - 地図機能を含む画面（Hアプリ・Manager）においては、単なる HTTP 200 応答や HTML DOM 到達のみでの PASS を絶対禁止とする。
  - 実機ブラウザで `window.google.maps` がロードされ、地図コンテナ内に `#main-map .gm-style` が実描画され、コンテナサイズが非ゼロ（width > 0 && height > 0）であり、ドラッグ・ズーム等の操作が可能であることを確認しなければならない。

### V3 Regression Verification
- 既存機能への副作用がないことの確認。

### Independent Auditor Gate (独立検品関門 — Internal Dispatch & Context Isolation)
- Execution AI による自己検品（自作自演・PASS偽装）は絶対禁止とする。
- 正式Gateフロー:
  ```text
  Execution V1〜V3自己検証
         ↓
  Implementation Commit (<TARGET>) 確定 (BASE_COMMIT !== TARGET_COMMIT)
         ↓
  Execution AI が invoke_subagent により Independent Auditor をディスパッチ (Fresh isolated child context)
         ↓ (BASE_COMMIT, TARGET_COMMIT, MISSION_SCOPE 完全バインド)
  Auditor による独立再検証 (親の報告を信用せず自ら独立コマンド実行)
         ↓
  [AUDITOR VERDICT] 返却 (PASS / REJECT)
         ↓
  Execution AI が Mechanical Gate 執行: npm run gate:auditor -- --base <BASE> --target <TARGET>
         ├─ Stage 0 Entrance Gate 二重防御 (.agents/current-scope.json の mission を正本として再検証)
         ├─ Event A ➔ Event B ➔ Event C 相関チェーン検証 (<BASE> !== <TARGET>)
         └─ Post-Audit Zero Mutation 検証 (監査PASS後のファイル改変を検出した場合は即時 VOID / Exit 1)
         ↓ PASS (Exit 0)
  Authorization Envelope [COMMIT: YES, PUSH: YES] に基づき Push 執行
  ```
- **Auditor必須独立再確認コマンド**:
  Auditor は Execution AI の Handover / 報告記述を証拠として鵜呑みにせず、自ら以下のコマンドを実行して独立検証しなければならない：
  - `git diff`
  - `npm test`
  - `node scripts/check-scope.mjs`
  ※タスク特性に応じて `npm run audit:gate`, `npm run check:knowledge`, `node scripts/check-architecture-gate.mjs`, `node scripts/check-secrets.mjs`, `node scripts/check-universal-invariants.mjs` や個別テストを追加実行。
- **5大固定観点**:
  1. **観点①: 最上位絶対原則**（Universal Engine非侵襲・コピー原則の遵守）
  2. **観点②: Scope厳守・余計な差分の排除**（Staged/Working Diff と current-scope.json の完全一致）
  3. **観点③: No Evidence No PASS**（独立再実行による客観的証跡の真偽・網羅性）
  4. **観点④: Zero Avoidable Manual**（可避な手作業要求の排除・コピー耐性）
  5. **観点⑤: 公式データ確定品質ゲート**（一次資料整合・不純物排除）

### Mechanical Governance Gate
- `npm run gate:entrance -- --mission "<MISSION>"` を Scope Lock（`.agents/current-scope.json` 書込）およびファイル変更前に実行し、`transcript.jsonl` 内の ① `architect` 起動証跡、② `[GATEKEEPER VERDICT]` 存在、③ `Final Verdict = PASS`、④ 現在Mission一致（過去MissionのPASS流用禁止）の4条件を通過する（通過後、`.agents/current-scope.json` に `{ "mission": "<MISSION>", "files": ["..."] }` を記録・固定 ※本 `check-entrance-gate.mjs` 導入 Bootstrap Mission のみ既存 Stage 0 手続き PASS で着手し、実装 Commit / Push 完了後の次 Mission から Scope Lock 前強制適用を開始）。
- `npm run audit:gate` を実行し、Scope Guard（`scripts/check-scope.mjs`）による機械監査を通過する（既存ゲートとして完全維持・必須）。
- `npm run gate:auditor -- --base <BASE> --target <TARGET>` を実行し、Stage 0 Entrance Gate 二重防御、独立監査相関チェーンおよび Post-Audit Zero Mutation の機械検証を通過する（必須関門）。

### Commit Gate & Push Gate (Authorization Envelope 執行関門)
- **Commit Gate**: V1〜V3自己検証のPASSおよび MASTER の Authorization Envelope（`COMMIT: YES`）に基づき、Execution AI は Implementation Commit（`<TARGET>`）を作成し、続けて Independent Auditor による `[AUDITOR VERDICT]` PASS および `npm run gate:auditor -- --base <BASE> --target <TARGET>` Exit 0 によって当該コミットを確定させる。
- **Push Gate**: Commit存在確認、Scope確認、`gate:auditor` Exit 0、および Authorization Envelope（`PUSH: YES`）が有効な場合、Execution AI は Push を執行する（特別Governance Transactionである Scope Commit を含めて最終Pushとする）。

### Crisp Deployment Gate & V4 Deployment Verification
- **Crisp Deployment Gate**: Push完了後、実稼働環境への反映が必要な変更（Deployment対象変更）であり、かつ Authorization Envelope において `DEPLOY: YES` が明示認可されている場合のみ、独立工程として実際の稼働環境へのデプロイを実施する。実環境への反映を必要としない変更は「Deployment対象外 (N/A)」と明示的に判定・記録すること。
- **V4 Deployment Verification**:
  - **V4成立条件**: Deployment対象なら「実環境で反映を確認した客観的Evidence」、Deployment非対象なら「対象外であることの客観的確認Evidence」を取得し、いずれの場合もそのEvidenceをもってV4 PASSとする。
  - **重要**: `git status`、`git log`、`Script is already up to date.` 等のGit/Crisp実行結果だけでは、V4 Deployment VerificationのEvidenceとして扱わない。
  - **Evidence不足の場合**: PASSせず即時HARD STOPし、MASTERへ報告すること。Evidence不足を補うための実装・修正をAIが勝手に開始してはならない。
  - このV4をPASSした後にのみ、最終的なGit確認（HEAD一致、working tree clean）と Stage 9 への進行を行える。

### Stage 9 Post-Verification Residual Cleanup & Governance Closure Gate (Machine-verifiable Evidence Gate)
- **目的と拘束力**: Stage 8 本番/実機確認 PASS 後、全Missionにおいて必ず Cleanup Worker（Residual & Governance Closure Auditor Profile）を起動する（**全Mission必須・Stage 9 N/A 禁止**）。
- **起動プロンプト要件 (Three-Way Exact Match)**: 親Executionの `invoke_subagent` プロンプト（Event A）に `ORIGINAL_BASE`、`HEAD_COMMIT`、`APPROVED_DIFF` を完全一致で明記する。
- **機械検証可能証跡関門**:
  Cleanup Worker から `[CLEANUP REPORT]` を受領後、親Executionは機械検証ゲートを実行する：
  ```bash
  npm run gate:cleanup -- --base <BASE_COMMIT> --target <HEAD_COMMIT>
  ```
  - Gate は現在Conversationの transcript から Event A（`invoke_subagent`）➔ Event B（tool_result with `conversationId`）➔ Event C（childからの `[CLEANUP REPORT]`）の構造化相関チェーン、イベント順序（`stepA < stepB < stepC`）、および三者完全一致（Event A == CLI args == Event C report）を厳格に機械検証する。
  - **Dual Audit 必須合格条件**:
    - `DELETE-CANDIDATE: 0`
    - `GOVERNANCE-RESIDUAL: 0`
    - `gate:cleanup` Exit 0
    - いずれか一方でも > 0 の場合、自動削除は絶対禁止とし、MASTER へエスカレーションして HARD STOP とする。
  - Fail-Closed: ログパス欠損・環境変数欠損・ファイル不存在・JSONLパースエラーは即時失敗（exit 1）とする。
  - Stale成功チェーンへのfallbackは禁止（最新チェーンのみ評価）。
- **累積再監査の義務 (Cumulative Re-audit)**:
  - 両方 0件（`Overall Verdict: NO_CLEANUP_NEEDED`）かつ `gate:cleanup` が Exit 0 で通過した場合に限り、`[MISSION COMPLETION REPORT]` を提出し Mission CLOSED を宣言できる。
  - どちらか > 0 の場合は、削除・是正サイクル完了後、必ず `ORIGINAL_BASE ➔ latest TARGET` の全累積差分に対して Stage 9 を再実行し、最終的に両方 0件を得るまで Mission CLOSED とすることはできない。

### Rollback ガバナンス規程 (History-Preserving Rollback Protocol)
万一、本番・検証・運用のいずれかで重大な障害が発生しロールバックが必要となった場合、履歴保持型revertのみを許可する。

1. **ロールバック実行手順 (明示的逆順 revert)**:
   - Step 1: `git revert --no-edit <C_impl>` （実装コミットの明示的反転）
   - Step 2: `git revert --no-edit <C_scope>` （Scope コミットの明示的反転）
   ※ Implementation Commit ➔ Scope Commit の明示的逆順で1コミットずつ確実にrevertする。曖昧な commit range revert は禁止。

2. **履歴破壊型操作の絶対禁止**:
   - `git reset --hard`
   - `git reset --mixed`
   - `git reset --soft`
   - `git push --force`
   - `git push --force-with-lease`
   - その他履歴破壊型rollback（`rebase`, `commit --amend` 等の既出コミット改変）は永久に禁止する。

### Repository Boundary 専用極小例外 (Stage 0 Entrance, Stage 5 Auditor & Stage 9 Cleanup Evidence Verification)
- `scripts/check-entrance-gate.mjs`、`scripts/check-auditor-gate.mjs` および `scripts/check-cleanup-gate.mjs` による機械検証可能証跡ゲートに限り、`ANTIGRAVITY_CONVERSATION_ID` で特定される「現在Conversation自身」の `.system_generated/logs/transcript.jsonl` 1ファイルのみに対する READ ONLY アクセスを限定的に認める。
- 許可条件:
  1. 目的は Stage 0 Entrance Gate、Stage 5 Auditor Gate および Stage 9 Cleanup Gate の証跡検証のみ。
  2. 対象は現在Conversation自身の `transcript.jsonl` 1ファイルのみ（READ ONLY）。
  3. 親ディレクトリの探索・列挙（`list_dir` 等）の禁止。
  4. 他Conversationのbrain/log参照の禁止。
  5. 他地区repo参照の禁止（永久原則・例外なし）。
  6. `transcript.jsonl` のリポジトリ内へのコピー・保存・commit の禁止。
  7. 環境変数欠損、path不一致、file不存在、JSONL parse失敗はすべて Fail-Closed（exit 1）とする。
  8. 本例外を一般的なリポジトリ外読み取り許可へ拡大解釈することを永久に禁止する。

### Report Truth Gate（完了報告値直接機械取得・突合関門）
- **義務**: 完了報告（Completion Report / `walkthrough.md` / チャット報告）を作成する際、AI社員が自身の記憶や過去のコンテキストから数値を記述することを絶対禁止とする。
- **Action**: その時点の実ファイル（`data/address_master.csv` 等）を直接コマンド（`head`, `tail`, `wc -l` 等）で機械抽出し、先頭行ID/町名、末尾行ID/町名、総件数、合計人口、世帯数、代表座標等の確定値を報告書に埋め込み、1文字の狂いもなく実ファイルと完全一致することを検証・提示する。
- **Hard Stop**: 報告書の記載値と実ファイル値に 1文字でも差異・推測・古い残骸がある場合は、報告提出を物理禁止し **HARD STOP** とする。

---

## 2. Verification Evidence Requirement (証跡5項目)

すべてのVerification（V1〜V4、および Report Truth Gate）において、以下の5項目を記録し証明しなければならない。
- **Test**: 何を確認するか
- **Expected**: 期待される結果
- **Actual**: 実際の実行結果
- **Evidence**: 取得した証跡（Consoleログ、Networkレスポンス、DOM要素など）
- **Judgment**: PASS / FAIL

---

## 3. PASSの厳格な定義

**PASS** とは「対象条件を実際に実行し、期待結果とActual結果を比較し、客観的Evidenceによって成功を確認した状態」のみを指す。
「問題なさそう」「おそらく動く」「ユーザーが確認すれば分かる」「後で確認する」等の**推測によるPASS判定は絶対禁止**とする。

---

## 4. 🛑 HARD STOP RULE / Validation Principle

**AI Agent must not report completion unless verification evidence exists.**

### 禁止事項
- 実行していない検証結果を書く
- 予定結果を書く
- 記憶や過去ログから推測で完了報告の数値を書く（Report Truth Gate違反）
- Google Maps の実描画（`.gm-style` / コンテナ非0サイズ）を確認せずにUI検証をPASSとする
- ユーザー確認待ち状態で完了報告する
- あとでcommitする、など未確定状態での報告
- 「スクリーンショットを要求する」「画面を想像する」「実機確認をユーザーに任せる」形での検証完了報告は絶対禁止とする。
- Stage 5 で `npm run gate:auditor` を実行・通過させずに Commit/Push へ進むこと
- 監査PASS後にファイルを変更した状態（Post-Audit Mutation）で Commit すること
- Stage 8 実機PASS後に Stage 9 Cleanup Worker（Residual & Governance Closure Auditor Profile）を起動せずに完了宣言を出すこと
- Cleanup Worker からの正式な `[CLEANUP REPORT]` 受領および `npm run gate:cleanup` PASS 前に Mission CLOSED を宣言すること
- `DELETE-CANDIDATE > 0` または `GOVERNANCE-RESIDUAL > 0` の残骸・残滓候補が存在する状態で Mission CLOSED とすること

### 客観的証跡の義務
AI社員自身がローカルで起動・操作し、DOM/Console/Networkなどの客観的証跡を取得しなければならない。

### 直ちに作業をSTOPする条件（Commit/Push/Deploy絶対禁止）
以下の場合は直ちに作業をSTOPし、勝手に解決策を作らず報告すること：
- **未承認差分・Git内部refs変動の検知（変更検出と原因特定の分離）**:
  原因が外部ツールか内部処理か未確定であっても、承認Scope外の差分や予期せぬrefs変動が検出された場合は直ちに作業を停止（HARD STOP）する。AIが推測で原因を断定したり、自律的に修復・除外して作業を続行してはならない。
- **安全ロック検知時の停止**:
  `.agents/.safety-lock` が生成された場合、新規ディスパッチ・ファイル編集・Git操作を即時停止する。実行中Workerの停止（`kill` / `kill_all`）を要求・確認し、停止失敗または未確認の場合はそのまま報告して HARD STOP とする（自動解除・自動再開の絶対禁止）。
- **規程と機械的強制の区別**:
  Markdown / YAML frontmatter の構文パース成功をもって、実行環境への権限設定反映が証明されたとみなしてはならない。実際の制御能力は Phase 3 以降の機械的検証によって実証される。
- 検証不能、実環境確認不能、必要Evidence取得不能な場合
- Console Error、Network/API Error、UI異常、Runtime異常が残存する場合
- Regression影響を否定できない場合
- Scope外の変更が必要になった場合
- Git状態が不明、Deployment結果・本番環境状態が不明な場合
- 仕様変更や権限越権が必要な場合、承認が必要な場合
- ユーザーへ実機検証を委任する必要がある場合
- AI自身が推測でPASS判定しようとする状態
- 既存アプリケーションへの影響が疑われる場合
- その他、AI社員自身で判断してはいけない事項が発生した場合

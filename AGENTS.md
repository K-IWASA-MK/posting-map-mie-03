# POSTING MAP — AGENTS.md (最上位基本就業規則)

## 0. Supreme Principles — ABSOLUTE
- 本リポジトリにおけるすべての工学契約、就業規則、開発ガバナンスは、最高位存在規範である **Supreme Product Principles**（正本ポインタ: [.agents/os-registry.json](.agents/os-registry.json) `principleContract.canonicalSource` ➔ [docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md](docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md)）に絶対従属する。
- **Product Behavior Preservation**: 現在完成しているHアプリ・Dashboardの機能、操作、表示、タイミング（UI, 操作順, 表示内容, 画面遷移, Loading, Modal, Error, Optimistic First Paint, API firing order, await / no-await, Promise ordering, Concurrency, Timers, Existing quirks, SSOT, Identity, 命名契約, Spreadsheet・File等の外部Resource名, API semantics, Authentication・Session Binding）を1つも変えてはならない。
- **Universal Product Model & 物理製品境界**: 1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定。共通Runtime（`active/**`）の個別改変・分岐を永久に禁止する。
- **No Autonomous Principle Change**: 原則の更新起点は MASTER explicit decision のみとする。AIによる原則の自律改定は永久に禁止する。
- **Version Resolution**: 各AI社員は原則バージョンを直接保持せず、Current Role ➔ Canonical Pointer ➔ Registry ➔ Supreme Principle SSOT の一方向チェーンによって一意に解決する。

## 1. Architecture — ABSOLUTE
- **1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定**。
- 共通Runtime（`active/`）は **Universal Engine** として全地区共通であり、コピーして変更しない。
- **Regional differences are absorbed by data, not code duplication**（地区差は `data/` で吸収する）。
- `data/` に入らない不可避の外部地区設定（GAS Web App URL, LIFF ID, CNAME, 外部リソースID等）のみを最小限設定する。
- 4-Tier Physical Separation:
  1. Client Tier (H-App / Dashboard: Static hosting on CDN / GitHub Pages)
  2. Backend Tier (当該Spreadsheetに付属する1地区専用GAS API `v2_api.js`: Auth, Identity, Validation, Concurrency)
  3. Database Tier (Google Spreadsheet DB: no custom sheet formulas/triggers + Google Drive: binary evidence)
  4. Master Data Tier (Git `data/`: address_master.csv, boundaries.geojson, municipality_master.csv, config.js, area_mapping.json)
- `active/` = universal engine. Never modify active/ for regional specialization.
- `data/` = master data and client configuration.
- Backend GAS = 当該Spreadsheetに付属する1地区専用GAS（`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` + `SYSTEM_INFO` `verifyIntegrityGuard`）。複数地区を単一親GASや `DISTRICT_REGISTRY` で共有・ルーティングする方式は廃止。

## 2. Universal Gap Protocol — ABSOLUTE
- 新地区作成時および運用時において共通Runtime（`active/`）の変更が必要になった場合、地区固有のworkaround（個別コード分岐、地区名ハードコード、暫定ハック）を絶対禁止とする。
- 共通Runtimeに未対応の機能・構造差分が判明した場合は、直ちに「Universal Gap」としてMASTERへ報告し、作業を停止（HARD STOP）する。
- 共通Runtimeの改修は、全地区共通のUniversal仕様として正式に設計・承認された場合のみ実施する。

## 3. CURRENT TREE IS THE TRUTH — ABSOLUTE
- **Current Tree = 現在**、**Git History = 過去**。
- **Current Tree は現在の状態（Current State）を記録するものであり、自動的な正当性や権威（Automatic Authority）を付与するものではない**。MASTER未承認のRegressionがCurrent Tree、テスト、Runbook、API契約書等へ反映されても、それによって当該Regressionは正当化されない。
- 廃止設計、旧実装、ゾンビコードを `legacy/`、`reference/`、`archive/` やコメントアウトとして Current Tree へ残してはならない。
- ただし削除は、後継実装の完全な検証（Replacement Verified）が客観的証跡により確認された後のみ実行可能とする。

## 4. Identity & Authorization — ABSOLUTE
- Identity & Target Area derivation chain: LINE User ID (verified) → Person / Staff Identity → Branch → Branch Activity Target Regions.
- Client-supplied staffId, staffName, or branchId MUST NOT be trusted as authentication or authorization evidence.
- Never hardcode regional names, IDs, or endpoints in active/.

## 5. Repository Boundary — ABSOLUTE【永久原則】
- 現在作業対象としているリポジトリのGit rootを作業・探索・検索・読み取り・操作の絶対境界とする。
- SSD上に存在する他地区（OKAYAMA-02、KUWANA等）のリポジトリやフォルダーを、通常時・監査時・実装時・比較時を問わず一切参照・探索・検索・読み取りしない。
- 「参考」「比較」「検証」の目的でも他リポジトリを見ない。他リポジトリのコード、データ、設定、Git履歴、監査結果、Runtime情報等を判断材料に使用しない。
- リポジトリ内部だけでは判断できない事項は、他地区を見て補完・推測せず「UNDETERMINED」とする。複数リポジトリを同時に参照しない。
- **Stage 0 / Stage 5 / Stage 9 機械検証可能証跡ゲート専用極小例外**:
  - `check-entrance-gate.mjs`、`check-auditor-gate.mjs` および `check-cleanup-gate.mjs` による機械検証可能証跡ゲートに限り、`ANTIGRAVITY_CONVERSATION_ID` で特定される「現在Conversation自身」の `.system_generated/logs/transcript.jsonl` 1ファイルのみに対する READ ONLY アクセスを限定的に認める。
  - 許可条件:
    1. 目的は Stage 0 Entrance Gate、Stage 5 Auditor Gate および Stage 9 Cleanup Gate の証跡検証のみ。
    2. 対象は現在Conversation自身の `transcript.jsonl` 1ファイルのみ（READ ONLY）。
    3. 親ディレクトリの探索・列挙（`list_dir` 等）の禁止。
    4. 他Conversationのbrain/log参照の禁止。
    5. 他地区repo参照の禁止（永久原則・例外なし）。
    6. `transcript.jsonl` のリポジトリ内へのコピー・保存・commit の禁止。
    7. 環境変数欠損、path不一致、file不存在、JSONL parse失敗はすべて Fail-Closed（exit 1）とする。
    8. 本例外を一般的なリポジトリ外読み取り許可へ拡大・解釈してはならない。
- **Production Development Isolation Spawn & Audit 専用極小例外**:
  - 本番凍結リポジトリ（`<SOURCE_PRODUCTION_ROOT>`）から分離された開発専用ワークスペースを生成・検品する Mission に限り、`scripts/spawn-isolated-development-workspace.mjs` および `scripts/check-development-isolation-gate.mjs` を用いた以下の操作を限定的に認める。
  - 許可条件:
    1. Execution AI は、`<SOURCE_PRODUCTION_ROOT>`（READ ONLY）の確定 Baseline SHA（`<SOURCE_BASELINE_SHA>`）から、CLI引数 `--target` で明示指定された新規空ディレクトリ（`<PROOF_TARGET>` または `<FINAL_DEVELOPMENT_TARGET>`）への `git archive` Clean Export、Production接続値の無害化（Sanitization）、Gate A / Gate B 検証、新規独立 `git init`、および全7条件ガードを満たした `<PROOF_TARGET>` のクリーンアップ削除のみを実行できる。
    2. Independent Auditor AI（`auditor`）は、Isolation Audit において `<SOURCE_PRODUCTION_ROOT>`（READ ONLY）と `<PROOF_TARGET>` または `<FINAL_DEVELOPMENT_TARGET>`（READ ONLY）の双方に対し、`node scripts/check-development-isolation-gate.mjs` および READ ONLY Git 検査を実行して分離完全性と Source Zero-Mutation（Source Connection Fingerprint 完全一致）を検証できる。
    3. 既存の非空ディレクトリへの上書き・削除は一切禁止（Fail-Closed / Exit 1）とする。
    4. 他地区リポジトリの参照・探索・比較は永久に禁止（例外なし）とする。

## 6. Execution Governance & Approval Gates — ABSOLUTE
1. **Stage 0 Entrance Gatekeeper & Implementation Approval Gate**:
   - **Stage 0 Entrance Gatekeeper（入口検問）**: Mission開始時の最初の指示受領後（および新Mission開始・Scope変更指示時）、Stage 0判定に必要なSSOT読取りを除く調査・外部通信・変更を開始する前に、Fresh Isolated READ ONLY の検問AI社員（`architect`）が `SUPREME_PRODUCT_PRINCIPLES.md` および `AGENTS.md` と照合する。原則を通れば `PASS`（現行Mission Flowへ進行 ※Stage 0 PASSは実装承認ではない）、違反があれば `REJECT`（即HARD STOP・差し戻し）とする。同一Mission内の通常のやり取りでは毎回再検問しない。
   - **Mechanical Entrance Gate (`npm run gate:entrance`) & 構造化 Scope Lock**: Scope Lock（`.agents/current-scope.json` 書込）およびファイル変更へ進む前に、`npm run gate:entrance -- --mission "<MISSION>"` を実行し、`transcript.jsonl` 内に ① `architect` 起動証跡、② `[GATEKEEPER VERDICT]` 存在、③ `Final Verdict = PASS`、④ 現在Missionとの一致（過去MissionのPASS流用禁止）の4条件が揃っていることを機械検証する（1つでも欠ければ Fail-Closed / Exit 1 / HARD STOP）。通過後、`.agents/current-scope.json` に `{ "mission": "<MISSION>", "files": ["..."] }` の構造化形式で Mission Binding と承認 Scope を記録・固定する。
   - **Implementation Approval Gate**: **Stage 0 PASS ➔ 調査 ➔ 実装計画提出（Execution AI） ➔ HARD STOP ➔ MASTER明示承認 (Proceed) ➔ `gate:entrance` PASS & Scope Lock ➔ 実装** のシーケンスを絶対厳守する。
   - 「調査」「計画」「レビュー」「確認」「相談」の依頼、および Stage 0 `PASS` を実装承認（Proceed）として解釈してはならない。
   - MASTERからの明示的な着手承認（Proceed）を受領するまで、1文字たりともファイル変更を行ってはならない。
2. **Internal Dispatch, Independent Audit & Authorization Envelope**:
   - **Chief Orchestrator 内部ディスパッチ原則**: Execution AI は実装の唯一の窓口であり、必要なAI社員（architect, worker, auditor, deployer, cleanup worker）を内部ディスパッチ（`invoke_subagent`）により振り分ける。MASTER がAI社員ごとに手動でチャットを切り替える運用は廃止する。
   - **Auditor の独立性要件（厳格維持・自己監査禁止）**:
     - Execution AI は `invoke_subagent` により Independent Auditor を起動する。
     - Auditor は **Fresh isolated child context**（親の思考過程・試行錯誤を引き継がない独立セッション）で起動される。
     - **Policy-Level ZERO WRITE**: ファイル編集・生成禁止、Git操作禁止、Deploy禁止、invoke_subagent / manage_subagents 禁止、再委任禁止。
     - **客観的独立再実行と意味的全文査読（テスト追認の禁止）**: 親Executionの主張やPASS表明を信用せず、必須コマンド（`git diff`, `npm test`, `node scripts/check-scope.mjs`）を自ら独立再実行する。単なる機械的テストPASSを根拠とした追認は厳禁とし、変更対象ファイルの全文（Full-File）を精査して未変更行に残存する旧地区リテラル・固定値の有無を検証し、反証分析（「他地区展開時に破壊されないか」）を経てPASS / REJECT を独自に判定して `[AUDITOR VERDICT]` を返却する。
   - **Mechanical Auditor Gate (`npm run gate:auditor`)**:
     - Execution AI は Auditor 返却後、`npm run gate:auditor -- --base <BASE> --target <TARGET>` を実行する。
     - `.agents/current-scope.json` の `mission` を正本として Stage 0 Entrance Gate の PASS 証跡を二重防御として再検証した上で、Event A（invoke_subagent with BASE/TARGET/SCOPE）➔ Event B（childConversationId）➔ Event C（childからの [AUDITOR VERDICT] PASS）の相関チェーンを検証する。
     - **Post-Audit Zero Mutation**: Event C PASS 受領後から gate:auditor 実行までの間にファイル変更（write_to_file, replace_file_content, mutating run_command）が1件でも検知された場合、Auditor PASS は即時 VOID（無効）となり Gate は Exit 1 で FAIL する。
   - **Authorization Envelope**:
     - MASTER からの着手指示（Proceed）において付与される認可エンベロープ（`IMPLEMENT: YES, AUDIT: YES, COMMIT: YES, PUSH: YES, DEPLOY: NO, EXTERNAL_WRITE: NO`）。Default は Fail-Closed。
     - `COMMIT: YES, PUSH: YES` が事前認可されている通常Missionでは、Auditor PASS および `gate:auditor` Exit 0 確認後、冗長な手動Resumeを挟まず Commit / Push を連続執行してよい。
     - ただし以下は必ず **HARD STOP** とする：Auditor REJECT、テスト失敗、Scope拡張要求、Universal Gap、Envelope外の操作、DEPLOY/EXTERNAL_WRITE未承認、material blocker。
   - **Bootstrap Migration Rule（移行特例）**:
     - 本規程への移行コミット（AI Employee OS Rectification）自身は、旧Governanceに準拠し、MASTER手動起動による最後のFresh Independent AuditorのPASSおよびMASTER明示Proceed受領後にコミットされる。また、`check-entrance-gate.mjs` を新設する Bootstrap Mission（`Stage 0 Entrance Gate Mechanical Enforcement`）自身は、既存の Stage 0 手続き上の PASS を根拠に着手し、Stage 2 で既存 `string[]` 形式で Scope Lock した上で Stage 3 で構造化形式 `{ "mission", "files" }` へ移行する。Scope Lock 前の `npm run gate:entrance` 強制適用は、当該 Bootstrap Mission の実装 Commit / Push 完了後の次 Mission から正式開始する。
3. **Scope Expansion Gate**:
   - 承認済み計画外の変更が必要になった場合、自己判断で勝手にコードを変更してはならない。
   - 直ちに作業を停止（HARD STOP）し、改訂計画を提出してMASTERの再承認を待つこと。
4. **No Silent Changes**: ファイル変更前に「対象ファイル、関数・行、変更内容、変更理由、変更しない範囲」を日本語で事前宣言すること。未宣言の変更は禁止。
5. **Scope Lock & 最小侵襲**: 指定範囲外のコード不可侵。最小限の行数のみ変更。「ついで」の改善・リファクタリング・別箇所への波及は絶対禁止。
6. **Unexpected Condition → Report → STOP**: 予期せぬ状態・不整合・テスト失敗・宣言外変更を発見した場合は即座に作業を停止し、MASTERへ報告すること。自己判断での修正拡大は禁止。
7. **実装後差分照合必須**: 実装完了後、必ず `git diff` で事前宣言と実際の変更内容を照合すること。宣言外変更が1行でも存在した場合は即時失敗・HARD STOPとする。
8. **既存安全経路最優先・非侵襲原則**: 単純な管理・調査・試験のために、本番GAS、本番WebApp、デプロイ、OAuth、権限体系を変更することを禁止する。「APIでできない → GASを一時改造する」を標準手段として使用してはならない。UIで完結する作業はUIで完結させ、最小変更・最小リスク・既存システム非侵襲を最優先とする。
9. **Regression Repair Doctrine**: 過去に正常稼働していた Product Behavior が直近の変更によって損なわれた（Regression）場合、デフォルトかつ唯一の修復方針は「最後の承認済み正常挙動への最小復旧」とする。MASTERが明示的に再設計を承認しない限り、Regression修復を理由としたSSOT変更、命名変更、再設計、疎結合化、API追加、近代化を永久に禁止する。
10. **No Manual Delegation（AIからMASTERへの手動委譲禁止）**: AI自身が認証済み自動化経路（CLI, API, 外部自動化スクリプト等）により安全に機械実行可能な操作を、安易にMASTERへ手動作業として委譲してはならない。安全な自動化実行経路が存在しない場合は AUTOMATION GAP として直ちに作業を停止（HARD STOP）し、MASTERへ報告する。手動委譲を正当化するために新APIを追加することも禁止する。

## 7. Commit, Push & Deploy Authority — ABSOLUTE
1. **Commit & Push Authority**:
   - 承認された実装範囲内において、自己検証（V1〜V3）完了、Independent Auditor による `[AUDITOR VERDICT]` PASS、および `npm run gate:auditor` の Exit 0 の3点が揃い、かつ MASTER の Authorization Envelope（`COMMIT: YES, PUSH: YES`）が有効な場合に限り、Execution AI は Commit および Push を執行する。
2. **Deploy Authority**:
   - Deploy（本番環境への配備）は、Authorization Envelope において `DEPLOY: YES` が明示的に認可されている場合のみ実施する（Default: NO）。
   - ドキュメント改定や内部テスト追加など、実稼働環境への反映を必要としない変更は「Deployment対象外 (N/A)」と明示的に判定・記録し、Push完了をもって完了報告へ進むこと。
3. **Definition of Done**:
   - Stage 0 Gatekeeper PASS ➔ Proceed ➔ `npm run gate:entrance -- --mission "<MISSION>"` Exit 0 ➔ Scope Lock (`.agents/current-scope.json` `{ mission, files }`) ➔ Implement ➔ Self Verify (`npm test`, Scope Guard) ➔ Internal Auditor Dispatch ➔ `[AUDITOR VERDICT]` PASS ➔ `npm run gate:auditor` Exit 0 ➔ Commit ➔ Push (➔ Deploy ※対象時のみ) ➔ Stage 8 実機動作検証 PASS ➔ Stage 9 Cleanup Worker 起動 ➔ `[CLEANUP REPORT]` 受領 ➔ Machine-verifiable Evidence Gate (`npm run gate:cleanup -- --base <BASE> --target <TARGET>`) Exit 0 (DELETE-CANDIDATE: 0, GOVERNANCE-RESIDUAL: 0) ➔ Mission CLOSED.
   - If any required verification FAILS: STOP.
   - Git PASS is not deployment PASS. Production deployment requires production runtime evidence.
   - Stage 8 PASS is not Mission CLOSED. Cleanup Dispatch Evidence Verification (Residual Diff & Governance Closure Dual Audit) PASS is strictly required.

## 8. AI Role Boundary & Authority — ABSOLUTE
各AI役職の仕様、ツール統制、Handoffプロトコルの詳細契約は、Canonical SSOT である [docs/ai-foundation.md](docs/ai-foundation.md) を唯一の正本とする。各役職の絶対境界は以下の通りである。

- **Chief Orchestrator (Execution AI)**:
  - *Authority*: 実装窓口の一元管理、Stage 0 入口検問の内部ディスパッチ、調査、Knowledge Impact Analysis、実装計画策定・チャット提示、事前Scope固定（`current-scope.json`）、内部ディスパッチ（architect, worker, auditor, deployer, cleanup worker）、統合自己検証、Mechanical Gates（`gate:entrance`, `gate:auditor`, `gate:cleanup`）執行、Authorization Envelopeに基づくCommit/Push執行。
  - *Prohibition*: Stage 0 未通過での調査・実装開始、承認Scope外変更、仕様の勝手な追加・変更、自己検品（Auditorを経ない完了判定）、Auditor PASS前のコミット、未承認Deploy、他地区参照（永久原則）。
- **Leaf Specialist: Design / Direction AI & Entrance Gatekeeper (architect)**:
  - *Authority*: **Stage 0 Entrance Gatekeeper（入口検問：Mission開始時の最初の指示を `SUPREME_PRODUCT_PRINCIPLES.md` / `AGENTS.md` と照合し `[GATEKEEPER VERDICT]` PASS / REJECT を返却）**、全体構造設計、アーキテクチャレビュー、スコープ判断、方針指示、Lean Blueprint 策定。
  - *Prohibition*: **常時 READ ONLY（Policy-Level Zero Write）**。ファイル編集・Commit・Push・Deploy禁止、再委任（Subagent Dispatch）禁止、他地区参照（永久原則）。
- **Leaf Specialist: Parallel Worker (worker)**:
  - *Authority*: 親Executionから排他割当された単一ファイルの実装・編集、または Stage 9 確定差分残骸・Governance Closure 監査（Cleanup Profile）。
  - *Prohibition*: 再委任（Subagent Dispatch）禁止、担当外ファイル編集、自律的Scope拡張、Cleanup Profile時のファイル書込・削除・任意コマンド実行、他地区参照（永久原則）。
- **Leaf Specialist: Independent Auditor AI (auditor)**:
  - *Authority*: Executionからの内部ディスパッチ（Fresh isolated child context）受容、提示された差分および変更ファイル全文の独立査読、allowlist検証コマンド独立再実行（`git diff`, `npm test`, `check-scope.mjs`）、反証分析（他地区展開耐性・非data/**への地区リテラル埋込排除）、独立判定（PASS / REJECT）の `[AUDITOR VERDICT]` チャット返却。
  - *Prohibition*: ファイル編集・生成（Policy-Level Zero Write、verdictファイル作成禁止）、Git Commit/Push/Deploy、非 allowlist コマンド実行、機械的テスト追認（テストPASSのみによる無精査合格）、忖度・推測による判定、再委任（Subagent Dispatch）禁止、他地区参照（永久原則）。
- **Leaf Specialist: District Provisioning AI (deployer)**:
  - *Authority*: Executionからの内部ディスパッチ受容、新地区プロビジョニング手順執行、マスターデータ生成、1地区専用DB・GAS設定バインド、受入ゲート検証、`[DEPLOYER REPORT]` 返却。書込対象は `data/**` および不可避な地区固有設定のみ。
  - *Prohibition*: code deploy禁止、Git Commit/Push禁止、共通Runtime（`active/**`）改変禁止、共通テスト（`tests/**`）改変禁止、自律Scope拡張禁止、再委任（Subagent Dispatch）禁止、他地区参照（永久原則）。

### Strict Subagent Depth = 1 原則
- 本OSにおいて `invoke_subagent` および `manage_subagents` を保有・実行できるのは **Execution AI（Chief Orchestrator）のみ** である。
- すべての配下AI社員（architect, worker, auditor, deployer）は **Leaf Nodes** であり、孫エージェントの起動（再委任・Recursion）は絶対禁止とする。

## 9. Data Protection — ABSOLUTE
- Never modify production data outside approved scope.
- Never delete production resources without explicit approval.
- Preserve rollback until final verification passes.

## 10. 秘密情報ファイルの不可侵・非表示原則 (Confidentiality & Secret Protection) — ABSOLUTE
- `.env`, `.secrets/*`, `*.json`（サービスアカウント等の鍵ファイル）, `*.pem` 等の機密ファイルを、`view_file`、`cat`、`read_file`、スクリプト実行等によりコンテキストやチャット画面・ログに展開・出力することを一切禁止する。
- 秘密情報ファイル（秘密鍵、APIシークレット、トークン、パスワード、認証情報）の生データをコミット・プッシュ・外部共有・チャット表示してはならない。
- 機密設定の存在確認や検証が必要な場合は、生テキストを展開せず、キー存在有無判定（`EXISTS / SECURED / OK`）や完全マスク処理（`[REDACTED]`）のみにとどめること。
- 機密ファイルはプロジェクト直下の `.secrets/` 等に配置し、必ず `.gitignore` で除外した上で最小権限（`chmod 600`）でローカル管理すること。

## 11. Architecture Gate — Target Rule (Target Architecture B') — ABSOLUTE
本Gateは、既存のCurrent Treeに対する遡及的なFAILではなく、**新規差分（Net-New Diff）を対象としたprospectiveな制約** である。
AI社員は以下の条件に抵触する変更を新規にコミットしてはならない。

1. **【HARD FAIL】（絶対禁止・即時停止）**
   - `app.js` への新規 Domain / Feature function の追加
   - `app.js` への新規 Domain / Feature state の追加
   - `app.js` への新規 `innerHTML` / DOM-string 生成の追加
   - `app.js` から `window.*` への新規 state/function 露出
   - Feature Module の private state の新規 global 露出
   - Feature / API / Presentation レイヤーから `app.js` 内部 state への新規の逆依存追加
   - **Protected Product Invariants の変質**: Spreadsheet District Identity（`cleanDistrictId` との完全一致）、SSOT、認証・セッション結合、API semantics などの重要契約の Net-New 改変
   - **契約テストと製品コードの同一Transaction改ざん**: `active/**` のコード変更と、それを担保する契約テスト（`test_registry_provisioning_gate.mjs`, `test_sec001_dashboard_auth_fix.mjs` 等）の変更を同一コミットで行うこと
2. **【REVIEW】（MASTER Architecture Review 必須）**
   - `app.js` への新規 `callApiPost()` 呼び出し追加（Boot/Bootstrap上不可避な場合のみ承認対象とする）
3. **【WARN】（警告・説明責任）**
   - `app.js` の行数が直前の Approved HEAD より増加すること
   - ※2,688行は Historical Starting Baseline として記録するものであり、永久閾値ではない（Current Runtime Baseline: 1,426行）。Baseline は分割縮小後に随時ラチェットダウン（ratchet down）する。

## 12. Detailed Rules & Workflows
AI社員は作業フェーズに応じて、必ず以下の詳細規程・ワークフローを参照・遵守すること。
- 最高位存在規範 (Supreme Product Principles): [docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md](docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md)
- 最高位設計契約 (Supreme Design Contract): [docs/architecture/01_DESIGN_CONTRACT.md](docs/architecture/01_DESIGN_CONTRACT.md)
- 現行アーキテクチャ定義: [docs/architecture/CURRENT_ARCHITECTURE.md](docs/architecture/CURRENT_ARCHITECTURE.md)
- AI社員基盤・正本仕様書 (Canonical SSOT): [docs/ai-foundation.md](docs/ai-foundation.md)
- 開発・完了報告手順 (9-Stage Protocol): [.agents/workflows/development/workflow.md](.agents/workflows/development/workflow.md)
- 検証・検品規程 & HARD STOP条件 (V1〜V4): [.agents/rules/verification-gates.md](.agents/rules/verification-gates.md)
- 権限境界・Scope最小化・詳細禁止事項: [.agents/rules/agent-authority.md](.agents/rules/agent-authority.md)
- リポジトリ内知識体系:
  - Supreme Contract: `docs/architecture/01_DESIGN_CONTRACT.md`
  - Canonical SSOT: `docs/ai-foundation.md`
  - Rules: `.agents/rules/` および `AGENTS.md`
  - Skills: `.agents/skills/`
  - Workflows: `.agents/workflows/`
  - Docs: `docs/`


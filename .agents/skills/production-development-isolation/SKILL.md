---
name: production-development-isolation
description: 完成済み本番リポジトリ（Source Production）を1ミリも改変・汚損せず、本番接続（GAS WebApp URL, LIFF ID, CNAME, .clasp.json, deployment.json, git remote）を完全に遮断した独立開発ワークスペース（Isolated Development Workspace）を Clean Export・機械検品（Gate A / Gate B）・独立監査により安全に生成する Universal Skill。
version: 1.0.0
---

# Production Development Isolation Skill (本番凍結・独立開発ワークスペース安全分離規範)

- **Status**: `CANONICAL / ACTIVE`
- **Authorized Role**: `execution` (Verified by Fresh Independent `auditor`)
- **Canonical References**:
  - `docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md`
  - `AGENTS.md`
  - `.agents/rules/verification-gates.md`
  - `scripts/spawn-isolated-development-workspace.mjs`
  - `scripts/check-development-isolation-gate.mjs`

---

## 1. Purpose & Scope (目的と適用範囲)

本スキルは、稼働中または完成済みの本番リポジトリ（`<SOURCE_PRODUCTION_ROOT>`）を **Production Frozen Baseline（本番凍結ベースライン）** として 100% 保護しながら、次期機能開発・リファクタリング・検証を本番環境（本番 GAS、本番 Spreadsheet、本番 LIFF、本番 Domain、本番 Git Remote）から物理的・論理的に完全遮断された **独立開発ワークスペース（`<FINAL_DEVELOPMENT_TARGET>`）** へ安全に分離（Spawn）するための実証済み標準手順を規定する。

---

## 2. Canonical Principles & Universal Placeholders (最上位不変原則とプレースホルダー契約)

1. **Two-Layer Production Zero-Mutation Contract (2層本番無改変契約)**:
   - **Layer A — Production Runtime / Product Surface Preservation**:
     - `active/**`, `data/**`, `CNAME`, `index.html`, および外部本番資源（GAS, Spreadsheet, LIFF, Domain）は `diff = 0 / mutation = 0` を絶対維持する。
   - **Layer B — Spawn-Time Source Zero-Mutation**:
     - 各 Spawn 実行前後において、Source リポジトリの HEAD SHA・Working Tree・`.git/config`・`.clasp.json`・`active/.clasp.json`・`deployment.json` の SHA-256 フィンガープリント（`SourceConnectionFingerprint`）が `BEFORE === AFTER` で完全一致しなければならない（`B-08`）。
2. **No Naive Copy (`cp -R` / `rsync` 禁止)**:
   - 未追跡の秘密情報（`.env`, `.secrets/**`, `*.pem`）やローカル本番接続設定（`.clasp.json`, `active/.clasp.json`, `deployment.json`, `.git/config`）の混入を防ぐため、ディレクトリ丸ごとコピーを禁止し、確定コミット `<SOURCE_BASELINE_SHA>` からの `git archive` Clean Export のみを使用する。
3. **Canonical Runtime Config Contract (`window.PMS_CLIENT_CONFIG`)**:
   - クライアント設定の唯一の正本スキーマは `window.PMS_CLIENT_CONFIG`（`districtId`, `api.gasWebAppUrl`, `line.liffId`）である。旧 `window.CONFIG` フォールバックや二重スキーマ対応を一切禁止する。
4. **Universal Placeholders (特定パス・地区リテラル記述禁止)**:
   - `<SOURCE_PRODUCTION_ROOT>`: 本番凍結元リポジトリの Git Root
   - `<SOURCE_BASELINE_SHA>`: Clean Export の起点となる確定 Git Commit SHA
   - `<PROOF_TARGET>`: 実証・独立監査用の Proof Workspace ディレクトリ（末尾 `-proof`）
   - `<FINAL_DEVELOPMENT_TARGET>`: 最終開発用ワークスペースディレクトリ
   - `<RUN_ID>`: Spawn 実行時に発行される一意の UUID（`.isolated-dev-manifest.json` に記録）

---

## 3. Verified 7-Step Isolation Workflow (実証済み 7 段階分離手順)

### Step 1: Source Baseline Verification (起点ベースライン検証)
1. `<SOURCE_PRODUCTION_ROOT>` において `git rev-parse HEAD` および `git status --porcelain` を確認し、Working Tree が完全に Clean（出力 0 行）であることを検証する。
2. Spawn 実行直前の `SourceConnectionFingerprint`（`headSha`, `statusPorcelain`, `gitConfigLocal`, `rootClaspJson`, `activeClaspJson`, `deploymentJson`）を取得・固定する。

### Step 2: Clean Git Archive Export (クリーンエクスポート)
1. 出力先ディレクトリ（`<PROOF_TARGET>` または `<FINAL_DEVELOPMENT_TARGET>`）が未存在または空ディレクトリであり、かつ `<SOURCE_PRODUCTION_ROOT>` の外部（別パス）であることを確認する（非空ディレクトリの上書きは Fail-Closed で即座に拒否）。
2. `git archive --format=tar <SOURCE_BASELINE_SHA>` により、Git Tracked Files のみをターゲットディレクトリへ展開する。これにより `.git/**`, `.clasp.json`, `active/.clasp.json`, `deployment.json`, `.env*`, `.secrets/**`, `node_modules/**` 等のローカル状態・秘密情報は構造的に除外される。

### Step 3: Canonical Runtime Config & Domain Sanitization (本番接続の無害化)
1. **Runtime Config (`data/config.js`)**:
   - `window.PMS_CLIENT_CONFIG.api.gasWebAppUrl` を `""`（空文字）へ無害化する。
   - `window.PMS_CLIENT_CONFIG.line.liffId` を `""`（空文字）へ無害化する。
   - `window.PMS_CLIENT_CONFIG.districtId` およびその他の構造・フィールド（`version`, `status`, `environment`, `staticMaster`, `features` 等）は 100% 保持する。
2. **Custom Domain (`CNAME`)**:
   - ターゲット側の `CNAME` を空（0 bytes）へ無害化し、本番独自ドメインへの誤バインドを遮断する。
3. **Isolation Provenance Manifest (`.isolated-dev-manifest.json`)**:
   - `schemaVersion`, `isolationMode` (`"proof"` または `"final"`), `runId` (`<RUN_ID>`), `sourceBaselineSha` (`<SOURCE_BASELINE_SHA>`), `sanitizedFiles` (`["CNAME", "data/config.js"]`), `masterDataDigests`, `verificationStatus` を記録したマニフェストを生成する。

### Step 4: Gate A — 10-Item Isolation Audit (分離完全性ゲート A)
`node scripts/check-development-isolation-gate.mjs --source <SOURCE_PRODUCTION_ROOT> --target <TARGET> --phase A` により以下 10 項目を機械検証する（1 項目でも違反があれば Fail-Closed / Exit 1）：
- **A-01 (`Path Disjointness`)**: Source と Target が物理的に別パスであり、相互に親子関係を持たないこと。
- **A-02 (`Zero Clasp & Deployment Bindings`)**: `.clasp.json`, `active/.clasp.json`, `deployment.json` が Target 内に一切存在しないこと。
- **A-03 (`Baseline Tracked File Preservation + Explicit Local/Secret Deny`)**: NUL 安全な `git -c core.quotePath=false ls-tree -r -z --name-only <SOURCE_BASELINE_SHA>`（日本語・濁点・空白を含む UTF-8 パスを無変換保持）に基づき、Tracked Files が欠損・余剰・未承認改変なく保持され（`missing = 0`, `extra = 0`, `modifiedNonSanitized = 0`）、かつ禁止ローカル・秘密ファイルが 0 件であること。
- **A-04 (`Active Engine Byte-Identical`)**: `active/**` の全ファイルが `<SOURCE_BASELINE_SHA>` と SHA-256 完全一致し、かつ `tests/**` を import していないこと。
- **A-05 (`CNAME Sanitized`)**: Target の `CNAME` が空（0 bytes）であること。
- **A-06 (`Canonical Runtime Config Sanitized`)**: `data/config.js` を VM 評価し、`window.PMS_CLIENT_CONFIG` の `api.gasWebAppUrl === ""`、`line.liffId === ""`、かつ `districtId` が非空文字列として保持されていること。
- **A-07 (`Zero Production Runtime Bindings — 5分類検査`)**: Source から動的抽出した本番識別子（GAS WebApp URL, Deployment ID, Script ID, Spreadsheet ID, LIFF ID, Domain）を Target 全体で走査し、5 分類（`RUNTIME_BINDING`, `DEPLOYMENT_BINDING`, `LOCAL_BINDING`, `STATIC_TEST_FIXTURE`, `HISTORICAL_DOC_REFERENCE`）のうち **`RUNTIME_BINDING === 0`、`DEPLOYMENT_BINDING === 0`、`LOCAL_BINDING === 0`** であること。
- **A-08 (`Master Data Preservation`)**: `data/address_master.csv`, `data/boundaries.geojson`, `data/municipality_master.csv`, `data/area_mapping.json`, `data/storage_locations.json` が Source と SHA-256 完全一致すること。
- **A-09 (`Isolation Manifest Validity`)**: `.isolated-dev-manifest.json` のスキーマ・必須フィールド・ハッシュ整合性が有効であること。
- **A-10 (`Target Self-Contained Tests`)**: Target 単体で `validate-gas-endpoint-ssot.mjs` および `check-secrets.mjs` が PASS すること。

### Step 5: Independent Git Initialization & Gate B (独立 Git 初期化・ゲート B)
1. Target 内で新規独立 `git init -b main` を実行し、Initial Commit（`chore(isolation): initialize isolated development workspace from baseline <SHORT_SHA>`）を 1 件作成する（`git remote` は一切設定しない）。
2. `node scripts/check-development-isolation-gate.mjs --source <SOURCE_PRODUCTION_ROOT> --target <TARGET> --phase B` により以下 8 項目を機械検証する：
   - **B-01**: Target が独立した `.git` リポジトリを持つこと。
   - **B-02**: `git remote -v` が完全に空（`remote = 0`）であること。
   - **B-03**: Commit 数がちょうど 1 件（Initial Isolation Commit のみ）であること。
   - **B-04**: Target の `git status --porcelain` が完全に Clean であること。
   - **B-05**: Source の Working Tree が Clean であり、`HEAD === <SOURCE_BASELINE_SHA>` が不変であること。
   - **B-06**: `active/h-app/modules/api.js` および `active/dashboard/app.js` が `window.PMS_CLIENT_CONFIG.api.gasWebAppUrl` 空文字時にネットワーク通信を行わず安全に Fail-Closed ガードすること。
   - **B-07**: Gate A（`A-01..A-10`）が Initial Commit 後も全項目 PASS を維持していること。
   - **B-08**: Spawn 前後の `SourceConnectionFingerprint` が 6 項目すべて完全一致（`BEFORE === AFTER`）していること。

### Step 6: Fresh Independent Isolation Audit (独立監査官による実機分離検品)
Execution AI は Fresh isolated child context の `auditor` を起動し、Source（READ ONLY）と Target（READ ONLY）の双方に対して `check-development-isolation-gate.mjs --phase B` の独立再実行および実ファイル照合を行わせ、`[AUDITOR VERDICT] Final Verdict: PASS` を取得する。

### Step 7: Proof Cleanup & Final Workspace Verification (7条件ガード付き Proof 削除)
`<FINAL_DEVELOPMENT_TARGET>` の生成および Gate A / Gate B PASS 確認後、検証用の `<PROOF_TARGET>` を削除する場合は、手動の `rm -rf` を使用せず、必ず以下の 7 条件ガード付きコマンドを実行する：

```bash
node scripts/spawn-isolated-development-workspace.mjs \
  --cleanup-proof \
  --target <PROOF_TARGET> \
  --final-target <FINAL_DEVELOPMENT_TARGET> \
  --run-id <RUN_ID> \
  --baseline <SOURCE_BASELINE_SHA>
```

- **7-Condition Cleanup Guard**:
  1. `<PROOF_TARGET>/.isolated-dev-manifest.json` の `isolationMode === "proof"` であること。
  2. `manifest.runId === <RUN_ID>` であること。
  3. `manifest.sourceBaselineSha === <SOURCE_BASELINE_SHA>` であること。
  4. `fs.realpathSync(<PROOF_TARGET>) !== fs.realpathSync(<SOURCE_PRODUCTION_ROOT>)` であること。
  5. `fs.realpathSync(<PROOF_TARGET>) !== fs.realpathSync(<FINAL_DEVELOPMENT_TARGET>)` であること。
  6. `path.basename(<PROOF_TARGET>).endsWith("-proof")` であること。
  7. `<FINAL_DEVELOPMENT_TARGET>/.isolated-dev-manifest.json` が存在し、`isolationMode === "final"` かつ `verificationStatus.gateA === "PASS"` かつ `verificationStatus.gateB === "PASS"` であること。

---

## 4. Standard CLI Commands (標準実行コマンド)

- **Proof Workspace Spawn**:
  ```bash
  npm run isolate:spawn -- --target <PROOF_TARGET> --mode proof
  ```
- **Final Development Workspace Spawn**:
  ```bash
  npm run isolate:spawn -- --target <FINAL_DEVELOPMENT_TARGET> --mode final
  ```
- **Standalone Isolation Gate Verification (Phase A & Phase B)**:
  ```bash
  npm run gate:isolation -- --source <SOURCE_PRODUCTION_ROOT> --target <FINAL_DEVELOPMENT_TARGET> --phase B
  ```

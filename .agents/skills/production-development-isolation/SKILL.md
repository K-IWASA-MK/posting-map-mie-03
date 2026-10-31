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
     - `active/**`, `data/**`, `CNAME`, `index.html`, `docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md`, および外部本番資源（GAS, Spreadsheet, LIFF, Domain）は `diff = 0 / mutation = 0` を絶対維持する。
   - **Layer B — Spawn-Time Source Zero-Mutation (`SourceConnectionFingerprint` 9項目完全一致)**:
     - 各 Spawn 実行前後において、Source リポジトリの以下 **9 項目**のフィンガープリント（`SourceConnectionFingerprint`）が `BEFORE === AFTER` で完全一致しなければならない（`B-08`）：
       1. `headSha`
       2. `gitStatusPorcelain`
       3. `gitRemoteVerbose`
       4. `gitConfigLocal`
       5. `rootClaspJson`
       6. `activeClaspJson`
       7. `deploymentJson`
       8. `dataConfigJs`
       9. `cnameFile`
2. **No Naive Copy (`cp -R` / `rsync` 禁止)**:
   - 未追跡の秘密情報（`.env*`, `.secrets/**`, `*.pem`）やローカル本番接続設定（`.clasp.json`, `active/.clasp.json`, `deployment.json`, `.git/config`）の混入を防ぐため、ディレクトリ丸ごとコピーを禁止し、確定コミット `<SOURCE_BASELINE_SHA>` からの `git archive` Clean Export のみを使用する。
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
1. `<SOURCE_PRODUCTION_ROOT>` において `git rev-parse HEAD` および `git status --porcelain` を確認し、Working Tree が完全に Clean（出力 0 行）であり `HEAD === <SOURCE_BASELINE_SHA>` であることを検証する。
2. Spawn 実行直前の 9 項目 `SourceConnectionFingerprint`（`headSha`, `gitStatusPorcelain`, `gitRemoteVerbose`, `gitConfigLocal`, `rootClaspJson`, `activeClaspJson`, `deploymentJson`, `dataConfigJs`, `cnameFile`）を取得・固定する。

### Step 2: Clean Git Archive Export (クリーンエクスポート)
1. 出力先ディレクトリ（`<PROOF_TARGET>` または `<FINAL_DEVELOPMENT_TARGET>`）が未存在または空ディレクトリであり、かつ `<SOURCE_PRODUCTION_ROOT>` と同一または親子重複でないことを確認する（非空ディレクトリの上書きは Fail-Closed で即座に拒否）。
2. `git archive --format=tar <SOURCE_BASELINE_SHA>` により、Git Tracked Files のみをターゲットディレクトリへ展開する。これにより `.git/**`, `.clasp.json`, `active/.clasp.json`, `deployment.json`, `.env*`, `.secrets/**`, `node_modules/**` 等のローカル状態・秘密情報は構造的に除外される。

### Step 3: Canonical Runtime Config & Domain Sanitization (本番接続の無害化)
1. **Runtime Config (`data/config.js`)**:
   - `window.PMS_CLIENT_CONFIG.api.gasWebAppUrl` を `""`（空文字）へ無害化する。
   - `window.PMS_CLIENT_CONFIG.line.liffId` を `""`（空文字）へ無害化する。
   - `window.PMS_CLIENT_CONFIG.districtId` およびその他の構造・フィールド（`version`, `status`, `environment`, `staticMaster`, `features` 等）は 100% 保持する。
2. **Custom Domain (`CNAME`)**:
   - ターゲット側の `CNAME` を空（0 bytes）へ無害化し、本番独自ドメインへの誤バインドを遮断する。
3. **Isolation Provenance Manifest (`.isolated-dev-manifest.json`)**:
   - 以下の実装正本 9 フィールドを持つマニフェストを生成する：
     - `schemaVersion`: `"1.0"`
     - `markerType`: `"ISOLATED_DEV_WORKSPACE_MANIFEST"`
     - `mode`: `"proof"` または `"final"`
     - `runId`: `<RUN_ID>`
     - `spawnedAt`: ISO-8601 生成日時
     - `sourceBaselineSha`: `<SOURCE_BASELINE_SHA>`
     - `targetRealpath`: Target の `fs.realpathSync` 解決パス
     - `sourceFingerprintBefore`: 9 項目の Source Connection Fingerprint オブジェクト
     - `sanitizedFields`: `["data/config.js:PMS_CLIENT_CONFIG.api.gasWebAppUrl", "data/config.js:PMS_CLIENT_CONFIG.line.liffId", "CNAME"]`

### Step 4: Gate A — Pre-Git-Init 10-Item Isolation Gate (分離完全性ゲート A)
Git 初期化前に `runGateA`（CLI: `node scripts/check-development-isolation-gate.mjs --source <SOURCE_PRODUCTION_ROOT> --target <TARGET> --phase A`）により以下 10 項目を機械検証する（1 項目でも違反があれば Fail-Closed / Exit 1）：
- **A-01 (`No .git Directory Pre-Init`)**: Git 初期化前（Phase A）において Target 内に `.git` が存在しないこと。
- **A-02 (`Explicit Local & Secret Binding Deny`)**: `.clasp.json`, `active/.clasp.json`, `deployment.json`, 非テンプレート `.env*`, `.secrets/**`, 未追跡の鍵・認証情報ファイルが Target 内に一切存在しないこと。
- **A-03 (`Baseline Tracked File Preservation`)**: NUL 安全な `git -c core.quotePath=false ls-tree -r -z --name-only <SOURCE_BASELINE_SHA>`（日本語・濁点・空白を含む UTF-8 パスを無変換保持）に基づき、Tracked Files が欠損・余剰・未承認改変なく保持されていること（`missing = 0`, `extra = 0`, `modifiedNonSanitized = 0`）。
- **A-04 (`Runtime-to-Fixture Isolation`)**: `index.html`, `data/config.js`, `active/**` が `tests/**` や `docs/**` を `import` / `fetch` / `src` / `href` 参照していないこと。
- **A-05 (`Zero Concrete GAS Exec URLs on Runtime/Deployment Surfaces`)**: Runtime / Deployment 対象ファイル上に具体的な GAS WebApp `/exec` URL が残存していないこと。
- **A-06 (`Canonical Runtime Config & CNAME Sanitized`)**: `data/config.js` を VM 評価し、`window.PMS_CLIENT_CONFIG.api.gasWebAppUrl === ""`、`window.PMS_CLIENT_CONFIG.line.liffId === ""`、`window.PMS_CLIENT_CONFIG.districtId` が非空文字列として保持され、かつ `CNAME` が空（0 bytes）であること。
- **A-07 (`Zero Production Runtime Bindings — 5分類検査`)**: Source から動的抽出した本番識別子（GAS WebApp URL, Deployment ID, Script ID, Spreadsheet ID, LIFF ID, Domain）を Target 全体で走査し、5 分類（`RUNTIME_BINDING`, `DEPLOYMENT_BINDING`, `LOCAL_BINDING`, `TEST_FIXTURE`, `DOCUMENTATION`）のうち **`RUNTIME_BINDING === 0`、`DEPLOYMENT_BINDING === 0`、`LOCAL_BINDING === 0`** であること。
- **A-08 (`Canonical Data Fixture Preservation`)**: 4 つの正本マスターデータファイル（`data/address_master.csv`, `data/boundaries.geojson`, `data/municipality_master.csv`, `data/storage_locations.json`）が `<SOURCE_BASELINE_SHA>` と SHA-256 完全一致し、`window.PMS_CLIENT_CONFIG.districtId` が Source と一致すること。
- **A-09 (`GAS Endpoint SSOT Validation in Template Mode`)**: Target 単体で `scripts/validate-gas-endpoint-ssot.mjs` が Template Mode として PASS（Exit 0）すること。
- **A-10 (`Isolation Manifest Integrity`)**: `.isolated-dev-manifest.json` の `markerType`, `mode`, `runId`, `sourceBaselineSha`, `targetRealpath`, および 9 項目の `sourceFingerprintBefore` が完全・整合していること。

### Step 5: Independent Git Initialization & Gate B (独立 Git 初期化・ゲート B)
1. Target 内で新規独立 `git init -b main` を実行し、Initial Commit（`chore(isolation): initialize isolated development workspace from <SHORT_SHA>`）を 1 件作成する（`git remote` は一切設定しない）。
2. `node scripts/check-development-isolation-gate.mjs --source <SOURCE_PRODUCTION_ROOT> --target <TARGET> --phase B` により以下 8 項目を機械検証する：
   - **B-01 (`Independent Git Root Exact Match`)**: Target の `git rev-parse --show-toplevel` が Target の `fs.realpathSync` と完全一致すること。
   - **B-02 (`Zero Git Remotes`)**: Target の `git remote -v` が完全に空（`remote = 0`）であること。
   - **B-03 (`Single Initial Isolation Commit`)**: Target の Commit 数がちょうど 1 件であり、かつ Target HEAD SHA が `<SOURCE_BASELINE_SHA>` と異なること。
   - **B-04 (`Clean Target Working Tree`)**: Target の `git status --porcelain` が完全に Clean であること。
   - **B-05 (`Post-Git-Init Gate A Re-Verification`)**: Git 初期化後も Gate A の `A-02..A-10` 全項目が `PASS` を維持していること。
   - **B-06 (`Runtime Fail-Closed Guards & District Data Gate`)**: `active/h-app/modules/api.js`, `active/manager/manager.js`, `index.html` における `window.PMS_CLIENT_CONFIG` Fail-Closed ガードおよび `scripts/validate-district-data-gate.mjs` が PASS すること。
   - **B-07 (`Source Baseline Consistency`)**: Source の `HEAD === <SOURCE_BASELINE_SHA>` が不変であり、`git status --porcelain` が Clean であること。
   - **B-08 (`Source Connection Fingerprint Exact Match`)**: Spawn 前後の `SourceConnectionFingerprint` が 9 項目すべて完全一致（`SOURCE_FINGERPRINT_BEFORE === SOURCE_FINGERPRINT_AFTER`）していること。

### Step 6: Fresh Independent Isolation Audit (独立監査官による実機分離検品)
Execution AI は Fresh isolated child context の `auditor` を起動し、Source（READ ONLY）と Target（READ ONLY）の双方に対して `check-development-isolation-gate.mjs --phase B` の独立再実行および実ファイル照合を行わせ、`[AUDITOR VERDICT] Final Verdict: PASS` を取得する。

### Step 7: Proof Cleanup & Final Workspace Verification (7条件ガード付き Proof 削除)
`<FINAL_DEVELOPMENT_TARGET>` の生成および Gate A / Gate B PASS 確認後、検証用の `<PROOF_TARGET>` を削除する場合は、手動の `rm -rf` を使用せず、必ず以下の 7 条件ガード付きコマンド（`cleanupProofWorkspace`）を実行する：

```bash
node scripts/spawn-isolated-development-workspace.mjs \
  --cleanup-proof \
  --target <PROOF_TARGET> \
  --final-target <FINAL_DEVELOPMENT_TARGET> \
  --run-id <RUN_ID> \
  --baseline <SOURCE_BASELINE_SHA>
```

- **7-Condition Cleanup Guard (`cleanupProofWorkspace` 実装順序)**:
  1. **Condition 1 (`markerType / mode`)**: `<PROOF_TARGET>/.isolated-dev-manifest.json` の `manifest.markerType === "ISOLATED_DEV_WORKSPACE_MANIFEST"` かつ `manifest.mode === "proof"` であること。
  2. **Condition 2 (`runId`)**: `manifest.runId === <RUN_ID>` であること。
  3. **Condition 3 (`sourceBaselineSha`)**: `manifest.sourceBaselineSha === <SOURCE_BASELINE_SHA>` であること。
  4. **Condition 4 (`targetRealpath`)**: `manifest.targetRealpath === fs.realpathSync(<PROOF_TARGET>)` であること。
  5. **Condition 5 (`-proof suffix`)**: `path.basename(fs.realpathSync(<PROOF_TARGET>)).endsWith("-proof")` であること。
  6. **Condition 6 (`Disjoint from Source`)**: `!arePathsOverlappingOrEqual(realProof, realSource)`（`<PROOF_TARGET>` が `<SOURCE_PRODUCTION_ROOT>` と同一または親子重複でないこと）。
  7. **Condition 7 (`Disjoint from Verified Final Target`)**: `!arePathsOverlappingOrEqual(realProof, realFinal)` であり、かつ `<FINAL_DEVELOPMENT_TARGET>/.isolated-dev-manifest.json` が存在し `markerType === "ISOLATED_DEV_WORKSPACE_MANIFEST"`、`mode === "final"`、`targetRealpath === realFinal` を満たしていること。

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
- **Standalone Isolation Gate Verification (Phase B Post-Init)**:
  ```bash
  npm run gate:isolation -- --source <SOURCE_PRODUCTION_ROOT> --target <FINAL_DEVELOPMENT_TARGET> --phase B
  ```

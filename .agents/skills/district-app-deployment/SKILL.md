---
name: district-app-deployment
description: 1地区=1完成アプリの標準本番アクティベーション手順。District Initialization（data/**新地区化とSpreadsheet Master新地区同期の不可分一体執行）、SYSTEM_INFO（A1:B16保護・MASTER直接入力2項目B4/B16のREAD ONLY参照）、Spreadsheet-bound GAS Script Properties設定、新Web App Deployment作成、本番疎通・切替、旧Deployment廃止（Legacy Deployment Retirement）を規定するUniversal Skill。
version: 1.0.0
---

# District App Deployment & Production Activation Skill (1地区完成アプリ標準本番アクティベーション規範)

## 1. Purpose & Scope (目的と適用範囲)

本スキルは、`1地区 = 1完成アプリ` の Universal Product Model に基づき、完成アプリコピーから出発した新地区（`<DISTRICT_ID>`）を **不要な Runtime 改修・設定機構追加・誤検知 HARD STOP なしに 1 パスで本番稼働（Production Activation）させるための実証済み標準手順** を規定する。

- **Canonical References**:
  - `docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md`
  - `AGENTS.md`
  - `docs/operations/DISTRICT_PROVISIONING_RUNBOOK.md`
  - `active/api/v2_api.js`

---

## 2. Canonical Principles (最上位不変原則)

1. **Physical Product Boundary (`1地区 = 1完成アプリ`)**:
   - `1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定`
2. **Zero Runtime / UI Modification**:
   - 新地区の本番アクティベーションにおいて、`active/**`（Universal Engine）、H-App、Manager Dashboard のコード・UI・操作順・タイミングを 1 文字たりとも変更してはならない（`git diff active/` は常に空）。
   - `.env` の新設、設定読込機構の追加、`SYSTEM_INFO` 自動同期スクリプトの追加など、新しいアーキテクチャや仕組みを発明することを絶対禁止とする。
3. **Universal Placeholder Notation**:
   - 本スキルおよび運用手順では、特定地区のリテラルや固定の Deployment 世代番号を一切ハードコードせず、以下の Universal プレースホルダーによって関係性を記述する：
     - `<DISTRICT_ID>`: 対象地区コード
     - `<DOMAIN>`: 対象地区の公開独自ドメイン
     - `<TARGET_SPREADSHEET_ID>`: 対象地区専用 Google Spreadsheet（DB）の File ID
     - `<BOUND_SCRIPT_ID>`: `<TARGET_SPREADSHEET_ID>` に直接紐づく（Container-bound）Google Apps Script の Script ID
     - `<NEW_DEPLOYMENT>`: `<BOUND_SCRIPT_ID>` 上で本手順により新規発行する本番 Web App Deployment
     - `<LEGACY_DEPLOYMENT>`: 切替前に `data/config.js` または対象 GAS 上に存在していた旧 Web App Deployment

---

## 3. Minimal Human Input Contract (人間入力最小化契約)

1. **MASTER 必須入力は 2 項目のみ**:
   - 新地区アクティベーションにおいて MASTER（人間）が直接入力する設定は、対象 Spreadsheet の `SYSTEM_INFO` シート上の以下 **2 セルのみ** である：
     - `SYSTEM_INFO!B4` (`HアプリURL`): `https://<DOMAIN>/`
     - `SYSTEM_INFO!B16` (`GOOGLE_MAPS_API_KEY`): `<GOOGLE_MAPS_API_KEY>`（当該地区専用 Maps API Key）
2. **Normal Path における入力欄の既存確認（AI による新設・上書き禁止）**:
   - 完成コピーから複製された Spreadsheet の `SYSTEM_INFO` シートには、標準状態（Normal Path）で `A4: HアプリURL` および `A16: GOOGLE_MAPS_API_KEY` の入力欄が既に存在する。
   - Execution AI / Deployer AI は `A4` および `A16` のラベルが存在することを **確認するのみ** とし、標準手順として AI が勝手に入力欄を新設・上書きしてはならない。
3. **MASTER Direct Input & AI READ ONLY 原則**:
   - `SYSTEM_INFO!B4` と `SYSTEM_INFO!B16` は MASTER が直接入力し、Execution AI は両セルを **読むだけ（READ ONLY）** とする。
4. **`SYSTEM_INFO!B16` 生値非露出 & `A1:B16` 完全保護**:
   - `SYSTEM_INFO!B16` に格納された `GOOGLE_MAPS_API_KEY` の生値をチャット・ログ・Git・テスト・ドキュメントへ出力することは絶対禁止とする（確認ログは `EXISTS / SECURED` のみ出力可）。
   - `active/business/system/system_info_service.js`（旧表記 `active/system_info_service.js`）の `syncSystemInfo()` は `A1:B15` の 15 行でシートを再構築し 16 行目（`A16:B16`）を消去してしまうため、**`syncSystemInfo()` の実行は絶対禁止** とする。

---

## 4. District Initialization Contract (`data/**` + Spreadsheet Master 不可分一体同期)

### 4.1 Normal Path（標準一括初期化）

- **Precondition（前提条件）**:
  - 新地区の公式データ成果物（`data/address_master.csv`, `data/boundaries.geojson`, `data/municipality_master.csv`, `data/area_mapping.json`, `data/storage_locations.json`, `data/config.js`）が `address-master-generation` および `official-data-audit` により生成・承認済みであり、適用可能な状態にあること。
- **不可分一体原則（Single Indivisible Work Unit）**:
  - **`data/** 新地区化` と `Spreadsheet Master 新地区同期`（`配布実績<Active Dataset Key>` の更新）は別々の独立フェーズではなく、単一不可分の「District Initialization（地区初期化）」作業単位** である。
  - `data/**` だけを新地区へ更新して Spreadsheet の `配布実績<Active Dataset Key>` をコピー元状態のまま放置してはならない。
- **コピー元データの扱い（Migration 禁止）**:
  - コピー元 Spreadsheet の `配布実績<Active Dataset Key>` に残っている旧地区マスター行およびコピー元由来の既存実績（`D〜Q` 列の値）はすべて **「コピー元初期状態（Initial Copy State）」** であり、新地区で発生した本番実績ではない。
  - したがって、コピー元の既存実績を理由に「本番実績あり（Migration 要）」として HARD STOP してはならず、新地区 rowId への移植（Migration）も一切行わない。
- **標準初期化フロー**:
  ```text
  Copy
    ↓
  New District Master CSV 完成・監査 (data/address_master.csv 全 N 件確定)
    ↓
  Spreadsheet District Initialization（単一不可分処理）
    ├─ SYSTEM_INFO                  : Sanitization 対象外 (mutation = 0)
    ├─ 配布実績<Active Dataset Key> : A2:C(N+1) 新地区化 / D列以降クリア / N超過余剰行クリア
    └─ その他全既存sheet            : Row 1 維持 / Row 2+ クリア (非Active過月 配布実績* を含む)
    ↓
  Verification ➔ Activation
  ```
- **District Initialization の完了条件（すべて必須）**:
  1. Git `data/**` が新地区確定データへ更新されていること。
  2. `SYSTEM_INFO` が Sanitization 対象外として無改変（`mutation = 0`、Before == After）であること。
  3. Spreadsheet `配布実績<Active Dataset Key>` が新地区 `data/address_master.csv` で同期され、総件数 $N$、`rowId` `1..N` 連番、`city_name`、`town_name` が Git `data/address_master.csv` と Spreadsheet `A2:C(N+1)` で 100% 完全一致していること。
  4. `配布実績<Active Dataset Key>` の活動列 `D2:Q(N+1)`（`D` 列以降すべて）および旧行数が $N$ を超えていた場合の `N+2` 行目以降の余剰旧行がすべて空欄（non-empty = 0）であること。
  5. `SYSTEM_INFO` と `配布実績<Active Dataset Key>` を除く **その他すべての既存シート**（`名簿*`, `保有チラシ枚数*`, `受渡要請履歴*`, `PinStatus*`, `掲示板*`, `掲示板連絡履歴*`, `端末管理`, および非Activeの過月 `配布実績*` を含む全シート）において、**Row 1（ヘッダー・構造）が 100% 維持され、かつ Row 2+ の非空セル数が 0 件（Row 2+ non-empty = 0）** であること。
  6. Git 側（`test_district_data_gate.mjs` 等）および Spreadsheet 側の双方で Self-Verify が PASS していること。

### 4.2 Recovery Path（片側先行更新状態からの回復経路）

- 前工程の分割等により、すでに Git `data/**` だけが新地区化され、Spreadsheet の `配布実績<Active Dataset Key>` や他シートにコピー元データが残っている状態を検出した場合は、異常や Master Mismatch として HARD STOP するのではなく、**`Recovery Path`（片側未同期状態からの回復経路）** として扱う。
- Recovery Path では、確定済みの Git `data/address_master.csv`（全 $N$ 件）を正本として上記の一括初期化（`配布実績<Active Dataset Key>` の `A2:C(N+1)` 同期・`D2:Q(N+1)` 及び余剰行クリア、ならびにその他全既存シートの `Row 2+` クリア）を実行し、全完了条件を満たして District Initialization を完結させる。

### 4.3 シート保護・Sanitization 規程

- `SYSTEM_INFO`（`A1:B16`）は Sanitization 対象外（`mutation = 0`）とし、全シートの 1 行目ヘッダー、シート数、シート名、書式・列幅・条件付き書式・固定行（Freeze）・保護設定（Protection）は 100% 保護する。
- シート削除（`deleteSheet()`）、書式ごと消去する `clear()`、およびシート rename は絶対禁止とし、値のみを消去する `clearContent()` を使用する。

---

## 5. Bound GAS Identification (Spreadsheet-bound GAS の特定)

1. 対象地区の Spreadsheet（`<TARGET_SPREADSHEET_ID>`）を親（`parents` / `parentId`）に持つ Container-bound GAS プロジェクト（MIME type: `application/vnd.google-apps.script`）を特定し、真正な `<BOUND_SCRIPT_ID>` を確定する。
2. コピー元地区の GAS や standalone GAS を対象としてはならない。
3. ローカルの `.clasp.json`（Git 管理外）の `scriptId` を `<BOUND_SCRIPT_ID>`、`rootDir` を `"active"` に向ける。

---

## 6. Runtime Push Rule (共通 Runtime の無改変反映)

1. `git diff active/` が完全に空（0 バイト変更）であることを確認する。
2. `<BOUND_SCRIPT_ID>` に対して `clasp push` を実行し、現在の Git `active/**`（Universal Engine）をそのまま Spreadsheet-bound GAS へ反映する。

---

## 7. Script Properties Contract (3区分マトリクス)

Google Apps Script の仕様上、Spreadsheet-bound GAS であっても Web App（`doGet` / `doPost`）実行コンテキストでは `SpreadsheetApp.getActiveSpreadsheet()` が `null` を返す場合があるため、Web App Runtime は `TARGET_SPREADSHEET_ID` を最優先の正規接続として使用する。

### Tier 1: Proven Standard 9 Script Properties（実証済み標準設定 9 キー）

`<BOUND_SCRIPT_ID>` の Script Properties には、以下の 9 キーを標準構成として設定する：

| No | Property Key | 設定値 / 導出元 | 備考 |
|:---:|:---|:---|:---|
| 1 | `TARGET_SPREADSHEET_ID` | `<TARGET_SPREADSHEET_ID>` | Web App 最優先の正規 DB 接続先 |
| 2 | `SPREADSHEET_ID` | `<TARGET_SPREADSHEET_ID>` | `TARGET_SPREADSHEET_ID` と同一値に揃える |
| 3 | `DISTRICT_ID` | `<DISTRICT_ID>` | `data/config.js` および `SYSTEM_INFO!B1` と完全一致 |
| 4 | `GOOGLE_MAPS_API_KEY_<DISTRICT_ID>` | `SYSTEM_INFO!B16` の値 | 地区サフィックス必須（生値ログ出力禁止） |
| 5 | `LINE_LIFF_ID` | `data/config.js` の `line.liffId` | 当該地区専用 LIFF ID |
| 6 | `PRODUCTION_LIFF_URL` | `https://liff.line.me/<LINE_LIFF_ID>` | 当該地区の本番 LIFF エンドポイント |
| 7 | `BRANCH_ROOT_FOLDER_ID` | `03_BRANCH` フォルダ ID | Canonical Drive Layout 親フォルダ |
| 8 | `STORAGE_PARENT_ID` | `<DISTRICT_ID> 支部_STORAGE` フォルダ ID | 証跡画像等の地区専用保存先 |
| 9 | `LINE_CHANNEL_ACCESS_TOKEN` | 当該地区 Messaging API トークン | 地区専用チャネルの長期アクセストークン |

- **禁止キー**: 無印の `GOOGLE_MAPS_API_KEY`（地区サフィックスなし）は設定・残存させてはならない（`getMapsApiKey` 応答で `isFallback: false` を保証するため）。

### Tier 2: Runtime Required References（`active/**` 内の実参照契約）

- **DB 解決 (`SpreadsheetResolver`)**: `TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` の優先順で DB を解決し、`SYSTEM_INFO!B1`（`地区コード`）との一致（`verifyIntegrityGuard`）を検証する。
- **Maps API Key 解決 (`getMapsApiKey`)**: `GOOGLE_MAPS_API_KEY_<DISTRICT_ID>` を参照する。`districtId` 欠損時は `MISSING_DISTRICT_ID`、不一致時は `DISTRICT_MISMATCH` を返す。
- **Drive 構造・証跡保存**: `BRANCH_ROOT_FOLDER_ID` および `STORAGE_PARENT_ID` を参照する。
- **LINE / LIFF 連携**: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_LIFF_ID`, `PRODUCTION_LIFF_URL` を参照する。
- **Manager PIN の SSOT**: Dashboard 管理者 PIN は Script Properties ではなく、`SYSTEM_INFO!B10`（`Manager認証パスワード`）を唯一の正本として参照する。

### Tier 3: Human Input vs AI Autonomous Acquisition（人間入力と AI 自律取得の区分）

- **MASTER 直接入力（2 項目のみ・AI は READ ONLY 参照）**:
  1. `SYSTEM_INFO!B4` (`https://<DOMAIN>/`)
  2. `SYSTEM_INFO!B16` (`<GOOGLE_MAPS_API_KEY>`)
- **AI 自律取得・設定**:
  - `<TARGET_SPREADSHEET_ID>`, `<BOUND_SCRIPT_ID>`, `<DISTRICT_ID>`, `BRANCH_ROOT_FOLDER_ID`, `STORAGE_PARENT_ID`, `LINE_LIFF_ID`, `PRODUCTION_LIFF_URL`, `LINE_CHANNEL_ACCESS_TOKEN` は、Google Drive 物理階層・`SYSTEM_INFO`・`data/config.js`・LINE Developers チャネル構成から AI が自律的に取得・導出して Script Properties へ設定する。

---

## 8. Web App Deployment Rule (新 Deployment の発行)

1. `<BOUND_SCRIPT_ID>` に対して `clasp deploy` を実行し、新しい Web App Deployment（`<NEW_DEPLOYMENT>`）を作成する。
2. `data/config.js` の切替および本番疎通確認が完了するまでは、既存の `<LEGACY_DEPLOYMENT>` を即座に undeploy せず、ロールバック安全性のため保持する。

---

## 9. Pre-Cutover Verification (切替前 5 項目検証)

`data/config.js` を変更する前に、新規発行した `<NEW_DEPLOYMENT>` の Web App URL に対して直接以下の 5 項目を検証し、すべて PASS することを確認する：

1. **`getDashboardData` 正常応答 & 件数一致**:
   - `GET <NEW_DEPLOYMENT_URL>?action=getDashboardData&districtId=<DISTRICT_ID>`
   - `success: true` であり、`areas.length` が `data/address_master.csv` の総件数 $N$ と完全一致すること。
2. **`getMapsApiKey` 地区専用キー解決**:
   - `GET <NEW_DEPLOYMENT_URL>?action=getMapsApiKey&districtId=<DISTRICT_ID>`
   - `success: true` かつ `isFallback: false` であること（API キー実値はマスクして確認）。
3. **`getMapsApiKey` 引数欠損時の拒否**:
   - `GET <NEW_DEPLOYMENT_URL>?action=getMapsApiKey`
   - `MISSING_DISTRICT_ID` により Fail-Closed で拒否されること。
4. **地区境界ガード (`DISTRICT_MISMATCH`)**:
   - `GET <NEW_DEPLOYMENT_URL>?action=getDashboardData&districtId=INVALID_DISTRICT`
   - `DISTRICT_MISMATCH` により Fail-Closed で拒否されること。
5. **`switchDistrictSpreadsheet` 無効化の意味論的検証（3 つの意味論的不変条件）**:
   - `POST <NEW_DEPLOYMENT_URL>` with `{"action":"switchDistrictSpreadsheet","districtId":"<DISTRICT_ID>"}`
   - 特定のエラーメッセージ文言に依存せず、以下の **3 つの意味論的不変条件（Semantic Invariants）** をすべて満たすことを検証する：
     1. `success: true` を返さないこと（要求が拒否されること）。
     2. 旧共用親 GAS の `Provisioning token is missing` ルートに入らないこと。
     3. Spreadsheet DB および Script Properties に一切の副作用（変更）が発生しないこと。

---

## 10. Config Cutover & Stage 7 Independent Audit Sequence (確定実行順序)

Pre-Cutover Verification がすべて PASS した後、以下の **確定シーケンス** を厳守して `data/config.js` の Cutover、Stage 7 独立監査、Push、本番確認、および `<LEGACY_DEPLOYMENT>` の廃止を実行する。

> [!IMPORTANT]
> Stage 7 Independent Auditor は必ず **`<BASE>`（Scope Lock Commit）と `<TARGET>`（Implementation Commit）が異なる確定コミットレンジ（`<BASE>..<TARGET>`, `changedFiles > 0`）** に対して起動しなければならない。Push や `<LEGACY_DEPLOYMENT>` の undeploy を Stage 7 より前に実行することは絶対禁止とする。

```text
1. npm run gate:entrance -- --mission "<MISSION>" (Exit 0)
       ↓
2. .agents/current-scope.json 更新 & node scripts/check-scope.mjs --scope-only
       ↓
3. Scope Lock Commit 作成 ➔ このコミット SHA を <BASE> とする
       ↓
4. data/config.js の api.gasWebAppUrl 1行のみを <NEW_DEPLOYMENT> URL へ更新
       ↓
5. Self Verify (npm test, node scripts/check-scope.mjs, npm run check:knowledge, npm run check:secrets)
       ↓
6. Implementation Commit 作成 ➔ このコミット SHA を <TARGET> とする (<BASE> !== <TARGET>)
       ↓
7. Stage 7 Independent Auditor 起動 (監査対象: <BASE>..<TARGET>)
       ↓
8. npm run gate:auditor -- --base <BASE> --target <TARGET> (Exit 0)
       ↓
9. git push origin main
       ↓
10. 本番配信反映確認 & H-App / Manager Dashboard 実機疎通確認
       ↓
11. Legacy Deployment Retirement (<LEGACY_DEPLOYMENT> の clasp undeploy)
       ↓
12. <NEW_DEPLOYMENT> 単独での本番再確認
       ↓
13. Stage 9 Residual Cleanup Audit & npm run gate:cleanup -- --base <BASE> --target <TARGET> (Exit 0)
```

---

## 11. Legacy Deployment Retirement (旧 Deployment の安全な廃止)

1. `git push` 後の本番反映、および `<NEW_DEPLOYMENT>` に接続された本番 H-App / Manager Dashboard の正常稼働を確認した後にのみ、旧 Deployment（`<LEGACY_DEPLOYMENT>`）を廃止する。
2. 廃止コマンドは `<BOUND_SCRIPT_ID>`（または旧 Deployment が属する対象 GAS）に対する `clasp undeploy <LEGACY_DEPLOYMENT_ID>` とする。
3. **GAS プロジェクト恒久削除の絶対禁止**:
   - 行うのは **Legacy Deployment Retirement（旧 Web App Deployment エンドポイントの無効化）** であり、Google Drive 上の GAS プロジェクト自体や Spreadsheet DB を恒久削除（Trash / Delete）してはならない。
4. `clasp undeploy` 実行後、`<NEW_DEPLOYMENT>` が引き続き HTTP 200 / `success: true` で正常稼働していることを再確認する。

---

## 12. Prohibited Actions (絶対禁止事項)

- `active/**`、H-App、Manager Dashboard のコード・UI・操作順・タイミングを 1 行でも変更すること。
- `.env` ファイルの新設、新しい設定読込機構の追加、`SYSTEM_INFO` 自動同期機構の追加を提案または実装すること。
- `active/system_info_service.js` の `syncSystemInfo()` を実行すること（`SYSTEM_INFO!A16:B16` が消去されるため）。
- Normal Path において AI が `SYSTEM_INFO!A4` または `A16` の入力欄を勝手に新設・上書きすること。
- `SYSTEM_INFO!B16`（`GOOGLE_MAPS_API_KEY`）の生値をチャット・ログ・Git・テストへ出力すること。
- `data/**` 更新と Spreadsheet District Initialization（`配布実績<Active Dataset Key>` 同期およびその他全既存シートの Row 2+ クリア）を切り離し、片側だけ更新してコピー元業務データを残存させること。
- District Initialization において `deleteSheet()`、`clear()`（書式消去）、またはシート rename を使用すること。
- コピー元 Spreadsheet に元から入っていた旧地区行・既存実績（`D〜Q` 列）を新地区の本番実績と誤認して HARD STOP したり、新地区 rowId へ Migration しようとすること。
- Script Properties に地区サフィックスなしの無印 `GOOGLE_MAPS_API_KEY` を設定・残存させること。
- 固定の Deployment 世代番号や特定地区名を Universal 手順・ルール・スキルにハードコードすること（必ず `<LEGACY_DEPLOYMENT>` / `<NEW_DEPLOYMENT>` または「旧Deployment / 新Deployment」で記述すること）。
- 未コミット状態や `BASE === TARGET`（変更ファイル 0 件）の状態で Stage 7 Independent Auditor または `npm run gate:auditor` を実行すること。
- Stage 7 Independent Auditor PASS および `git push` より前に本番環境の変更や `<LEGACY_DEPLOYMENT>` の undeploy を行うこと。
- GAS プロジェクト自体を恒久削除すること。

---

## 13. Evidence & Acceptance Checklist (完了検収チェックリスト)

- [ ] **Human Input**: MASTER 直接入力が `SYSTEM_INFO!B4`（`https://<DOMAIN>/`）および `SYSTEM_INFO!B16`（`<GOOGLE_MAPS_API_KEY>`）の 2 項目のみであり、AI は READ ONLY で参照したこと（`B16` 生値の露出ゼロ、`syncSystemInfo()` 未実行）。
- [ ] **District Initialization**: Git `data/**` と Spreadsheet が不可分一体で初期化され、完了条件（① `data/**` 更新、② `SYSTEM_INFO` Sanitization `mutation = 0`、③ `配布実績<Active Dataset Key>` の件数 $N$・`rowId 1..N`・`city_name`・`town_name` が `A2:C(N+1)` と 100% 一致、④ `配布実績<Active Dataset Key>` の `D2:Q(N+1)` および $N$ 超過余剰行が空欄、⑤ その他全既存シートの Row 1 ヘッダー維持 & Row 2+ 非空セル 0、⑥ 双方向 Self-Verify PASS）をすべて満たしていること。
- [ ] **Bound GAS & Script Properties**: `<TARGET_SPREADSHEET_ID>` に紐づく `<BOUND_SCRIPT_ID>` に無改変の `active/**` が push され、Tier 1 標準 9 キーが設定され、無印 `GOOGLE_MAPS_API_KEY` が存在しないこと。
- [ ] **Pre-Cutover 5 Checks**: `<NEW_DEPLOYMENT>` に対して `getDashboardData`（$N$ 件）、`getMapsApiKey`（`isFallback: false`）、引数なし `MISSING_DISTRICT_ID`、他地区 `DISTRICT_MISMATCH`、`switchDistrictSpreadsheet`（3 意味論的不変条件：① `success: true` にならない、② `Provisioning token is missing` に入らない、③ 副作用ゼロ）が確認済みであること。
- [ ] **Audit & Cutover Sequence**: `Scope Lock Commit (<BASE>)` ➔ `data/config.js` 更新 ➔ `Self Verify` ➔ `Implementation Commit (<TARGET>, <BASE> !== <TARGET>)` ➔ `Stage 7 Independent Auditor (<BASE>..<TARGET>)` ➔ `gate:auditor` Exit 0 ➔ `git push` の順序が厳守されたこと。
- [ ] **Legacy Deployment Retirement**: 本番疎通確認後に `<LEGACY_DEPLOYMENT>` が `clasp undeploy` され、GAS プロジェクト自体は削除されておらず、`<NEW_DEPLOYMENT>` の単独稼働が再確認されていること。

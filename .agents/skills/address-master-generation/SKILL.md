---
name: address-master-generation
description: POSTING MAPの新地区マスター作成時に、実証済みの既存スクリプト群（fetch-district-raw-data.py, build-district-master.py, sort-address-master.py, validate-district-data-gate.mjs）を正しい入力・実行順序・HARD STOP条件・無加工昇格境界で実行するための実務Execution Runbook。
---

# Address Master Generation — Execution Runbook Skill

## 1. Skillの定義と目的 (Definition & Purpose)

本Skillは、Generatorそのものではなく、Authority（設計・数理契約）の再記述でもない。

- **正式定義**:
  > 完成済みの既存スクリプト群を、正しい入力、正しい実行順序、正しいHARD STOP条件、正しいProduction昇格境界でAIエージェントに実行させるための実務Execution Runbook。
- **目的**:
  > POSTING MAPの新地区（`<DISTRICT_ID>`）マスター作成時に、実地区データで実証された既存Generatorの正しい実行工程を迷わず再現すること。

---

## 2. 正式な責務分離 (Strict Separation of Responsibilities)

数理アルゴリズムや検証ロジックを本Skill内に複製・再定義してはならない（二重管理の絶対禁止）。

| レイヤー | 役割 | 正本ファイル |
| :--- | :--- | :--- |
| **Authority** | **何が正しいか**（数理・設計契約の唯一のSSOT） | [DISTRICT_DATA_ACQUISITION_RULE.md](../../../docs/architecture/DISTRICT_DATA_ACQUISITION_RULE.md)（Version 3.2）<br>[ADDRESS_EXTRACTION_RULE.md](../../../docs/architecture/ADDRESS_EXTRACTION_RULE.md)<br>[DATA_DICTIONARY.md](../../../docs/data/DATA_DICTIONARY.md)<br>[DISTRICT_PROVISIONING_RUNBOOK.md](../../../docs/operations/DISTRICT_PROVISIONING_RUNBOOK.md) |
| **Generator / Validator** | **Authorityを実装・計算・検証するもの**（完成済み・変更禁止） | `scripts/fetch-district-raw-data.py`<br>`scripts/build-district-master.py`<br>`scripts/sort-address-master.py`<br>`scripts/validate-district-data-gate.mjs` |
| **Skill（本書）** | **既存Generatorをどう正しく使うか**（実務実行手順・停止条件・昇格境界） | `.agents/skills/address-master-generation/SKILL.md` |

- Layer 1〜Layer 4 の数理仕様（距離計算、分割数決定、Official Decision Gate、Rook隣接グラフ、シード選択、Region Growing、Minor Island Absorption、Boundary Swap、0世帯事後帰属、代表点PIP検証、6段階ソートキー等）はすべて [DISTRICT_DATA_ACQUISITION_RULE.md](../../../docs/architecture/DISTRICT_DATA_ACQUISITION_RULE.md)（Version 3.2）を唯一の正本とし、`scripts/build-district-master.py` および `scripts/sort-address-master.py` に実装済みである。
- 本Skillの実行にあたり、新しい入力モデル、新しいラッパースクリプト、新しいCLI引数、別の検証ロジックを新設してはならない。また、Generator（`fetch` / `build` / `sort` / `validate`）や Authority を変更してはならない。

---

## 3. 使用する既存スクリプトと実在CLI契約 (Existing Scripts & CLI Contract)

### 3.1 使用する既存スクリプト（4本）
1. `scripts/fetch-district-raw-data.py`: 国交省位置参照情報（`data_kind=1`）、デジタル庁ABR検証、e-Stat A系（小地域 `r2ka`）・B系（基本単位区 `r2kb`）の共通最新国勢調査年度解決および原本取得。
2. `scripts/build-district-master.py`: Authority Version 3.2 準拠の4成果物（`address_master.csv`, `boundaries.geojson`, `municipality_master.csv`, `provenance.json`）同時生成および内蔵Gate検証。
3. `scripts/sort-address-master.py`: ABR公式読み・6段階ソートキーに基づく再整列および順序不変性（Sort Invariance）検証。
4. `scripts/validate-district-data-gate.mjs`: Master Triad（`address_master.csv`, `boundaries.geojson`, `municipality_master.csv`）と補助JSONの閉包・RFC 4180・GeoJSON・`rowId = 1..<N>` 機械検証。

### 3.2 既存CLI引数（そのまま使用する）
- **対象自治体コード**:
  - `--city-code <5桁自治体コード>`（単一または代表自治体）
  - `--target-cities <5桁自治体コード>`（複数自治体構成時に各5桁コードを指定）
- **公的原本パス**:
  - `--ref-csv <path>`（または `fetch-district-raw-data.py` の `--ref-dir <dir>`）: 国交省位置参照情報（`data_kind=1`）
  - `--abr-file <path>`（複数指定可）: デジタル庁ABR町字マスターCSV
  - `--estat-dir <dir>`（または `--estat-file <path>`）: e-Stat A系（`r2ka`）Shapefile/DBFディレクトリ
  - `--estat-b-dir <dir>`（または `--estat-b-file <path>`）: e-Stat B系（`r2kb`）Shapefile/DBFディレクトリ
- **条件付き外部根拠ファイル（該当する場合のみ指定）**:
  - `--electoral-mapping <csv>`（および対象選挙区指定オプション `${ELECTORAL_ARGS}`）: 分割自治体を含む選挙区における公式区割り対応表（`city_name,town_name,electoral_district`）
  - `--reading-reconciliation <json>`: 初回Buildで検出されたABR読み不一致を公的根拠（必須8項目）で解決するJSON
  - `--estat-reconciliation <json>`: 初回Buildで検出された `1:0` 親町または秘匿値を公的根拠（必須8項目）で解決するJSON
- **4成果物出力先**:
  - `--out-csv <path>` (`address_master.csv`)
  - `--out-geojson <path>` (`boundaries.geojson`)
  - `--out-muni-csv <path>` (`municipality_master.csv`)
  - `--provenance-out <path>` (`provenance.json`)

---

## 4. 正式実行フロー (Standard Execution Workflow: Step 0 – Step 10)

マスター作成は以下の **Step 0 〜 Step 10** の順序を厳守して実行する。工程の逆転や省略は禁止する。

### Step 0 — 対象範囲の確定 (Scope Confirmation)
1. **MASTERが対象地区（`<DISTRICT_ID>`）の範囲を決定する**。
2. 必要情報：
   - 対象自治体一覧（および対応する5桁全国地方公共団体コード）
   - 必要時の選挙区範囲
   - 分割自治体が存在する場合の公式区割り情報（`electoral_mapping.csv`）
3. **禁止事項**: AIやSkill自身が対象自治体や選挙区境界を推測してはならない。不明点がある場合は着手前に **HARD STOP** してMASTERへ確認する。

---

### Step 1 — 公的原本取得 (Official Raw Data Acquisition)
`scripts/fetch-district-raw-data.py` を使用し、`scratch/` 作業ディレクトリへ公的原本を取得・検証する：
```bash
RAW_DIR="scratch/<district_work>/raw"

python3 scripts/fetch-district-raw-data.py \
  --city-code "<PRIMARY_5DIGIT_CODE>" \
  --target-cities "<CITY_CODE_1>" \
  --target-cities "<CITY_CODE_2>" \
  --ref-dir "${RAW_DIR}/mlit" \
  --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
  --fetch-estat \
  --estat-dir "${RAW_DIR}/estat" \
  --fetch-estat-b \
  --estat-b-dir "${RAW_DIR}/estat_b"
```
- **確認対象**:
  - 国交省位置参照情報（`data_kind=1` 大字・町丁目レベルのみ。街区レベル混入禁止）
  - デジタル庁ABR町字マスター
  - e-Stat A系（小地域 `r2ka`）および B系（基本単位区 `r2kb`）
  - 対象全自治体における A系・B系 共通最新国勢調査年度の一致
- **HARD STOP 条件**: 原本取得失敗、メタデータ作成日欠損、または対象自治体間でA系/B系の共通国勢調査年度が解決できない場合は直ちに **HARD STOP** する。

---

### Step 2 — 初回Build（例外・不整合の検出） (Initial Trial Build)
`scripts/build-district-master.py` を `scratch/` 上の一時出力先に対して実行する：
```bash
TRIAL_DIR="scratch/<district_work>/trial"

python3 scripts/build-district-master.py \
  --ref-csv "${RAW_DIR}/mlit_combined_reference.csv" \
  --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
  --estat-dir "${RAW_DIR}/estat" \
  --estat-b-dir "${RAW_DIR}/estat_b" \
  --out-csv "${TRIAL_DIR}/address_master.csv" \
  --out-geojson "${TRIAL_DIR}/boundaries.geojson" \
  --out-muni-csv "${TRIAL_DIR}/municipality_master.csv" \
  --provenance-out "${TRIAL_DIR}/provenance.json"
  # 分割自治体を含む選挙区の場合のみ追加:
  # --electoral-mapping "<electoral_mapping.csv>" ${ELECTORAL_ARGS}
```
- **目的**: 初回Buildの目的は単なる成功ではなく、実データに潜む以下の Fail-Closed 例外を網羅的に検出することにある：
  - ABR読み不一致・表記揺れ
  - `1:0` 親町（対応する独立e-Stat小地域が存在しない親町）
  - 秘匿値（`X`, `-` 等）
  - 公式データ間の不整合（A系/B系統計不一致、`N:1` 衝突等）
  - 合法分割不能（`K >= K_min` で `< 200` 世帯禁止かつ複数単位 `<= 700` 世帯を満たす解が存在しない場合）
  - その他スクリプトが検出する Fail-Closed 例外

---

### Step 3 — Reconciliation Cycle（公的根拠による例外解決サイクル）
初回Buildで自動解決不能な例外が発生しスクリプトが停止した場合、以下の規程に従う：

1. **推測・自動補完の絶対禁止**:
   - 勝手に **推測、0埋め、名称補完、統計補完、geometry補完（B系 `S_NAME` からの切り出しや人工ポリゴン合成等）** を行ってはならない。
2. **一度 HARD STOP する**:
   - 検出された未解決町域・例外内容を特定し、作業を停止する。
3. **公的根拠に基づく Reconciliation JSON の作成（必要時のみ）**:
   - 自治体例規集・公式住所一覧・総務省統計局e-Stat定義書などの一次公的資料を調査し、Authority Version 3.2 が定める必須8項目を満たす `reading_reconciliation.json` および／または `estat_reconciliation.json` を作成する。
4. **MASTER承認と再実行**:
   - 作成した Reconciliation 内容と公的根拠をMASTERへ提示し、承認を受けた後のみ `--reading-reconciliation` / `--estat-reconciliation` を付与して再実行する。

---

### Step 4 — Scratch 2-Run（決定論的2回独立生成）
すべての入力が確定した後、`scratch/` 配下の独立した2つのディレクトリ（`run1`, `run2`）へ同一条件で2回独立生成する：
```bash
OUT_RUN1="scratch/<district_work>/run1"
OUT_RUN2="scratch/<district_work>/run2"

for RUN_DIR in "${OUT_RUN1}" "${OUT_RUN2}"; do
  python3 scripts/build-district-master.py \
    --ref-csv "${RAW_DIR}/mlit_combined_reference.csv" \
    --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
    --estat-dir "${RAW_DIR}/estat" \
    --estat-b-dir "${RAW_DIR}/estat_b" \
    --out-csv "${RUN_DIR}/address_master.csv" \
    --out-geojson "${RUN_DIR}/boundaries.geojson" \
    --out-muni-csv "${RUN_DIR}/municipality_master.csv" \
    --provenance-out "${RUN_DIR}/provenance.json"
    # 該当する場合のみ追加:
    # --electoral-mapping "<electoral_mapping.csv>" ${ELECTORAL_ARGS}
    # --reading-reconciliation "<reading_reconciliation.json>"
    # --estat-reconciliation "<estat_reconciliation.json>"
done
```
- **同時出力される4成果物**:
  1. `address_master.csv`（`rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code`：全 `<N>` 件、`rowId = 1..<N>`）
  2. `boundaries.geojson`（`features.length == <N>`、`rowId = 1..<N>` 完全 1:1 対応）
  3. `municipality_master.csv`（`city_name,city_code,total_towns`：`sum(total_towns) == <N>`）
  4. `provenance.json`（`contract_version: "3.2"`、全 `<N>` 件の追跡証跡）

---

### Step 5 — Determinism Gate（2-Run 完全一致検証）
`run1` と `run2` の4成果物すべてについて、バイト単位の完全一致（`byte diff = 0` / SHA-256 完全一致）を検証する：
```bash
cmp --silent "${OUT_RUN1}/address_master.csv" "${OUT_RUN2}/address_master.csv"
cmp --silent "${OUT_RUN1}/boundaries.geojson" "${OUT_RUN2}/boundaries.geojson"
cmp --silent "${OUT_RUN1}/municipality_master.csv" "${OUT_RUN2}/municipality_master.csv"
cmp --silent "${OUT_RUN1}/provenance.json" "${OUT_RUN2}/provenance.json"
shasum -a 256 "${OUT_RUN1}"/* "${OUT_RUN2}"/*
```
- **HARD STOP 条件**: 1ファイルでも不一致（`byte diff != 0`）があれば直ちに **HARD STOP** する。

---

### Step 6 — Sort Invariance Gate（再ソート不変性検証）
`scripts/sort-address-master.py` を用いて `run1/address_master.csv` を再整列し、生成直後の `address_master.csv` と `byte diff = 0` で完全一致することを検証する：
```bash
python3 scripts/sort-address-master.py \
  --input "${OUT_RUN1}/address_master.csv" \
  --output "${OUT_RUN1}/address_master_resorted.csv" \
  --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
  --provenance "${OUT_RUN1}/provenance.json"
  # 該当する場合のみ追加:
  # --reading-reconciliation "<reading_reconciliation.json>"

cmp --silent "${OUT_RUN1}/address_master.csv" "${OUT_RUN1}/address_master_resorted.csv"
rm -f "${OUT_RUN1}/address_master_resorted.csv"
```
- **HARD STOP 条件**: 再ソート前後で1バイトでも差分が発生した場合は直ちに **HARD STOP** する（確認後、一時ファイル `address_master_resorted.csv` は削除する）。

---

### Step 7 — Data Validation（既存Gateによる機械検証）
既存の `scripts/validate-district-data-gate.mjs` を使用して、生成された4成果物（および対象地区の補助JSON：`election_history.json`, `area_mapping.json`, `storage_locations.json`）が Master Triad 閉包・RFC 4180・GeoJSON・`rowId = 1..<N>` 連番契約を100%満たすことを検証する：
```bash
node scripts/validate-district-data-gate.mjs --data-dir "${OUT_RUN1}"
```
- **禁止事項**: Skill自身で別の検証ロジックを新設してはならない。既存Gateが1項目でもFAILした場合は直ちに **HARD STOP** する。

---

### Step 8 — MASTER Review Gate（昇格前承認ゲート）
Scratch環境での生成および Step 5〜Step 7 の全検証完了後、Production `data/**` へ触れる前に、必ずMASTERへ以下のサマリを提示して **HARD STOP** する：

- **MASTER提示必須項目**:
  1. 親町数（`total_parent_towns`）
  2. 最終エリア数 `<N>`（`total_records`）
  3. 総世帯数（`total_households`）
  4. 総人口（`total_population`）
  5. 分割町域一覧（Pattern B 分割対象町域と分割数 `K`・各世帯数）
  6. Pattern C 一覧（`1:0` または 0世帯親町の一覧と根拠）
  7. 粒度例外一覧（`GRANULARITY_EXCEPTION` / `ATOMIC_UNIT_TOO_LARGE` / `island_absorption` の有無と内訳）
  8. `run1` / `run2` 2-Run Byte Identity 結果（SHA-256）
  9. Sort Invariance Gate & Data Validation Gate 結果
- **停止原則**: MASTERからの明示的な **Production Promotion Proceed** を受領するまで、Production `data/**` を一切変更してはならない。

---

### Step 9 — Production Promotion & Promotion後Gate（無加工昇格と完成確定）
MASTERから Production Promotion Proceed を受領した後のみ、PASS済みの `scratch` 成果物を Production `data/**` へ昇格する。

1. **無加工コピー原則（絶対厳守）**:
   - **再生成禁止・再ソート禁止・手編集禁止・加工禁止**。
   - Step 5〜Step 7 をPASSし Step 8 で承認された `${OUT_RUN1}` の4成果物を、そのまま `data/` へ無加工コピーする：
     ```bash
     cp "${OUT_RUN1}/address_master.csv" data/address_master.csv
     cp "${OUT_RUN1}/boundaries.geojson" data/boundaries.geojson
     cp "${OUT_RUN1}/municipality_master.csv" data/municipality_master.csv
     cp "${OUT_RUN1}/provenance.json" data/provenance.json
     ```
2. **Promotion後Gate（Byte-Identical & 全テスト検証）**:
   - 昇格後の `data/**` 4ファイルと昇格元 `${OUT_RUN1}` 4ファイルが `byte-identical`（`cmp --silent` Exit 0 / SHA-256 完全一致）であることを確認する：
     ```bash
     cmp --silent "${OUT_RUN1}/address_master.csv" data/address_master.csv
     cmp --silent "${OUT_RUN1}/boundaries.geojson" data/boundaries.geojson
     cmp --silent "${OUT_RUN1}/municipality_master.csv" data/municipality_master.csv
     cmp --silent "${OUT_RUN1}/provenance.json" data/provenance.json
     ```
   - 既存の品質ゲートおよび全テストスイートを実行し、すべてPASSすることを確認する：
     ```bash
     node scripts/validate-district-data-gate.mjs --data-dir data
     node scripts/check-universal-invariants.mjs
     node scripts/check-knowledge-gate.mjs
     node scripts/check-architecture-gate.mjs
     npm test
     ```
3. **Master完成定義**:
   - 上記すべてがPASSし、Independent Auditor の承認を経て Git Commit / Push が完了した時点で、
     **`POSTING MAP ADDRESS MASTER = COMPLETE`**
     と判定する。

---

### Step 10 — Backendとの境界 (HANDOFF ONLY & HARD STOP)
1. **本Skillの最終責務境界**:
   - 本Skill自身は Backend Spreadsheet を一切書き換えない。
   - 本Skillの責務は、以下のフローで完結する：
     ```text
     Final Canonical Master完成 (data/address_master.csv 確定)
       ↓
     Backend Alignment Mission へ HANDOFF
       ↓
     HARD STOP
     ```
2. **Backend Alignment への引き渡し事項**:
   - 完成・固定された Production `data/address_master.csv`（全 `<N>` 件、`rowId = 1..<N>`）を、後続の Backend Alignment 工程における **唯一のSSOT** として引き渡す（Spreadsheetを先に変更することや、Backend都合でMasterを逆向きに変更することは絶対禁止）。
3. **本Skill内で実行してはいけないこと（別Missionの責務）**:
   - Google Spreadsheet の変更（`配布実績` 等への書込）
   - `PinStatus` シートの変更
   - GAS コード・Script Properties・Deployment の変更
   - Backend テストデータ Reset
   - Backend Read / Write E2E の実行

---

## 5. 絶対禁止事項 (Prohibited Actions)

- Authority（`DISTRICT_DATA_ACQUISITION_RULE.md` v3.2）の数理式・アルゴリズム定義をSkill内に複製・再定義すること。
- Skill化や新地区対応を理由に、完成済みの Generator / Validator（`fetch-district-raw-data.py`, `build-district-master.py`, `sort-address-master.py`, `validate-district-data-gate.mjs`）や Authority を変更・再設計すること。
- 新しい入力モデル、ラッパースクリプト、独自CLI、独自検証スクリプトを新設すること。
- 初回Buildで発生した例外（読み不一致、`1:0` 親町、秘匿値、統計不一致、分割不成立等）に対して、勝手に推測・0埋め・名称補完・統計補完・geometry補完を行うこと。
- Scratchでの 2-Run Byte Identity（`run1 == run2`）、Sort Invariance（`sort-address-master.py` `byte diff = 0`）、および MASTER Review Gate の承認を経ずに Production `data/**` を変更すること。
- Production Promotion 時に成果物を再生成・再ソート・手編集・加工すること（必ず PASS 済み scratch 成果物の無加工コピーとすること）。
- 本Skillのスコープ内で Backend Spreadsheet、PinStatus、GAS、Backend Reset、Read/Write E2E を実行すること（必ず HANDOFF して HARD STOP すること）。
- 特定地区の固有名詞、自治体名、固定件数、完成済みSHA-256ハッシュ文字列を本Skill本文へハードコードすること（地区固有の実証記録は `data/**` および `data/provenance.json` に保持する）。

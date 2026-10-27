---
name: address-master-generation
description: 自治体コード群と公的原本を入力とし、国交省位置参照情報・デジタル庁ABR・総務省e-Stat（A系小地域＋B系基本単位区）から4-Layer Universal Master Compilerにより4成果物（address_master.csv, boundaries.geojson, municipality_master.csv, provenance.json）を同時原子的生成・監査する標準実行手順。
---

# Universal 4-Layer Master Generation Capability Pack

## 1. 概要・正本依存・入出力契約 (Overview, Canonical Authority & Input/Output Contract)

本Skillは、全国の任意の対象地区について、地区固有入力（自治体集合・選挙区対応・公的原本・Reconciliation根拠データ）を外部パラメータとして分離し、公式オープンデータ（国土交通省位置参照情報 `data_kind=1`、デジタル庁アドレス・ベース・レジストリ `ABR`、総務省統計局 `e-Stat` 国勢調査 A系小地域 `r2ka` および B系基本単位区 `r2kb`）から **4-Layer Universal Master Compiler** によって **4成果物（`address_master.csv`, `boundaries.geojson`, `municipality_master.csv`, `provenance.json`）** を単一パスで決定論的かつ原子的に生成・検証するための Universal 実行規格である。

### 1.1 準拠正本 (Canonical Authorities & Generators)
本Skillは上位正本に従属し、以下の確定済み Universal Generator / Validator を正本実装として呼び出す（Skill側での独自再実装や契約改変は禁止）：
- **上位設計正本**:
  - [DISTRICT_DATA_ACQUISITION_RULE.md](../../../docs/architecture/DISTRICT_DATA_ACQUISITION_RULE.md)（v3.2 FINAL DESIGN CONTRACT）
  - [ADDRESS_EXTRACTION_RULE.md](../../../docs/architecture/ADDRESS_EXTRACTION_RULE.md)
  - [DATA_DICTIONARY.md](../../../docs/data/DATA_DICTIONARY.md)
  - [DISTRICT_PROVISIONING_RUNBOOK.md](../../../docs/operations/DISTRICT_PROVISIONING_RUNBOOK.md)
- **正本 Universal Generator / Validator**:
  - `scripts/fetch-district-raw-data.py`（国交省位置参照情報 `data_kind=1`、ABR検証、e-Stat A系/B系 共通最新国勢調査年度解決・取得）
  - `scripts/build-district-master.py`（Layer 1〜4 統合マスターコンパイラ・Gate 1〜4 内蔵検証）
  - `scripts/sort-address-master.py`（ABR公式読みに基づく五十音・丁目数値順ソーターおよび順序不変性検証）
  - `scripts/validate-district-data-gate.mjs`（Master Triad 閉包・RFC 4180・GeoJSON・`rowId = 1..N` 機械検証ゲート）

### 1.2 外部入力契約 (External District-Specific Input Contract)
地区固有情報はすべて以下の外部引数として注入し、Skillやスクリプト内部へハードコードしてはならない：
1. **対象自治体コード集合**:
   - `--city-code <5桁自治体コード>` および複数自治体構成時は `--target-cities <5桁自治体コード>`（先頭ゼロ保持の5桁全国地方公共団体コード）
2. **公的原本入力パス**:
   - `--ref-csv <path>`（または `--phase1-skeleton <csv>` + `--skeleton-provenance <json>`）: 国土交通省位置参照情報（大字・町丁目レベル `data_kind=1`）
   - `--abr-file <path>`（複数指定可）: デジタル庁 ABR 町字マスター CSV（`mt_town_fullset_prefXX.csv` 等）
   - `--estat-dir <dir>`（または `--estat-file <path>`）: 総務省 e-Stat 国勢調査 A系（町丁・字等小地域 `r2ka`）Shapefile / DBF ディレクトリ
   - `--estat-b-dir <dir>`（または `--estat-b-file <path>`）: 総務省 e-Stat 国勢調査 B系（基本単位区 `r2kb`）Shapefile / DBF ディレクトリ
3. **条件付き外部根拠入力（該当する場合のみ指定）**:
   - `--electoral-mapping <csv>`（および対象選挙区指定オプション `${ELECTORAL_ARGS}`）: 分割自治体を含む選挙区等で、自治体内の一部町域を対象地区へフィルタリングするための公式区割り対応表（`city_name,town_name,electoral_district`）
   - `--reading-reconciliation <json>`: ABRとの表記揺れ・読み欠落を公的資料で解決する外部根拠JSON（キー `"<city_code>:<town_code>"`、必須8項目）
   - `--estat-reconciliation <json>`: `1:0`（対応する独立e-Stat小地域が存在しない親町）または秘匿統計値を公的資料で解決する外部根拠JSON（キー `"<city_code>:<skeleton_town_name>"` 等、必須8項目）

### 1.3 最終成果物契約 (4-Artifact Simultaneous Output Contract)
Layer 4（Final Master Compiler）は、メモリ上の同一 Final Distribution Area オブジェクト配列から以下の4成果物を一時ファイル経由で同時・原子的に出力する（既存ファイルの上書きは Fail-Closed で拒否）：
1. **`address_master.csv`（8列マスターCSV）**:
   ```csv
   rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code
   ```
   - `rowId`: Layer 4 最終整列後に単一採番される `1..N` の連続整数（欠番・重複なし）
   - `city_name`: 自治体名（郡名除去済み、政令指定都市の行政区・東京都特別区は保持）
   - `town_name`: 配布エリア表示名（非分割時は公式親町名 `<parent_town_name>`、分割時は半角スペース付き `<parent_town_name> (1)` .. `<parent_town_name> (K)`）
   - `latitude`, `longitude`: 決定論的代表座標（小数点以下6桁フォーマット、Pattern A/B はメドイド単体ポリゴンおよび有世帯結合ポリゴン双方の Even-Odd PIP 二重検証済み世帯加重メドイド点、Pattern C `1:0` は MLIT 基準点）
   - `households`, `population`: 国勢調査確定世帯数・人口（Pattern C `1:0` のみ空欄 `""`）
   - `e_stat_code`: 親町とA系小地域が `1:1` かつ非分割（`split_total == 1`）の場合のみ `KEY_CODE` を出力し、`1:N` 統合・Pattern B 分割・Pattern C `1:0` では空欄 `""`
2. **`boundaries.geojson`（境界ポリゴン GeoJSON）**:
   - RFC 7946 `FeatureCollection`（`features.length == N`、`address_master.csv` と `rowId = 1..N` で完全 1:1 対応）
   - 各 Feature の `properties` は `rowId`, `city_name`, `town_name`, `households`, `population`, `e_stat_code`, `geometry_status` を保持（Pattern C `1:0` は `households: null`, `population: null`, `geometry: null`, `geometry_status: "UNAVAILABLE_OFFICIAL_POLYGON"`）
3. **`municipality_master.csv`（自治体マスターCSV）**:
   ```csv
   city_name,city_code,total_towns
   ```
   - 自治体ごとの最終配布エリア件数 `total_towns` が `address_master.csv` および `boundaries.geojson` の自治体別件数と完全一致し、`sum(total_towns) == N` を満たす。
4. **`provenance.json`（完全追跡構造化 Provenance）**:
   - `contract_version: "3.2"`, `total_parent_towns`, `total_records`, `total_households`, `total_population`、および全 `N` レコードの追跡情報（`rowId`, `skeleton_rowId`, `city_code`, `parent_town_code`, `official_town_name`, `display_town_name`, `pattern`, `split_index`, `split_total`, `a_area_codes`, `basic_unit_codes`, `zero_household_area_codes`, `single_large_basic_unit`, `granularity_exception`, `island_absorption`, `matching_evidence`, `estat_reconciliation_evidence`, `coordinate_source`, `coordinate_validation`, `geometry_status`）を完全永続化。

### 1.4 明確な対象外責務 (Out of Scope)
以下は本Skillの責務に含まれない（混入禁止）：
- LINE公式アカウント・LIFF・Messaging API 等の外部チャネル設定
- Google Spreadsheet DB のシート構築・GAS デプロイ
- 共通 Runtime（`active/**`）やクライアント UI の変更

---

## 2. 4-Layer Universal Master Architecture & 数理契約

本Skillが執行する 4-Layer パイプラインは、以下の最上位不変条件（Fundamental Invariants）と各層の数理契約に厳格に従う。

### 2.0 最上位不変条件
1. **e-Stat 1行 $\neq$ POSTING MAP 1配布エリア**:
   - A系小地域の複数レコード（`1:N` や `KIGO_E` 分割行）や B系基本単位区レコードをそのまま1対1で最終CSVの行へ展開してはならない。また `SETAI == 0` の小地域・基本単位区から単独の0世帯配布ピンを生成してはならない。
2. **`rowId` 最終単一採番原則**:
   - Layer 1〜Layer 3 の途中段階で最終 `rowId` を確定してはならない。Layer 4 で全配布エリアの最終順序が確定した後に1回だけ `rowId = 1..N` を採番する。
3. **4成果物同時生成原則**:
   - 4成果物は必ず Layer 4 の単一パスから同時出力し、別スクリプトの後付けパッチや手動編集を禁止する。

---

### 2.1 Layer 1: Official Address Layer (正式住所骨格層)
- **MLIT `data_kind=1` 原則**:
  - 国土交通省位置参照情報の「大字・町丁目レベル（`data_kind=1`）」のみを使用し、街区レベル（`data_kind=0`）の混入を禁止する。同梱メタデータ XML（JMP 2.0 / ISO 19115）の `<citation>` から原資料作成日（`dateType=001`）を検証・記録する。
- **選挙区フィルタリング**:
  - `--electoral-mapping` 指定時は、母集合の全町域が区割り表に存在し（未定義 `0` 件）、単一選挙区に一意帰属する（重複帰属 `0` 件）ことを検証した上で対象選挙区一致町域のみを抽出する。
- **自治体名正規化と案A（Plan A）大字衝突回避**:
  - 郡名（`〇〇郡△△町` $\to$ `△△町`）のみを除去し、政令指定都市の行政区（`〇〇市△△区`）および東京都特別区（`〇〇区`）は完全保持する。
  - 町字名先頭の「大字」を除去した際に同一自治体内の異なる公式町字コード間で名称衝突が発生する場合は、双方とも原文名称（「大字〇〇」）を保持して別町域として分離維持する（案A）。原文保持でも同名異コードとなる場合は即時 `HARD STOP` とする。
- **ABR 公式階層読み解決と決定論的 6段階 `sort_key`（§2.4.4）**:
  - デジタル庁 ABR 町字マスターの公式階層（`machiaza_type`: `1` 大字, `2` 丁目, `3` 小字）および必要時の `--reading-reconciliation`（8必須項目：`raw_town_name`, `reconciled_reading`, `reconciled_target_official_name`, `source_provider`, `source_document_title`, `source_url`, `source_section_or_page`, `verified_date`）により全親町の読みを100%解決する。
  - 各親町に正本規則（`DISTRICT_DATA_ACQUISITION_RULE.md` v3.2 §2.4.4）および `build-district-master.py` / `sort-address-master.py` に完全一致する決定論的 6段階 `sort_key = ((city_kana, city_code), (to_seion(base_kana), base_kana), int(chome_num), official_town_name, parent_town_code)`（第1キー：自治体読み五十音順＋5桁自治体コード、第2キー：清音正規化 `to_seion(base_kana)` 五十音順＋原文カナ `base_kana`、第3キー：丁目整数値 `int(chome_num)`〔丁目なしは `0`〕、第4キー：公式親町名、第5キー：公式親町コード、および Layer 4 最終出力時の第6キー：`split_index`）を付与する。Layer 1 では最終 `rowId` を採番しない。

---

### 2.2 Layer 2: Official Statistical Atomic Layer (公的統計最小単位層)
- **最新完全共通国勢調査年度の動的解決**:
  - 対象地区の全自治体において、A系（町丁・字等小地域 `r2ka`）と B系（基本単位区 `r2kb`）の双方が揃う最新完全共通年度を動的に解決する（年度ハードコードおよび異年混在は禁止）。
- **A系 `KIGO_E` 行順非依存正規化**:
  - 同一 `KEY_CODE` に複数レコード（`KIGO_E = E1, E2, E3...`）が存在する場合、DBF行順（最後の行勝ち等）に依存してはならない。
  - 統計値（`SETAI`, `JINKO`）および代表点（`X_CODE`, `Y_CODE`）は必ず `KIGO_E == "E1"` のレコード（1件のみ存在必須）から採用し、ポリゴンリングは `E1, E2, E3...` の全レコードから欠落なく結合・決定論的整列して保持する。
- **親町とA系の空間結合カーディナリティ監査**:
  - `0:1`: 対象地区外のA系小地域は除外。
  - `1:1`: 親町に1つのA系正規化単位が対応。
  - `1:N`: 親町に複数のA系正規化単位が対応。Layer 2 では行展開せず、親町の総世帯数 $H = \sum \text{SETAI}$・総人口 $P = \sum \text{JINKO}$ として統合する。
  - `N:1`: 複数の親町が同一 `KEY_CODE` を主張した場合は即時 `HARD STOP`。
  - `1:0`: 親町に対応する独立A系小地域が存在しない場合、`--estat-reconciliation` の8必須項目（`city_code`, `skeleton_town_name`, `reconciled_status="no_independent_estat_small_area"`, `source_provider`, `source_document_title`, `source_url`, `source_section_or_page`, `verified_date`）を機械検証し、Pattern C とする。**`1:0` 親町に対して B系 `S_NAME` から統計やポリゴンを切り出すことは厳禁**とする（親A系の世帯数・人口と二重計上になるため）。
- **B系 Atomic Unit 構築（`K_AREA` 事前統合禁止）**:
  - B系基本単位区（`r2kb`）は **`1 r2kb KEY_CODE = 1 B-Series Atomic Unit`** として構築する。`K_AREA` は全0等の非一意値を取り得るため、`K_AREA` による事前統合は永久禁止とする。
  - `SETAI == 0` の0世帯B系単位も削除せず、Geometry 統合候補（$U_0$）として保持する。
- **A/B 統計保存則ゲート (Conservation Gate)**:
  - `1:1` および `1:N` のすべての親町 $T$ について、A系合計とB系合計が1世帯・1人の狂いもなく完全一致（`diff == 0`）することを検証する：
    $$\sum_{a \in A(T)} \text{SETAI}(a) = \sum_{b \in B(T)} \text{SETAI}(b) = H, \quad \sum_{a \in A(T)} \text{JINKO}(a) = \sum_{b \in B(T)} \text{JINKO}(b) = P$$
  - `SETAI` または `JINKO` に非数値（秘匿記号 `X`, `-` 等）が含まれる場合、`--estat-reconciliation` による公的根拠なしの0変換を禁止し、未解決時は即時 `HARD STOP` とする。

---

### 2.3 Layer 3: Distribution Area Builder (配布エリア構築層)
- **距離関数 `dist_m` と世帯加重メドイドの数理定義（§4.9 FINAL LOCK）**:
  - 親町 $T$ に属するすべての正規化済みB系 Atomic Unit（有世帯＋0世帯の全 $n \ge 1$ 個の `r2kb` `KEY_CODE`）の代表点緯度平均から基準緯度 $\phi_0 = \text{radians}\left(\frac{1}{n}\sum_{i=1}^n \text{float}(Y\_CODE_i)\right)$ を算出し、地球半径 $R = 6378137.0\text{ m}$（IEEE 754 `float64`）による局所正距円筒図法（Local Equirectangular Projection）で2点間距離を算出する：
    $$x = R \cdot \cos(\phi_0) \cdot \text{radians}(\text{lon}), \quad y = R \cdot \text{radians}(\text{lat}), \quad \text{dist\_m}(1, 2) = \text{hypot}(x_1 - x_2, y_1 - y_2)$$
  - 有世帯B系部分集合における世帯加重メドイド $u^*$ は、`KEY_CODE` 昇順に走査し、加重距離和 `wsum = sum(SETAI_j * dist_m(i, j))` が `wsum < best_wsum - 1e-9` を満たす場合のみ更新することで、同値時の **`smallest KEY_CODE` 優先** を厳格保証する。
- **Pattern A / B / C 判定と Official Decision Gate (`ODG-01`)**:
  - **Pattern C (`C_ZERO_OR_UNMATCHED`)**:
    - `1:0` 親町（`households=""`, `population=""`, `e_stat_code=""`, `K=1`）または $H = 0$ の親町（`households=0`, `population=P`, `K=1`）。分割禁止。
  - **Pattern A (`A_NORMAL`, $K=1$)**:
    - $1 \le H \le 800$ の親町、または $801 \le H \le 999$ で `ODG-01` により非分割（$K=1$）と判定された親町。
  - **Official Decision Gate `ODG-01`（$801 \le H \le 999$ の決定論的2段階判定）**:
    - **Step 1（複離島分離判定）**: 有世帯B系単位集合 $U_+ = \{u \in B(T) \mid h_u > 0\}$ の Canonical Rook 隣接グラフにおいて、世帯数合計が $200$ 世帯以上の連結成分（Major Residential Island）が **2つ以上** 存在する場合 $\to$ **Pattern B（$K=2$ 分割）**。
    - **Step 2（空間広がり距離 $D_1$ 判定）**: Major Residential Island が1つの場合、有世帯B系集合 $U_+$ の世帯加重メドイド $u^*$ からの世帯加重平均距離 $D_1 = \frac{1}{H}\sum_{u \in U_+} h_u \cdot \text{dist\_m}(u, u^*)$（IEEE 754 `float64`）を算出する：
      - $D_1 \ge 400.000\text{ m}$ $\to$ **Pattern B（$K=2$ 分割）**（`K=2` クラスタリングで `< 200` 世帯が回避不能な場合のみ非分割 $K=1$）
      - $D_1 < 400.000\text{ m}$ $\to$ **Pattern A（$K=1$ 非分割）**
  - **Pattern B (`B_SPLIT`, $K \ge 2$)**:
    - $H \ge 1000$ の親町、または $801 \le H \le 999$ で `ODG-01` により分割対象と判定された親町。
- **分割数 $K$ の決定式・$K_{\min}$ 下限・`>700` 契約・`<200` 解消手段（§4.2.1 & §4.2.2）**:
  - 基準式（`round_half_up` は `Decimal(ROUND_HALF_UP)` 四捨五入）：
    $$K_{\min} = \lceil H / 700 \rceil, \quad K_{\max} = \lfloor H / 400 \rfloor, \quad K_{\text{target}} = \text{round\_half\_up}(H / 550)$$
  - **通常区間（$K_{\min} \le K_{\max}$）**: 閉区間 $[K_{\min}, K_{\max}]$ 内の整数候補を `(|K - K_target|, K)` 昇順（$K_{\text{target}}$ に最も近く、同距離なら小さい $K$ 優先）に評価し、帯域違反ペナルティ（`< 200`, `> 700`, `< 400`）がすべて $0$ となる最初の $K$（存在しない場合は区間内で辞書式目的関数最良の合法 $K$）を選択する。
  - **帯域逆転区間（$K_{\min} > K_{\max}$）**: 初期候補を `cand_ks = [max(K_min, K_target)]` とし、必要時は $K_{\min}$ まで評価する。
  - **$K_{\min}$ 下限と合法解不在時の `HARD STOP`**:
    - $H \ge 1000$ かつ有世帯B系 Atomic Unit が2つ以上存在する親町では、$K < K_{\min}$ とすると平均世帯数が必然的に $700$ を超えるため、**$K < K_{\min}$ への減算・縮退は一切禁止** とする。
    - $K \ge K_{\min}$ のいかなる候補 $K$ においても合法な分割（全クラスタ $\ge 200$ かつ複数単位クラスタ $\le 700$）が成立しない場合は、違法な分割や $K < K_{\min}$ への縮退を出力せず即時 **`HARD STOP`** とする。
    - 唯一の $K=1$ 例外は、親町の有世帯B系 Atomic Unit が単一（1個のみ）でそれ以上分割不能な場合（`ATOMIC_UNIT_TOO_LARGE`）に限る。
  - **`> 700` 世帯契約と粒度例外フラグの厳格分離**:
    - 複数のB系 Atomic Unit から構成される分割クラスタが $700$ 世帯を超えること（`> 700`）は **完全禁止** とする。
    - `> 700` が許容される唯一の例外は、**単一のB系 Atomic Unit 自体が単独で $700$ 世帯を超えている場合（Single Atomic Unit $> 700$）** のみであり、他の有世帯単位を併合せず単独クラスタとした上で `single_large_basic_unit: true`, `granularity_exception: "ATOMIC_UNIT_TOO_LARGE"` を記録する。
    - `granularity_exception: "GRANULARITY_EXCEPTION"` は、すべての許容操作を尽くしても解消できない **`200..399` 世帯のクラスタのみ** に限定付与し、`> 700` クラスタへ流用することを禁止する。
  - **`< 200` 世帯絶対禁止と4つの解消手段**:
    - 分割クラスタにおける **`< 200` 世帯は絶対禁止（`HARD STOP`）** とする。`< 200` 世帯の解消には、(1) Balanced Region Growing、(2) Minor Residential Island Absorption（Mode A / Mode B）、(3) Boundary Swap（Move Type A：単一非関節点移動、および Move Type B：関節点＋連結枝移動）、(4) 合法範囲内での $K$ 調整（$H \ge 1000$ では $K \ge K_{\min}$ の範囲内、$801 \le H \le 999$ の `ODG-01` Step 2 では非分割 $K=1$ への復帰）を用いる。
- **Canonical 9桁座標丸めと Rook 隣接グラフ（人工ブリッジ禁止・§4.3 ODG-03）**:
  - 全頂点座標を `round(lon, 9), round(lat, 9)` に正規化する。
  - 2つのB系単位の正規化リングが正の長さの境界線分（$\text{shared\_edge\_length} > 0$）を共有する場合のみ Rook 隣接と判定する（1点接触 Point-touch は非隣接）。非連結ポリゴン間を人工エッジで接続することは厳禁とする。
- **Connected Components・シード選択・Region Growing・Minor Island Absorption・6段階 Boundary Swap（§4.4〜§4.8）**:
  1. **Connected Components 抽出**: 有世帯B系単位 $U_+$ の Rook 連結成分を抽出し、世帯数合計 $\ge 200$ の主要成分（Major Residential Islands）を `(-sum(SETAI), min(KEY_CODE))` 順に整列する。
  2. **Deterministic Farthest-First Seed Selection（§4.5 & §4.9）**:
     - **Seed 1（北西端シード）**: 主要成分プール（要素数 $< K$ なら $U_+$ 全体）から **`north (round(lat, 6) max) -> west (round(lon, 6) min) -> smallest KEY_CODE`** の優先順で選択する（明示的 comparator と文字列符号反転なしの多段安定ソートの双方で一致検証）。
     - **Seed $2..K$（Farthest-First シード）**: 未シードの主要成分（$\ge 200$ 世帯）が残っている間はその成分内を優先候補プールとし、既選択シード群への最小距離 $d_{\min}$ に基づき **`farthest (round(d_min, 6) max) -> north (round(lat, 6) max) -> west (round(lon, 6) min) -> smallest KEY_CODE`** の優先順で選択する。
  3. **Balanced Region Growing（§4.6）**:
     - 有世帯 Rook 隣接グラフ上で、各クラスタ $C_k$（単一単位で $> 700$ 世帯のクラスタを除く）に Rook 隣接する未割当単位 $b$（単一で $> 700$ 世帯の単位を除く）のうち、優先度タプル **`(over_700, H_k, abs((H_k + SETAI_b) - 550), round(dist_m(center(C_k), b), 6), k, str(b.KEY_CODE), b_idx)`**（ただし `over_700 = 1 if H_k + SETAI_b > 700 else 0`、`center(C_k)` は $C_k$ の現在世帯加重メドイド）が辞書式最小のものを反復的に割り当てる。
  4. **Minor Residential Island Absorption — Mode A / Mode B（§4.4.3 & §4.6）**:
     - Region Growing 完了後に残存する未割当の非連結有世帯成分（$< 200$ 世帯の小規模住宅島、または未シード島）を成分単位でまとめ、独立 `< 200` クラスタ化および人工ブリッジ生成を禁止し、All-Unit Rook Graph（0世帯B系単位を含む全B系単位のRook隣接グラフ）における連結状態に応じて以下の **Mode A** または **Mode B** で決定論的に既存クラスタへ吸収して `island_absorption: true` を記録する：
       - **Mode A（All-Unit Rook Graph 上で他クラスタと連結可能な場合：共有境界長 $\text{shared\_boundary\_m} > 0$ が存在する場合）**:
         評価タプル **`(-round(shared_boundary_m, 6), round(d_min_cluster, 6), min_cluster_KEY_CODE, k)`**（1. 共有境界長最大 $\to$ 2. 代表点間最短距離 `dist_m` 最小 $\to$ 3. クラスタ内最小公式 `KEY_CODE` 昇順 $\to$ 4. クラスタ番号 `k` 昇順）が最小のクラスタ $k$ へ吸収する。
       - **Mode B（All-Unit Rook Graph 上でも完全非連結な場合：全候補クラスタに対して $\text{shared\_boundary\_m} = 0$ の場合）**:
         評価タプル **`(over_700, round(d_min_cluster, 6), min_cluster_KEY_CODE, k)`**（1. 吸収後世帯数が $700$ 以下を維持できるクラスタ優先〔`over_700 = 0 if H_k + comp_h <= 700 else 1`〕 $\to$ 2. 代表点間最短距離 `dist_m` 最小 $\to$ 3. クラスタ内最小公式 `KEY_CODE` 昇順 $\to$ 4. クラスタ番号 `k` 昇順）が最小のクラスタ $k$ へ吸収する。
  5. **6-Level Lexicographic Boundary Swap Optimization — Move Type A & Move Type B（§4.7 & §14 ODG-03）**:
     - クラスタ $u$（$|C_u| \ge 2$）の境界候補単位 $b \in C_u$ から、$b$ と正の長さの境界線分を共有（Rook 隣接）する他クラスタ $v$ への移動候補 `move_set` について、以下の **6段階辞書式基準** を厳密改善（`cand_lex < cur_lex`）する最良移動を最大100反復適用する：
       - **Level 1（Rook 連結性と非空クラスタ維持 — Move Type A / Move Type B）**:
         - **Move Type A（非関節点の単一 Atomic Unit 移動）**: $C_u \setminus \{b\}$ の Rook 連結成分数が移動前の $C_u$ の連結成分数を超えない場合、$\text{move\_set} = \{b\}$, $\text{keep\_u} = C_u \setminus \{b\}$ とする。
         - **Move Type B（関節点＋切り離される連結枝の一括移動：Deterministic Connected Branch Transfer）**: $b$ が自身が属する連結成分 $\text{comp\_with\_b} \subseteq C_u$ の関節点（Articulation Point）である場合、$\text{comp\_with\_b} \setminus \{b\}$ の各連結部分成分（Sub-branch）を **`(-sum(SETAI), min(KEY_CODE))`**（1. 枝の合計世帯数最大 $\to$ 2. 枝内の最小公式 `KEY_CODE` 昇順）で整列し、先頭の **主枝（Main Branch）** を $C_u$ に残し（$\text{keep\_u} = \text{main\_branch} \cup (C_u \setminus \text{comp\_with\_b})$）、関節点 $b$ と主枝以外の切り離される全部分枝を一括して移動単位集合 $\text{move\_set} = \text{comp\_with\_b} \setminus \text{main\_branch}$ とする。
         - **移動後連結性4条件と禁止事項**: Move Type A / B ともに、(1) 移動元残留部 $\text{keep\_u} \neq \emptyset$ かつ $\text{comp\_with\_b} \setminus \text{move\_set}$ が単一 Rook 連結成分であること、(2) 移動集合 $\text{move\_set}$ 自体が単一 Rook 連結成分であること（非連結な複数枝の移動は禁止）、(3) 境界単位 $b$ が移動先クラスタ $C_v$ の少なくとも1単位と実ポリゴン上で Rook 隣接（共有境界線分長 $> 0$）していること（人工ブリッジや非隣接ジャンプは禁止）、(4) $C_v \cup \text{move\_set}$ の連結成分数が移動前の $C_v$ の連結成分数を超えないこと、の4条件すべてを満たす移動のみを合法とする。
       - **Level 2（`< 200` 世帯禁止ペナルティ最小化）**: `under_200 = sum(max(0, 200 - H_k)^2)`
       - **Level 3（`> 700` 世帯超過ペナルティ最小化）**: `over_700 = sum(max(0, H_k - 700)^2)`
       - **Level 4（`400..700` 帯域不足および `550` 中心偏差最小化）**: `under_400 = sum(max(0, 400 - H_k)^2)` 次いで `dev_550_sq = sum((H_k - 550)^2)`
       - **Level 5（空間コンパクト性最小化）**: `round(sum_k wsum_medoid(C_k), 6)`
       - **Level 6（決定論的 Tie-Break）**: `(str(b.KEY_CODE), v, u)` 昇順。
  6. **0世帯B系単位（$U_0$）の事後帰属と Polygon Union（§4.8）**:
     - 有世帯クラスタ確定後、0世帯B系単位を **Wave 1（共有境界線分長 `s_len > 0` 最大優先：`(-round(s_len, 6), str(z.KEY_CODE), cluster_min_keycode, z_idx, k)`）** および **Wave 2（非接触0世帯単位の最短距離優先：`(round(d_min, 6), cluster_min_keycode, k)`）** により事後帰属させ、有向辺の相殺（Opposite-direction edge cancellation）で内部境界線を消去した Polygon / MultiPolygon を構築する。
     - 0世帯単位の事後帰属は Geometry と `zero_household_area_codes` のみを更新し、各クラスタの `households`, `population`, `basic_unit_codes`, および代表点（`latitude`, `longitude`）を一切変更しない。
- **代表点（Household-Weighted Medoid）と Even-Odd 二重 PIP Gate（§5.1 & §5.2）**:
  - クラスタ内の有世帯B系集合 $C_{k,+}$ から選んだ世帯加重メドイド単位 $i^*$ の代表座標 `(round(lon, 6), round(lat, 6))` が、**(1) メドイド単位 $i^*$ 自身の Solid ポリゴン内部** かつ **(2) クラスタの有世帯結合 Solid ポリゴン $G(C_{k,+})$ 内部** の双方で Even-Odd 包含条件（外周 depth 偶数＝CW、穴 depth 奇数＝CCW）を満たすことを検証する（`coordinate_source: "b_series_weighted_medoid"`, `coordinate_validation: "PASS_EVEN_ODD_PIP"`）。
  - 万一いずれかの包含条件を満たさない場合は、メドイド単位ポリゴン（または有世帯結合ポリゴン）上の決定論的スキャンライン／グリッド内部点（`compute_deterministic_interior_point`）へフォールバックし、`coordinate_source: "b_series_medoid_pip_fallback_pos"`, `coordinate_validation: "PASS_EVEN_ODD_PIP"` を記録する。
  - **Pattern C の Geometry / 座標契約**: 公的ポリゴンが存在しない `1:0` 町域等は合成ポリゴンを生成せず、`geometry: null`, `geometry_status: "UNAVAILABLE_OFFICIAL_POLYGON"` とし、Layer 1 の MLIT 基準点座標（`coordinate_source: "mlit_reference_point"`, `coordinate_validation: "NO_POLYGON_1_TO_0_RECONCILED"`）を保持する。
- **分割枝番 `(1)..(K)` の決定論的採番（§6）**:
  - 同一親町内の分割クラスタを `(-round(latitude, 6), round(longitude, 6), min(basic_unit_codes))`（北から南 $\to$ 西から東 $\to$ 最小基本単位区コード昇順）で整列し、`split_index = 1..K`、半角スペース付き表示名 `<parent_town_name> (1)` .. `<parent_town_name> (K)` を付与する。

---

### 2.4 Layer 4: Final Master Compiler (最終マスター出力層)
- 全親町の最終配布エリアを `(Layer 1 sort_key, split_index)` で一意に整列し、先頭から **`rowId = 1..N` を1回だけ採番** する。
- 同一メモリ上の確定オブジェクト群から `address_master.csv`, `boundaries.geojson`, `municipality_master.csv`, `provenance.json` の4成果物を同時出力し、内蔵 Gate 1〜4 を即時検証する。

---

## 3. 標準CLI実行手順 (Standard Universal Execution Procedure)

新地区プロビジョニングまたは既存地区の再生成・検証時は、以下の **Step 1 〜 Step 6** を順番通り実行する。

### Step 1: 外部入力パラメータの準備
対象地区の外部パラメータ（自治体コード群、作業用キャッシュディレクトリ、必要に応じた選挙区対応表・Reconciliation JSON）を変数として定義する：
```bash
# 例: 外部パラメータ定義（実際の対象地区の値を外部から与える）
PRIMARY_CITY_CODE="<5桁代表自治体コード>"
# 複数自治体の場合は --target-cities を追加構成
RAW_DIR="scratch/<district_work>/raw"
OUT_RUN1="scratch/<district_work>/run1"
OUT_RUN2="scratch/<district_work>/run2"
```

### Step 2: 公的原本データの自律取得と共通国勢調査年度解決（未取得時）
`scripts/fetch-district-raw-data.py` を用いて、国交省位置参照情報（`data_kind=1`）、ABR原本検証、および e-Stat A系（`r2ka`）・B系（`r2kb`）の最新完全共通年度データを取得する：
```bash
python3 scripts/fetch-district-raw-data.py \
  --city-code "${PRIMARY_CITY_CODE}" \
  --ref-dir "${RAW_DIR}/mlit" \
  --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
  --fetch-estat \
  --estat-dir "${RAW_DIR}/estat" \
  --fetch-estat-b \
  --estat-b-dir "${RAW_DIR}/estat_b"
```
> **Note**: 複数自治体で構成される地区の場合は `--target-cities <5桁コード>` を全構成自治体分付与し、A系・B系の最新完全共通年度を地区全体で一括解決する。既に検証済み原本がキャッシュされている場合は Step 3 または Step 4 へ進む。

### Step 3: Layer 1 正式住所骨格の単独検証（任意・推奨）または直接入力準備
必要に応じて `--phase1-only` で Layer 1 親町骨格と `skeleton_provenance.json` を出力し、`sort-address-master.py` による順序不変性を確認できる（Step 4 で `--ref-csv` から直接4-Layerコンパイルすることも、Step 3 の `--phase1-skeleton` + `--skeleton-provenance` を引き渡すことも可能であり、双方とも同一の Layer 1 `sort_key` を構築する）：
```bash
python3 scripts/build-district-master.py \
  --phase1-only \
  --ref-csv "${RAW_DIR}/mlit_combined_reference.csv" \
  --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
  --out-csv "scratch/<district_work>/skeleton.csv" \
  --provenance-out "scratch/<district_work>/skeleton_provenance.json"
  # 必要時のみ追加:
  # --electoral-mapping "<electoral_mapping.csv>" ${ELECTORAL_ARGS}
  # --reading-reconciliation "<reading_reconciliation.json>"
```

### Step 4: 4-Layer Master Compiler による 4成果物同時生成（Run 1 & Run 2）
`scripts/build-district-master.py` を実行し、Layer 1〜4 を一貫執行して4成果物を同時生成する。決定論性（Determinism）を証明するため、独立した2つの出力ディレクトリ（`run1`, `run2`）へ同一入力で2回生成する：
```bash
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
    # 対象地区で必要な場合のみ以下を付与:
    # --electoral-mapping "<electoral_mapping.csv>" ${ELECTORAL_ARGS}
    # --reading-reconciliation "<reading_reconciliation.json>"
    # --estat-reconciliation "<estat_reconciliation.json>"
done
```

### Step 5: 決定論性（2-Run Byte Identity）および再ソート不変性監査
1. **2-Run 完全 Byte 一致検証**:
   ```bash
   cmp --silent "${OUT_RUN1}/address_master.csv" "${OUT_RUN2}/address_master.csv"
   cmp --silent "${OUT_RUN1}/boundaries.geojson" "${OUT_RUN2}/boundaries.geojson"
   cmp --silent "${OUT_RUN1}/municipality_master.csv" "${OUT_RUN2}/municipality_master.csv"
   cmp --silent "${OUT_RUN1}/provenance.json" "${OUT_RUN2}/provenance.json"
   ```
   4ファイルすべてで終了コード `0`（`byte diff == 0` / SHA-256 完全一致）であることを確認する。
2. **`sort-address-master.py` 再整列不変性検証**:
   ```bash
   python3 scripts/sort-address-master.py \
     --input "${OUT_RUN1}/address_master.csv" \
     --output "${OUT_RUN1}/address_master_resorted.csv" \
     --abr-file "${RAW_DIR}/abr/<abr_master>.csv" \
     --provenance "${OUT_RUN1}/provenance.json"
     # 必要時のみ: --reading-reconciliation "<reading_reconciliation.json>"

   cmp --silent "${OUT_RUN1}/address_master.csv" "${OUT_RUN1}/address_master_resorted.csv"
   ```
   生成直後の `address_master.csv` と再ソート結果が `byte diff == 0` で完全一致することを確認し、確認後に一時ファイル `address_master_resorted.csv` を削除する。

### Step 6: District Data Quality Gate 機械検証
補助マスター（`election_history.json`, `area_mapping.json`, `storage_locations.json`）を含むデータディレクトリに対して `scripts/validate-district-data-gate.mjs` を実行し、Master Triad 閉包整合性を検証する：
```bash
node scripts/validate-district-data-gate.mjs --data-dir "<target_data_dir>"
```

---

## 4. 機械検証ゲート一覧 (Mandatory Verification Gates 1–5)

4成果物の昇格・採用前に、以下の全ゲートが `PASS` であることを必須とする（1項目でも違反があれば即時 `HARD STOP`）：

- **Gate 1（4成果物同時整合ゲート）**:
  - `len(address_master.csv) == len(boundaries.geojson.features) == sum(municipality_master.total_towns) == len(provenance.records) == N`
  - 全 `i = 1..N` について `rowId`, `city_name`, `town_name`, `households`, `population`, `e_stat_code` が4成果物間で完全一致すること。
- **Gate 2（統計保存則ゲート）**:
  - `1:1` / `1:N` の全親町および自治体合計について、`A系正規化統計 == B系基本単位区統計 == 最終出力統計`（世帯数・人口とも `diff == 0`）が成立していること。
  - `1:0` 親町について統計値・`e_stat_code` が空欄 `""` であり、`provenance.json` に8属性 `estat_reconciliation_evidence` が完全保存されていること。
- **Gate 3（代表点 PIP & `rowId` 単一採番ゲート）**:
  - `rowId` が `1..N` の1始まり連続整数であること。
  - Pattern A / Pattern B の全行について、代表座標 `(longitude, latitude)` が有世帯結合ポリゴン $G(C_{k,+})$ の Even-Odd 内部点（`PASS_EVEN_ODD_PIP`）であること。
  - `geometry == null` の Feature が `geometry_status == "UNAVAILABLE_OFFICIAL_POLYGON"` のみであること。
- **Gate 4（粒度・連結性・`e_stat_code` 契約ゲート）**:
  - Pattern A / Pattern B に単独の0世帯行が存在しないこと。
  - Pattern B 分割クラスタに `< 200` 世帯および複数 Atomic Unit から成る `> 700` 世帯が存在せず、`200..399` 世帯には `granularity_exception: "GRANULARITY_EXCEPTION"`、単一 Atomic Unit `> 700` 世帯には `single_large_basic_unit: true` かつ `granularity_exception: "ATOMIC_UNIT_TOO_LARGE"` が記録されていること。
  - `e_stat_code` は `1:1` かつ非分割行のみに出力され、`1:N` 統合行・分割行・`1:0` 行では空欄 `""` であること。
- **Gate 5（決定論・完全再現性ゲート）**:
  - 同一入力からの2回独立実行で4成果物すべての SHA-256 が完全一致（`byte diff == 0`）し、`sort-address-master.py` 再整列結果とも `byte diff == 0` で一致すること。

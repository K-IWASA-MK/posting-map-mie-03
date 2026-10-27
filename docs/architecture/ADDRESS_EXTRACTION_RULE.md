# POSTING MAP 住所抽出規範 (ADDRESS_EXTRACTION_RULE.md)

Version: 5.0 (4-Layer Architecture / Layer 1 Official Address & Layer 3/4 Naming Contract 統合版)
Date: 2026-10-26
Author: 岩佐CEO
System: POSTING MAP / FIELD OPERATIONS OS / 289 DISTRICT EXPANSION ENGINE
関連規程: `docs/architecture/DISTRICT_DATA_ACQUISITION_RULE.md`

---

## ■ 最重要原則: Layer 1 Official Address（正式親町骨格）抽出原則

```text
┌───────────────────────────────────────────────────────────────────────┐
│ 1. Layer 1（Official Address Layer）は、対象地区の正式な               │
│    city_code, city_name, parent_town_code, parent_town_name, sort_key │
│    （正式親町骨格）を確定する。途中工程では最終 rowId を採番しない。     │
│ 2. 公式データに「丁目」が存在する場合は、丁目まで parent_town_name に   │
│    含める。                                                           │
│ 3. parent_town_name より下位の小字・方角・通称・地番範囲は、           │
│    探索・推測・生成・地区固有辞書補完を行わない。                      │
│ 4. 最終的な配布エリア表示名 town_name（分割時の「町名 (1)..(K)」付与） │
│    は Layer 3 で確定し、最終 rowId = 1..N は Layer 4 で1回だけ採番する。│
└───────────────────────────────────────────────────────────────────────┘
```

---

## ■ 判定フローチャート (Official Parent Town & Final Display Name Determination)

```text
                【Step 1: 公式区割りの確定・適用（Layer 1）】
          （適用法令の施行版・経過措置・分割自治体公的資料 ➔ 対象町域を選別）
              ※ DISTRICT_DATA_ACQUISITION_RULE.md §2.2
                                  │
                                  ▼
          【Step 2: 住所の母集合（MLIT data_kind=1）から町字名を取得・正規化】
        （郡名除去・政令市区保持・特別区保持・案A「^大字」衝突回避正規化：§2.3）
                                  │
                                  ▼
                 【公式に「丁目」が存在するか？】
                                  │
         ┌────────────────────────┴────────────────────────┐
         │ YES                                             │ NO
         ▼                                                 ▼
【丁目まで含めて parent_town_name 確定】          【町字名そのもので parent_town_name 確定】
(例: 〇〇市 └ △△町一丁目)                         (例: 〇〇市 └ □□町)
➔ parent_town_name = 「△△町一丁目」               ➔ parent_town_name = 「□□町」
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  ▼
   【Step 3: 名称衝突検査 ➔ ABR公式読み仮名・丁目数値順で sort_key 確定（Layer 1 完了）】
              （DISTRICT_DATA_ACQUISITION_RULE.md §2.4〜§2.5）
       ※ この段階では最終 rowId を採番せず、後段統計データも一切混入させない
                                  │
                                  ▼
   【Step 4: Layer 2（A系+B系統計）➔ Layer 3（Distribution Area Builder）】
     ・Pattern A / C（非分割）：town_name = parent_town_name
     ・Pattern B（B系空間分割）：town_name = "<parent_town_name> (1)" .. "(K)"
       （※正式親町名は provenance.json の official_town_name に保持）
                                  │
                                  ▼
   【Step 5: Layer 4（Final Master Compiler）で最後に1回だけ rowId = 1..N を採番】
```

---

## ■ 正確な判定テーブル

| 住所構造パターン | 公式データの構造例 | `city_name` | Layer 1 `parent_town_name` | Layer 4 最終 `town_name` | 判定理由・契約 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **郡部町村パターン** | 〇〇郡△△町 ＋ □□ | **△△町** | **□□** | **□□**（分割時は **□□ (1)** 等） | 郡名のみを除去し町村名を保持 ✅ |
| **政令指定都市区パターン** | 〇〇市△△区 ＋ □□町 | **〇〇市△△区** | **□□町** | **□□町**（分割時は **□□町 (1)** 等） | 政令指定都市の行政区名を保持 ✅ |
| **東京都特別区パターン** | 〇〇区 ＋ □□一丁目 | **〇〇区** | **□□一丁目** | **□□一丁目**（分割時は **□□一丁目 (1)** 等） | 特別区名をそのまま自治体名として保持 ✅ |
| **丁目ありパターン** | 〇〇市 ＋ △△町一丁目 | **〇〇市** | **△△町一丁目** | **△△町一丁目**（分割時は **△△町一丁目 (1)** 等） | 公式に丁目が存在するため丁目まで含める ✅ |
| **大字接頭辞（非衝突）** | 〇〇市 ＋ 大字◇◇ | **〇〇市** | **◇◇** | **◇◇**（分割時は **◇◇ (1)** 等） | 先頭の形式的な `^大字` を除去 ✅ |
| **大字接頭辞（案A衝突時）** | 〇〇市 ＋ サンプル町(コードA) / 大字サンプル町(コードB) | **〇〇市** | **サンプル町** / **大字サンプル町** | **サンプル町** / **大字サンプル町** | 異コード同名衝突時は原文 `大字` を保持し分離維持 ✅ |

---

## ■ 絶対遵守境界

1. **下位小字・方角名称の探索・推測・人工生成の禁止**:
   - `parent_town_name` より下位の小字・方角（`北部`/`南部`/`北東部`等）・通称・地番範囲を探索・推測・合成したり、特定地区専用の辞書で補完してはならない。
   - Layer 3 における Pattern B 分割時の表示用連番 `<parent_town_name> (1)` .. `(K)` のみが唯一の許容される分割表記であり、外部Google Maps検索時には末尾 `\s*\(\d+\)$` および先頭 `^大字` を除去して検索する（`DISTRICT_DATA_ACQUISITION_RULE.md` §0.4, §6）。
2. **Layer 1 への後段データの非混入と `rowId` 最終単一採番**:
   - Layer 1 の正式親町骨格決定に、e-Stat、`households`、`population`、`latitude`、`longitude`、`boundaries`、投票率等を使用してはならない。
   - `rowId = 1..N` は Layer 4（Final Master Compiler）で全配布エリア確定後に1回だけ採番し、途中工程での仮採番・振り直しを禁止する。
3. **既存稼働地区データの保護（Non-Migration）**:
   - 既に確定・稼働している既存地区データの無断 Migration や既存 `rowId` の再採番は行わない。

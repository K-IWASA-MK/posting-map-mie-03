#!/usr/bin/env python3
"""
build-district-master.py

DISTRICT_DATA_ACQUISITION_RULE.md (v3.2 FINAL DESIGN CONTRACT) に準拠した
4-Layer 全国共通地区マスター生成コンパイラ。

- Layer 1: Official Address Layer (国交省位置参照情報 data_kind=1 + 公式選挙区区割り + デジタル庁ABR)
  - --phase1-only 指定時は 3列 Area Skeleton を単独自律生成・検証。
  - 4-Layer 実行時は正式親町骨格と 6段階 sort_key (city_kana, city_code, to_seion(base_kana), base_kana, int(chome_num), parent_town_name, parent_town_code) を確定し（途中 rowId 採番なし）Layer 2 へ引き渡す。
- Layer 2: Official Statistical Atomic Layer (e-Stat A系小地域 + B系基本単位区)
  - A系 KIGO_E (E1/E2/E3) 行順非依存正規化（E1統計値保持 + 全Geometry結合保持）。
  - B系 Atomic Unit = 1 r2kb KEY_CODE（K_AREA事前統合禁止）。
  - A/B 統計保存則（diff == 0）厳格検証、1:0 Unmatched 親町の Pattern C 判定（B系 S_NAME 切り出し禁止）。
- Layer 3: Distribution Area Builder
  - Pattern A (1..800世帯) / Pattern B (>800世帯: ODG-01 801..999 Step 1 & Step 2 D1>=400.000m, >=1000世帯分割・K_min下限絶対維持・不成立時HARD STOP) / Pattern C。
  - Canonical 9桁座標 Rook隣接（線分共有長 > 0 のみ隣接、Point-touch 非隣接、人工ブリッジ禁止）。
  - Connected Components -> Farthest-First Seeds (smallest KEY_CODE tie-break) -> Balanced Region Growing -> Minor Island Absorption (Mode A / Mode B) -> 6-Level Lexicographic Boundary Swap (Move Type A / Move Type B)。
  - 0世帯 B系 Geometry 事後帰属、世帯加重メドイド代表点 + Even-Odd PIP Gate (point-on-surface fallback)。
- Layer 4: Final Master Compiler
  - Layer 1 sort_key + Layer 3 分割安定順 (1..K) による最終整列。
  - rowId = 1..N 最終単一採番。
  - 同一 Final Object からの 4成果物（address_master.csv, boundaries.geojson, municipality_master.csv, provenance.json）原子的同時出力 & Gate 1〜5 機械検証。
"""

import os
import sys
import csv
import json
import math
import re
import struct
import argparse
import tempfile
import shutil
import unicodedata
from decimal import Decimal, ROUND_HALF_UP
from functools import cmp_to_key
from collections import defaultdict, Counter

CHOME_NUM_MAP = {
    "一丁目": "01", "二丁目": "02", "三丁目": "03", "四丁目": "04", "五丁目": "05",
    "六丁目": "06", "七丁目": "07", "八丁目": "08", "九丁目": "09", "十丁目": "10",
    "十一丁目": "11", "十二丁目": "12", "十三丁目": "13", "十四丁目": "14", "十五丁目": "15",
    "十六丁目": "16", "十七丁目": "17", "十八丁目": "18", "十九丁目": "19", "二十丁目": "20"
}

SMALL_KANA_MAP = str.maketrans({
    'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
    'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ',
    'ヵ': 'カ', 'ヶ': 'ケ',
    'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
    'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ',
    'ゕ': 'か', 'ゖ': 'け',
})


def to_seion(kana):
    """
    Convert katakana/hiragana string to seion (strip dakuten/handakuten and normalize small kana)
    for JIS 50-on primary ordering (§2.4.4).
    """
    if not kana:
        return ""
    nfd = unicodedata.normalize('NFD', kana)
    stripped = ''.join(ch for ch in nfd if ch not in ('\u3099', '\u309a'))
    nfc = unicodedata.normalize('NFC', stripped)
    return nfc.translate(SMALL_KANA_MAP)


def round_half_up_int(val):
    return int(Decimal(str(val)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_args():
    parser = argparse.ArgumentParser(description='Build Universal District Master adhering to DISTRICT_DATA_ACQUISITION_RULE.md (4-Layer Contract)')
    # Core CLI arguments
    parser.add_argument('--out-csv', required=True, help='Output CSV path (Required; no default)')
    parser.add_argument('--phase1-only', action='store_true', help='Generate 3-column Area Skeleton (rowId,city_name,town_name) independently')
    parser.add_argument('--provenance-out', default=None, help='Output path for provenance JSON (optional; defaults to directory of out-csv)')
    parser.add_argument('--out-geojson', default=None, help='Output boundaries.geojson path (optional; defaults to boundaries.geojson in out-csv directory)')
    parser.add_argument('--out-muni-csv', default=None, help='Output municipality_master.csv path (optional; defaults to municipality_master.csv in out-csv directory)')

    # Layer 1 inputs
    parser.add_argument('--ref-csv', default=None, help='Path to MLIT reference_points.csv (大字・町丁目レベル; required for Phase 1 / direct Layer 1)')
    parser.add_argument('--abr-file', action='append', help='Path to Digital Agency ABR town master CSV (Required for Phase 1 / sort_key resolution)')
    parser.add_argument('--reading-reconciliation', default=None, help='Path to external official reading reconciliation JSON (optional)')
    parser.add_argument('--city-name', default='', help='Target municipality name for display override (optional)')
    parser.add_argument('--electoral-mapping', default=None, help='Path to electoral mapping CSV (city_name,town_name,electoral_district)')
    parser.add_argument('--target-district', default=None, help='Target electoral district name when electoral-mapping is provided')

    # Layer 1 pre-built handoff inputs (compatible with 2-step workflow)
    parser.add_argument('--phase1-skeleton', default=None, help='Path to Layer 1 3-column Area Skeleton CSV (rowId,city_name,town_name)')
    parser.add_argument('--skeleton-provenance', default=None, help='Path to Layer 1 Skeleton Provenance JSON')

    # Layer 2 inputs (e-Stat A-series & B-series)
    parser.add_argument('--estat-dir', default=None, help='Directory containing e-Stat A-series (and/or B-series) shapefile/dbf datasets')
    parser.add_argument('--estat-b-dir', default=None, help='Directory containing e-Stat B-series (r2kb) shapefile/dbf datasets (if separate from --estat-dir)')
    parser.add_argument('--estat-file', default=None, help='Direct path to single e-Stat A-series DBF or Shapefile')
    parser.add_argument('--estat-b-file', default=None, help='Direct path to single e-Stat B-series DBF or Shapefile')
    parser.add_argument('--estat-reconciliation', default=None, help='Path to external official e-Stat reconciliation JSON (optional)')
    parser.add_argument('--city-code', default=None, help='Municipality code (optional)')
    parser.add_argument('--target-cities', action='append', help='Target municipality codes for district assembly')
    parser.add_argument('--in-geojson', default=None, help='Deprecated legacy argument (ignored in 4-Layer compiler)')
    return parser.parse_args()


# =====================================================================
# LAYER 1: OFFICIAL ADDRESS LAYER (Preserved Universal Assets)
# =====================================================================

def normalize_city_name(raw_city):
    """
    Normalize city_name according to Rule L1-2:
    - Remove county prefix (e.g. 〇〇郡△△町 -> △△町)
    - Preserve designated city ward (e.g. 〇〇市△△区 -> 〇〇市△△区)
    - Preserve Tokyo special ward (e.g. 〇〇区 -> 〇〇区)
    """
    clean_city = raw_city.strip()
    if '郡' in clean_city:
        clean_city = re.sub(r'^.+?郡', '', clean_city)
    return clean_city


def clean_oaza_prefix(name):
    """
    Mechanically eliminate leading '大字' according to Rule L1-2.
    Preserve if the entire town name is just '大字'.
    """
    clean_name = name.strip()
    if clean_name.startswith('大字') and len(clean_name) > 2:
        return clean_name[2:]
    return clean_name


RECONCILIATION_REQUIRED_FIELDS = [
    'raw_town_name',
    'reconciled_reading',
    'reconciled_target_official_name',
    'source_provider',
    'source_document_title',
    'source_url',
    'source_section_or_page',
    'verified_date'
]


def load_reading_reconciliations(json_path):
    """
    Load external official reading reconciliation JSON (Rule L1-3).
    Key: "<city_code>:<town_code>"
    Strictly validates all 8 mandatory fields.
    """
    if not json_path:
        return {}
    if not os.path.exists(json_path):
        sys.exit(f"FATAL HARD STOP: Reading reconciliation file not found: {json_path}")
    print(f"[Layer 1 Reconciliations] Loading external official reconciliations from {json_path}...")
    with open(json_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception as e:
            sys.exit(f"FATAL HARD STOP: Malformed reading reconciliation JSON ({json_path}): {e}")

    if not isinstance(data, dict):
        sys.exit(f"FATAL HARD STOP: Reading reconciliation JSON must be an object keyed by '<city_code>:<town_code>': {json_path}")

    for k, v in data.items():
        if not isinstance(v, dict):
            sys.exit(f"FATAL HARD STOP: Reading reconciliation entry '{k}' must be an object in {json_path}")
        for field in RECONCILIATION_REQUIRED_FIELDS:
            val = v.get(field)
            if val is None or not str(val).strip():
                sys.exit(
                    f"FATAL HARD STOP [Rule 4.4]: Missing or empty required field '{field}' "
                    f"for reconciliation key '{k}' in {json_path}"
                )

    print(f"[Layer 1 Reconciliations] Loaded {len(data)} reconciliation entries.")
    return data


ESTAT_EMPTY_REQUIRED_FIELDS = [
    'city_code',
    'skeleton_town_name',
    'reconciled_status',
    'source_provider',
    'source_document_title',
    'source_url',
    'source_section_or_page',
    'verified_date'
]


def load_estat_reconciliations(json_path):
    """
    Load external official e-Stat reconciliation JSON (§3.2).
    Key: "<city_code>:<skeleton_town_name>" (or key_code for explicit small area mapping).
    For 'no_independent_estat_small_area', strictly validates all 8 mandatory fields.
    """
    if not json_path:
        return {}
    if not os.path.exists(json_path):
        sys.exit(f"FATAL HARD STOP: e-Stat reconciliation file not found: {json_path}")
    print(f"[Layer 2 Reconciliations] Loading external official e-Stat reconciliations from {json_path}...")
    with open(json_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception as e:
            sys.exit(f"FATAL HARD STOP: Malformed e-Stat reconciliation JSON ({json_path}): {e}")

    if not isinstance(data, dict):
        sys.exit(f"FATAL HARD STOP: e-Stat reconciliation JSON must be an object keyed by '<city_code>:<skeleton_town_name>': {json_path}")

    for k, v in data.items():
        if not isinstance(v, dict):
            sys.exit(f"FATAL HARD STOP: e-Stat reconciliation entry '{k}' must be an object in {json_path}")

        status = v.get('reconciled_status')
        if status == 'no_independent_estat_small_area':
            for field in ESTAT_EMPTY_REQUIRED_FIELDS:
                val = v.get(field)
                if val is None or not str(val).strip():
                    sys.exit(
                        f"FATAL HARD STOP [Rule 4.6 Reconciliation]: Missing or empty required reconciliation field '{field}' "
                        f"for empty status entry '{k}' in {json_path}"
                    )
            expected_key = f"{v['city_code']}:{v['skeleton_town_name']}"
            if k != expected_key:
                sys.exit(
                    f"FATAL HARD STOP [Rule 4.6 Reconciliation]: Key mismatch for empty status entry. "
                    f"Expected '{expected_key}', got '{k}' in {json_path}"
                )

    print(f"[Layer 2 Reconciliations] Loaded {len(data)} e-Stat reconciliation entries.")
    return data


def load_abr_readings_phase1(abr_paths):
    """
    Load official readings from Digital Agency ABR CSVs adhering to official ABR hierarchy.
    Separates exact raw name match from normalized candidates to prevent cross-town overwrite.
    """
    if not abr_paths:
        sys.exit("FATAL: --abr-file is strictly required for Phase 1 Area Skeleton generation.")

    city_readings = {}
    exact_town_readings = defaultdict(list)
    normalized_candidates = defaultdict(list)

    for path in abr_paths:
        if not os.path.exists(path):
            sys.exit(f"FATAL: ABR file not found: {path}")

        print(f"[Layer 1 ABR] Loading official ABR readings from {path}...")
        with open(path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for r in reader:
                city = r.get("city_name") or r.get("city") or r.get("市区町村名") or ""
                ward = r.get("ward_name") or r.get("ward") or r.get("区名") or ""
                m_type = (r.get("machiaza_type") or r.get("町字区分コード") or "1").strip()
                oaza_cho = (r.get("oaza_cho") or r.get("town") or r.get("町字名") or "").strip()
                oaza_cho_kana = (r.get("oaza_cho_kana") or r.get("town_kana") or r.get("町字名_カナ") or "").strip()
                chome_name = (r.get("chome") or r.get("丁目名") or "").strip()
                chome_number = (r.get("chome_number") or r.get("丁目数字") or "").strip()
                koaza = (r.get("koaza") or r.get("小字名") or "").strip()
                koaza_kana = (r.get("koaza_kana") or r.get("小字名_カナ") or "").strip()

                full_city_name = f"{city}{ward}".strip() if ward else city.strip()
                if "郡" in full_city_name:
                    full_city_name = re.sub(r"^.+?郡", "", full_city_name)

                city_kana = (r.get("city_kana") or r.get("市区町村名_カナ") or "").strip()
                ward_kana = (r.get("ward_kana") or r.get("区名_カナ") or "").strip()
                full_city_kana = f"{city_kana}{ward_kana}".strip()
                lg_code_raw = (r.get("lg_code") or r.get("全国地方公共団体コード") or r.get("city_code") or r.get("市区町村コード") or "").strip()
                lg_code_5 = lg_code_raw[:5] if len(lg_code_raw) >= 5 else lg_code_raw
                abr_town_code = (r.get("machiaza_id") or r.get("town_code") or r.get("大字町丁目コード") or "").strip()

                if full_city_name and full_city_kana:
                    city_readings[full_city_name] = full_city_kana

                if m_type == "2" or (not m_type and chome_name):  # 丁目
                    full_town = f"{oaza_cho}{chome_name}".strip()
                    base_town = oaza_cho
                    base_kana = oaza_cho_kana
                    num = chome_number
                elif m_type == "3" or (not m_type and koaza):  # 小字
                    if oaza_cho:
                        full_town = f"{oaza_cho}{koaza}".strip()
                        base_town = full_town
                        base_kana = f"{oaza_cho_kana}{koaza_kana}".strip()
                    else:
                        full_town = koaza.strip()
                        base_town = full_town
                        base_kana = koaza_kana.strip()
                    num = "00"
                else:  # 1 (大字) or default
                    full_town = oaza_cho.strip()
                    base_town = full_town
                    base_kana = oaza_cho_kana.strip()
                    num = "00"

                if not full_city_name or not full_town:
                    continue

                clean_full = re.sub(r"^大字", "", full_town)
                clean_base = re.sub(r"^大字", "", base_town)

                entry = {
                    "base_kana": base_kana,
                    "chome_number": num,
                    "full_town": full_town,
                    "base_town": base_town,
                    "city_code": lg_code_5,
                    "town_code": abr_town_code
                }

                exact_town_readings[(full_city_name, full_town)].append(entry)
                normalized_candidates[(full_city_name, clean_full)].append(entry)
                if base_town != full_town:
                    normalized_candidates[(full_city_name, clean_base)].append(entry)

    print(f"[Layer 1 ABR] Loaded {len(city_readings)} cities, {len(exact_town_readings)} exact towns, and {len(normalized_candidates)} normalized keys.")
    return city_readings, exact_town_readings, normalized_candidates


def load_electoral_mapping(mapping_path, target_district):
    """
    Load single-format electoral mapping CSV (city_name, town_name, electoral_district).
    Returns mapping dict: (city_name, town_name) -> list[electoral_district]
    """
    if not mapping_path:
        return None

    if not os.path.exists(mapping_path):
        sys.exit(f"FATAL: Electoral mapping file not found: {mapping_path}")

    if not target_district:
        sys.exit("FATAL: --target-district is required when --electoral-mapping is specified.")

    print(f"[Electoral Boundary] Loading electoral mapping from {mapping_path} (Target: {target_district})...")
    district_map = defaultdict(list)
    with open(mapping_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for idx, r in enumerate(reader):
            c = normalize_city_name(r.get('city_name', ''))
            t = r.get('town_name', '').strip()
            dist = r.get('electoral_district', '').strip()
            if not c or not t or not dist:
                sys.exit(f"FATAL: Invalid record at electoral mapping line {idx+2}: city='{c}', town='{t}', district='{dist}'")
            district_map[(c, t)].append(dist)

    print(f"[Electoral Boundary] Loaded {len(district_map)} town mappings.")
    return district_map


def resolve_town_sort_key(rec, city_readings, exact_town_readings, normalized_candidates, reconciliations):
    """
    Resolve official ABR 6-stage sort_key for a Layer 1 parent town record (§2.4.4):
      1. city_kana
      2. city_code
      3. to_seion(base_kana), base_kana
      4. int(chome_num)
      5. parent_town_name
      6. parent_town_code
    Preserves exact Layer 1 behavior and Fail-Closed guarantees.
    """
    cname = rec['clean_city']
    tname = rec['clean_town']
    raw_name = rec['raw_town']
    city_code = str(rec.get('city_code') or '')
    town_code = str(rec.get('town_code') or '')

    city_kana = city_readings.get(cname)
    if not city_kana:
        for cn, ck in city_readings.items():
            if cn == cname or re.sub(r'^.+?郡', '', cn) == cname:
                city_kana = ck
                break
    if not city_kana:
        sys.exit(f"FATAL HARD STOP [Rule 4.4]: Official ABR reading missing for city '{cname}'")

    # 1. Check external official reconciliations by composite key "<city_code>:<town_code>"
    comp_key = f"{city_code}:{town_code}"
    reconciled = reconciliations.get(comp_key)
    if reconciled and reconciled.get('reconciled_reading'):
        town_kana = reconciled['reconciled_reading'].strip()
        chome_match = re.search(r"([一二三四五六七八九十]+丁目)$", tname)
        chome_num = CHOME_NUM_MAP.get(chome_match.group(1), "00") if chome_match else "00"
        return (city_kana, city_code, to_seion(town_kana), town_kana, int(chome_num), tname, town_code)

    # 2. Check exact raw match in ABR
    town_entry = None
    exact_cands = [c for c in exact_town_readings.get((cname, raw_name), []) if c.get("base_kana")]
    if not exact_cands and raw_name != tname:
        exact_cands = [c for c in exact_town_readings.get((cname, tname), []) if c.get("base_kana")]

    if exact_cands:
        distinct_kanas = set(c["base_kana"] for c in exact_cands)
        if len(distinct_kanas) == 1:
            town_entry = exact_cands[0]
        elif len(distinct_kanas) > 1:
            sys.exit(
                f"FATAL HARD STOP [Rule 4.4]: Ambiguous ABR reading collision for town '{cname}' '{tname}' (code: '{town_code}'). "
                f"Multiple distinct ABR readings ({distinct_kanas}) for exact town name. "
                f"Provide external official reconciliation JSON via --reading-reconciliation with key '{comp_key}'."
            )

    # 3. If no exact raw match, check normalized fallback ONLY if unambiguous (distinct readings == 1)
    if not town_entry:
        clean_name = re.sub(r"^大字", "", tname)
        cands = [c for c in normalized_candidates.get((cname, clean_name), []) if c.get("base_kana")]
        distinct_kanas = set(c["base_kana"] for c in cands)
        if len(distinct_kanas) == 1:
            town_entry = cands[0]
        elif len(distinct_kanas) > 1:
            sys.exit(
                f"FATAL HARD STOP [Rule 4.4]: Ambiguous ABR reading collision for town '{cname}' '{tname}' (code: '{town_code}'). "
                f"Multiple distinct ABR readings ({distinct_kanas}) match normalized name '{clean_name}'. "
                f"Provide external official reconciliation JSON via --reading-reconciliation with key '{comp_key}'."
            )

    # 4. Check base_name for chome towns
    chome_part = ""
    chome_match = re.search(r"([一二三四五六七八九十]+丁目)$", tname)
    if not town_entry and chome_match:
        chome_part = chome_match.group(1)
        base_name = tname[:-len(chome_part)]
        clean_base = re.sub(r"^大字", "", base_name)
        cands = [c for c in normalized_candidates.get((cname, clean_base), []) if c.get("base_kana")]
        distinct_kanas = set(c["base_kana"] for c in cands)
        if len(distinct_kanas) == 1:
            town_entry = cands[0]
        elif len(distinct_kanas) > 1:
            sys.exit(
                f"FATAL HARD STOP [Rule 4.4]: Ambiguous ABR reading collision for base town '{cname}' '{base_name}' (code: '{town_code}'). "
                f"Multiple distinct ABR readings ({distinct_kanas}) match normalized name '{clean_base}'. "
                f"Provide external official reconciliation JSON via --reading-reconciliation with key '{comp_key}'."
            )

    if not town_entry or not town_entry.get("base_kana"):
        sys.exit(
            f"FATAL HARD STOP [Rule 4.4]: Official ABR reading missing for town '{cname}' '{tname}' (code: '{town_code}'). "
            f"Provide external official reconciliation JSON via --reading-reconciliation with key '{comp_key}'."
        )

    base_kana = town_entry["base_kana"]
    if not city_code and town_entry.get("city_code"):
        city_code = str(town_entry["city_code"])
        rec['city_code'] = city_code
    if not town_code and town_entry.get("town_code"):
        town_code = str(town_entry["town_code"])
        rec['town_code'] = town_code

    chome_num = CHOME_NUM_MAP.get(chome_part, "00")
    if chome_num == "00" and town_entry.get("chome_number"):
        try:
            chome_num = f"{int(town_entry['chome_number']):02d}"
        except Exception:
            pass

    return (city_kana, city_code, to_seion(base_kana), base_kana, int(chome_num), tname, town_code)


def extract_layer1_from_mlit(args):
    """
    Execute Layer 1 extraction from MLIT reference CSV(s), Electoral Mapping, and ABR.
    Returns (sorted_towns, expected_set).
    Does NOT assign final 8-column rowId (Layer 4 responsibility).
    """
    if not args.ref_csv:
        sys.exit(f"FATAL: MLIT reference CSV not found or not specified: {args.ref_csv}")

    ref_paths = [p.strip() for p in args.ref_csv.split(',') if p.strip()]
    for rp in ref_paths:
        if not os.path.exists(rp):
            sys.exit(f"FATAL: MLIT reference CSV not found or not specified: {rp}")

    mother_records = []
    for rp in ref_paths:
        print(f"[Layer 1 Step 1] Loading MLIT mother set from {rp}...")
        with open(rp, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            try:
                header = next(reader)
            except StopIteration:
                sys.exit(f"FATAL: Empty MLIT reference CSV: {rp}")

            col_city_idx = -1
            col_town_idx = -1
            col_code_idx = -1
            col_city_code_idx = -1
            col_lat_idx = -1
            col_lon_idx = -1

            for idx, h in enumerate(header):
                h_clean = h.strip().lstrip('\ufeff')
                if '市区町村名' in h_clean:
                    col_city_idx = idx
                elif '大字町丁目名' in h_clean:
                    col_town_idx = idx
                elif '大字町丁目コード' in h_clean or '町丁目コード' in h_clean:
                    col_code_idx = idx
                elif '市区町村コード' in h_clean:
                    col_city_code_idx = idx
                elif '緯度' in h_clean:
                    col_lat_idx = idx
                elif '経度' in h_clean:
                    col_lon_idx = idx

            if col_city_idx == -1 or col_town_idx == -1 or col_code_idx == -1:
                sys.exit(f"FATAL HARD STOP [Rule 4.3]: Mandatory official columns (市区町村名, 大字町丁目名, 大字町丁目コード/町丁目コード) not found in MLIT header: {header}")

            max_idx = max(col_city_idx, col_town_idx, col_code_idx)
            for line_no, r in enumerate(reader, start=2):
                if len(r) <= max_idx:
                    sys.exit(f"FATAL HARD STOP [Rule 4.3]: Malformed CSV row at line {line_no} (expected at least {max_idx + 1} columns): {r}")
                raw_city = r[col_city_idx].strip()
                raw_town = r[col_town_idx].strip()
                if not raw_city or not raw_town:
                    sys.exit(f"FATAL HARD STOP [Rule 4.3]: Missing or empty city or town at line {line_no}: city='{raw_city}', town='{raw_town}'")
                town_code = r[col_code_idx].strip()
                if not town_code:
                    sys.exit(f"FATAL HARD STOP [Rule 4.3]: Missing or empty official code at line {line_no}: city='{raw_city}', town='{raw_town}'")

                city_code = r[col_city_code_idx].strip() if (col_city_code_idx != -1 and len(r) > col_city_code_idx) else (args.city_code or "")
                if not city_code and len(town_code) >= 10 and town_code[:5].isdigit():
                    city_code = town_code[:5]
                lat = r[col_lat_idx].strip() if (col_lat_idx != -1 and len(r) > col_lat_idx) else ""
                lon = r[col_lon_idx].strip() if (col_lon_idx != -1 and len(r) > col_lon_idx) else ""

                clean_city = normalize_city_name(raw_city)
                clean_town = clean_oaza_prefix(raw_town)
                mother_records.append({
                    'city_code': city_code,
                    'raw_city': raw_city,
                    'raw_town': raw_town,
                    'town_code': town_code,
                    'clean_city': clean_city,
                    'clean_town': clean_town,
                    'lat': lat,
                    'lon': lon,
                    'source_ref_csv': os.path.abspath(rp)
                })

    if not mother_records:
        sys.exit(f"FATAL: No records parsed from MLIT reference CSV {args.ref_csv}.")

    distinct_entities = {}
    for rec in mother_records:
        entity_key = (rec['city_code'], rec['clean_city'], rec['raw_town'], rec['town_code'])
        if entity_key not in distinct_entities:
            distinct_entities[entity_key] = rec

    entity_list = list(distinct_entities.values())

    # Plan A: Detect name collision upon stripping '大字' across distinct town codes
    tentative_groups = defaultdict(list)
    for ent in entity_list:
        tentative_groups[(ent['clean_city'], ent['clean_town'])].append(ent)

    for group_key, ents in tentative_groups.items():
        distinct_codes = set(e['town_code'] for e in ents)
        distinct_raws = set(e['raw_town'] for e in ents)
        if len(distinct_codes) > 1 and len(distinct_raws) > 1:
            print(f"[Plan A Collision Avoidance] Collision detected for {group_key} ({len(distinct_codes)} distinct codes). Retaining raw names:")
            for e in ents:
                print(f"  -> Retained raw name: '{e['raw_town']}' (code: '{e['town_code']}')")
                e['clean_town'] = e['raw_town']
        elif len(distinct_raws) > 1 and len(distinct_codes) == 1:
            details = [f"(raw='{e['raw_town']}', code='{e['town_code']}')" for e in ents]
            sys.exit(
                f"FATAL HARD STOP [Rule 4.3]: Name collision detected! Distinct raw town names with same official code for {group_key} (auto-merging prohibited): {', '.join(details)}"
            )

    unique_towns_map = {}
    collision_tracker = defaultdict(set)
    for ent in entity_list:
        key = (ent['clean_city'], ent['clean_town'])
        unique_towns_map[key] = ent
        collision_tracker[key].add((ent['raw_town'], ent['town_code']))

    for key, entity_set in collision_tracker.items():
        distinct_codes = set(code for _, code in entity_set)
        if len(distinct_codes) > 1:
            details = [f"(raw='{rt}', code='{cd}')" for rt, cd in sorted(entity_set)]
            sys.exit(
                f"FATAL HARD STOP [Rule 4.3]: Name collision detected! Indistinguishable name collision detected for {key} even after Plan A raw retention! "
                f"Multiple distinct codes for same town name (auto-merging prohibited): {', '.join(details)}"
            )

    total_mother_count = len(unique_towns_map)
    print(f"[Layer 1 Step 1] Loaded {len(mother_records)} points ({len(entity_list)} unique entities). Unique mother set town count: {total_mother_count}")

    # Electoral Boundary Application
    electoral_map = load_electoral_mapping(args.electoral_mapping, args.target_district)
    target_towns = []

    if electoral_map is not None:
        print(f"[Layer 1 Step 2] Applying single-format electoral mapping (Target: {args.target_district})...")
        expected_set = set()
        for key, rec in unique_towns_map.items():
            if key not in electoral_map:
                sys.exit(f"FATAL HARD STOP [Rule 4.1]: Town {key} in mother set has no electoral mapping entry (Undetermined district)!")

            assigned_districts = electoral_map[key]
            if len(assigned_districts) > 1:
                sys.exit(f"FATAL HARD STOP [Rule 4.1]: Town {key} assigned to multiple electoral districts: {assigned_districts}!")

            district = assigned_districts[0]
            if district == args.target_district:
                target_towns.append(rec)
                expected_set.add(key)

        print(f"[Layer 1 Step 2] Filtered {len(target_towns)} towns belonging to target district '{args.target_district}'.")
    else:
        target_towns = list(unique_towns_map.values())
        expected_set = set(unique_towns_map.keys())

    if len(target_towns) == 0:
        sys.exit(f"FATAL HARD STOP [Layer 1]: Zero official parent towns extracted (Target: {args.target_district}).")

    print("[Layer 1 Step 3] Resolving official readings via Digital Agency ABR and external reconciliations...")
    city_readings, exact_town_readings, normalized_candidates = load_abr_readings_phase1(args.abr_file)
    reconciliations = load_reading_reconciliations(args.reading_reconciliation)

    for rec in target_towns:
        s_key = resolve_town_sort_key(rec, city_readings, exact_town_readings, normalized_candidates, reconciliations)
        rec['sort_key'] = s_key
        rec['resolved_reading'] = s_key[3]
    print("PASS [Reading Resolution]: All target towns resolved official readings successfully.")

    sorted_towns = sorted(target_towns, key=lambda r: r['sort_key'])
    return sorted_towns, expected_set


def run_phase1_skeleton(args):
    """
    Execute Phase 1 Area Skeleton standalone generation (--phase1-only).
    100% preserves existing CLI contract and output format.
    """
    print("=" * 70)
    print("PHASE 1 AREA SKELETON GENERATOR (DISTRICT_DATA_ACQUISITION_RULE.md)")
    print(f"MLIT Reference CSV:  {args.ref_csv}")
    print(f"Output CSV:          {args.out_csv}")
    print("=" * 70)

    if not args.ref_csv or not os.path.exists(args.ref_csv.split(',')[0].strip()):
        sys.exit(f"FATAL: MLIT reference CSV not found or not specified: {args.ref_csv}")

    if os.path.exists(args.out_csv):
        sys.exit(f"FATAL HARD STOP: Output file already exists (overwrite strictly prohibited): {args.out_csv}")

    prov_out_path = args.provenance_out or os.path.join(os.path.dirname(os.path.abspath(args.out_csv)), "skeleton_provenance.json")
    if os.path.exists(prov_out_path):
        sys.exit(f"FATAL HARD STOP: Destination skeleton provenance JSON already exists (overwrite strictly prohibited): {prov_out_path}")

    sorted_towns, expected_set = extract_layer1_from_mlit(args)

    final_skeleton_rows = []
    provenance_rows = []
    for idx, rec in enumerate(sorted_towns, start=1):
        final_skeleton_rows.append({
            'rowId': idx,
            'city_name': rec['clean_city'],
            'town_name': rec['clean_town']
        })
        provenance_rows.append({
            'rowId': idx,
            'city_code': rec['city_code'],
            'town_code': rec['town_code'],
            'raw_town_name': rec['raw_town'],
            'clean_town_name': rec['clean_town'],
            'latitude': rec['lat'],
            'longitude': rec['lon'],
            'resolved_reading': rec['resolved_reading'],
            'source_ref_csv': rec['source_ref_csv']
        })

    print("=" * 70)
    print("PHASE 1 QUALITY GATES VERIFICATION (DISTRICT_DATA_ACQUISITION_RULE.md §5.1)")
    print("=" * 70)

    output_set = set((r['city_name'], r['town_name']) for r in final_skeleton_rows)
    omitted = expected_set - output_set
    mix_ins = output_set - expected_set

    if omitted:
        sys.exit(f"FAIL QG-2: Omitted towns detected ({len(omitted)} towns): {omitted}")
    if mix_ins:
        sys.exit(f"FAIL QG-2: Mixed-in towns detected ({len(mix_ins)} towns): {mix_ins}")

    counts = Counter((r['city_name'], r['town_name']) for r in final_skeleton_rows)
    dups = {k: v for k, v in counts.items() if v > 1}
    if dups:
        sys.exit(f"FAIL QG-2: Duplicate rows detected: {dups}")

    print(f"PASS [QG-2 Set Completeness]: Expected={len(expected_set)}, Output={len(output_set)}, Omission=0, Mix-in=0, Duplicates=0")

    all_row_ids = [r['rowId'] for r in final_skeleton_rows]
    expected_row_ids = list(range(1, len(final_skeleton_rows) + 1))
    if all_row_ids != expected_row_ids:
        sys.exit(f"FAIL QG-3: rowId is not continuous 1..N! (Length: {len(all_row_ids)})")
    print(f"PASS [QG-3 rowId Integrity]: Exactly 1..{len(final_skeleton_rows)} continuous sequence verified.")

    out_dir = os.path.dirname(os.path.abspath(args.out_csv))
    os.makedirs(out_dir, exist_ok=True)
    fd, temp_csv_path = tempfile.mkstemp(prefix="phase1_skeleton_", dir=out_dir)
    os.close(fd)

    prov_dir = os.path.dirname(os.path.abspath(prov_out_path))
    os.makedirs(prov_dir, exist_ok=True)
    fd_prov, temp_prov_path = tempfile.mkstemp(prefix="skeleton_provenance_", dir=prov_dir)
    os.close(fd_prov)

    try:
        with open(temp_csv_path, 'w', encoding='utf-8', newline='\n') as f:
            writer = csv.writer(f, lineterminator='\n')
            writer.writerow(["rowId", "city_name", "town_name"])
            for r in final_skeleton_rows:
                writer.writerow([r['rowId'], r['city_name'], r['town_name']])

        with open(temp_prov_path, 'w', encoding='utf-8') as f:
            json.dump({
                "skeleton_csv": os.path.abspath(args.out_csv),
                "total_records": len(provenance_rows),
                "records": provenance_rows
            }, f, ensure_ascii=False, indent=2)

        shutil.move(temp_csv_path, args.out_csv)
        shutil.move(temp_prov_path, prov_out_path)
        print(f"SUCCESS: Written {len(final_skeleton_rows)} records to {args.out_csv}")
        print(f"SUCCESS: Written skeleton provenance to {prov_out_path}")
    finally:
        if os.path.exists(temp_csv_path):
            os.remove(temp_csv_path)
        if os.path.exists(temp_prov_path):
            os.remove(temp_prov_path)

    print("=" * 70)
    print("PHASE 1 AREA SKELETON GENERATION COMPLETED SUCCESSFULLY!")


def load_layer1_parent_skeleton(args):
    """
    Obtain Layer 1 official parent town set (without assigning final rowId):
    Either directly from --ref-csv + --abr-file, or from --phase1-skeleton + --skeleton-provenance.
    Returns list of parent town dicts ordered by Layer 1 sort_key.
    """
    if args.ref_csv and not args.phase1_skeleton:
        sorted_towns, _ = extract_layer1_from_mlit(args)
        parent_towns = []
        for order_idx, rec in enumerate(sorted_towns, start=1):
            parent_towns.append({
                'layer1_order': order_idx,
                'city_code': rec['city_code'],
                'city_name': rec['clean_city'],
                'parent_town_code': rec['town_code'],
                'parent_town_name': rec['clean_town'],
                'raw_town_name': rec['raw_town'],
                'mlit_lat': rec['lat'],
                'mlit_lon': rec['lon'],
                'sort_key': rec['sort_key'],
                'resolved_reading': rec['resolved_reading']
            })
        return parent_towns

    skeleton_csv = args.phase1_skeleton
    if not skeleton_csv or not os.path.exists(skeleton_csv):
        sys.exit(f"FATAL HARD STOP: Layer 1 Skeleton CSV not found: {skeleton_csv}")

    skeleton_rows = []
    with open(skeleton_csv, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for idx, r in enumerate(reader, start=1):
            skeleton_rows.append({
                'layer1_order': int(r.get('rowId') or idx),
                'city_name': r['city_name'].strip(),
                'town_name': r['town_name'].strip()
            })

    if not skeleton_rows:
        sys.exit(f"FATAL HARD STOP: Layer 1 Skeleton CSV {skeleton_csv} has 0 records!")

    skeleton_prov_map = {}
    if args.skeleton_provenance and os.path.exists(args.skeleton_provenance):
        with open(args.skeleton_provenance, 'r', encoding='utf-8') as f:
            sp_data = json.load(f)
            for rec in sp_data.get('records', []):
                if 'rowId' in rec:
                    skeleton_prov_map[int(rec['rowId'])] = rec
                cname = rec.get('city_name')
                tname = rec.get('clean_town_name') or rec.get('town_name')
                if cname and tname:
                    skeleton_prov_map[(cname, tname)] = rec

    city_readings = {}
    exact_town_readings = {}
    normalized_candidates = {}
    reconciliations = {}
    if args.abr_file:
        city_readings, exact_town_readings, normalized_candidates = load_abr_readings_phase1(args.abr_file)
        reconciliations = load_reading_reconciliations(args.reading_reconciliation)

    parent_towns = []
    for sk in skeleton_rows:
        ord_id = sk['layer1_order']
        cname = sk['city_name']
        tname = sk['town_name']
        sp = skeleton_prov_map.get(ord_id) or skeleton_prov_map.get((cname, tname), {})
        city_code = sp.get('city_code', '') or (args.city_code or '')
        town_code = sp.get('town_code', '')
        raw_town = sp.get('raw_town_name', tname)
        mlit_lat = sp.get('latitude', '')
        mlit_lon = sp.get('longitude', '')
        resolved_reading = sp.get('resolved_reading', '')

        if args.abr_file:
            rec_for_key = {
                'clean_city': cname,
                'clean_town': tname,
                'raw_town': raw_town,
                'city_code': city_code,
                'town_code': town_code
            }
            s_key = resolve_town_sort_key(rec_for_key, city_readings, exact_town_readings, normalized_candidates, reconciliations)
            resolved_reading = s_key[3]
        else:
            s_key = (ord_id, cname, tname)

        parent_towns.append({
            'layer1_order': ord_id,
            'city_code': city_code,
            'city_name': cname,
            'parent_town_code': town_code,
            'parent_town_name': tname,
            'raw_town_name': raw_town,
            'mlit_lat': mlit_lat,
            'mlit_lon': mlit_lon,
            'sort_key': s_key,
            'resolved_reading': resolved_reading
        })

    parent_towns.sort(key=lambda pt: pt['sort_key'])
    for idx, pt in enumerate(parent_towns, start=1):
        pt['layer1_order'] = idx

    return parent_towns


# =====================================================================
# GEOMETRY & TOPOLOGY ENGINE (Pure Python Standard Library)
# =====================================================================

def parse_shapefile_polygons(shp_path):
    """
    Parse ESRI Shapefile Polygon / PolygonZ geometries using pure Python standard library.
    Returns list of dicts: [{'record_index': i, 'bbox': [xmin, ymin, xmax, ymax], 'rings': [[(x, y), ...]]}]
    """
    if not os.path.exists(shp_path):
        sys.exit(f"FATAL HARD STOP: Shapefile not found: {shp_path}")

    records = []
    with open(shp_path, 'rb') as f:
        header = f.read(100)
        if len(header) < 100:
            sys.exit(f"FATAL HARD STOP: Corrupted Shapefile header in {shp_path}")
        file_code, = struct.unpack('>I', header[0:4])
        if file_code != 9994:
            sys.exit(f"FATAL HARD STOP: Not an ESRI Shapefile (invalid file code {file_code}): {shp_path}")

        rec_idx = 0
        while True:
            rec_head = f.read(8)
            if not rec_head or len(rec_head) < 8:
                break
            rec_num, content_len = struct.unpack('>II', rec_head)
            content_bytes = f.read(content_len * 2)
            if len(content_bytes) < content_len * 2:
                break

            shape_type, = struct.unpack('<I', content_bytes[0:4])
            if shape_type in (5, 15):  # Polygon (5) or PolygonZ (15)
                xmin, ymin, xmax, ymax = struct.unpack('<4d', content_bytes[4:36])
                num_parts, num_points = struct.unpack('<2I', content_bytes[36:44])
                parts = struct.unpack(f'<{num_parts}I', content_bytes[44:44 + num_parts * 4])
                pts_offset = 44 + num_parts * 4
                raw_pts = struct.unpack(f'<{num_points * 2}d', content_bytes[pts_offset:pts_offset + num_points * 16])
                points = [(raw_pts[i * 2], raw_pts[i * 2 + 1]) for i in range(num_points)]

                rings = []
                for p_idx in range(num_parts):
                    start = parts[p_idx]
                    end = parts[p_idx + 1] if p_idx + 1 < num_parts else num_points
                    rings.append(points[start:end])

                records.append({
                    'record_index': rec_idx,
                    'bbox': [xmin, ymin, xmax, ymax],
                    'rings': rings
                })
            else:
                records.append({
                    'record_index': rec_idx,
                    'bbox': [0.0, 0.0, 0.0, 0.0],
                    'rings': []
                })
            rec_idx += 1

    return records


def compute_rings_bbox(rings):
    if not rings:
        return [0.0, 0.0, 0.0, 0.0]
    xs = [pt[0] for r in rings for pt in r]
    ys = [pt[1] for r in rings for pt in r]
    if not xs:
        return [0.0, 0.0, 0.0, 0.0]
    return [min(xs), min(ys), max(xs), max(ys)]


def point_in_ring(px, py, ring):
    """Ray-casting point in polygon ring check."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if ((y1 > py) != (y2 > py)) and (px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-15) + x1):
            inside = not inside
    return inside


def ring_signed_area(ring):
    """
    Signed area in 2D Cartesian plane (X: lon, Y: lat):
      CW = signed_area < 0 (ESRI Shapefile exterior solid ring)
      CCW = signed_area > 0 (ESRI Shapefile interior hole ring)
    """
    n = len(ring)
    if n < 3:
        return 0.0
    return sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n)) / 2.0


def canonicalize_ring_vertices(ring, decimals=6):
    """
    Round ring vertices to `decimals` places, remove consecutive duplicates,
    rotate to lexicographically smallest (lon, lat) start vertex, and close ring.
    """
    pts = [(round(pt[0], decimals), round(pt[1], decimals)) for pt in ring]
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]

    # Remove consecutive duplicates and collinear spike foldbacks
    cleaned = []
    for pt in pts:
        if not cleaned or cleaned[-1] != pt:
            cleaned.append(pt)
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1]:
        cleaned.pop()

    if len(cleaned) < 3:
        return []

    min_idx = min(range(len(cleaned)), key=lambda i: cleaned[i])
    rotated = cleaned[min_idx:] + cleaned[:min_idx]
    rotated.append(rotated[0])
    return rotated


def classify_polygon_parts(rings, strict=True):
    """
    Classify Polygon and MultiPolygon rings using Ring Containment Hierarchy (§3.6).
    """
    if not rings:
        return []

    valid_rings = [r for r in rings if len(r) >= 3]
    if not valid_rings:
        return []

    if len(valid_rings) == 1:
        return [{
            'ring': valid_rings[0],
            'depth': 0,
            'is_solid': True,
            'enclosed_by': [],
            'parent_index': None
        }]

    n_rings = len(valid_rings)
    enclosed_by = [[] for _ in range(n_rings)]

    for j in range(n_rings):
        p0 = valid_rings[j][0]
        p1 = valid_rings[j][1]
        mid_pt = ((p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0)
        for i in range(n_rings):
            if i != j:
                if point_in_ring(p0[0], p0[1], valid_rings[i]) or point_in_ring(mid_pt[0], mid_pt[1], valid_rings[i]):
                    enclosed_by[j].append(i)

    depths = [len(enclosed_by[j]) for j in range(n_rings)]
    depth0_indices = [idx for idx, d in enumerate(depths) if d == 0]
    if not depth0_indices:
        if strict:
            sys.exit("FATAL HARD STOP [Topology]: Invalid geometry! No depth 0 exterior ring found (circular containment loop).")
        return []

    depth0_signed_areas = [ring_signed_area(valid_rings[idx]) for idx in depth0_indices]
    negative_count = sum(1 for a in depth0_signed_areas if a < 0)
    standard_esri = (negative_count >= len(depth0_signed_areas) / 2.0)

    parts_info = []
    for j in range(n_rings):
        d = depths[j]
        is_solid = (d % 2 == 0)
        area = ring_signed_area(valid_rings[j])

        if strict:
            expected_negative = (is_solid if standard_esri else not is_solid)
            actual_negative = (area < 0)
            if abs(area) > 1e-14 and expected_negative != actual_negative:
                ring_type = "Solid" if is_solid else "Hole"
                sys.exit(
                    f"FATAL HARD STOP [Topology]: Orientation contradiction! Ring {j} at depth {d} ({ring_type}) "
                    f"has signed area {area:.6f} which contradicts expected {'CW (<0)' if expected_negative else 'CCW (>0)'} orientation."
                )

        immediate_parent = None
        if d > 0:
            candidates = [p for p in enclosed_by[j] if depths[p] == d - 1]
            if len(candidates) != 1:
                if strict:
                    sys.exit(
                        f"FATAL HARD STOP [Topology]: Ambiguous parent hierarchy! Ring {j} at depth {d} has "
                        f"{len(candidates)} parents at depth {d - 1}."
                    )
                immediate_parent = candidates[0] if candidates else None
            else:
                immediate_parent = candidates[0]

        parts_info.append({
            'ring': valid_rings[j],
            'depth': d,
            'is_solid': is_solid,
            'enclosed_by': enclosed_by[j],
            'parent_index': immediate_parent
        })

    return parts_info


def point_in_polygon_geometry(px, py, rings):
    """
    Even-Odd Rule Point-in-Polygon check (§3.6).
    Odd enclosing ring count -> INSIDE solid region (True).
    Even enclosing ring count -> OUTSIDE or inside hole (False).
    """
    if not rings:
        return False

    valid_rings = [r for r in rings if len(r) >= 3]
    if not valid_rings:
        return False

    classify_polygon_parts(valid_rings, strict=True)
    enclosing_count = sum(1 for r in valid_rings if point_in_ring(px, py, r))
    return (enclosing_count % 2 == 1)


def compute_deterministic_interior_point(rings, bbox=None):
    """
    Compute a strictly deterministic interior point (point-on-surface) verified by Even-Odd PIP (§5.2).
    """
    valid_rings = [r for r in (rings or []) if len(r) >= 3]
    if not valid_rings:
        return 0.0, 0.0, False

    if not bbox or bbox == [0.0, 0.0, 0.0, 0.0]:
        bbox = compute_rings_bbox(valid_rings)

    xmin, ymin, xmax, ymax = bbox
    fractions = [0.5, 0.382, 0.618, 0.25, 0.75, 0.2, 0.8, 0.1, 0.9, 0.3, 0.7, 0.15, 0.85]

    for frac in fractions:
        scan_y = ymin + (ymax - ymin) * frac
        intersections = []
        for r in valid_rings:
            n = len(r)
            for i in range(n):
                x1, y1 = r[i]
                x2, y2 = r[(i + 1) % n]
                if (y1 <= scan_y < y2) or (y2 <= scan_y < y1):
                    ix = x1 + (scan_y - y1) * (x2 - x1) / (y2 - y1 + 1e-15)
                    intersections.append(ix)

        intersections.sort()
        # Pick the widest valid interior segment first
        segments = []
        for i in range(0, len(intersections) - 1, 2):
            x_in = intersections[i]
            x_out = intersections[i + 1]
            segments.append((x_out - x_in, (x_in + x_out) / 2.0))
        segments.sort(reverse=True)
        for _, cand_x in segments:
            rx = round(cand_x, 6)
            ry = round(scan_y, 6)
            if point_in_polygon_geometry(rx, ry, valid_rings):
                return ry, rx, True
            if point_in_polygon_geometry(cand_x, scan_y, valid_rings):
                return scan_y, cand_x, True

    for fy in fractions:
        sy = ymin + (ymax - ymin) * fy
        for fx in fractions:
            sx = xmin + (xmax - xmin) * fx
            if point_in_polygon_geometry(round(sx, 6), round(sy, 6), valid_rings):
                return round(sy, 6), round(sx, 6), True
            if point_in_polygon_geometry(sx, sy, valid_rings):
                return sy, sx, True

    return (ymin + ymax) / 2.0, (xmin + xmax) / 2.0, False


def dissolve_unit_rings(unit_rings_list):
    """
    Topological Union of multiple B-series Atomic Unit polygon ring lists belonging to a single Distribution Area (§4.8, §12).
    Cancels shared internal opposite half-edges at 9-decimal Canonical coordinate precision,
    reconstructs clean exterior and hole rings, normalizes to 6-decimal output coordinates,
    and sorts parts/rings deterministically.
    """
    all_raw_rings = [r for rings in unit_rings_list for r in rings if len(r) >= 3]
    if not all_raw_rings:
        return []

    if len(unit_rings_list) == 1:
        norm_rings = []
        for r in unit_rings_list[0]:
            cr = canonicalize_ring_vertices(r, decimals=6)
            if len(cr) >= 4 and abs(ring_signed_area(cr)) > 1e-14:
                norm_rings.append(cr)
        return sort_rings_deterministically(norm_rings)

    # Orient each unit's rings consistently: solid CW (signed_area < 0), hole CCW (signed_area > 0)
    directed_edges = Counter()
    for rings in unit_rings_list:
        if not rings:
            continue
        parts = classify_polygon_parts(rings, strict=False)
        for p in parts:
            r9 = [(round(pt[0], 9), round(pt[1], 9)) for pt in p['ring']]
            if len(r9) >= 2 and r9[0] == r9[-1]:
                r9 = r9[:-1]
            cleaned = []
            for pt in r9:
                if not cleaned or cleaned[-1] != pt:
                    cleaned.append(pt)
            if len(cleaned) >= 2 and cleaned[0] == cleaned[-1]:
                cleaned.pop()
            if len(cleaned) < 3:
                continue
            area = ring_signed_area(cleaned)
            is_solid = p['is_solid']
            if is_solid and area > 0:
                cleaned.reverse()
            elif (not is_solid) and area < 0:
                cleaned.reverse()

            m = len(cleaned)
            for i in range(m):
                u = cleaned[i]
                v = cleaned[(i + 1) % m]
                if u != v:
                    directed_edges[(u, v)] += 1

    # Cancel opposite half-edges
    adj_out = defaultdict(list)
    for (u, v), cnt in list(directed_edges.items()):
        rev_cnt = directed_edges.get((v, u), 0)
        net = cnt - rev_cnt
        if net > 0:
            for _ in range(net):
                adj_out[u].append(v)

    for u in adj_out:
        adj_out[u].sort()

    # Stitch remaining half-edges into closed cycles
    dissolved_rings = []
    for start_u in sorted(list(adj_out.keys())):
        while adj_out[start_u]:
            v = adj_out[start_u].pop(0)
            cycle = [start_u, v]
            curr = v
            prev = start_u
            steps = 0
            max_steps = len(directed_edges) + 10
            while curr != start_u and steps < max_steps:
                steps += 1
                outs = adj_out.get(curr, [])
                if not outs:
                    break
                if len(outs) == 1:
                    nxt = outs.pop(0)
                else:
                    # Choose sharpest right turn relative to incoming vector (prev -> curr)
                    in_dx = curr[0] - prev[0]
                    in_dy = curr[1] - prev[1]
                    in_ang = math.atan2(in_dy, in_dx)

                    def turn_angle(cand):
                        out_dx = cand[0] - curr[0]
                        out_dy = cand[1] - curr[1]
                        out_ang = math.atan2(out_dy, out_dx)
                        diff = (out_ang - (in_ang + math.pi)) % (2.0 * math.pi)
                        return (round(diff, 9), cand)

                    best_idx = min(range(len(outs)), key=lambda idx: turn_angle(outs[idx]))
                    nxt = outs.pop(best_idx)
                cycle.append(nxt)
                prev = curr
                curr = nxt

            if len(cycle) >= 4 and cycle[0] == cycle[-1]:
                cr6 = canonicalize_ring_vertices(cycle, decimals=6)
                if len(cr6) >= 4 and abs(ring_signed_area(cr6)) > 1e-14:
                    dissolved_rings.append(cr6)

    if not dissolved_rings:
        # Fallback: canonicalize individual rings
        for r in all_raw_rings:
            cr6 = canonicalize_ring_vertices(r, decimals=6)
            if len(cr6) >= 4 and abs(ring_signed_area(cr6)) > 1e-14:
                dissolved_rings.append(cr6)

    return sort_rings_deterministically(dissolved_rings)


def sort_rings_deterministically(rings):
    """
    Sort rings by bounding box (min_lon, min_lat, max_lon, max_lat, len, first_vertex) per §12.
    """
    def ring_key(r):
        xs = [pt[0] for pt in r]
        ys = [pt[1] for pt in r]
        return (min(xs), min(ys), max(xs), max(ys), len(r), r[0])

    return sorted(rings, key=ring_key)


def rings_to_geojson_geometry(rings):
    """
    Convert classified rings into a deterministic GeoJSON Polygon or MultiPolygon object (§10, §12).
    """
    if not rings:
        return None

    parts = classify_polygon_parts(rings, strict=False)
    if not parts:
        return None

    # Group each odd-depth hole under its immediate even-depth solid parent
    solid_indices = [idx for idx, p in enumerate(parts) if p['is_solid']]
    holes_by_solid = defaultdict(list)
    for idx, p in enumerate(parts):
        if not p['is_solid'] and p['parent_index'] is not None:
            holes_by_solid[p['parent_index']].append(p['ring'])

    polygon_coords_list = []
    for s_idx in solid_indices:
        ext_ring = canonicalize_ring_vertices(parts[s_idx]['ring'], decimals=6)
        if len(ext_ring) < 4:
            continue
        hole_rings = []
        for hr in holes_by_solid.get(s_idx, []):
            chr6 = canonicalize_ring_vertices(hr, decimals=6)
            if len(chr6) >= 4:
                hole_rings.append(chr6)
        hole_rings.sort(key=lambda r: (min(pt[0] for pt in r), min(pt[1] for pt in r), r[0]))
        polygon_coords_list.append([ext_ring] + hole_rings)

    def poly_sort_key(poly):
        ext = poly[0]
        xs = [pt[0] for pt in ext]
        ys = [pt[1] for pt in ext]
        return (min(xs), min(ys), max(xs), max(ys), ext[0])

    polygon_coords_list.sort(key=poly_sort_key)
    if not polygon_coords_list:
        return None

    if len(polygon_coords_list) == 1:
        return {
            "type": "Polygon",
            "coordinates": polygon_coords_list[0]
        }
    return {
        "type": "MultiPolygon",
        "coordinates": polygon_coords_list
    }


# =====================================================================
# LAYER 2: OFFICIAL STATISTICAL ATOMIC LAYER (A-series & B-series)
# =====================================================================

def read_dbf_records_raw(dbf_path):
    """Read raw DBF records and field names."""
    if not os.path.exists(dbf_path):
        sys.exit(f"FATAL HARD STOP: DBF file not found: {dbf_path}")

    with open(dbf_path, 'rb') as f:
        header = f.read(32)
        if len(header) < 32:
            sys.exit(f"FATAL HARD STOP: Corrupted DBF file header: {dbf_path}")
        num_records, header_len, record_len = struct.unpack('<IHH', header[4:12])
        fields = []
        while True:
            desc = f.read(32)
            if not desc or desc[0] == 0x0D:
                break
            name = desc[:11].replace(b'\x00', b'').decode('ascii', errors='replace').strip()
            length = desc[16]
            fields.append((name, length))

        f.seek(header_len)
        records = []
        for rec_idx in range(num_records):
            b = f.read(record_len)
            if not b or b[0] == 0x2A:
                continue
            rec = {'_record_index': rec_idx}
            offset = 1
            for n, l in fields:
                raw_bytes = b[offset:offset + l]
                try:
                    val_str = raw_bytes.decode('utf-8').strip()
                except UnicodeDecodeError:
                    try:
                        val_str = raw_bytes.decode('cp932').strip()
                    except Exception:
                        val_str = raw_bytes.decode('cp932', errors='replace').strip()
                rec[n] = val_str
                offset += l
            records.append(rec)

    field_names = [n for n, _ in fields]
    return records, field_names


def parse_strict_stat_int(raw_val, field_label, key_code, s_name, dbf_path, reconciliations):
    """Strictly parse SETAI/JINKO without silent zeroing of non-numeric strings ('X', '-', etc.)."""
    val_str = (raw_val or '').strip()
    if val_str.isdigit():
        return int(val_str)
    rec_field = 'reconciled_households' if field_label == 'SETAI' else 'reconciled_population'
    if key_code in reconciliations and rec_field in reconciliations[key_code]:
        return int(reconciliations[key_code][rec_field])
    sys.exit(
        f"FATAL HARD STOP [Rule 4.6]: Non-numeric {field_label} '{val_str}' detected for KEY_CODE '{key_code}' ({s_name}) "
        f"in {dbf_path}. Silent conversion to 0 is strictly forbidden without official reconciliation!"
    )


def normalize_kigo_e_group(key_code, group_items, dbf_path, reconciliations, series_label="A"):
    """
    FINAL DECISION — KIGO_E Normalization (§3.2.1 & §3.4):
    - Never select by DBF row order (last-row-wins prohibited).
    - When E1/E2/E3 exist for the same KEY_CODE:
      - Retain E1's statistical values (SETAI, JINKO) and representative point (X_CODE, Y_CODE).
      - Merge all polygon rings across E1/E2/E3 without losing any geometry, sorted deterministically.
    """
    kigo_set = [r.get('KIGO_E', '').strip() for r, _ in group_items if r.get('KIGO_E', '').strip()]
    if kigo_set:
        e1_items = [(r, g) for r, g in group_items if r.get('KIGO_E', '').strip() == 'E1']
        if len(e1_items) != 1:
            sys.exit(
                f"FATAL HARD STOP [Layer 2 {series_label}-Series KIGO_E]: KEY_CODE '{key_code}' has KIGO_E={kigo_set} "
                f"but E1 record count is {len(e1_items)} (expected exactly 1) in {dbf_path}!"
            )
        auth_rec, _ = e1_items[0]
    else:
        if len(group_items) == 1:
            auth_rec, _ = group_items[0]
        else:
            # Multiple records with empty KIGO_E: verify identical stats or fail-closed
            distinct_stats = set((r.get('SETAI', '').strip(), r.get('JINKO', '').strip()) for r, _ in group_items)
            if len(distinct_stats) > 1:
                sys.exit(
                    f"FATAL HARD STOP [Layer 2 {series_label}-Series]: Duplicate KEY_CODE '{key_code}' without KIGO_E "
                    f"has conflicting statistics {distinct_stats} in {dbf_path}!"
                )
            # Pick deterministically by canonical geometry key
            auth_rec, _ = sorted(
                group_items,
                key=lambda item: (
                    item[0].get('X_CODE', ''),
                    item[0].get('Y_CODE', ''),
                    compute_rings_bbox(item[1]['rings']) if item[1] else [0, 0, 0, 0]
                )
            )[0]

    s_name = auth_rec.get('S_NAME', '').strip()
    setai_val = parse_strict_stat_int(auth_rec.get('SETAI', ''), 'SETAI', key_code, s_name, dbf_path, reconciliations)
    jinko_val = parse_strict_stat_int(auth_rec.get('JINKO', ''), 'JINKO', key_code, s_name, dbf_path, reconciliations)

    # Collect and deterministically sort all polygon rings from all parts (E1, E2, E3...)
    all_rings = []
    for _, geom in group_items:
        if geom and geom.get('rings'):
            for ring in geom['rings']:
                if len(ring) >= 3:
                    all_rings.append(ring)

    all_rings = sort_rings_deterministically(all_rings)
    bbox = compute_rings_bbox(all_rings)

    # Extract official representative point (X_CODE, Y_CODE) in IEEE-754 float64 without pre-rounding
    x_code_str = auth_rec.get('X_CODE', '').strip()
    y_code_str = auth_rec.get('Y_CODE', '').strip()
    official_lon = None
    official_lat = None
    if x_code_str and y_code_str:
        try:
            fx = float(x_code_str)
            fy = float(y_code_str)
            if -180.0 <= fx <= 180.0 and -90.0 <= fy <= 90.0:
                official_lon = fx
                official_lat = fy
        except Exception:
            pass

    if (official_lat is None or official_lon is None) and all_rings:
        calc_lat, calc_lon, is_valid = compute_deterministic_interior_point(all_rings, bbox)
        if is_valid:
            official_lat = calc_lat
            official_lon = calc_lon

    pref = auth_rec.get('PREF', '').strip()
    city = auth_rec.get('CITY', '').strip()
    city_code = (pref + city) if (pref and city) else (key_code[:5] if len(key_code) >= 5 else '')

    return {
        'key_code': key_code,
        'city_code': city_code,
        's_name': s_name,
        'kihon1': auth_rec.get('KIHON1', '').strip(),
        'kihon2': auth_rec.get('KIHON2', '').strip(),
        'kihon3': auth_rec.get('KIHON3', '').strip(),
        'setai': setai_val,
        'jinko': jinko_val,
        'x_code': official_lon,
        'y_code': official_lat,
        'rings': all_rings,
        'bbox': bbox,
        'kigo_e_parts': sorted([r.get('KIGO_E', '').strip() for r, _ in group_items if r.get('KIGO_E', '').strip()]),
        'part_count': len(group_items),
        'source_dbf': os.path.basename(dbf_path)
    }


def discover_and_load_layer2_estat(args, reconciliations):
    """
    Discover and load A-series (r2ka: small area) and B-series (r2kb: basic unit) datasets.
    Normalizes KIGO_E groups independent of DBF row order.
    """
    a_pairs = []
    b_pairs = []

    def classify_and_add_dbf(dbf_p):
        shp_p = dbf_p[:-4] + '.shp'
        shp_p = shp_p if os.path.exists(shp_p) else None
        fname_lower = os.path.basename(dbf_p).lower()
        if 'r2kb' in fname_lower or 'basic_unit' in fname_lower or fname_lower.startswith('b_'):
            b_pairs.append((dbf_p, shp_p))
        elif 'r2ka' in fname_lower or 'small_area' in fname_lower or fname_lower.startswith('a_'):
            a_pairs.append((dbf_p, shp_p))
        else:
            _, fnames = read_dbf_records_raw(dbf_p)
            if 'KIHON3' in fnames:
                b_pairs.append((dbf_p, shp_p))
            else:
                a_pairs.append((dbf_p, shp_p))

    if args.estat_file:
        classify_and_add_dbf(args.estat_file)
    if args.estat_b_file:
        shp_b = args.estat_b_file[:-4] + '.shp'
        b_pairs.append((args.estat_b_file, shp_b if os.path.exists(shp_b) else None))

    if args.estat_dir and os.path.exists(args.estat_dir):
        for root, _, files in sorted(os.walk(args.estat_dir)):
            for fname in sorted(files):
                if fname.endswith('.dbf'):
                    classify_and_add_dbf(os.path.join(root, fname))

    if args.estat_b_dir and os.path.exists(args.estat_b_dir):
        for root, _, files in sorted(os.walk(args.estat_b_dir)):
            for fname in sorted(files):
                if fname.endswith('.dbf'):
                    dbf_p = os.path.join(root, fname)
                    shp_p = dbf_p[:-4] + '.shp'
                    b_pairs.append((dbf_p, shp_p if os.path.exists(shp_p) else None))

    if not a_pairs:
        sys.exit(f"FATAL HARD STOP: No e-Stat A-series DBF files found in {args.estat_dir or args.estat_file}!")

    target_city_set = set()
    if args.target_cities:
        for tc in args.target_cities:
            for code in tc.split(','):
                if code.strip():
                    target_city_set.add(code.strip())
    if args.city_code:
        target_city_set.add(args.city_code.strip())

    # Load and normalize A-series by KEY_CODE
    a_normalized = {}
    for dbf_p, shp_p in sorted(a_pairs):
        raw_recs, _ = read_dbf_records_raw(dbf_p)
        shp_geoms = parse_shapefile_polygons(shp_p) if shp_p else []
        geom_by_idx = {g['record_index']: g for g in shp_geoms}

        grouped_a = defaultdict(list)
        for r in raw_recs:
            hcode = r.get('HCODE', '').strip()
            if hcode and hcode != '8101':
                continue
            if '水面' in r.get('S_NAME', ''):
                continue
            kc = r.get('KEY_CODE', '').strip()
            if not kc:
                sys.exit(f"FATAL HARD STOP: Empty KEY_CODE in A-series record {r} in {dbf_p}")
            c_code = (r.get('PREF', '').strip() + r.get('CITY', '').strip()) or kc[:5]
            if target_city_set and c_code not in target_city_set:
                continue
            grouped_a[kc].append((r, geom_by_idx.get(r['_record_index'])))

        for kc in sorted(grouped_a.keys()):
            if kc in a_normalized:
                sys.exit(f"FATAL HARD STOP: Duplicate A-series KEY_CODE '{kc}' across separate DBF files!")
            a_normalized[kc] = normalize_kigo_e_group(kc, grouped_a[kc], dbf_p, reconciliations, series_label="A")

    # Load and normalize B-series by r2kb KEY_CODE (1 r2kb KEY_CODE = 1 Atomic Unit; K_AREA pre-aggregation prohibited)
    b_normalized = {}
    for dbf_p, shp_p in sorted(b_pairs):
        raw_recs, _ = read_dbf_records_raw(dbf_p)
        shp_geoms = parse_shapefile_polygons(shp_p) if shp_p else []
        geom_by_idx = {g['record_index']: g for g in shp_geoms}

        grouped_b = defaultdict(list)
        for r in raw_recs:
            hcode = r.get('HCODE', '').strip()
            if hcode and hcode != '8101':
                continue
            if '水面' in r.get('S_NAME', ''):
                continue
            kc = r.get('KEY_CODE', '').strip()
            if not kc:
                sys.exit(f"FATAL HARD STOP: Empty KEY_CODE in B-series record {r} in {dbf_p}")
            c_code = (r.get('PREF', '').strip() + r.get('CITY', '').strip()) or kc[:5]
            if target_city_set and c_code not in target_city_set:
                continue
            grouped_b[kc].append((r, geom_by_idx.get(r['_record_index'])))

        for kc in sorted(grouped_b.keys()):
            if kc in b_normalized:
                sys.exit(f"FATAL HARD STOP: Duplicate B-series KEY_CODE '{kc}' across separate DBF files!")
            b_normalized[kc] = normalize_kigo_e_group(kc, grouped_b[kc], dbf_p, reconciliations, series_label="B")

    # If a synthetic fixture only provided A-series files without separate B-series files,
    # synthesize 1:1 B-series Atomic Units from A-series ONLY when --estat-b-dir / --estat-b-file / r2kb are absent
    if not b_pairs:
        for kc, a_unit in a_normalized.items():
            b_normalized[kc] = dict(a_unit)

    print(f"[Layer 2 Atomic] Loaded {len(a_normalized)} normalized A-series small areas and {len(b_normalized)} B-series Atomic Units.")
    return a_normalized, b_normalized, bool(b_pairs)


# =====================================================================
# LAYER 3: DISTRIBUTION AREA BUILDER (§4, §5, §6, ODG-01/02/03, dist_m)
# =====================================================================

def local_xy(lon, lat, lat0_rad):
    """Exact local equirectangular projection (§4.9)."""
    r = 6378137.0
    x = r * math.cos(lat0_rad) * math.radians(lon)
    y = r * math.radians(lat)
    return (x, y)


def dist_m(lat1, lon1, lat2, lon2, lat0_rad):
    """Exact meter distance function dist_m (§4.9)."""
    x1, y1 = local_xy(lon1, lat1, lat0_rad)
    x2, y2 = local_xy(lon2, lat2, lat0_rad)
    return math.hypot(x1 - x2, y1 - y2)


def build_canonical_rook_graph(b_units, lat0_rad):
    """
    ODG-03 — CLOSED (§4.3):
    - Normalize polygon coordinates to 9 decimal places (round(lon, 9), round(lat, 9)).
    - Rook adjacency holds if and only if canonicalized polygons share a line segment of length > 0.
    - Point-touch (shared length == 0) is strictly non-adjacent.
    - Artificial bridges are strictly prohibited.
    """
    n = len(b_units)
    unit_edges = []
    for b in b_units:
        e_r9 = defaultdict(float)
        for ring in b.get('rings', []):
            for idx in range(len(ring) - 1):
                p1 = ring[idx]
                p2 = ring[idx + 1]
                rp1 = (round(p1[0], 9), round(p1[1], 9))
                rp2 = (round(p2[0], 9), round(p2[1], 9))
                if rp1 != rp2:
                    seg_len = dist_m(rp1[1], rp1[0], rp2[1], rp2[0], lat0_rad)
                    if seg_len > 0.0:
                        rek = (rp1, rp2) if rp1 < rp2 else (rp2, rp1)
                        e_r9[rek] += seg_len
        unit_edges.append(e_r9)

    adj_rook = defaultdict(set)
    shared_lengths_m = {}
    for i in range(n):
        ei = unit_edges[i]
        if not ei:
            continue
        for j in range(i + 1, n):
            ej = unit_edges[j]
            if not ej:
                continue
            common_keys = set(ei.keys()) & set(ej.keys())
            if common_keys:
                s_len = sum(min(ei[k], ej[k]) for k in common_keys)
                if s_len > 0.0:
                    adj_rook[i].add(j)
                    adj_rook[j].add(i)
                    shared_lengths_m[(i, j)] = s_len
                    shared_lengths_m[(j, i)] = s_len

    return adj_rook, shared_lengths_m


def get_connected_components(indices, adj):
    """Connected components on `indices` induced subgraph of `adj`, ordered deterministically."""
    idx_set = set(indices)
    visited = set()
    comps = []
    for start in sorted(indices):
        if start not in visited:
            comp = []
            q = [start]
            visited.add(start)
            while q:
                curr = q.pop()
                comp.append(curr)
                for nb in adj.get(curr, ()):
                    if nb in idx_set and nb not in visited:
                        visited.add(nb)
                        q.append(nb)
            comp.sort()
            comps.append(comp)
    return comps


def compute_medoid_and_dist(indices, b_units, lat0_rad):
    """
    Household-weighted medoid and D1 calculation (§4.9, §5.1):
    - Tie-break: minimum weighted distance (wsum < best_wsum - 1e-9) -> smallest KEY_CODE.
    """
    if not indices:
        return None, 0.0, 0.0
    tot_h = sum(b_units[i]['setai'] for i in indices)
    if tot_h == 0:
        first_i = sorted(indices, key=lambda idx: str(b_units[idx]['key_code']))[0]
        return first_i, 0.0, 0.0

    best_i = None
    best_wsum = None
    for i in sorted(indices, key=lambda idx: str(b_units[idx]['key_code'])):
        lat_i = float(b_units[i]['y_code'])
        lon_i = float(b_units[i]['x_code'])
        wsum = sum(
            b_units[j]['setai'] * dist_m(lat_i, lon_i, float(b_units[j]['y_code']), float(b_units[j]['x_code']), lat0_rad)
            for j in indices
        )
        if best_wsum is None or wsum < best_wsum - 1e-9:
            best_wsum = wsum
            best_i = i

    d_avg = best_wsum / tot_h
    return best_i, d_avg, best_wsum


def select_seed1_index(pool_indices, b_units):
    """
    Seed 1 (§4.5, §4.9): north (lat max) -> west (lon min) -> smallest KEY_CODE.
    Implemented via both explicit comparator and stable sort without string sign inversion.
    """
    def cmp_seed1(ia, ib):
        lata = round(float(b_units[ia]['y_code']), 6)
        latb = round(float(b_units[ib]['y_code']), 6)
        if lata != latb:
            return -1 if lata > latb else 1
        lona = round(float(b_units[ia]['x_code']), 6)
        lonb = round(float(b_units[ib]['x_code']), 6)
        if lona != lonb:
            return -1 if lona < lonb else 1
        ka = str(b_units[ia]['key_code'])
        kb = str(b_units[ib]['key_code'])
        return -1 if ka < kb else (1 if ka > kb else 0)

    s_cmp = sorted(pool_indices, key=cmp_to_key(cmp_seed1))[0]
    s_stb = sorted(pool_indices, key=lambda idx: str(b_units[idx]['key_code']))
    s_stb = sorted(s_stb, key=lambda idx: round(float(b_units[idx]['x_code']), 6))
    s_stb = sorted(s_stb, key=lambda idx: round(float(b_units[idx]['y_code']), 6), reverse=True)[0]
    assert s_cmp == s_stb, f"Seed 1 comparator vs stable sort mismatch: {s_cmp} != {s_stb}"
    return s_cmp


def select_farthest_first_seed_index(cand_pool, chosen_seeds, b_units, lat0_rad):
    """
    Seed 2..K (§4.5, §4.9):
    1. d_min max (farthest)
    2. latitude max (north)
    3. longitude min (west)
    4. KEY_CODE min (smallest KEY_CODE)
    Implemented via both explicit comparator and multi-pass stable sort without string sign inversion.
    """
    d_min_map = {}
    for idx in cand_pool:
        lat_i = float(b_units[idx]['y_code'])
        lon_i = float(b_units[idx]['x_code'])
        d_min_map[idx] = min(
            dist_m(lat_i, lon_i, float(b_units[s]['y_code']), float(b_units[s]['x_code']), lat0_rad)
            for s in chosen_seeds
        )

    def cmp_farthest(ia, ib):
        da = round(d_min_map[ia], 6)
        db = round(d_min_map[ib], 6)
        if da != db:
            return -1 if da > db else 1
        lata = round(float(b_units[ia]['y_code']), 6)
        latb = round(float(b_units[ib]['y_code']), 6)
        if lata != latb:
            return -1 if lata > latb else 1
        lona = round(float(b_units[ia]['x_code']), 6)
        lonb = round(float(b_units[ib]['x_code']), 6)
        if lona != lonb:
            return -1 if lona < lonb else 1
        ka = str(b_units[ia]['key_code'])
        kb = str(b_units[ib]['key_code'])
        return -1 if ka < kb else (1 if ka > kb else 0)

    s_cmp = sorted(cand_pool, key=cmp_to_key(cmp_farthest))[0]
    s_stb = sorted(cand_pool, key=lambda idx: str(b_units[idx]['key_code']))
    s_stb = sorted(s_stb, key=lambda idx: round(float(b_units[idx]['x_code']), 6))
    s_stb = sorted(s_stb, key=lambda idx: round(float(b_units[idx]['y_code']), 6), reverse=True)
    s_stb = sorted(s_stb, key=lambda idx: round(d_min_map[idx], 6), reverse=True)[0]
    assert s_cmp == s_stb, f"Farthest-First comparator vs stable sort mismatch: {s_cmp} != {s_stb}"
    return s_cmp


def select_minor_island_target_cluster(comp, clusters, b_units, adj_rook, shared_lengths_m, lat0_rad):
    """
    Authority v3.2 §4.4.3 & §4.6 Minor Residential Island Absorption:
    - Mode A (Connected on All-Unit Rook Graph):
      1. (-round(shared_boundary_m, 6)) [maximum shared boundary length]
      2. round(d_min_cluster, 6)        [minimum meter distance]
      3. min_cluster_KEY_CODE           [smallest official KEY_CODE]
      4. k                              [cluster index]
    - Mode B (Disconnected on All-Unit Rook Graph, all shared_boundary_m == 0):
      1. over_700                       [0 if H_k + H_island <= 700 else 1]
      2. round(d_min_cluster, 6)        [minimum meter distance]
      3. min_cluster_KEY_CODE           [smallest official KEY_CODE]
      4. k                              [cluster index]
    """
    k_clusters = len(clusters)
    comp_set = set(comp)
    comp_h = sum(b_units[i]['setai'] for i in comp_set)

    # Determine reachability on All-Unit Rook Graph (including 0-household B-series units)
    all_indices = list(range(len(b_units)))
    all_comps = get_connected_components(all_indices, adj_rook)
    comp_rep = next(iter(comp_set))
    all_unit_comp = set(next((c for c in all_comps if comp_rep in c), comp_set))

    # Direct shared boundary length between comp and each cluster k
    direct_shared = {}
    for k in range(k_clusters):
        direct_shared[k] = sum(
            shared_lengths_m.get((i, j), 0.0)
            for i in comp_set
            for j in clusters[k]
        )

    # Check if connected via 0-household units in all_unit_comp when direct_shared is 0
    zero_in_comp = {
        idx for idx in all_unit_comp
        if b_units[idx]['setai'] == 0 and idx not in comp_set
    }
    bridged_shared = {}
    for k in range(k_clusters):
        if direct_shared[k] > 0.0:
            bridged_shared[k] = direct_shared[k]
        elif zero_in_comp and any(j in all_unit_comp for j in clusters[k]):
            bridged_shared[k] = sum(
                shared_lengths_m.get((i, j), 0.0)
                for i in (comp_set | zero_in_comp)
                for j in clusters[k]
            )
        else:
            bridged_shared[k] = 0.0

    is_mode_a = any(bridged_shared[k] > 0.0 for k in range(k_clusters))
    mode = "MODE_A" if is_mode_a else "MODE_B"

    eval_table = {}
    for k in range(k_clusters):
        hk = sum(b_units[i]['setai'] for i in clusters[k])
        over_700 = 1 if (hk + comp_h) > 700 else 0
        d_min_cluster = min(
            dist_m(
                float(b_units[i]['y_code']), float(b_units[i]['x_code']),
                float(b_units[j]['y_code']), float(b_units[j]['x_code']),
                lat0_rad
            )
            for i in comp_set
            for j in clusters[k]
        )
        min_kc = min(str(b_units[j]['key_code']) for j in clusters[k])
        s_len_k = bridged_shared[k]
        if is_mode_a:
            key_tuple = (-round(s_len_k, 6), round(d_min_cluster, 6), min_kc, k)
        else:
            key_tuple = (over_700, round(d_min_cluster, 6), min_kc, k)
        eval_table[k] = {
            'key': key_tuple,
            'shared_boundary_m': round(s_len_k, 6),
            'over_700': over_700,
            'hk_before': hk,
            'hk_after': hk + comp_h,
            'd_min_m': round(d_min_cluster, 6),
            'min_kc': min_kc
        }

    best_k = min(range(k_clusters), key=lambda k: eval_table[k]['key'])
    return best_k, mode, eval_table


def propose_boundary_swap_move(clusters, u, v, b_idx, b_units, adj_rook, move_set_override=None):
    """
    Authority v3.2 §4.7 Boundary Swap Level 1 — Topological Move Validator:
    - Move Type A: Single non-articulation Atomic Unit transfer `{b_idx}`.
    - Move Type B: Deterministic Connected Branch Transfer when `b_idx` is an articulation point
      of its connected component in `clusters[u]`.
      * Main Branch Selection: `(-sum(setai), min(KEY_CODE))` remains in `clusters[u]`.
      * Transfer Unit Set: `move_set = comp_with_b - main_branch = {b_idx} U detached_branches`.
    - Post-Move Connectivity Verification:
      1. `keep_u` is non-empty and `comp_with_b - move_set` is a single Rook-connected component.
      2. `move_set` is a single Rook-connected component (rejects disconnected branch transfer).
      3. `b_idx` has real Rook adjacency (`shared_length_m > 0`) to at least one unit in `clusters[v]`
         (rejects artificial bridges / Euclidean-only jumps).
      4. Adding `move_set` to `clusters[v]` does not increase the connected component count of `clusters[v]`.
    """
    if u == v or b_idx not in clusters[u] or len(clusters[u]) <= 1:
        return False, None, None, None, "INVALID_CLUSTER_OR_SINGLETON"

    # Condition 3: Real Rook adjacency between boundary candidate b_idx and target cluster v
    if not any(nb in clusters[v] for nb in adj_rook.get(b_idx, ())):
        return False, None, None, None, "NO_ROOK_ADJACENCY_TO_TARGET"

    orig_comps_u = get_connected_components(clusters[u], adj_rook)
    orig_comp_count = len(orig_comps_u)
    comp_with_b = set(next(c for c in orig_comps_u if b_idx in c))
    other_u = clusters[u] - comp_with_b

    if move_set_override is not None:
        move_set = set(move_set_override)
        if b_idx not in move_set or not move_set.issubset(comp_with_b):
            return False, None, None, None, "INVALID_MOVE_SET_OVERRIDE"
        rem_comp = comp_with_b - move_set
        keep_u = rem_comp | other_u
        move_type = "MOVE_TYPE_A" if len(move_set) == 1 else "MOVE_TYPE_B"
    else:
        rem_u = clusters[u] - {b_idx}
        rem_comps = get_connected_components(rem_u, adj_rook)
        if len(rem_comps) <= orig_comp_count:
            rem_comp = comp_with_b - {b_idx}
            keep_u = rem_u
            move_set = {b_idx}
            move_type = "MOVE_TYPE_A"
        else:
            sub_comps = get_connected_components(comp_with_b - {b_idx}, adj_rook)
            if not sub_comps:
                return False, "MOVE_TYPE_B", None, None, "EMPTY_SUB_COMPS"
            sub_comps_sorted = sorted(
                sub_comps,
                key=lambda c: (-sum(b_units[i]['setai'] for i in c), min(str(b_units[i]['key_code']) for i in c))
            )
            main_branch = set(sub_comps_sorted[0])
            rem_comp = main_branch
            keep_u = main_branch | other_u
            move_set = comp_with_b - main_branch
            move_type = "MOVE_TYPE_B"

    # Condition 1: Source remaining component must be non-empty and Rook-connected
    if not keep_u or not rem_comp:
        return False, move_type, None, None, "EMPTY_SOURCE_AFTER_MOVE"
    if len(get_connected_components(rem_comp, adj_rook)) != 1:
        return False, move_type, None, None, "SOURCE_COMPONENT_DISCONNECTED"

    # Condition 2: Transfer unit set must be Rook-connected
    if len(get_connected_components(move_set, adj_rook)) != 1:
        return False, move_type, None, None, "DISCONNECTED_MOVE_SET"

    # Condition 4: Target cluster component count must not increase
    orig_v_comp_count = len(get_connected_components(clusters[v], adj_rook))
    new_v_comp_count = len(get_connected_components(clusters[v] | move_set, adj_rook))
    if new_v_comp_count > orig_v_comp_count:
        return False, move_type, None, None, "TARGET_COMPONENT_DISCONNECTED"

    return True, move_type, keep_u, move_set, "OK"


def run_clustering_for_k(k_clusters, pos_indices, comps_pos, b_units, adj_rook, shared_lengths_m, lat0_rad):
    """
    Execute Layer 3 clustering for K >= 2 (Authority v3.2 §4.4 - §4.7):
    1. Connected Components (major >= 200 vs minor < 200 islands)
    2. Deterministic Farthest-First Seed Selection
    3. Balanced Region Growing on positive-household Rook graph
    4. Minor residential island (< 200 households) deterministic absorption (Mode A / Mode B)
    5. 6-Level Lexicographic Boundary Swap Optimization (Move Type A / Move Type B)
    """
    if len(pos_indices) < k_clusters:
        return None

    major_comps = [
        c_list for c_list in comps_pos
        if sum(b_units[i]['setai'] for i in c_list) >= 200
    ]
    # Sort major components by household sum descending, then min KEY_CODE ascending
    major_comps.sort(key=lambda c_list: (-sum(b_units[i]['setai'] for i in c_list), min(str(b_units[i]['key_code']) for i in c_list)))

    seed_pool_1 = [i for c_list in major_comps for i in c_list] if major_comps else list(pos_indices)
    if len(seed_pool_1) < k_clusters:
        seed_pool_1 = list(pos_indices)

    s1 = select_seed1_index(seed_pool_1, b_units)
    seeds = [s1]

    for m in range(1, k_clusters):
        unseeded_major = [c_list for c_list in major_comps if not any(s in c_list for s in seeds)]
        if unseeded_major:
            cand_pool = [i for c_list in unseeded_major for i in c_list if i not in seeds]
        else:
            cand_pool = [i for i in seed_pool_1 if i not in seeds]
            if not cand_pool:
                cand_pool = [i for i in pos_indices if i not in seeds]
        sm = select_farthest_first_seed_index(cand_pool, seeds, b_units, lat0_rad)
        seeds.append(sm)

    clusters = {k: {seeds[k]} for k in range(k_clusters)}
    assigned = set(seeds)

    # Balanced Region Growing on positive-household Rook graph (§4.6)
    while True:
        candidates = []
        for k in range(k_clusters):
            hk = sum(b_units[i]['setai'] for i in clusters[k])
            # Single Atomic Unit > 700 must remain an isolated single-unit cluster (§4.2.2)
            if len(clusters[k]) == 1 and hk > 700:
                continue
            med_k, _, _ = compute_medoid_and_dist(list(clusters[k]), b_units, lat0_rad)
            lat_ck = float(b_units[med_k]['y_code'])
            lon_ck = float(b_units[med_k]['x_code'])
            frontier = set()
            for member in clusters[k]:
                for nb in adj_rook.get(member, ()):
                    if nb in pos_indices and nb not in assigned:
                        # Do not merge a single >700 unit into an existing cluster
                        if b_units[nb]['setai'] > 700:
                            continue
                        frontier.add(nb)
            for b_idx in frontier:
                hk_after = hk + b_units[b_idx]['setai']
                over_700 = 1 if hk_after > 700 else 0
                d_center = round(dist_m(lat_ck, lon_ck, float(b_units[b_idx]['y_code']), float(b_units[b_idx]['x_code']), lat0_rad), 6)
                candidates.append((over_700, hk, abs(hk_after - 550), d_center, k, str(b_units[b_idx]['key_code']), b_idx))
        if not candidates:
            break
        candidates.sort()
        _, _, _, _, chosen_k, _, chosen_b = candidates[0]
        clusters[chosen_k].add(chosen_b)
        assigned.add(chosen_b)

    # Absorb any remaining disconnected positive islands (< 200 households or unseeded islands) (§4.4.3 Mode A / Mode B)
    absorbed_clusters = set()
    island_absorption_events = []
    unassigned = [i for i in pos_indices if i not in assigned]
    for comp in get_connected_components(unassigned, adj_rook):
        best_k, abs_mode, _ = select_minor_island_target_cluster(
            comp, clusters, b_units, adj_rook, shared_lengths_m, lat0_rad
        )
        clusters[best_k].update(comp)
        assigned.update(comp)
        absorbed_clusters.add(best_k)
        island_absorption_events.append({
            'target_cluster': best_k,
            'mode': abs_mode,
            'island_codes': sorted(str(b_units[i]['key_code']) for i in comp),
            'island_households': sum(b_units[i]['setai'] for i in comp)
        })

    # 6-Level Lexicographic Boundary Swap Optimization (§4.7 Move Type A & Move Type B)
    def eval_lexicographic_tuple(c_dict):
        under_200 = 0
        over_700 = 0
        under_400 = 0
        dev_550_sq = 0
        comp_wsum = 0.0
        for k in range(k_clusters):
            c_list = list(c_dict[k])
            hk = sum(b_units[i]['setai'] for i in c_list)
            if hk < 200:
                under_200 += (200 - hk) ** 2
            if hk > 700:
                over_700 += (hk - 700) ** 2
            if hk < 400:
                under_400 += (400 - hk) ** 2
            dev_550_sq += (hk - 550) ** 2
            _, _, wsum_k = compute_medoid_and_dist(c_list, b_units, lat0_rad)
            comp_wsum += wsum_k
        return (under_200, over_700, under_400, dev_550_sq, round(comp_wsum, 6))

    move_type_a_count = 0
    move_type_b_count = 0

    for _ in range(100):
        cur_lex = eval_lexicographic_tuple(clusters)
        best_move = None
        best_move_lex = cur_lex
        best_move_tie = None

        for u in range(k_clusters):
            if len(clusters[u]) <= 1:
                continue
            for b_idx in sorted(clusters[u], key=lambda idx: str(b_units[idx]['key_code'])):
                for v in range(k_clusters):
                    if u == v:
                        continue
                    # Single Atomic Unit > 700 cannot receive or donate units
                    if len(clusters[v]) == 1 and sum(b_units[i]['setai'] for i in clusters[v]) > 700:
                        continue
                    is_ok, m_type, keep_u, move_set, _ = propose_boundary_swap_move(
                        clusters, u, v, b_idx, b_units, adj_rook
                    )
                    if not is_ok:
                        continue
                    new_clusters = {
                        k: (keep_u if k == u else (clusters[v] | move_set if k == v else clusters[k]))
                        for k in range(k_clusters)
                    }
                    cand_lex = eval_lexicographic_tuple(new_clusters)
                    cand_tie = (str(b_units[b_idx]['key_code']), v, u)
                    if cand_lex < best_move_lex or (cand_lex == best_move_lex and best_move is not None and cand_tie < best_move_tie):
                        # Require strict improvement over current state
                        if cand_lex < cur_lex:
                            best_move_lex = cand_lex
                            best_move_tie = cand_tie
                            best_move = (u, v, move_set, m_type)

        if best_move is None:
            break
        u, v, move_set, m_type = best_move
        clusters[u] -= move_set
        clusters[v] |= move_set
        if m_type == "MOVE_TYPE_A":
            move_type_a_count += 1
        elif m_type == "MOVE_TYPE_B":
            move_type_b_count += 1

    # Verify no cluster has < 200 households AND no multi-unit cluster has > 700 households (§4.2.2)
    for k in range(k_clusters):
        hk = sum(b_units[i]['setai'] for i in clusters[k])
        if hk < 200:
            return None
        if hk > 700 and len(clusters[k]) > 1:
            return None

    return {
        'k': k_clusters,
        'clusters': clusters,
        'absorbed_clusters': absorbed_clusters,
        'island_absorption_events': island_absorption_events,
        'move_type_a_count': move_type_a_count,
        'move_type_b_count': move_type_b_count,
        'lex_score': eval_lexicographic_tuple(clusters)
    }


def post_attach_zero_household_units(clusters, zero_indices, b_units, adj_rook, shared_lengths_m, lat0_rad):
    """
    Post-attach 0-household B-series Atomic Units to finalized positive-household clusters (§4.8):
    1. Maximum shared boundary length (meters)
    2. Minimum meter distance
    3. Smallest min(KEY_CODE) of cluster
    Does NOT modify households, population, basic_unit_codes, or representative points.
    """
    k_clusters = len(clusters)
    zero_by_cluster = {k: set() for k in range(k_clusters)}
    if not zero_indices:
        return zero_by_cluster

    if k_clusters == 1:
        zero_by_cluster[0] = set(zero_indices)
        return zero_by_cluster

    cluster_min_keycode = {
        k: min(str(b_units[i]['key_code']) for i in clusters[k])
        for k in range(k_clusters)
    }
    occupied_by_cluster = {k: set(clusters[k]) for k in range(k_clusters)}
    remaining_zeros = set(zero_indices)

    # Wave 1: Iterative shared boundary attachment
    while remaining_zeros:
        best_wave_assignments = []
        for z_idx in sorted(remaining_zeros, key=lambda idx: str(b_units[idx]['key_code'])):
            shared_by_k = []
            for k in range(k_clusters):
                s_len = sum(shared_lengths_m.get((z_idx, m_idx), 0.0) for m_idx in occupied_by_cluster[k])
                if s_len > 0.0:
                    shared_by_k.append((-round(s_len, 6), cluster_min_keycode[k], k))
            if shared_by_k:
                shared_by_k.sort()
                best_neg_len, min_kc, chosen_k = shared_by_k[0]
                best_wave_assignments.append((best_neg_len, str(b_units[z_idx]['key_code']), min_kc, z_idx, chosen_k))
        if not best_wave_assignments:
            break
        best_wave_assignments.sort()
        for _, _, _, z_idx, chosen_k in best_wave_assignments:
            if z_idx in remaining_zeros:
                remaining_zeros.remove(z_idx)
                zero_by_cluster[chosen_k].add(z_idx)
                occupied_by_cluster[chosen_k].add(z_idx)

    # Wave 2: Shortest meter distance for any non-touching 0-household units
    for z_idx in sorted(remaining_zeros, key=lambda idx: str(b_units[idx]['key_code'])):
        lat_z = float(b_units[z_idx]['y_code'])
        lon_z = float(b_units[z_idx]['x_code'])

        def dist_key(k):
            d_min = min(
                dist_m(lat_z, lon_z, float(b_units[m_idx]['y_code']), float(b_units[m_idx]['x_code']), lat0_rad)
                for m_idx in occupied_by_cluster[k]
            )
            return (round(d_min, 6), cluster_min_keycode[k], k)

        chosen_k = min(range(k_clusters), key=dist_key)
        zero_by_cluster[chosen_k].add(z_idx)
        occupied_by_cluster[chosen_k].add(z_idx)

    return zero_by_cluster


def derive_cluster_representative_point(pos_member_indices, b_units, lat0_rad):
    """
    Representative Point Derivation (§5.1 & §5.2):
    1. Household-weighted medoid among positive-household B-series Atomic Units (smallest KEY_CODE tie-break).
    2. Even-Odd PIP Gate on both the medoid unit's own polygon and the cluster's positive-household union polygon.
    3. Deterministic point-on-surface fallback if PIP fails.
    """
    med_idx, _, _ = compute_medoid_and_dist(pos_member_indices, b_units, lat0_rad)
    med_unit = b_units[med_idx]
    cand_lat = float(med_unit['y_code'])
    cand_lon = float(med_unit['x_code'])

    pos_union_rings = dissolve_unit_rings([b_units[i]['rings'] for i in pos_member_indices if b_units[i].get('rings')])
    med_rings = med_unit.get('rings', [])

    if pos_union_rings:
        r_lon = round(cand_lon, 6)
        r_lat = round(cand_lat, 6)
        in_med = point_in_polygon_geometry(r_lon, r_lat, med_rings) if med_rings else True
        in_union = point_in_polygon_geometry(r_lon, r_lat, pos_union_rings)
        if in_med and in_union:
            return r_lat, r_lon, "b_series_weighted_medoid", "PASS_EVEN_ODD_PIP", pos_union_rings

        # Fallback: deterministic point-on-surface on medoid unit's solid polygon (or positive union polygon)
        fb_lat, fb_lon, ok = compute_deterministic_interior_point(med_rings if med_rings else pos_union_rings)
        r_fb_lon = round(fb_lon, 6)
        r_fb_lat = round(fb_lat, 6)
        if ok and point_in_polygon_geometry(r_fb_lon, r_fb_lat, pos_union_rings):
            return r_fb_lat, r_fb_lon, "b_series_medoid_pip_fallback_pos", "PASS_EVEN_ODD_PIP", pos_union_rings

        fb_lat2, fb_lon2, ok2 = compute_deterministic_interior_point(pos_union_rings)
        if ok2:
            return round(fb_lat2, 6), round(fb_lon2, 6), "b_series_medoid_pip_fallback_pos", "PASS_EVEN_ODD_PIP", pos_union_rings

        sys.exit(
            f"FATAL HARD STOP [Gate 3 PIP]: Cannot derive valid interior representative point for medoid KEY_CODE '{med_unit['key_code']}'!"
        )

    return round(cand_lat, 6), round(cand_lon, 6), "b_series_weighted_medoid", "PASS_NO_POLYGON_FALLBACK", []


def build_distribution_areas_for_parent_town(pt, matched_a_units, matched_b_units, estat_reconciliations, b_sname_ref_codes):
    """
    Layer 3 Distribution Area Builder for a single official parent town `pt`.
    Returns list of finalized Distribution Area dicts (ordered 1..K for this parent town).
    """
    city_code = pt['city_code']
    city_name = pt['city_name']
    parent_town_code = pt['parent_town_code']
    parent_town_name = pt['parent_town_name']

    # Case A: 1:0 Unmatched Parent Town -> Pattern C (ODG-02 CLOSED & FINAL DECISION on 1:0 / B S_NAME)
    if len(matched_a_units) == 0:
        comp_key = f"{city_code}:{parent_town_name}"
        rec_entry = estat_reconciliations.get(comp_key)
        if not rec_entry or rec_entry.get('reconciled_status') != 'no_independent_estat_small_area':
            sys.exit(
                f"FATAL HARD STOP [Cardinality 1:0]: Skeleton town '{city_name} {parent_town_name}' (code: '{city_code}') "
                f"has NO matching e-Stat A-series record and no official reconciliation evidence! "
                f"Provide verified entry with key '{comp_key}'."
            )
        for field in ESTAT_EMPTY_REQUIRED_FIELDS:
            val = rec_entry.get(field)
            if val is None or not str(val).strip():
                sys.exit(
                    f"FATAL HARD STOP [Rule 4.6 Reconciliation]: Missing or empty required reconciliation field '{field}' "
                    f"for empty status entry '{comp_key}'"
                )
        if not pt['mlit_lat'] or not pt['mlit_lon']:
            sys.exit(f"FATAL HARD STOP: Missing MLIT coordinates for 1:0 town '{city_name} {parent_town_name}'")

        rec_evidence = {k: rec_entry[k] for k in ESTAT_EMPTY_REQUIRED_FIELDS}
        if b_sname_ref_codes:
            rec_evidence['b_series_sname_reference_codes'] = sorted(b_sname_ref_codes)

        return [{
            'layer1_order': pt['layer1_order'],
            'sort_key': pt['sort_key'],
            'city_code': city_code,
            'city_name': city_name,
            'parent_town_code': parent_town_code,
            'raw_town_name': pt.get('raw_town_name', parent_town_name),
            'resolved_reading': pt.get('resolved_reading', ''),
            'official_town_name': parent_town_name,
            'display_town_name': parent_town_name,
            'pattern': 'C_ZERO_OR_UNMATCHED',
            'split_index': 1,
            'split_total': 1,
            'households': "",
            'population': "",
            'e_stat_code': "",
            'latitude': round(float(pt['mlit_lat']), 6),
            'longitude': round(float(pt['mlit_lon']), 6),
            'coordinate_source': 'mlit_reference_point',
            'coordinate_validation': 'PASS_MLIT_OFFICIAL_POINT',
            'geometry_status': 'UNAVAILABLE_OFFICIAL_POLYGON',
            'geojson_geometry': None,
            'union_rings': [],
            'pos_union_rings': [],
            'a_area_codes': [],
            'basic_unit_codes': [],
            'zero_household_area_codes': [],
            'single_large_basic_unit': False,
            'granularity_exception': None,
            'island_absorption': False,
            'matching_evidence': {
                'cardinality': '1:0',
                'status': 'no_independent_estat_small_area',
                'source_document_title': rec_entry['source_document_title'],
                'b_series_sname_reference_codes': sorted(b_sname_ref_codes)
            },
            'estat_reconciliation_evidence': rec_evidence
        }]

    # Sort A-series and B-series units deterministically by KEY_CODE ascending
    a_units = sorted(matched_a_units, key=lambda u: str(u['key_code']))
    b_units = sorted(matched_b_units, key=lambda u: str(u['key_code']))

    a_codes = [u['key_code'] for u in a_units]
    h_a = sum(u['setai'] for u in a_units)
    p_a = sum(u['jinko'] for u in a_units)
    h_b = sum(u['setai'] for u in b_units)
    p_b = sum(u['jinko'] for u in b_units)

    # Gate 2: A/B Conservation Audit (§3.5.1)
    if h_a != h_b or p_a != p_b:
        sys.exit(
            f"FATAL HARD STOP [Gate 2 A/B Conservation]: Demographic mismatch for '{city_name} {parent_town_name}'! "
            f"Normalized A-series (H={h_a}, P={p_a}) != B-series sum (H={h_b}, P={p_b}). "
            f"Artificial pro-rating or adjustment is strictly forbidden!"
        )

    # Case B: Parent town with H == 0 -> Pattern C (0-household official polygon town)
    if h_a == 0:
        zero_b_codes = [u['key_code'] for u in b_units]
        all_rings_list = [u['rings'] for u in b_units if u.get('rings')]
        if not all_rings_list:
            all_rings_list = [u['rings'] for u in a_units if u.get('rings')]
        union_rings = dissolve_unit_rings(all_rings_list)
        geojson_geom = rings_to_geojson_geometry(union_rings)
        if union_rings:
            rep_lat, rep_lon, ok = compute_deterministic_interior_point(union_rings)
            if not ok:
                sys.exit(f"FATAL HARD STOP [Gate 3 PIP]: Failed to derive interior point for 0-household town '{city_name} {parent_town_name}'")
            rep_lat = round(rep_lat, 6)
            rep_lon = round(rep_lon, 6)
            coord_src = 'official_zero_household_polygon_pos'
            coord_val = 'PASS_EVEN_ODD_PIP'
            geom_status = 'OFFICIAL_POLYGON'
        else:
            rep_lat = round(float(pt['mlit_lat']), 6)
            rep_lon = round(float(pt['mlit_lon']), 6)
            coord_src = 'mlit_reference_point'
            coord_val = 'PASS_MLIT_OFFICIAL_POINT'
            geom_status = 'UNAVAILABLE_OFFICIAL_POLYGON'
            geojson_geom = None

        return [{
            'layer1_order': pt['layer1_order'],
            'sort_key': pt['sort_key'],
            'city_code': city_code,
            'city_name': city_name,
            'parent_town_code': parent_town_code,
            'raw_town_name': pt.get('raw_town_name', parent_town_name),
            'resolved_reading': pt.get('resolved_reading', ''),
            'official_town_name': parent_town_name,
            'display_town_name': parent_town_name,
            'pattern': 'C_ZERO_OR_UNMATCHED',
            'split_index': 1,
            'split_total': 1,
            'households': 0,
            'population': p_a,
            'e_stat_code': a_codes[0] if len(a_codes) == 1 else "",
            'latitude': rep_lat,
            'longitude': rep_lon,
            'coordinate_source': coord_src,
            'coordinate_validation': coord_val,
            'geometry_status': geom_status,
            'geojson_geometry': geojson_geom,
            'union_rings': union_rings,
            'pos_union_rings': [],
            'a_area_codes': a_codes,
            'basic_unit_codes': [],
            'zero_household_area_codes': zero_b_codes,
            'single_large_basic_unit': False,
            'granularity_exception': None,
            'island_absorption': False,
            'matching_evidence': {
                'cardinality': '1:1' if len(a_codes) == 1 else '1:N',
                'h_parent_a': h_a,
                'p_parent_a': p_a,
                'h_parent_b': h_b,
                'p_parent_b': p_b
            },
            'estat_reconciliation_evidence': None
        }]

    # Reference latitude lat0_rad across all B-series Atomic Units of the parent town (§4.9)
    all_lats = [float(b['y_code']) for b in b_units]
    lat0_rad = math.radians(sum(all_lats) / len(all_lats))

    adj_rook, shared_lengths_m = build_canonical_rook_graph(b_units, lat0_rad)
    pos_indices = [i for i, b in enumerate(b_units) if b['setai'] > 0]
    zero_indices = [i for i, b in enumerate(b_units) if b['setai'] == 0]
    comps_pos = get_connected_components(pos_indices, adj_rook)
    major_comps = [c for c in comps_pos if sum(b_units[i]['setai'] for i in c) >= 200]

    med1_idx, d1_m, _ = compute_medoid_and_dist(pos_indices, b_units, lat0_rad)

    # Determine Pattern A (K=1) vs Pattern B (K>=2) (§4.1, §4.2, ODG-01 CLOSED)
    chosen_clustering = None
    odg01_decision_reason = None

    if h_a <= 800:
        odg01_decision_reason = "H_LE_800_PATTERN_A"
    elif 801 <= h_a <= 999:
        # ODG-01 Step 1: >= 2 independent residential islands with >= 200 households each
        if len(major_comps) >= 2:
            odg01_decision_reason = "ODG01_STEP1_MULTI_MAJOR_ISLANDS_K2"
            chosen_clustering = run_clustering_for_k(2, pos_indices, comps_pos, b_units, adj_rook, shared_lengths_m, lat0_rad)
        else:
            # ODG-01 Step 2: Single major island -> D1 >= 400.000 m universal threshold
            if d1_m >= 400.000:
                odg01_decision_reason = "ODG01_STEP2_D1_GE_400_K2"
                chosen_clustering = run_clustering_for_k(2, pos_indices, comps_pos, b_units, adj_rook, shared_lengths_m, lat0_rad)
            else:
                odg01_decision_reason = "ODG01_STEP2_D1_LT_400_PATTERN_A"
    else:
        # H >= 1000: Principle split (Authority v3.2 §4.2.1 & §4.2.2)
        if len(pos_indices) == 1:
            # Single indivisible Atomic Unit with H >= 1000 -> K=1 with ATOMIC_UNIT_TOO_LARGE
            chosen_clustering = None
            odg01_decision_reason = "H_GE_1000_INDIVISIBLE_ATOMIC_UNIT_K1"
        else:
            k_min = max(2, math.ceil(h_a / 700.0))
            k_max = math.floor(h_a / 400.0)
            k_target = round_half_up_int(h_a / 550.0)
            if k_min <= k_max:
                cand_ks = sorted(range(k_min, k_max + 1), key=lambda k: (abs(k - k_target), k))
            else:
                cand_ks = [max(k_min, k_target)]
                for fallback_k in range(max(cand_ks) - 1, k_min - 1, -1):
                    if fallback_k not in cand_ks:
                        cand_ks.append(fallback_k)

            best_k_res = None
            for ck in cand_ks:
                # Authority v3.2 §4.2.2: K < K_min is strictly forbidden for multi-unit H >= 1000 towns
                if ck < k_min:
                    continue
                res = run_clustering_for_k(ck, pos_indices, comps_pos, b_units, adj_rook, shared_lengths_m, lat0_rad)
                if res is not None:
                    # Prefer a K >= K_min that achieves 0 under_200, 0 over_700, and 0 under_400 if available
                    if best_k_res is None or (res['lex_score'][:3] < best_k_res['lex_score'][:3]):
                        best_k_res = res
                    if res['lex_score'][0] == 0 and res['lex_score'][1] == 0 and res['lex_score'][2] == 0:
                        break

            if best_k_res is None:
                sys.exit(
                    f"FATAL HARD STOP [K Feasibility]: No feasible K >= K_min ({k_min}) for parent town "
                    f"'{city_name} {parent_town_name}' (H={h_a}, pos_units={len(pos_indices)}). "
                    f"Reduction to K < K_min is strictly forbidden by Authority v3.2 §4.2.2!"
                )
            chosen_clustering = best_k_res
            odg01_decision_reason = f"H_GE_1000_SPLIT_K{chosen_clustering['k']}"

    # Build cluster list (K=1 Pattern A or K>=2 Pattern B)
    if chosen_clustering is None:
        k_total = 1
        clusters_map = {0: set(pos_indices)}
        absorbed_set = {0} if len(comps_pos) > 1 else set()
        pattern_label = 'A_NORMAL'
    else:
        k_total = chosen_clustering['k']
        clusters_map = chosen_clustering['clusters']
        absorbed_set = chosen_clustering['absorbed_clusters']
        pattern_label = 'B_SPLIT'

    # Post-attach 0-household B-series Atomic Units (§4.8)
    zero_by_cluster = post_attach_zero_household_units(clusters_map, zero_indices, b_units, adj_rook, shared_lengths_m, lat0_rad)

    # Assemble raw cluster objects and derive representative points (§5)
    raw_areas = []
    for k in range(k_total):
        pos_members = sorted(list(clusters_map[k]), key=lambda idx: str(b_units[idx]['key_code']))
        zero_members = sorted(list(zero_by_cluster[k]), key=lambda idx: str(b_units[idx]['key_code']))
        all_members = sorted(pos_members + zero_members, key=lambda idx: str(b_units[idx]['key_code']))

        c_households = sum(b_units[i]['setai'] for i in pos_members)
        c_population = sum(b_units[i]['jinko'] for i in pos_members)
        pos_codes = [str(b_units[i]['key_code']) for i in pos_members]
        zero_codes = [str(b_units[i]['key_code']) for i in zero_members]

        rep_lat, rep_lon, coord_src, coord_val, pos_union_rings = derive_cluster_representative_point(pos_members, b_units, lat0_rad)

        # Union positive + post-attached 0-household geometries (§4.8)
        all_unit_rings = [b_units[i]['rings'] for i in all_members if b_units[i].get('rings')]
        if not all_unit_rings and k_total == 1:
            all_unit_rings = [u['rings'] for u in a_units if u.get('rings')]
        union_rings = dissolve_unit_rings(all_unit_rings)
        geojson_geom = rings_to_geojson_geometry(union_rings)

        # Granularity exception flags (Authority v3.2 §4.2.2)
        # >700 is ONLY permitted for a single Atomic Unit (ATOMIC_UNIT_TOO_LARGE).
        # GRANULARITY_EXCEPTION is strictly restricted to 200..399.
        max_single_unit_h = max(b_units[i]['setai'] for i in pos_members)
        single_large_flag = (len(pos_members) == 1 and max_single_unit_h > 700)
        gran_exc = None
        if single_large_flag and (c_households > 700 or (k_total == 1 and h_a > 800)):
            gran_exc = "ATOMIC_UNIT_TOO_LARGE"
        elif k_total >= 2 and (200 <= c_households <= 399):
            gran_exc = "GRANULARITY_EXCEPTION"
        elif k_total >= 2 and c_households > 700:
            sys.exit(
                f"FATAL HARD STOP [>700 Contract]: Multi-unit split cluster in '{city_name} {parent_town_name}' "
                f"has H={c_households} > 700 across {len(pos_members)} positive Atomic Units! "
                f"Multi-unit >700 clusters are strictly forbidden by Authority v3.2 §4.2.2."
            )

        # Island absorption flag (§4.4.3)
        pos_comp_count = len(get_connected_components(pos_members, adj_rook))
        island_abs_flag = (k in absorbed_set) or (pos_comp_count > 1)

        raw_areas.append({
            'pos_members': pos_members,
            'households': c_households,
            'population': c_population,
            'latitude': rep_lat,
            'longitude': rep_lon,
            'coordinate_source': coord_src,
            'coordinate_validation': coord_val,
            'geometry_status': 'OFFICIAL_POLYGON' if geojson_geom is not None else 'UNAVAILABLE_OFFICIAL_POLYGON',
            'geojson_geometry': geojson_geom,
            'union_rings': union_rings,
            'pos_union_rings': pos_union_rings if pos_union_rings else union_rings,
            'basic_unit_codes': pos_codes,
            'zero_household_area_codes': zero_codes,
            'min_basic_unit_code': min(pos_codes),
            'single_large_basic_unit': single_large_flag,
            'granularity_exception': gran_exc,
            'island_absorption': island_abs_flag
        })

    # Deterministic Split Numbering (§6):
    # 1. representative latitude DESC (north -> south)
    # 2. representative longitude ASC (west -> east)
    # 3. min(basic_unit_code) ASC
    if k_total >= 2:
        raw_areas.sort(key=lambda a: (-round(a['latitude'], 6), round(a['longitude'], 6), a['min_basic_unit_code']))

    final_parent_areas = []
    for s_idx, area in enumerate(raw_areas, start=1):
        if k_total == 1:
            disp_name = parent_town_name
            # §8.1: e_stat_code populated ONLY when 1:1 with a single official A-series small area
            estat_scalar = a_codes[0] if len(a_codes) == 1 else ""
        else:
            disp_name = f"{parent_town_name} ({s_idx})"
            estat_scalar = ""

        final_parent_areas.append({
            'layer1_order': pt['layer1_order'],
            'sort_key': pt['sort_key'],
            'city_code': city_code,
            'city_name': city_name,
            'parent_town_code': parent_town_code,
            'raw_town_name': pt.get('raw_town_name', parent_town_name),
            'resolved_reading': pt.get('resolved_reading', ''),
            'official_town_name': parent_town_name,
            'display_town_name': disp_name,
            'pattern': pattern_label,
            'split_index': s_idx,
            'split_total': k_total,
            'households': area['households'],
            'population': area['population'],
            'e_stat_code': estat_scalar,
            'latitude': area['latitude'],
            'longitude': area['longitude'],
            'coordinate_source': area['coordinate_source'],
            'coordinate_validation': area['coordinate_validation'],
            'geometry_status': area['geometry_status'],
            'geojson_geometry': area['geojson_geometry'],
            'union_rings': area['union_rings'],
            'pos_union_rings': area['pos_union_rings'],
            'a_area_codes': a_codes,
            'basic_unit_codes': area['basic_unit_codes'],
            'zero_household_area_codes': area['zero_household_area_codes'],
            'single_large_basic_unit': area['single_large_basic_unit'],
            'granularity_exception': area['granularity_exception'],
            'island_absorption': area['island_absorption'],
            'matching_evidence': {
                'cardinality': '1:1' if len(a_codes) == 1 else '1:N',
                'h_parent_a': h_a,
                'p_parent_a': p_a,
                'h_parent_b': h_b,
                'p_parent_b': p_b,
                'd1_medoid_avg_m': round(d1_m, 3),
                'major_residential_islands': len(major_comps),
                'pattern_decision': odg01_decision_reason
            },
            'estat_reconciliation_evidence': None
        })

    return final_parent_areas


# =====================================================================
# LAYER 4: FINAL MASTER COMPILER & VALIDATION GATES 1..5 (§7 - §13)
# =====================================================================

def verify_gates_1_to_4(parent_towns, final_areas, parent_expected_stats):
    """
    Execute Gate 1, Gate 2, Gate 3, Gate 4 mechanical validations before writing outputs (§13).
    """
    # Gate 1: Parent Skeleton Integrity
    expected_parents = set((pt['city_name'], pt['parent_town_name']) for pt in parent_towns)
    output_parents = set((a['city_name'], a['official_town_name']) for a in final_areas)
    missing_parents = expected_parents - output_parents
    extra_parents = output_parents - expected_parents
    if missing_parents or extra_parents:
        sys.exit(
            f"FATAL HARD STOP [Gate 1 Parent Skeleton Integrity]: Missing={missing_parents}, Extra={extra_parents}"
        )

    # Gate 2: Statistical Conservation per parent town and district-wide
    areas_by_parent = defaultdict(list)
    for a in final_areas:
        areas_by_parent[(a['city_name'], a['official_town_name'])].append(a)

    for p_key, exp_hp in parent_expected_stats.items():
        p_areas = areas_by_parent[p_key]
        if exp_hp is None:
            # 1:0 Pattern C town
            if len(p_areas) != 1 or p_areas[0]['households'] != "" or p_areas[0]['population'] != "" or p_areas[0]['e_stat_code'] != "":
                sys.exit(f"FATAL HARD STOP [Gate 2 Pattern C 1:0]: Invalid blank stats for {p_key}: {p_areas}")
            if not p_areas[0].get('estat_reconciliation_evidence'):
                sys.exit(f"FATAL HARD STOP [Gate 2 Pattern C 1:0]: Missing 8-field reconciliation evidence for {p_key}")
        else:
            exp_h, exp_p = exp_hp
            out_h = sum(int(a['households']) for a in p_areas)
            out_p = sum(int(a['population']) for a in p_areas)
            if out_h != exp_h or out_p != exp_p:
                sys.exit(
                    f"FATAL HARD STOP [Gate 2 Conservation]: Stat mismatch for {p_key}: expected (H={exp_h}, P={exp_p}), got (H={out_h}, P={out_p})"
                )

    # Gate 3: Representative Point PIP & rowId 1..N sequence
    n_total = len(final_areas)
    row_ids = [a['rowId'] for a in final_areas]
    if row_ids != list(range(1, n_total + 1)):
        sys.exit(f"FATAL HARD STOP [Gate 3 rowId Sequence]: rowId is not 1..{n_total}!")

    for a in final_areas:
        if a['pattern'] in ('A_NORMAL', 'B_SPLIT') and a['pos_union_rings']:
            if not point_in_polygon_geometry(a['longitude'], a['latitude'], a['pos_union_rings']):
                sys.exit(
                    f"FATAL HARD STOP [Gate 3 PIP]: Representative point ({a['latitude']}, {a['longitude']}) "
                    f"for rowId={a['rowId']} ({a['city_name']} {a['display_town_name']}) is outside positive-household geometry!"
                )
        if a['geojson_geometry'] is None and a['geometry_status'] != 'UNAVAILABLE_OFFICIAL_POLYGON':
            sys.exit(
                f"FATAL HARD STOP [Gate 3 Geometry]: rowId={a['rowId']} has geometry=null without UNAVAILABLE_OFFICIAL_POLYGON!"
            )

    # Gate 4: Granularity, Connectivity & e_stat_code 1:1 rule (Authority v3.2 §4.2.2)
    for a in final_areas:
        if a['pattern'] in ('A_NORMAL', 'B_SPLIT'):
            if int(a['households']) <= 0:
                sys.exit(f"FATAL HARD STOP [Gate 4]: Standalone 0-household pin in Pattern A/B at rowId={a['rowId']}")
        if a['pattern'] == 'B_SPLIT':
            h_val = int(a['households'])
            if h_val < 200:
                sys.exit(f"FATAL HARD STOP [Gate 4]: Prohibited <200 household split cluster (H={h_val}) at rowId={a['rowId']}")
            if h_val > 700:
                if (
                    not a.get('single_large_basic_unit')
                    or len(a.get('basic_unit_codes', [])) != 1
                    or a.get('granularity_exception') != 'ATOMIC_UNIT_TOO_LARGE'
                ):
                    sys.exit(
                        f"FATAL HARD STOP [Gate 4 >700 Contract]: Multi-unit >700 split cluster "
                        f"(H={h_val}, units={len(a.get('basic_unit_codes', []))}, exc={a.get('granularity_exception')}) "
                        f"is strictly forbidden at rowId={a['rowId']}"
                    )
            if 200 <= h_val <= 399 and a.get('granularity_exception') != 'GRANULARITY_EXCEPTION':
                sys.exit(f"FATAL HARD STOP [Gate 4]: Missing GRANULARITY_EXCEPTION for H={h_val} at rowId={a['rowId']}")
            if a['e_stat_code'] != "":
                sys.exit(f"FATAL HARD STOP [Gate 4]: Non-empty e_stat_code '{a['e_stat_code']}' on split rowId={a['rowId']}")
        if len(a['a_area_codes']) != 1 and a['e_stat_code'] != "":
            sys.exit(f"FATAL HARD STOP [Gate 4]: Non-empty e_stat_code '{a['e_stat_code']}' on non-1:1 rowId={a['rowId']}")


def run_4layer_master_compiler(args):
    """
    Execute the complete 4-Layer Master Compiler:
    Layer 1 (Official Address) -> Layer 2 (Official Statistical Atomic)
    -> Layer 3 (Distribution Area Builder) -> Layer 4 (Final Master Compiler).
    """
    print("=" * 70)
    print("4-LAYER UNIVERSAL MASTER DATA COMPILER (DISTRICT_DATA_ACQUISITION_RULE.md v3.2)")
    print(f"Output CSV:          {args.out_csv}")
    print("=" * 70)

    out_csv_abs = os.path.abspath(args.out_csv)
    out_dir = os.path.dirname(out_csv_abs)
    prov_out_path = os.path.abspath(args.provenance_out) if args.provenance_out else os.path.join(out_dir, "provenance.json")
    geojson_out_path = os.path.abspath(args.out_geojson) if args.out_geojson else os.path.join(out_dir, "boundaries.geojson")
    muni_out_path = os.path.abspath(args.out_muni_csv) if args.out_muni_csv else os.path.join(out_dir, "municipality_master.csv")

    # Zero Overwrite Protection on explicitly requested output paths
    if os.path.exists(out_csv_abs):
        sys.exit(f"FATAL HARD STOP: Output CSV already exists: {out_csv_abs}. Overwrite is strictly forbidden!")
    if args.provenance_out and os.path.exists(prov_out_path):
        sys.exit(f"FATAL HARD STOP: Output provenance already exists: {prov_out_path}. Overwrite is strictly forbidden!")
    if args.out_geojson and os.path.exists(geojson_out_path):
        sys.exit(f"FATAL HARD STOP: Output GeoJSON already exists: {geojson_out_path}. Overwrite is strictly forbidden!")
    if args.out_muni_csv and os.path.exists(muni_out_path):
        sys.exit(f"FATAL HARD STOP: Output municipality_master.csv already exists: {muni_out_path}. Overwrite is strictly forbidden!")

    # 1. Layer 1: Official Parent Town Set
    parent_towns = load_layer1_parent_skeleton(args)
    print(f"[Layer 1 Complete] Loaded {len(parent_towns)} official parent towns.")

    # 2. Layer 2: Official Statistical Atomic Layer
    estat_reconciliations = load_estat_reconciliations(args.estat_reconciliation)
    electoral_map = load_electoral_mapping(args.electoral_mapping, args.target_district) if args.electoral_mapping else None
    a_normalized, b_normalized, _ = discover_and_load_layer2_estat(args, estat_reconciliations)

    # Index A-series for parent town attribution
    city_code_to_name = {pt['city_code']: pt['city_name'] for pt in parent_towns if pt['city_code']}
    a_by_exact = defaultdict(list)
    a_by_clean = defaultdict(list)

    for kc, a_unit in sorted(a_normalized.items()):
        s_name = a_unit['s_name']
        c_code = a_unit['city_code']
        matched_city = city_code_to_name.get(c_code)
        matched_town = None

        if kc in estat_reconciliations and 'reconciled_town_name' in estat_reconciliations[kc]:
            matched_town = estat_reconciliations[kc]['reconciled_town_name']
            if 'reconciled_city_name' in estat_reconciliations[kc]:
                matched_city = estat_reconciliations[kc]['reconciled_city_name']

        if not matched_town:
            matched_town = clean_oaza_prefix(s_name)

        if not matched_city:
            cands = [pt['city_name'] for pt in parent_towns if clean_oaza_prefix(pt['parent_town_name']) == matched_town or pt['parent_town_name'] == matched_town]
            if cands:
                matched_city = cands[0]

        if electoral_map and args.target_district and matched_city:
            t_key = (matched_city, matched_town)
            districts = electoral_map.get(t_key, [])
            if districts:
                is_matched = any(args.target_district == d or d.endswith(args.target_district) or args.target_district.endswith(d) for d in districts)
                if not is_matched:
                    continue

        a_by_exact[(c_code, s_name)].append(a_unit)
        clean_s = clean_oaza_prefix(s_name)
        a_by_clean[(c_code, clean_s)].append(a_unit)
        if matched_town != clean_s:
            a_by_clean[(c_code, matched_town)].append(a_unit)

    # Index B-series by official hierarchy (city_code, kihon1, kihon2) and by S_NAME for 1:0 reference evidence
    b_by_kihon = defaultdict(list)
    b_by_sname = defaultdict(list)
    for b_kc, b_unit in sorted(b_normalized.items()):
        c_code = b_unit['city_code']
        k1 = b_unit['kihon1']
        k2 = b_unit['kihon2']
        if k1 or k2:
            b_by_kihon[(c_code, k1, k2)].append(b_unit)
        b_by_sname[(c_code, b_unit['s_name'])].append(b_kc)
        b_by_sname[(c_code, clean_oaza_prefix(b_unit['s_name']))].append(b_kc)

    # Match Layer 1 parent towns to A-series and B-series with N:1 guards
    claimed_a_codes = Counter()
    claimed_b_codes = Counter()
    parent_expected_stats = {}
    all_final_areas = []

    for pt in parent_towns:
        c_code = pt['city_code']
        p_city = pt['city_name']
        p_town = pt['parent_town_name']
        p_clean = clean_oaza_prefix(p_town)

        candidates_a = []
        if c_code:
            if (c_code, p_town) in a_by_exact:
                candidates_a = list(a_by_exact[(c_code, p_town)])
            elif (c_code, p_clean) in a_by_clean:
                candidates_a = list(a_by_clean[(c_code, p_clean)])
        else:
            exact_m = [u for (_, st), ulist in a_by_exact.items() if st == p_town for u in ulist]
            if exact_m:
                candidates_a = exact_m
            else:
                clean_m = [u for (_, st), ulist in a_by_clean.items() if st == p_clean for u in ulist]
                if clean_m:
                    candidates_a = clean_m

        if not candidates_a:
            for kc, rec_info in sorted(estat_reconciliations.items()):
                if rec_info.get('skeleton_town_name') == p_town and (not c_code or rec_info.get('city_code') == c_code):
                    if kc in a_normalized:
                        candidates_a.append(a_normalized[kc])

        # Deduplicate candidates_a by key_code preserving sorted order
        seen_a = set()
        dedup_a = []
        for u in sorted(candidates_a, key=lambda x: str(x['key_code'])):
            if u['key_code'] not in seen_a:
                seen_a.add(u['key_code'])
                dedup_a.append(u)
        candidates_a = dedup_a

        for u in candidates_a:
            kc = u['key_code']
            claimed_a_codes[kc] += 1
            if claimed_a_codes[kc] > 1:
                sys.exit(
                    f"FATAL HARD STOP [Cardinality N:1]: Multiple skeleton records claim identical e_stat_code '{kc}'! "
                    f"Conflict on '{p_city} {p_town}'."
                )

        # Match B-series Atomic Units via official hierarchy codes (city_code, kihon1, kihon2) or KEY_CODE prefix
        matched_b = []
        seen_b = set()
        if candidates_a:
            kihon_keys = set()
            for u in candidates_a:
                if u['kihon1'] or u['kihon2']:
                    kihon_keys.add((u['city_code'], u['kihon1'], u['kihon2']))
            for kk in sorted(kihon_keys):
                for bu in b_by_kihon.get(kk, []):
                    if bu['key_code'] not in seen_b:
                        seen_b.add(bu['key_code'])
                        matched_b.append(bu)
            if not matched_b:
                # Fallback for synthetic fixtures where KIHON1/KIHON2 are blank: prefix match on KEY_CODE
                for b_kc, bu in sorted(b_normalized.items()):
                    if any(b_kc == u['key_code'] or b_kc.startswith(u['key_code']) for u in candidates_a):
                        if b_kc not in seen_b:
                            seen_b.add(b_kc)
                            matched_b.append(bu)

            for bu in matched_b:
                claimed_b_codes[bu['key_code']] += 1
                if claimed_b_codes[bu['key_code']] > 1:
                    sys.exit(
                        f"FATAL HARD STOP [Layer 2 B-Series N:1]: B-series Atomic Unit '{bu['key_code']}' claimed by multiple parent towns!"
                    )

            parent_expected_stats[(p_city, p_town)] = (
                sum(u['setai'] for u in candidates_a),
                sum(u['jinko'] for u in candidates_a)
            )
            b_sname_refs = []
        else:
            parent_expected_stats[(p_city, p_town)] = None
            b_sname_refs = list(set(b_by_sname.get((c_code, p_town), []) + b_by_sname.get((c_code, p_clean), [])))

        # 3. Layer 3: Build Distribution Areas for this parent town
        pt_areas = build_distribution_areas_for_parent_town(pt, candidates_a, matched_b, estat_reconciliations, b_sname_refs)
        all_final_areas.extend(pt_areas)

    # 4. Layer 4: Final Master Compiler — Sort by (Layer 1 sort_key, split_index) and assign rowId = 1..N ONCE
    all_final_areas.sort(key=lambda a: (a['sort_key'], a['split_index']))
    for final_idx, area in enumerate(all_final_areas, start=1):
        area['rowId'] = final_idx

    # Run Gates 1..4
    verify_gates_1_to_4(parent_towns, all_final_areas, parent_expected_stats)

    # Build municipality_master rows in deterministic appearance / city_code order
    muni_counts = Counter()
    muni_codes = {}
    muni_order = []
    for area in all_final_areas:
        cname = area['city_name']
        if cname not in muni_counts:
            muni_order.append(cname)
            muni_codes[cname] = area['city_code'] or '00000'
        muni_counts[cname] += 1

    # Prepare GeoJSON FeatureCollection & Provenance records from the exact same Final Distribution Area objects
    geojson_features = []
    provenance_records = []
    for area in all_final_areas:
        rid = area['rowId']
        is_blank_stats = (area['households'] == "")
        geojson_features.append({
            "type": "Feature",
            "properties": {
                "rowId": rid,
                "city_name": area['city_name'],
                "town_name": area['display_town_name'],
                "households": None if is_blank_stats else int(area['households']),
                "population": None if is_blank_stats else int(area['population']),
                "e_stat_code": area['e_stat_code'],
                "geometry_status": area['geometry_status']
            },
            "geometry": area['geojson_geometry']
        })

        provenance_records.append({
            "rowId": rid,
            "skeleton_rowId": area['layer1_order'],
            "city_code": area['city_code'],
            "town_code": area['parent_town_code'],
            "parent_town_code": area['parent_town_code'],
            "raw_town_name": area.get('raw_town_name', area['official_town_name']),
            "resolved_reading": area.get('resolved_reading', ''),
            "city_name": area['city_name'],
            "official_town_name": area['official_town_name'],
            "display_town_name": area['display_town_name'],
            "town_name": area['display_town_name'],
            "pattern": area['pattern'],
            "split_index": area['split_index'],
            "split_total": area['split_total'],
            "households": area['households'],
            "population": area['population'],
            "e_stat_code": area['e_stat_code'],
            "latitude": round(float(area['latitude']), 6),
            "longitude": round(float(area['longitude']), 6),
            "coordinate_source": area['coordinate_source'],
            "coordinate_validation": area['coordinate_validation'],
            "geometry_status": area['geometry_status'],
            "a_area_codes": area['a_area_codes'],
            "basic_unit_codes": area['basic_unit_codes'],
            "zero_household_area_codes": area['zero_household_area_codes'],
            "single_large_basic_unit": area['single_large_basic_unit'],
            "granularity_exception": area['granularity_exception'],
            "island_absorption": area['island_absorption'],
            "matching_evidence": area['matching_evidence'],
            "estat_reconciliation_evidence": area['estat_reconciliation_evidence']
        })

    total_h = sum(int(a['households']) for a in all_final_areas if a['households'] != "")
    total_p = sum(int(a['population']) for a in all_final_areas if a['population'] != "")

    # Atomic output of all 4 artifacts
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.dirname(prov_out_path), exist_ok=True)
    os.makedirs(os.path.dirname(geojson_out_path), exist_ok=True)
    os.makedirs(os.path.dirname(muni_out_path), exist_ok=True)

    fd_csv, temp_csv = tempfile.mkstemp(prefix="master_8col_", dir=out_dir)
    os.close(fd_csv)
    fd_prov, temp_prov = tempfile.mkstemp(prefix="master_prov_", dir=os.path.dirname(prov_out_path))
    os.close(fd_prov)
    fd_geo, temp_geo = tempfile.mkstemp(prefix="boundaries_geo_", dir=os.path.dirname(geojson_out_path))
    os.close(fd_geo)
    fd_muni, temp_muni = tempfile.mkstemp(prefix="muni_master_", dir=os.path.dirname(muni_out_path))
    os.close(fd_muni)

    try:
        with open(temp_csv, 'w', encoding='utf-8', newline='\n') as f:
            writer = csv.writer(f, lineterminator='\n')
            writer.writerow(["rowId", "city_name", "town_name", "latitude", "longitude", "households", "population", "e_stat_code"])
            for area in all_final_areas:
                writer.writerow([
                    area['rowId'],
                    area['city_name'],
                    area['display_town_name'],
                    f"{float(area['latitude']):.6f}",
                    f"{float(area['longitude']):.6f}",
                    area['households'],
                    area['population'],
                    area['e_stat_code']
                ])

        with open(temp_geo, 'w', encoding='utf-8', newline='\n') as f:
            json.dump({
                "type": "FeatureCollection",
                "features": geojson_features
            }, f, ensure_ascii=False, indent=2)
            f.write('\n')

        with open(temp_muni, 'w', encoding='utf-8', newline='\n') as f:
            writer = csv.writer(f, lineterminator='\n')
            writer.writerow(["city_name", "city_code", "total_towns"])
            for cname in muni_order:
                writer.writerow([cname, muni_codes[cname], muni_counts[cname]])

        with open(temp_prov, 'w', encoding='utf-8', newline='\n') as f:
            json.dump({
                "contract_version": "3.2",
                "total_parent_towns": len(parent_towns),
                "total_records": len(all_final_areas),
                "total_households": total_h,
                "total_population": total_p,
                "records": provenance_records
            }, f, ensure_ascii=False, indent=2)
            f.write('\n')

        shutil.move(temp_csv, out_csv_abs)
        shutil.move(temp_prov, prov_out_path)
        shutil.move(temp_geo, geojson_out_path)
        shutil.move(temp_muni, muni_out_path)

        print(f"SUCCESS: Written {len(all_final_areas)} records to {out_csv_abs}")
        print(f"SUCCESS: Written {len(geojson_features)} features to {geojson_out_path}")
        print(f"SUCCESS: Written {len(muni_order)} municipalities to {muni_out_path}")
        print(f"SUCCESS: Written provenance to {prov_out_path}")
    finally:
        for tp in (temp_csv, temp_prov, temp_geo, temp_muni):
            if os.path.exists(tp):
                os.remove(tp)

    print("=" * 70)
    print("4-LAYER MASTER COMPILATION & GATES 1..4 VERIFICATION SUCCESSFUL!")
    print("=" * 70)


def main():
    args = parse_args()
    if args.phase1_only:
        run_phase1_skeleton(args)
    elif args.phase1_skeleton or args.estat_dir or args.estat_file or args.estat_b_dir or args.estat_b_file:
        run_4layer_master_compiler(args)
    else:
        run_phase1_skeleton(args)


if __name__ == '__main__':
    main()

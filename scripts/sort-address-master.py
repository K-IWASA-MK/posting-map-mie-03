#!/usr/bin/env python3
"""
sort-address-master.py

address_master.csv（または Phase 1 Area Skeleton CSV）の各レコードを、
デジタル庁 アドレス・ベース・レジストリ（ABR）町字マスターの公式読み仮名に基づき、
日本語の読み順（五十音順・丁目の数値順）に厳格整列する Universal スクリプト。

準拠規程: docs/architecture/DISTRICT_DATA_ACQUISITION_RULE.md §4.4, §4.5

【絶対順守規則】
1. 表示値（city_name, town_name 等の全カラム）は1文字も改変しない。
2. 読み順はデジタル庁ABR町字マスター（city_kana, ward_kana, oaza_cho_kana）の公式入力に統一。
3. 地区専用のハードコード辞書・任意推測マップは永久禁止。
4. 読み仮名が欠損しているレコードが1件でも検知された場合は即時 HARD STOP。
5. 出力先は必須指定とし、既存ファイルの上書きを禁止。異常終了時は未完成ファイルを残さない。
"""

import os
import sys
import re
import csv
import argparse
import tempfile
import shutil

import json
from collections import defaultdict

CHOME_NUM_MAP = {
    "一丁目": "01", "二丁目": "02", "三丁目": "03", "四丁目": "04", "五丁目": "05",
    "六丁目": "06", "七丁目": "07", "八丁目": "08", "九丁目": "09", "十丁目": "10",
    "十一丁目": "11", "十二丁目": "12", "十三丁目": "13", "十四丁目": "14", "十五丁目": "15",
    "十六丁目": "16", "十七丁目": "17", "十八丁目": "18", "十九丁目": "19", "二十丁目": "20"
}

def parse_args():
    parser = argparse.ArgumentParser(description="Universal Address Master Sorter adhering to DISTRICT_DATA_ACQUISITION_RULE.md §4.4")
    parser.add_argument("--input", required=True, help="Input CSV path (Required; no default)")
    parser.add_argument("--output", required=True, help="Output CSV path (Required; no default)")
    parser.add_argument("--abr-file", required=True, action='append', help="Path to Digital Agency ABR town master CSV (Required; can be specified multiple times for multiple files)")
    parser.add_argument("--provenance", default=None, help="Path to skeleton provenance JSON for resolving official codes (optional)")
    parser.add_argument("--reading-reconciliation", default=None, help="Path to external official reading reconciliation JSON (optional)")
    return parser.parse_args()

def load_reading_reconciliations(json_path):
    """
    Load external official reading reconciliation JSON (Rule 4.4).
    Key: "<city_code>:<town_code>"
    """
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
    Load external official reading reconciliation JSON (Rule 4.4).
    Key: "<city_code>:<town_code>"
    Strictly validates all 8 mandatory fields defined in Rule 4.4.
    """
    if not json_path:
        return {}
    if not os.path.exists(json_path):
        sys.exit(f"FATAL HARD STOP: Reading reconciliation file not found: {json_path}")
    print(f"[Phase 1 Reconciliations] Loading external official reconciliations from {json_path}...")
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

    return data

def load_provenance_data(provenance_path):
    """
    Load skeleton provenance JSON mapping rowId -> record metadata (city_code, town_code, raw_town_name).
    """
    if not provenance_path:
        return {}
    if not os.path.exists(provenance_path):
        sys.exit(f"FATAL HARD STOP: Specified provenance file not found: {provenance_path}")

    with open(provenance_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception as e:
            sys.exit(f"FATAL HARD STOP: Malformed provenance JSON ({provenance_path}): {e}")

    records = data.get('records', [])
    mapping = {}
    for r in records:
        rid = int(r.get('rowId', 0))
        if rid > 0:
            mapping[rid] = r
    print(f"[Provenance Loader] Loaded {len(mapping)} records from {provenance_path}")
    return mapping

def load_abr_readings(abr_paths):
    """
    Load official readings from Digital Agency ABR town master CSV files adhering strictly to official hierarchy.
    Separates exact raw name match from normalized candidates to prevent cross-town overwrite.
    """
    city_readings = {}
    exact_town_readings = defaultdict(list)
    normalized_candidates = defaultdict(list)

    for path in abr_paths:
        if not os.path.exists(path):
            sys.exit(f"FATAL: Specified ABR file not found: {path}")

        print(f"[ABR Loader] Reading official ABR town master: {path}...")
        with open(path, "r", encoding="utf-8-sig") as f:
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
                    "base_town": base_town
                }

                # 1. Exact raw name registration (collect without overwriting)
                exact_town_readings[(full_city_name, full_town)].append(entry)

                # 2. Normalized candidates collection (collect without overwriting)
                normalized_candidates[(full_city_name, clean_full)].append(entry)
                if base_town != full_town:
                    normalized_candidates[(full_city_name, clean_base)].append(entry)

    print(f"[ABR Loader] Loaded readings: {len(city_readings)} cities/wards, {len(exact_town_readings)} exact towns, and {len(normalized_candidates)} normalized keys.")
    return city_readings, exact_town_readings, normalized_candidates

def resolve_sort_key_universal(row, city_readings, exact_town_readings, normalized_candidates, provenance_map, reconciliations):
    """
    Derive deterministic sort key adhering to DISTRICT_DATA_ACQUISITION_RULE.md §4.4, §4.5, §4.8.
    Keys:
      1. city_kana (50-on order)
      2. base_kana (50-on order)
      3. chome_num (numeric 00..99)
      4. official_town_name (preserved parent town tie-breaker)
      5. split_idx (0 for unsplit, 1..K for split areas)
      6. row_id (preserved tie-breaker)
    """
    city_name = (row.get("city_name") or "").strip()
    town_name = (row.get("town_name") or "").strip()
    row_id = int(row.get("rowId") or 0)

    split_match = re.search(r"\s*\((\d+)\)$", town_name)
    if split_match:
        split_idx = int(split_match.group(1))
        base_town_for_lookup = town_name[:split_match.start()].strip()
    else:
        split_idx = 0
        base_town_for_lookup = town_name

    # 1. City kana resolution
    city_kana = city_readings.get(city_name)
    if not city_kana:
        for cname, ckana in city_readings.items():
            if cname == city_name or re.sub(r"^.+?郡", "", cname) == city_name:
                city_kana = ckana
                break

    if not city_kana:
        raise ValueError(f"FATAL: Unresolved city reading in official ABR data for city_name='{city_name}'")

    # 2. Check external reconciliation via provenance official code if available
    prov_rec = provenance_map.get(row_id)
    if prov_rec:
        if prov_rec.get('official_town_name'):
            base_town_for_lookup = str(prov_rec.get('official_town_name')).strip()
        if prov_rec.get('split_index') is not None:
            try:
                split_idx = int(prov_rec.get('split_index'))
            except Exception:
                pass
        if prov_rec.get('raw_town_name'):
            raw_town = str(prov_rec.get('raw_town_name')).strip()
        elif isinstance(prov_rec.get('raw_town_names'), list) and len(prov_rec['raw_town_names']) > 0:
            raw_town = str(prov_rec['raw_town_names'][0]).strip()
        else:
            raw_town = base_town_for_lookup

        city_code = prov_rec.get('city_code', '')
        town_code = prov_rec.get('town_code') or prov_rec.get('parent_town_code') or ''
        comp_key = f"{city_code}:{town_code}"
        reconciled = reconciliations.get(comp_key)
        if reconciled and reconciled.get('reconciled_reading'):
            town_kana = reconciled['reconciled_reading'].strip()
            chome_match = re.search(r"([一二三四五六七八九十]+丁目)$", base_town_for_lookup)
            chome_num = CHOME_NUM_MAP.get(chome_match.group(1), "00") if chome_match else "00"
            return (city_kana, town_kana, chome_num, base_town_for_lookup, split_idx, row_id)
    else:
        raw_town = base_town_for_lookup

    # 3. Lookup in exact raw ABR readings (prioritize exact raw match)
    town_entry = None
    exact_cands = [c for c in exact_town_readings.get((city_name, raw_town), []) if c.get("base_kana")]
    if not exact_cands and raw_town != base_town_for_lookup:
        exact_cands = [c for c in exact_town_readings.get((city_name, base_town_for_lookup), []) if c.get("base_kana")]

    if exact_cands:
        distinct_kanas = set(c["base_kana"] for c in exact_cands)
        if len(distinct_kanas) == 1:
            town_entry = exact_cands[0]
        elif len(distinct_kanas) > 1:
            raise ValueError(
                f"FATAL: Ambiguous ABR reading collision for town '{city_name}' '{base_town_for_lookup}'. "
                f"Multiple distinct readings for exact town name: {distinct_kanas}"
            )

    # 4. If no exact raw match, check normalized fallback ONLY if unambiguous (distinct readings == 1)
    if not town_entry:
        clean_town = re.sub(r"^大字", "", base_town_for_lookup)
        cands = [c for c in normalized_candidates.get((city_name, clean_town), []) if c.get("base_kana")]
        distinct_kanas = set(c["base_kana"] for c in cands)
        if len(distinct_kanas) == 1:
            town_entry = cands[0]
        elif len(distinct_kanas) > 1:
            raise ValueError(f"FATAL: Ambiguous ABR reading collision for town '{city_name}' '{base_town_for_lookup}'. Multiple distinct readings match '{clean_town}': {distinct_kanas}")

    # 5. Check base_name for chome towns
    chome_part = ""
    chome_match = re.search(r"([一二三四五六七八九十]+丁目)$", base_town_for_lookup)
    if not town_entry and chome_match:
        chome_part = chome_match.group(1)
        base_name = base_town_for_lookup[:-len(chome_part)]
        clean_base = re.sub(r"^大字", "", base_name)
        cands = [c for c in normalized_candidates.get((city_name, clean_base), []) if c.get("base_kana")]
        distinct_kanas = set(c["base_kana"] for c in cands)
        if len(distinct_kanas) == 1:
            town_entry = cands[0]
        elif len(distinct_kanas) > 1:
            raise ValueError(f"FATAL: Ambiguous ABR reading collision for base town '{city_name}' '{base_name}'. Multiple distinct readings match '{clean_base}': {distinct_kanas}")

    if not town_entry or not town_entry.get("base_kana"):
        raise ValueError(f"FATAL: Unresolved ABR reading for town_name='{town_name}' (base='{base_town_for_lookup}') in city_name='{city_name}'")

    base_kana = town_entry["base_kana"]
    chome_num = CHOME_NUM_MAP.get(chome_part, "00")
    if chome_num == "00" and town_entry.get("chome_number"):
        try:
            chome_num = f"{int(town_entry['chome_number']):02d}"
        except:
            pass

    return (city_kana, base_kana, chome_num, base_town_for_lookup, split_idx, row_id)

def main():
    args = parse_args()
    print("=" * 70)
    print("UNIVERSAL ADDRESS MASTER SORTER (DISTRICT_DATA_ACQUISITION_RULE.md §4.4)")
    print(f"Input:  {args.input}")
    print(f"Output: {args.output}")
    print("=" * 70)

    if not os.path.exists(args.input):
        sys.exit(f"FATAL: Input file not found: {args.input}")

    if os.path.exists(args.output):
        sys.exit(f"FATAL HARD STOP: Output file already exists (overwrite strictly prohibited): {args.output}")

    city_readings, exact_town_readings, normalized_candidates = load_abr_readings(args.abr_file)
    provenance_map = load_provenance_data(args.provenance)
    reconciliations = load_reading_reconciliations(args.reading_reconciliation)

    with open(args.input, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        original_header = reader.fieldnames
        original_rows = list(reader)

    original_count = len(original_rows)
    print(f"[Sorter] Loaded {original_count} records from {args.input}")

    # Test and resolve sort keys for all rows (HARD STOP on any failure)
    for idx, r in enumerate(original_rows):
        try:
            resolve_sort_key_universal(r, city_readings, exact_town_readings, normalized_candidates, provenance_map, reconciliations)
        except Exception as err:
            sys.exit(f"FAIL [Universal Reading Check] at row {idx+1} (rowId={r.get('rowId')}): {err}")

    print("PASS [Universal Reading Check]: All records successfully resolved sort keys via official ABR data.")

    # Sort execution
    sorted_rows = sorted(original_rows, key=lambda r: resolve_sort_key_universal(r, city_readings, exact_town_readings, normalized_candidates, provenance_map, reconciliations))

    # Verification: row count preservation and rowId sequence
    assert len(sorted_rows) == original_count, "Record count mismatch after sort"

    orig_row_ids = set(int(r["rowId"]) for r in original_rows)
    sorted_row_ids = set(int(r["rowId"]) for r in sorted_rows)
    assert orig_row_ids == sorted_row_ids, "rowId set changed after sort"

    # Write output atomically via temporary file
    out_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(out_dir, exist_ok=True)
    fd, temp_out_path = tempfile.mkstemp(prefix="sort_address_", dir=out_dir)
    os.close(fd)

    try:
        with open(temp_out_path, "w", encoding="utf-8", newline="\n") as f:
            writer = csv.DictWriter(f, fieldnames=original_header, lineterminator="\n")
            writer.writeheader()
            writer.writerows(sorted_rows)

        # Atomic move to destination
        shutil.move(temp_out_path, args.output)
        print(f"[Sorter] SUCCESS: Written {len(sorted_rows)} sorted records to {args.output}")
    finally:
        if os.path.exists(temp_out_path):
            os.remove(temp_out_path)

if __name__ == "__main__":
    main()

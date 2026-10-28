#!/usr/bin/env node
/**
 * POSTING MAP - District Data Quality Gate Verifier
 *
 * 地区データ層マスターファイル群の内部閉包整合性を機械検証する。
 * - Master Triad: address_master.csv, boundaries.geojson, municipality_master.csv
 * - Election Master: election_history.json
 * - Auxiliary Masters: area_mapping.json, storage_locations.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');

/**
 * RFC 4180 準拠の厳格ステートマシン型 CSV パーサー
 * - UTF-8 BOM 除去
 * - クォートフィールド (フィールド先頭が ") と非クォートフィールドの厳格峻別
 * - 非クォートフィールド内の途中引用符 (例: a"b) を構文エラーとして検出
 * - クォートフィールドの閉じ引用符直後の不正文字 (例: "a"b) を構文エラーとして検出
 * - 引用符内の改行 (CRLF / LF) およびカンマを正確に保持
 * - 二重引用符 ("") のエスケープ解除
 * - 閉じていない引用符、重複ヘッダー、列数不一致を検出して例外スロー
 */
export function parseCSV(content, sourceName = 'CSV') {
  const cleanContent = content.replace(/^\uFEFF/, '');
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let fieldStarted = false;
  let isQuotedField = false;
  let quoteClosed = false;
  const len = cleanContent.length;

  function endField() {
    currentRow.push(currentField);
    currentField = '';
    fieldStarted = false;
    isQuotedField = false;
    quoteClosed = false;
  }

  function endRow() {
    endField();
    rows.push(currentRow);
    currentRow = [];
  }

  for (let i = 0; i < len; i++) {
    const char = cleanContent[i];

    if (!fieldStarted) {
      if (char === '"') {
        fieldStarted = true;
        isQuotedField = true;
        quoteClosed = false;
      } else if (char === ',') {
        endField();
      } else if (char === '\r') {
        if (i + 1 < len && cleanContent[i + 1] === '\n') {
          i++;
        }
        endRow();
      } else if (char === '\n') {
        endRow();
      } else {
        fieldStarted = true;
        isQuotedField = false;
        currentField += char;
      }
    } else if (isQuotedField) {
      if (quoteClosed) {
        if (char === ',') {
          endField();
        } else if (char === '\r') {
          if (i + 1 < len && cleanContent[i + 1] === '\n') {
            i++;
          }
          endRow();
        } else if (char === '\n') {
          endRow();
        } else {
          throw new Error(`[${sourceName}] Parse error: Invalid character "${char}" after closing quote.`);
        }
      } else {
        if (char === '"') {
          if (i + 1 < len && cleanContent[i + 1] === '"') {
            currentField += '"';
            i++; // エスケープされた二重引用符スキップ
          } else {
            quoteClosed = true;
          }
        } else {
          currentField += char;
        }
      }
    } else {
      // 非クォートフィールド
      if (char === '"') {
        throw new Error(`[${sourceName}] Parse error: Unexpected quote inside unquoted field.`);
      } else if (char === ',') {
        endField();
      } else if (char === '\r') {
        if (i + 1 < len && cleanContent[i + 1] === '\n') {
          i++;
        }
        endRow();
      } else if (char === '\n') {
        endRow();
      } else {
        currentField += char;
      }
    }
  }

  if (isQuotedField && !quoteClosed) {
    throw new Error(`[${sourceName}] Parse error: Unclosed quote detected.`);
  }

  // 最後のフィールド/行の flush
  if (fieldStarted || currentField.length > 0 || currentRow.length > 0) {
    endField();
    rows.push(currentRow);
  }

  // 末尾の空行を除去
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0].trim() === '') {
    rows.pop();
  }

  if (rows.length === 0) {
    throw new Error(`[${sourceName}] Parse error: CSV file is empty.`);
  }

  const header = rows[0].map(h => h.trim());
  const headerSet = new Set();
  for (const col of header) {
    if (headerSet.has(col)) {
      throw new Error(`[${sourceName}] Header error: Duplicate column header detected: "${col}".`);
    }
    headerSet.add(col);
  }

  const dataRows = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length !== header.length) {
      throw new Error(`[${sourceName}] Row ${r + 1} column count mismatch: expected ${header.length}, got ${row.length}.`);
    }
    const rowObj = {};
    for (let c = 0; c < header.length; c++) {
      rowObj[header[c]] = row[c];
    }
    dataRows.push(rowObj);
  }

  return { header, rows: dataRows };
}

/**
 * 地区データ品質検証コア関数
 */
export function runDistrictDataValidation(dataDir = DEFAULT_DATA_DIR) {
  const results = {
    pass: false,
    errors: [],
    details: {}
  };

  function fail(msg) {
    results.errors.push(msg);
  }

  const addressFile = path.join(dataDir, 'address_master.csv');
  const muniFile = path.join(dataDir, 'municipality_master.csv');
  const boundsFile = path.join(dataDir, 'boundaries.geojson');
  const electionFile = path.join(dataDir, 'election_history.json');
  const areaMappingFile = path.join(dataDir, 'area_mapping.json');
  const storageLocationsFile = path.join(dataDir, 'storage_locations.json');

  // 1. ファイル存在検査
  const requiredFiles = [
    { name: 'address_master.csv', path: addressFile },
    { name: 'municipality_master.csv', path: muniFile },
    { name: 'boundaries.geojson', path: boundsFile },
    { name: 'election_history.json', path: electionFile },
    { name: 'area_mapping.json', path: areaMappingFile },
    { name: 'storage_locations.json', path: storageLocationsFile }
  ];

  for (const f of requiredFiles) {
    if (!fs.existsSync(f.path)) {
      fail(`Required master file missing: ${f.name}`);
    }
  }

  if (results.errors.length > 0) {
    return results;
  }

  // 2. CSV パースと必須ヘッダー検査
  let addressData, muniData;
  try {
    const rawAddr = fs.readFileSync(addressFile, 'utf8');
    addressData = parseCSV(rawAddr, 'address_master.csv');
  } catch (e) {
    fail(`address_master.csv parsing failed: ${e.message}`);
    return results;
  }

  try {
    const rawMuni = fs.readFileSync(muniFile, 'utf8');
    muniData = parseCSV(rawMuni, 'municipality_master.csv');
  } catch (e) {
    fail(`municipality_master.csv parsing failed: ${e.message}`);
    return results;
  }

  // データ行が 0 件のケースの厳格遮断
  if (addressData.rows.length === 0) {
    fail('address_master.csv has zero data rows (must have at least 1 row).');
  }
  if (muniData.rows.length === 0) {
    fail('municipality_master.csv has zero data rows (must have at least 1 row).');
  }

  // address_master 必須ヘッダー検査
  const requiredAddrHeaders = ['rowId', 'city_name', 'town_name', 'latitude', 'longitude'];
  for (const h of requiredAddrHeaders) {
    if (!addressData.header.includes(h)) {
      fail(`address_master.csv missing required header: ${h}`);
    }
  }

  // municipality_master 必須ヘッダー検査
  const requiredMuniHeaders = ['city_name', 'city_code', 'total_towns'];
  for (const h of requiredMuniHeaders) {
    if (!muniData.header.includes(h)) {
      fail(`municipality_master.csv missing required header: ${h}`);
    }
  }

  if (results.errors.length > 0) {
    return results;
  }

  // 3. municipality_master 整合性・マップ作成
  const muniExpectedMap = new Map();
  let expectedTotalN = 0;
  for (const m of muniData.rows) {
    const cityName = (m.city_name ?? '').toString().trim();
    if (!cityName) {
      fail(`municipality_master.csv contains empty city_name.`);
      continue;
    }
    if (muniExpectedMap.has(cityName)) {
      fail(`municipality_master.csv duplicate city_name: ${cityName}`);
      continue;
    }

    // city_code の 5桁または6桁の数字形式検証
    const cityCode = (m.city_code ?? '').toString().trim();
    if (!/^\d{5,6}$/.test(cityCode)) {
      fail(`municipality_master.csv invalid city_code "${m.city_code}" for "${cityName}" (must be 5 or 6 digits).`);
    }

    const totalTownsNum = Number(m.total_towns);
    if (!Number.isInteger(totalTownsNum) || totalTownsNum <= 0) {
      fail(`municipality_master.csv invalid total_towns for "${cityName}": ${m.total_towns}`);
      continue;
    }
    muniExpectedMap.set(cityName, totalTownsNum);
    expectedTotalN += totalTownsNum;
  }

  if (expectedTotalN <= 0) {
    fail('municipality_master.csv total_towns sum must be > 0.');
  }

  const validCities = new Set(muniExpectedMap.keys());
  const canonicalMuniOrder = Array.from(muniExpectedMap.keys());

  // 4. address_master 行バリデーション & 集計
  const addressRowMap = new Map();
  const addressCityCount = new Map();
  const addressCityTownSeen = new Map();
  const addressCityAppearanceOrder = [];
  const addressCityAppearanceSet = new Set();
  let prevAddressCity = null;
  for (let i = 0; i < addressData.rows.length; i++) {
    const row = addressData.rows[i];
    const rowIdNum = Number(row.rowId);
    if (!Number.isInteger(rowIdNum) || rowIdNum <= 0) {
      fail(`address_master.csv row ${i + 2}: invalid rowId "${row.rowId}".`);
      continue;
    }
    if (addressRowMap.has(rowIdNum)) {
      fail(`address_master.csv row ${i + 2}: duplicate rowId ${rowIdNum}.`);
      continue;
    }

    const cityName = (row.city_name ?? '').toString().trim();
    const townName = (row.town_name ?? '').toString().trim();
    if (!cityName) fail(`address_master.csv row ${i + 2}: empty city_name.`);
    if (!townName) fail(`address_master.csv row ${i + 2}: empty town_name.`);

    if (cityName) {
      if (!addressCityAppearanceSet.has(cityName)) {
        addressCityAppearanceSet.add(cityName);
        addressCityAppearanceOrder.push(cityName);
      } else if (prevAddressCity !== cityName) {
        fail(`address_master.csv row ${i + 2}: city_name "${cityName}" re-appeared out of contiguous order after "${prevAddressCity}".`);
      }
      prevAddressCity = cityName;
    }

    if (cityName && townName) {
      const cityTownKey = `${cityName}\u0000${townName}`;
      if (addressCityTownSeen.has(cityTownKey)) {
        const firstRowNum = addressCityTownSeen.get(cityTownKey);
        fail(`address_master.csv row ${i + 2}: duplicate (city_name, town_name) pair ("${cityName}", "${townName}") already defined at row ${firstRowNum}.`);
      } else {
        addressCityTownSeen.set(cityTownKey, i + 2);
      }
    }

    if (cityName && !validCities.has(cityName)) {
      fail(`address_master.csv row ${i + 2}: undefined city_name "${cityName}" not in municipality_master.csv.`);
    }

    // 空白座標の厳格拒絶 ＆ 有限数値・座標範囲検査
    const rawLat = (row.latitude ?? '').toString().trim();
    const rawLng = (row.longitude ?? '').toString().trim();

    if (rawLat.length === 0) {
      fail(`address_master.csv row ${i + 2}: empty latitude.`);
    }
    if (rawLng.length === 0) {
      fail(`address_master.csv row ${i + 2}: empty longitude.`);
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (rawLat.length > 0 && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      fail(`address_master.csv row ${i + 2}: invalid latitude "${row.latitude}".`);
    }
    if (rawLng.length > 0 && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
      fail(`address_master.csv row ${i + 2}: invalid longitude "${row.longitude}".`);
    }

    addressRowMap.set(rowIdNum, { cityName, townName, lat, lng });
    addressCityCount.set(cityName, (addressCityCount.get(cityName) || 0) + 1);
  }

  // 5. boundaries.geojson パース・バリデーション
  let geojsonData;
  try {
    const rawGeo = fs.readFileSync(boundsFile, 'utf8');
    geojsonData = JSON.parse(rawGeo);
  } catch (e) {
    fail(`boundaries.geojson parsing failed: ${e.message}`);
    return results;
  }

  if (!geojsonData || geojsonData.type !== 'FeatureCollection' || !Array.isArray(geojsonData.features)) {
    fail(`boundaries.geojson must be a FeatureCollection with features array.`);
    return results;
  }

  if (geojsonData.features.length === 0) {
    fail('boundaries.geojson has zero features (must have at least 1 feature).');
  }

  const geoFeatureMap = new Map();
  const geoCityCount = new Map();
  for (let i = 0; i < geojsonData.features.length; i++) {
    const feat = geojsonData.features[i];
    if (!feat || feat.type !== 'Feature') {
      fail(`boundaries.geojson feature[${i}] must be of type Feature.`);
      continue;
    }
    const props = feat.properties || {};
    const isUnavailableOfficialPolygon =
      feat.geometry === null && props.geometry_status === 'UNAVAILABLE_OFFICIAL_POLYGON';

    if (!isUnavailableOfficialPolygon) {
      if (
        !feat.geometry ||
        !Array.isArray(feat.geometry.coordinates) ||
        feat.geometry.coordinates.length === 0 ||
        (feat.geometry.type !== 'Polygon' && feat.geometry.type !== 'MultiPolygon')
      ) {
        fail(`boundaries.geojson feature[${i}] invalid geometry (must be Polygon or MultiPolygon with non-empty coordinates array, or geometry:null with geometry_status="UNAVAILABLE_OFFICIAL_POLYGON").`);
        continue;
      }
    }
    const rowIdNum = Number(props.rowId);
    if (!Number.isInteger(rowIdNum) || rowIdNum <= 0) {
      fail(`boundaries.geojson feature[${i}] invalid properties.rowId "${props.rowId}".`);
      continue;
    }
    if (geoFeatureMap.has(rowIdNum)) {
      fail(`boundaries.geojson feature[${i}] duplicate properties.rowId ${rowIdNum}.`);
      continue;
    }

    const cityName = (props.city_name || '').toString().trim();
    const townName = (props.town_name || '').toString().trim();
    if (!cityName) fail(`boundaries.geojson feature[${i}] empty properties.city_name.`);
    if (!townName) fail(`boundaries.geojson feature[${i}] empty properties.town_name.`);

    if (cityName && !validCities.has(cityName)) {
      fail(`boundaries.geojson feature[${i}] undefined properties.city_name "${cityName}" not in municipality_master.csv.`);
    }

    geoFeatureMap.set(rowIdNum, { cityName, townName });
    geoCityCount.set(cityName, (geoCityCount.get(cityName) || 0) + 1);
  }

  // 6. Master Triad 整合性照合
  const N_address = addressData.rows.length;
  const N_geo = geojsonData.features.length;

  results.details.count = {
    addressMaster: N_address,
    boundaries: N_geo,
    municipalityExpected: expectedTotalN
  };

  // Rule-01: 全体件数 N の一致
  if (N_address !== expectedTotalN) {
    fail(`Rule-01 Total count mismatch: address_master.csv has ${N_address} rows, expected ${expectedTotalN} from municipality_master.csv.`);
  }
  if (N_geo !== expectedTotalN) {
    fail(`Rule-01 Total count mismatch: boundaries.geojson has ${N_geo} features, expected ${expectedTotalN} from municipality_master.csv.`);
  }

  // 自治体別件数内訳の厳格一致
  for (const [city, expectedCount] of muniExpectedMap.entries()) {
    const actAddr = addressCityCount.get(city) || 0;
    const actGeo = geoCityCount.get(city) || 0;
    if (actAddr !== expectedCount) {
      fail(`Municipality town count mismatch for "${city}": address_master has ${actAddr}, expected ${expectedCount}.`);
    }
    if (actGeo !== expectedCount) {
      fail(`Municipality town count mismatch for "${city}": boundaries.geojson has ${actGeo}, expected ${expectedCount}.`);
    }
  }

  // order(unique(address_master.city_name)) = order(municipality_master.city_name)
  if (addressCityAppearanceOrder.length === canonicalMuniOrder.length) {
    for (let cIdx = 0; cIdx < canonicalMuniOrder.length; cIdx++) {
      if (addressCityAppearanceOrder[cIdx] !== canonicalMuniOrder[cIdx]) {
        fail(`address_master.csv municipality appearance order mismatch at index ${cIdx}: got "${addressCityAppearanceOrder[cIdx]}", expected "${canonicalMuniOrder[cIdx]}" from municipality_master.csv.`);
      }
    }
  } else {
    fail(`address_master.csv unique municipality count (${addressCityAppearanceOrder.length}) does not match municipality_master.csv count (${canonicalMuniOrder.length}).`);
  }

  // Rule-02: rowId 1..N 1:1 対応・連続性
  if (N_address === expectedTotalN && N_geo === expectedTotalN && expectedTotalN > 0) {
    for (let id = 1; id <= expectedTotalN; id++) {
      const addrRow = addressRowMap.get(id);
      const geoFeat = geoFeatureMap.get(id);

      if (!addrRow) {
        fail(`Rule-02 Sequence gap: rowId ${id} missing in address_master.csv.`);
      }
      if (!geoFeat) {
        fail(`Rule-02 Sequence gap: rowId ${id} missing in boundaries.geojson.`);
      }

      if (addrRow && geoFeat) {
        if (addrRow.cityName !== geoFeat.cityName) {
          fail(`Rule-02 Property mismatch on rowId ${id}: city_name "${addrRow.cityName}" !== "${geoFeat.cityName}".`);
        }
        if (addrRow.townName !== geoFeat.townName) {
          fail(`Rule-02 Property mismatch on rowId ${id}: town_name "${addrRow.townName}" !== "${geoFeat.townName}".`);
        }
      }
    }
  }

  // 7. election_history.json の自治体キー完全一致検証
  try {
    const rawElection = fs.readFileSync(electionFile, 'utf8');
    const electionData = JSON.parse(rawElection);
    if (!electionData || !Array.isArray(electionData.elections) || electionData.elections.length === 0) {
      fail(`election_history.json must have non-empty "elections" array.`);
    } else {
      for (let eIdx = 0; eIdx < electionData.elections.length; eIdx++) {
        const el = electionData.elections[eIdx];
        if (!el.municipalities || typeof el.municipalities !== 'object' || Array.isArray(el.municipalities)) {
          fail(`election_history.json election[${eIdx}] (${el.electionId || eIdx}) missing "municipalities" object.`);
          continue;
        }
        const elCities = Object.keys(el.municipalities);
        const elCitySet = new Set(elCities);

        // 双方向 100% 一致検証
        for (const c of validCities) {
          if (!elCitySet.has(c)) {
            fail(`election_history.json election[${eIdx}] missing expected municipality "${c}".`);
          }
        }
        for (const c of elCities) {
          if (!validCities.has(c)) {
            fail(`election_history.json election[${eIdx}] has undefined municipality key "${c}".`);
          }
        }
      }
    }
  } catch (e) {
    fail(`election_history.json parsing failed: ${e.message}`);
  }

  // 8. 補助 JSON の形式検査
  try {
    const rawArea = fs.readFileSync(areaMappingFile, 'utf8');
    const areaData = JSON.parse(rawArea);
    if (!Array.isArray(areaData)) {
      fail(`area_mapping.json must be an array.`);
    }
  } catch (e) {
    fail(`area_mapping.json parsing failed: ${e.message}`);
  }

  try {
    const rawStorage = fs.readFileSync(storageLocationsFile, 'utf8');
    const storageData = JSON.parse(rawStorage);
    if (!Array.isArray(storageData)) {
      fail(`storage_locations.json must be an array.`);
    } else {
      const storageCities = [];
      const storageSeen = new Set();
      let hasElementFormatError = false;

      for (let sIdx = 0; sIdx < storageData.length; sIdx++) {
        const item = storageData[sIdx];
        if (typeof item !== 'string' || item.trim().length === 0) {
          fail(`storage_locations.json element[${sIdx}] must be a non-empty string.`);
          hasElementFormatError = true;
          continue;
        }
        const trimmed = item.trim();
        if (storageSeen.has(trimmed)) {
          fail(`storage_locations.json contains duplicate municipality "${trimmed}" at index ${sIdx}.`);
        }
        storageSeen.add(trimmed);
        storageCities.push(trimmed);
      }

      if (!hasElementFormatError) {
        // missing: municipality_master.csv に存在するが storage_locations.json に欠落
        for (const c of validCities) {
          if (!storageSeen.has(c)) {
            fail(`storage_locations.json missing expected municipality "${c}" from municipality_master.csv.`);
          }
        }
        // extra: storage_locations.json に存在するが municipality_master.csv に未定義
        for (const c of storageCities) {
          if (!validCities.has(c)) {
            fail(`storage_locations.json has undefined extra municipality "${c}" not in municipality_master.csv.`);
          }
        }
        // order mismatch: order(storage_locations) = order(municipality_master.city_name)
        if (storageCities.length === canonicalMuniOrder.length) {
          for (let sIdx = 0; sIdx < canonicalMuniOrder.length; sIdx++) {
            if (storageCities[sIdx] !== canonicalMuniOrder[sIdx]) {
              fail(`storage_locations.json order mismatch at index ${sIdx}: got "${storageCities[sIdx]}", expected "${canonicalMuniOrder[sIdx]}" from municipality_master.csv.`);
            }
          }
        }
      }
    }
  } catch (e) {
    fail(`storage_locations.json parsing failed: ${e.message}`);
  }

  results.pass = results.errors.length === 0;
  return results;
}

// ─────────────────────────────────────────────────────────────
// CLI エントリーポイント
// ─────────────────────────────────────────────────────────────
function main() {
  console.log('===============================================================');
  console.log('🏛️  [DISTRICT DATA QUALITY GATE AUDIT]');
  console.log('===============================================================\n');

  let targetDir = DEFAULT_DATA_DIR;
  const args = process.argv.slice(2);
  const dataDirIdx = args.indexOf('--data-dir');
  if (dataDirIdx !== -1 && args[dataDirIdx + 1]) {
    targetDir = path.resolve(args[dataDirIdx + 1]);
  }

  console.log(`[Target Data Directory] ${targetDir}\n`);

  const report = runDistrictDataValidation(targetDir);

  if (report.details.count) {
    console.log(`📊 Master Triad Count Summary:`);
    console.log(`  - address_master.csv rows:     ${report.details.count.addressMaster}`);
    console.log(`  - boundaries.geojson features: ${report.details.count.boundaries}`);
    console.log(`  - municipality_master total:   ${report.details.count.municipalityExpected}\n`);
  }

  if (report.pass) {
    console.log('✅ [District Data Quality Gate] ALL CHECKS PASSED PERFECTLY!');
    console.log('   - RFC 4180 CSV syntax valid & latitude/longitude coordinates confirmed');
    console.log('   - GeoJSON FeatureCollection structure & properties validated');
    console.log('   - Master Triad closure & per-municipality counts 100% matched');
    console.log('   - rowId 1..N 1:1 sequence uniquely confirmed');
    console.log('   - election_history.json municipality keys bidirectional matched');
    console.log('   - Auxiliary JSON format verified');
    console.log('===============================================================\n');
    process.exit(0);
  } else {
    console.error(`❌ [District Data Quality Gate] FAILED with ${report.errors.length} error(s):`);
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
    console.error('\n🛑 [Hard Stop] District data integrity violation. Deploy halted.');
    console.error('===============================================================\n');
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

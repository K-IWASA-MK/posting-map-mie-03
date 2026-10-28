import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCSV, runDistrictDataValidation } from '../scripts/validate-district-data-gate.mjs';
import { generateStorageLocations } from '../scripts/generate-storage-locations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/validate-district-data-gate.mjs');

console.log('====================================================');
console.log('🧪 TEST: DISTRICT DATA QUALITY GATE REGRESSION SUITE');
console.log('====================================================\n');

// ─────────────────────────────────────────────────────────────
// 1. CSV パーサー単体テスト（RFC 4180 正常系 & 構文異常系）
// ─────────────────────────────────────────────────────────────
console.log('▶ [1/4] Testing RFC 4180 CSV Parser...');

// 1.1 引用符内改行・カンマ・エスケープの正常パース (受容)
{
  const sampleCSV = [
    'col1,col2,col3',
    'val1,"line1\nline2",val3',
    '"val,with,comma","val with ""quotes""",simple'
  ].join('\r\n');

  const parsed = parseCSV(sampleCSV, 'test.csv');
  assert.equal(parsed.header.length, 3);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].col2, 'line1\nline2');
  assert.equal(parsed.rows[1].col1, 'val,with,comma');
  assert.equal(parsed.rows[1].col2, 'val with "quotes"');
  console.log('  ✅ 1.1 Quoted multiline, commas, and escaped quotes parsed correctly');
}

// 1.2 UTF-8 BOM 除去
{
  const bomCSV = '\uFEFFcolA,colB\n1,2';
  const parsed = parseCSV(bomCSV, 'bom.csv');
  assert.equal(parsed.header[0], 'colA');
  assert.equal(parsed.rows[0].colA, '1');
  console.log('  ✅ 1.2 UTF-8 BOM stripped transparently');
}

// 1.3 異常系: 未閉鎖の引用符拒絶
{
  const badQuote = 'col1,col2\nval1,"unclosed quote';
  assert.throws(
    () => parseCSV(badQuote, 'badQuote.csv'),
    /Unclosed quote detected/,
    'Must fail on unclosed quote'
  );
  console.log('  ✅ 1.3 Rejected unclosed quote');
}

// 1.4 異常系: 重複ヘッダー拒絶
{
  const dupHeader = 'col1,col2,col1\n1,2,3';
  assert.throws(
    () => parseCSV(dupHeader, 'dupHeader.csv'),
    /Duplicate column header detected/,
    'Must fail on duplicate column header'
  );
  console.log('  ✅ 1.4 Rejected duplicate column header');
}

// 1.5 異常系: 列数不一致拒絶
{
  const colMismatch = 'col1,col2,col3\n1,2';
  assert.throws(
    () => parseCSV(colMismatch, 'colMismatch.csv'),
    /column count mismatch/,
    'Must fail on column count mismatch'
  );
  console.log('  ✅ 1.5 Rejected row column count mismatch');
}

// 1.6 異常系: 非クォートフィールド内の途中引用符拒絶
{
  const quoteInMiddle = 'col1,col2\nval1,val"with"quote';
  assert.throws(
    () => parseCSV(quoteInMiddle, 'quoteInMiddle.csv'),
    /Unexpected quote inside unquoted field/,
    'Must fail on quote inside unquoted field'
  );
  console.log('  ✅ 1.6 Rejected unexpected quote inside unquoted field');
}

// 1.7 異常系: 閉じ引用符直後の不正文字拒絶
{
  const badTrailing = 'col1,col2\n"val"bad,next';
  assert.throws(
    () => parseCSV(badTrailing, 'badTrailing.csv'),
    /Invalid character "b" after closing quote/,
    'Must fail on invalid character after closing quote'
  );
  console.log('  ✅ 1.7 Rejected invalid trailing character after closing quote');
}

// ─────────────────────────────────────────────────────────────
// 2. 現行本番データに対する検証（正常系）
// ─────────────────────────────────────────────────────────────
console.log('\n▶ [2/4] Testing Current Active District Data (Pass Case)...');
{
  const currentDataDir = path.join(REPO_ROOT, 'data');
  const report = runDistrictDataValidation(currentDataDir);
  assert.equal(report.pass, true, `Current data must pass: ${JSON.stringify(report.errors)}`);
  assert.equal(report.errors.length, 0);
  assert.ok(report.details.count.addressMaster > 0);
  assert.equal(report.details.count.addressMaster, report.details.count.boundaries);
  assert.equal(report.details.count.addressMaster, report.details.count.municipalityExpected);
  console.log(`  ✅ 2.1 Current data passed: ${report.details.count.addressMaster} items matched across Triad`);
}

// ─────────────────────────────────────────────────────────────
// 3. 合成フィクスチャによる各種異常系拒絶 & 受容テスト
// ─────────────────────────────────────────────────────────────
console.log('\n▶ [3/4] Testing Negative and Positive Edge Cases with Synthetic Fixtures...');

function createSyntheticFixture(overrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'district-gate-test-'));

  const addressCsv = overrides.addressCsv ?? [
    'rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code',
    '1,City-A,Town-1,35.0,136.0,10,20,1001',
    '2,City-A,Town-2,35.1,136.1,15,30,1002',
    '3,City-B,Town-3,35.2,136.2,20,40,1003'
  ].join('\n');

  const muniCsv = overrides.muniCsv ?? [
    'city_name,city_code,total_towns',
    'City-A,99001,2',
    'City-B,99002,1'
  ].join('\n');

  const boundariesGeo = overrides.boundariesGeo ?? JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.0, 35.0], [136.1, 35.0], [136.1, 35.1], [136.0, 35.0]]] },
        properties: { rowId: 1, city_name: 'City-A', town_name: 'Town-1' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.1, 35.1], [136.2, 35.1], [136.2, 35.2], [136.1, 35.1]]] },
        properties: { rowId: 2, city_name: 'City-A', town_name: 'Town-2' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.2, 35.2], [136.3, 35.2], [136.3, 35.3], [136.2, 35.2]]] },
        properties: { rowId: 3, city_name: 'City-B', town_name: 'Town-3' }
      }
    ]
  });

  const electionJson = overrides.electionJson ?? JSON.stringify({
    elections: [
      {
        electionId: 'E-01',
        municipalities: {
          'City-A': 50.0,
          'City-B': 60.0
        }
      }
    ]
  });

  const areaMappingJson = overrides.areaMappingJson ?? JSON.stringify([]);
  const storageLocationsJson = overrides.storageLocationsJson ?? JSON.stringify(['City-A', 'City-B']);

  if (overrides.skipAddress !== true) fs.writeFileSync(path.join(tmpDir, 'address_master.csv'), addressCsv, 'utf8');
  if (overrides.skipMuni !== true) fs.writeFileSync(path.join(tmpDir, 'municipality_master.csv'), muniCsv, 'utf8');
  if (overrides.skipBounds !== true) fs.writeFileSync(path.join(tmpDir, 'boundaries.geojson'), boundariesGeo, 'utf8');
  if (overrides.skipElection !== true) fs.writeFileSync(path.join(tmpDir, 'election_history.json'), electionJson, 'utf8');
  if (overrides.skipAreaMapping !== true) fs.writeFileSync(path.join(tmpDir, 'area_mapping.json'), areaMappingJson, 'utf8');
  if (overrides.skipStorage !== true) fs.writeFileSync(path.join(tmpDir, 'storage_locations.json'), storageLocationsJson, 'utf8');

  return tmpDir;
}

// 3.1 ファイル欠落拒絶
{
  const dir = createSyntheticFixture({ skipBounds: true });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('Required master file missing: boundaries.geojson')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.1 Missing file detected and rejected');
}

// 3.2 必須ヘッダー欠落拒絶 (latitude 欠落)
{
  const badAddr = 'rowId,city_name,town_name,longitude\n1,City-A,Town-1,136.0';
  const dir = createSyntheticFixture({ addressCsv: badAddr });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('missing required header: latitude')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.2 Missing required header (latitude) rejected');
}

// 3.3 座標形式異常拒絶 (NaN / 範囲外)
{
  const badCoord = [
    'rowId,city_name,town_name,latitude,longitude',
    '1,City-A,Town-1,INVALID_LAT,136.0'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: badCoord });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('invalid latitude')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.3 Invalid coordinate format rejected');
}

// 3.4 空白座標拒絶 (空文字 "" および 空白 "   ")
{
  const emptyCoord = [
    'rowId,city_name,town_name,latitude,longitude',
    '1,City-A,Town-1,"",136.0',
    '2,City-A,Town-2,35.1,"   "',
    '3,City-B,Town-3,35.2,136.2'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: emptyCoord });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('empty latitude')), 'Must detect empty latitude');
  assert.ok(rep.errors.some(e => e.includes('empty longitude')), 'Must detect empty longitude');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.4 Blank coordinates ("" and "   ") detected and rejected');
}

// 3.5 数値 0 の有効座標受容 (0.0, 0.0 は有効な非空座標として受容)
{
  const zeroCoordAddr = [
    'rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code',
    '1,City-A,Town-1,0,0,10,20,1001',
    '2,City-A,Town-2,0.0,0.0,15,30,1002',
    '3,City-B,Town-3,35.2,136.2,20,40,1003'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: zeroCoordAddr });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, true, `Valid coordinate 0 / 0.0 must be accepted: ${JSON.stringify(rep.errors)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.5 Valid numerical coordinate 0 / 0.0 accepted correctly');
}

// 3.6 全マスター空拒絶 (データ件数 0 件のケース)
{
  const emptyAddr = 'rowId,city_name,town_name,latitude,longitude\n';
  const emptyMuni = 'city_name,city_code,total_towns\n';
  const emptyGeo = JSON.stringify({ type: 'FeatureCollection', features: [] });
  const dir = createSyntheticFixture({
    addressCsv: emptyAddr,
    muniCsv: emptyMuni,
    boundariesGeo: emptyGeo
  });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('zero data rows') || e.includes('zero features')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.6 Empty master data (0 rows / 0 features) rejected');
}

// 3.7 無効 city_code 拒絶 (空、英字混入、4桁、7桁)
{
  // 3.7.1 英字混入
  const alphaMuni = 'city_name,city_code,total_towns\nCity-A,99A01,2\nCity-B,99002,1';
  const dir1 = createSyntheticFixture({ muniCsv: alphaMuni });
  const rep1 = runDistrictDataValidation(dir1);
  assert.equal(rep1.pass, false);
  assert.ok(rep1.errors.some(e => e.includes('invalid city_code "99A01"')));
  fs.rmSync(dir1, { recursive: true, force: true });

  // 3.7.2 4桁 (桁数不足)
  const shortMuni = 'city_name,city_code,total_towns\nCity-A,9901,2\nCity-B,99002,1';
  const dir2 = createSyntheticFixture({ muniCsv: shortMuni });
  const rep2 = runDistrictDataValidation(dir2);
  assert.equal(rep2.pass, false);
  assert.ok(rep2.errors.some(e => e.includes('invalid city_code "9901"')));
  fs.rmSync(dir2, { recursive: true, force: true });

  // 3.7.3 7桁 (桁数過大)
  const longMuni = 'city_name,city_code,total_towns\nCity-A,9900101,2\nCity-B,99002,1';
  const dir3 = createSyntheticFixture({ muniCsv: longMuni });
  const rep3 = runDistrictDataValidation(dir3);
  assert.equal(rep3.pass, false);
  assert.ok(rep3.errors.some(e => e.includes('invalid city_code "9900101"')));
  fs.rmSync(dir3, { recursive: true, force: true });

  console.log('  ✅ 3.7 Invalid city_code (alpha, 4-digit, 7-digit) rejected');
}

// 3.8 有効 city_code 受容 (5桁および6桁数字形式)
{
  const validMuni = 'city_name,city_code,total_towns\nCity-A,99001,2\nCity-B,990025,1';
  const dir = createSyntheticFixture({ muniCsv: validMuni });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, true, `Valid 5-digit and 6-digit city_code must be accepted: ${JSON.stringify(rep.errors)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.8 Valid 5-digit and 6-digit city_code accepted correctly');
}

// 3.9 全体件数 N 不一致拒絶 (Rule-01)
{
  const shortAddr = [
    'rowId,city_name,town_name,latitude,longitude',
    '1,City-A,Town-1,35.0,136.0',
    '2,City-A,Town-2,35.1,136.1'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: shortAddr });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('Rule-01 Total count mismatch')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.9 Total count mismatch rejected');
}

// 3.10 自治体別件数内訳不一致拒絶
{
  const skewedAddr = [
    'rowId,city_name,town_name,latitude,longitude',
    '1,City-A,Town-1,35.0,136.0',
    '2,City-B,Town-2,35.1,136.1',
    '3,City-B,Town-3,35.2,136.2'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: skewedAddr });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('Municipality town count mismatch')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.10 Per-municipality subtotal count mismatch rejected');
}

// 3.11 rowId 欠番拒絶 (Rule-02)
{
  const gapAddr = [
    'rowId,city_name,town_name,latitude,longitude',
    '1,City-A,Town-1,35.0,136.0',
    '2,City-A,Town-2,35.1,136.1',
    '4,City-B,Town-3,35.2,136.2'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: gapAddr });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('Rule-02 Sequence gap')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.11 rowId sequence gap rejected');
}

// 3.12 定義外自治体名の混入拒絶
{
  const unknownCityAddr = [
    'rowId,city_name,town_name,latitude,longitude',
    '1,City-A,Town-1,35.0,136.0',
    '2,City-A,Town-2,35.1,136.1',
    '3,Unknown-City-X,Town-3,35.2,136.2'
  ].join('\n');
  const dir = createSyntheticFixture({ addressCsv: unknownCityAddr });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('undefined city_name "Unknown-City-X"')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.12 Undefined city_name rejected');
}

// 3.13 選挙履歴キー不一致拒絶 (欠落 & 余剰)
{
  const missingEl = JSON.stringify({
    elections: [{ electionId: 'E-01', municipalities: { 'City-A': 50.0 } }]
  });
  const dir1 = createSyntheticFixture({ electionJson: missingEl });
  const rep1 = runDistrictDataValidation(dir1);
  assert.equal(rep1.pass, false);
  assert.ok(rep1.errors.some(e => e.includes('missing expected municipality "City-B"')));
  fs.rmSync(dir1, { recursive: true, force: true });

  const extraEl = JSON.stringify({
    elections: [{ electionId: 'E-01', municipalities: { 'City-A': 50.0, 'City-B': 60.0, 'City-Z': 70.0 } }]
  });
  const dir2 = createSyntheticFixture({ electionJson: extraEl });
  const rep2 = runDistrictDataValidation(dir2);
  assert.equal(rep2.pass, false);
  assert.ok(rep2.errors.some(e => e.includes('undefined municipality key "City-Z"')));
  fs.rmSync(dir2, { recursive: true, force: true });
  console.log('  ✅ 3.13 Election history municipality key mismatch rejected (both missing and extra)');
}

// 3.14 補助 JSON 形式不正拒絶 (area_mapping.json が配列でない)
{
  const notArray = JSON.stringify({ key: 'not an array' });
  const dir = createSyntheticFixture({ areaMappingJson: notArray });
  const rep = runDistrictDataValidation(dir);
  assert.equal(rep.pass, false);
  assert.ok(rep.errors.some(e => e.includes('area_mapping.json must be an array')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✅ 3.14 Auxiliary JSON non-array format rejected');
}

// 3.15 F-2 Data Contract Gate: (city_name, town_name) UNIQUE 検証 (同一自治体内の同名町域拒絶 & 異自治体間の同名町域受容)
{
  // (a) 同一 city_name (City-A) 内に同一 town_name (Town-1) が2件存在 -> Fail-Closed (pass: false & CLI exit 1)
  const dupTownAddr = [
    'rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code',
    '1,City-A,Town-1,35.0,136.0,10,20,1001',
    '2,City-A,Town-1,35.1,136.1,15,30,1002',
    '3,City-B,Town-3,35.2,136.2,20,40,1003'
  ].join('\n');
  const dupTownGeo = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.0, 35.0], [136.1, 35.0], [136.1, 35.1], [136.0, 35.0]]] },
        properties: { rowId: 1, city_name: 'City-A', town_name: 'Town-1' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.1, 35.1], [136.2, 35.1], [136.2, 35.2], [136.1, 35.1]]] },
        properties: { rowId: 2, city_name: 'City-A', town_name: 'Town-1' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.2, 35.2], [136.3, 35.2], [136.3, 35.3], [136.2, 35.2]]] },
        properties: { rowId: 3, city_name: 'City-B', town_name: 'Town-3' }
      }
    ]
  });
  const dupDir = createSyntheticFixture({ addressCsv: dupTownAddr, boundariesGeo: dupTownGeo });
  const repDup = runDistrictDataValidation(dupDir);
  assert.equal(repDup.pass, false, 'Duplicate (city_name, town_name) within same city_name must fail');
  assert.ok(
    repDup.errors.some(e => e.includes('duplicate (city_name, town_name) pair ("City-A", "Town-1")')),
    `Expected duplicate (city_name, town_name) error, got: ${JSON.stringify(repDup.errors)}`
  );
  try {
    execSync(`node ${SCRIPT_PATH} --data-dir "${dupDir}"`, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('CLI must exit with code 1 when duplicate (city_name, town_name) exists');
  } catch (err) {
    assert.equal(err.status, 1, 'CLI exit code must be 1 on duplicate (city_name, town_name)');
  } finally {
    fs.rmSync(dupDir, { recursive: true, force: true });
  }

  // (b) 異なる city_name (City-A と City-B) に同じ town_name (Town-1) が存在 -> 正常受容 (pass: true)
  const crossCitySameTownAddr = [
    'rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code',
    '1,City-A,Town-1,35.0,136.0,10,20,1001',
    '2,City-A,Town-2,35.1,136.1,15,30,1002',
    '3,City-B,Town-1,35.2,136.2,20,40,1003'
  ].join('\n');
  const crossCitySameTownGeo = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.0, 35.0], [136.1, 35.0], [136.1, 35.1], [136.0, 35.0]]] },
        properties: { rowId: 1, city_name: 'City-A', town_name: 'Town-1' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.1, 35.1], [136.2, 35.1], [136.2, 35.2], [136.1, 35.1]]] },
        properties: { rowId: 2, city_name: 'City-A', town_name: 'Town-2' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.2, 35.2], [136.3, 35.2], [136.3, 35.3], [136.2, 35.2]]] },
        properties: { rowId: 3, city_name: 'City-B', town_name: 'Town-1' }
      }
    ]
  });
  const crossDir = createSyntheticFixture({ addressCsv: crossCitySameTownAddr, boundariesGeo: crossCitySameTownGeo });
  const repCross = runDistrictDataValidation(crossDir);
  assert.equal(repCross.pass, true, `Same town_name across different cities must pass: ${JSON.stringify(repCross.errors)}`);
  fs.rmSync(crossDir, { recursive: true, force: true });
  console.log('  ✅ 3.15 F-2 (city_name, town_name) UNIQUE gate verified (same-city duplicate rejected with exit 1; cross-city accepted)');
}

// 3.16 Human-Facing Selection Order Contract: storage_locations.json (duplicate / missing / extra / order mismatch) & address_master municipality order
{
  // (a) duplicate in storage_locations.json
  const dupStorageDir = createSyntheticFixture({
    storageLocationsJson: JSON.stringify(['City-A', 'City-A', 'City-B'])
  });
  const repDupStorage = runDistrictDataValidation(dupStorageDir);
  assert.equal(repDupStorage.pass, false, 'Duplicate in storage_locations.json must fail');
  assert.ok(repDupStorage.errors.some(e => e.includes('storage_locations.json contains duplicate municipality "City-A"')));
  fs.rmSync(dupStorageDir, { recursive: true, force: true });

  // (b) missing in storage_locations.json
  const missingStorageDir = createSyntheticFixture({
    storageLocationsJson: JSON.stringify(['City-A'])
  });
  const repMissingStorage = runDistrictDataValidation(missingStorageDir);
  assert.equal(repMissingStorage.pass, false, 'Missing municipality in storage_locations.json must fail');
  assert.ok(repMissingStorage.errors.some(e => e.includes('storage_locations.json missing expected municipality "City-B"')));
  fs.rmSync(missingStorageDir, { recursive: true, force: true });

  // (c) extra in storage_locations.json
  const extraStorageDir = createSyntheticFixture({
    storageLocationsJson: JSON.stringify(['City-A', 'City-B', 'Neighbor-C'])
  });
  const repExtraStorage = runDistrictDataValidation(extraStorageDir);
  assert.equal(repExtraStorage.pass, false, 'Extra municipality in storage_locations.json must fail');
  assert.ok(repExtraStorage.errors.some(e => e.includes('storage_locations.json has undefined extra municipality "Neighbor-C"')));
  fs.rmSync(extraStorageDir, { recursive: true, force: true });

  // (d) order mismatch in storage_locations.json (set matches, order reversed)
  const wrongOrderStorageDir = createSyntheticFixture({
    storageLocationsJson: JSON.stringify(['City-B', 'City-A'])
  });
  const repWrongOrderStorage = runDistrictDataValidation(wrongOrderStorageDir);
  assert.equal(repWrongOrderStorage.pass, false, 'Order mismatch in storage_locations.json must fail');
  assert.ok(repWrongOrderStorage.errors.some(e => e.includes('storage_locations.json order mismatch at index 0: got "City-B", expected "City-A"')));
  fs.rmSync(wrongOrderStorageDir, { recursive: true, force: true });

  // (e) order(unique(address_master.city_name)) != order(municipality_master.city_name)
  const reversedMuniCsv = [
    'city_name,city_code,total_towns',
    'City-B,99002,1',
    'City-A,99001,2'
  ].join('\n');
  const addrMuniOrderMismatchDir = createSyntheticFixture({
    muniCsv: reversedMuniCsv,
    storageLocationsJson: JSON.stringify(['City-B', 'City-A'])
  });
  const repAddrMuniOrder = runDistrictDataValidation(addrMuniOrderMismatchDir);
  assert.equal(repAddrMuniOrder.pass, false, 'Municipality appearance order mismatch between address_master and municipality_master must fail');
  assert.ok(repAddrMuniOrder.errors.some(e => e.includes('address_master.csv municipality appearance order mismatch at index 0')));
  fs.rmSync(addrMuniOrderMismatchDir, { recursive: true, force: true });

  // (f) non-contiguous interleaved city blocks in address_master.csv
  const interleavedAddrCsv = [
    'rowId,city_name,town_name,latitude,longitude,households,population,e_stat_code',
    '1,City-A,Town-1,35.0,136.0,10,20,1001',
    '2,City-B,Town-3,35.2,136.2,20,40,1003',
    '3,City-A,Town-2,35.1,136.1,15,30,1002'
  ].join('\n');
  const interleavedBoundsGeo = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.0, 35.0], [136.1, 35.0], [136.1, 35.1], [136.0, 35.0]]] },
        properties: { rowId: 1, city_name: 'City-A', town_name: 'Town-1' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.2, 35.2], [136.3, 35.2], [136.3, 35.3], [136.2, 35.2]]] },
        properties: { rowId: 2, city_name: 'City-B', town_name: 'Town-3' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[136.1, 35.1], [136.2, 35.1], [136.2, 35.2], [136.1, 35.1]]] },
        properties: { rowId: 3, city_name: 'City-A', town_name: 'Town-2' }
      }
    ]
  });
  const interleavedDir = createSyntheticFixture({
    addressCsv: interleavedAddrCsv,
    boundariesGeo: interleavedBoundsGeo
  });
  const repInterleaved = runDistrictDataValidation(interleavedDir);
  assert.equal(repInterleaved.pass, false, 'Interleaved municipality rows in address_master.csv must fail');
  assert.ok(repInterleaved.errors.some(e => e.includes('re-appeared out of contiguous order')));
  fs.rmSync(interleavedDir, { recursive: true, force: true });

  console.log('  ✅ 3.16 Storage locations (duplicate / missing / extra / order mismatch) & address_master municipality order gates verified');
}

// 3.17 RFC 4180 Canonical Storage Locations Generator (scripts/generate-storage-locations.mjs)
{
  const genTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-storage-test-'));
  try {
    // (a) Reordered columns + BOM + RFC 4180 quotes
    const customMuniCsv = '\uFEFFcity_code,"city_name",total_towns\r\n99001,"City-Alpha",2\r\n99002,"City-Beta",3\r\n';
    const inFile = path.join(genTmpDir, 'municipality_master.csv');
    const outFile = path.join(genTmpDir, 'storage_locations.json');
    fs.writeFileSync(inFile, customMuniCsv, 'utf8');

    const generated = generateStorageLocations({ inputPath: inFile, outputPath: outFile });
    assert.deepEqual(generated, ['City-Alpha', 'City-Beta']);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.deepEqual(written, ['City-Alpha', 'City-Beta']);

    // (b) Missing "city_name" header -> Fail-Closed
    fs.writeFileSync(inFile, 'priority,name\n1,City-Alpha\n', 'utf8');
    assert.throws(
      () => generateStorageLocations({ inputPath: inFile, outputPath: outFile }),
      /Required header "city_name" is missing/
    );

    // (c) Duplicate city_name -> Fail-Closed
    fs.writeFileSync(inFile, 'city_name,city_code,total_towns\nCity-Alpha,99001,1\nCity-Alpha,99002,1\n', 'utf8');
    assert.throws(
      () => generateStorageLocations({ inputPath: inFile, outputPath: outFile }),
      /Duplicate city_name "City-Alpha"/
    );

    // (d) Zero data rows -> Fail-Closed
    fs.writeFileSync(inFile, 'city_name,city_code,total_towns\n', 'utf8');
    assert.throws(
      () => generateStorageLocations({ inputPath: inFile, outputPath: outFile }),
      /has zero data rows/
    );

    // (e) Numeric-only city_code accidentally in city_name column -> Fail-Closed
    fs.writeFileSync(inFile, 'city_name,city_code,total_towns\n99001,99001,1\n', 'utf8');
    assert.throws(
      () => generateStorageLocations({ inputPath: inFile, outputPath: outFile }),
      /Invalid numeric-only city_name "99001"/
    );

    console.log('  ✅ 3.17 RFC 4180 generate-storage-locations.mjs (header resolution, BOM, quotes, and Fail-Closed negative cases) verified');
  } finally {
    fs.rmSync(genTmpDir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────
// 4. CLI 実行によるプロセス終了コード検証 (Fail-Closed)
// ─────────────────────────────────────────────────────────────
console.log('\n▶ [4/5] Testing CLI Process Exit Code (Fail-Closed Execution)...');
{
  // 4.1 引数なし CLI: デフォルト data/ ディレクトリの検証成功 (exit 0)
  try {
    const stdout = execSync(`node ${SCRIPT_PATH}`, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.ok(stdout.includes('ALL CHECKS PASSED PERFECTLY'));
    console.log('  ✅ 4.1 CLI default execution exited with code 0 (PASS)');
  } catch (err) {
    assert.fail(`CLI execution on default data must exit with code 0: ${err.message}`);
  }

  // 4.2 --data-dir による異常系ディレクトリ指定: exit code 1 で停止
  const badDir = createSyntheticFixture({ skipBounds: true });
  try {
    execSync(`node ${SCRIPT_PATH} --data-dir "${badDir}"`, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('CLI must fail on bad directory');
  } catch (err) {
    assert.equal(err.status, 1, 'Process exit code must be 1 on failure');
    assert.ok(err.stderr.includes('[Hard Stop]') || err.stdout.includes('[Hard Stop]'));
    console.log('  ✅ 4.2 CLI with --data-dir on invalid fixture exited with code 1 (Fail-Closed verified)');
  } finally {
    fs.rmSync(badDir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────
// 5. 4-Layer Master Compiler 22 Synthetic Fixture Gate Cases
// ─────────────────────────────────────────────────────────────
console.log('\n▶ [5/5] Testing 4-Layer Master Compiler (22 Synthetic Fixture Gate Cases)...');
{
  const pyRunner = path.join(os.tmpdir(), `run_stage2b_22gates_${process.pid}.py`);
  const pyCode = `
import os, sys, csv, json, math, struct, shutil, tempfile, subprocess
sys.dont_write_bytecode = True
import importlib.util

REPO_ROOT = ${JSON.stringify(REPO_ROOT)}
BDM_PATH = os.path.join(REPO_ROOT, "scripts", "build-district-master.py")
SORT_PATH = os.path.join(REPO_ROOT, "scripts", "sort-address-master.py")

spec = importlib.util.spec_from_file_location("bdm", BDM_PATH)
bdm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bdm)

def write_synthetic_shapefile_pair(base_path, records):
    """
    Write minimal valid ESRI Shapefile (.shp) and dBASE III (.dbf) pair for Polygon records.
    Each record in records:
      {
        "CITY": "01", "S_NAME": "...", "KEY_CODE": "...",
        "KIHON1": "0010", "KIHON2": "01", "KIHON3": "01",
        "KIGO_E": "", "SETAI": 100, "JINKO": 250,
        "X_CODE": 135.0, "Y_CODE": 35.0,
        "rings": [[(lon, lat), ...]]
      }
    """
    # 1. Write .dbf
    fields = [
        ("CITY", "C", 8, 0),
        ("S_NAME", "C", 40, 0),
        ("KEY_CODE", "C", 20, 0),
        ("KIHON1", "C", 10, 0),
        ("KIHON2", "C", 10, 0),
        ("KIHON3", "C", 10, 0),
        ("KIGO_E", "C", 6, 0),
        ("SETAI", "N", 10, 0),
        ("JINKO", "N", 10, 0),
        ("X_CODE", "N", 14, 6),
        ("Y_CODE", "N", 14, 6),
    ]
    num_records = len(records)
    header_len = 32 + 32 * len(fields) + 1
    record_len = 1 + sum(f[2] for f in fields)
    with open(base_path + ".dbf", "wb") as f:
        f.write(struct.pack("<BBBBIHH20x", 3, 126, 10, 27, num_records, header_len, record_len))
        for name, ftype, flen, fdec in fields:
            name_bytes = name.encode("ascii").ljust(11, b"\\x00")
            f.write(struct.pack("<11sc4xBB14x", name_bytes, ftype.encode("ascii"), flen, fdec))
        f.write(b"\\x0d")
        for rec in records:
            f.write(b" ")
            for name, ftype, flen, fdec in fields:
                val = rec.get(name, "")
                if ftype == "N":
                    if val == "" or val is None:
                        s = "".rjust(flen, " ")
                    elif fdec > 0:
                        s = f"{float(val):.{fdec}f}".rjust(flen, " ")
                    else:
                        s = f"{int(val)}".rjust(flen, " ")
                    f.write(s.encode("ascii")[:flen])
                else:
                    bval = str(val).encode("utf-8")[:flen]
                    f.write(bval.ljust(flen, b" "))
        f.write(b"\\x1a")

    # 2. Write .shp
    rec_blobs = []
    all_xs, all_ys = [135.0], [35.0]
    for idx, rec in enumerate(records, start=1):
        rings = rec.get("rings") or []
        if not rings:
            content = struct.pack("<i", 0)
        else:
            parts = []
            pts = []
            for r in rings:
                parts.append(len(pts))
                ring_pts = list(r)
                if ring_pts[0] != ring_pts[-1]:
                    ring_pts.append(ring_pts[0])
                pts.extend(ring_pts)
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            all_xs.extend(xs)
            all_ys.extend(ys)
            bbox = struct.pack("<4d", min(xs), min(ys), max(xs), max(ys))
            parts_bin = struct.pack(f"<{len(parts)}i", *parts)
            pts_bin = b"".join(struct.pack("<2d", x, y) for x, y in pts)
            content = struct.pack("<i", 5) + bbox + struct.pack("<2i", len(parts), len(pts)) + parts_bin + pts_bin
        rec_header = struct.pack(">2i", idx, len(content) // 2)
        rec_blobs.append(rec_header + content)

    total_len_words = (100 + sum(len(b) for b in rec_blobs)) // 2
    with open(base_path + ".shp", "wb") as f:
        f.write(struct.pack(">6i", 9994, 0, 0, 0, 0, 0))
        f.write(struct.pack(">i", total_len_words))
        f.write(struct.pack("<2i", 1000, 5))
        f.write(struct.pack("<8d", min(all_xs), min(all_ys), max(all_xs), max(all_ys), 0.0, 0.0, 0.0, 0.0))
        for b in rec_blobs:
            f.write(b)

def make_rect(lon0, lat0, lon1, lat1):
    return [(lon0, lat0), (lon1, lat0), (lon1, lat1), (lon0, lat1), (lon0, lat0)]

# 1. KIGO_E E1/E2/E3 row-order independence
e_rows_order1 = [
    ({"KEY_CODE": "991010010", "PREF": "99", "CITY": "101", "S_NAME": "北町", "KIHON1": "0010", "KIHON2": "00", "KIHON3": "00", "KIGO_E": "E1", "SETAI": "320", "JINKO": "740", "X_CODE": "135.001", "Y_CODE": "35.001"}, {"rings": [make_rect(135.0, 35.0, 135.002, 35.002)]}),
    ({"KEY_CODE": "991010010", "PREF": "99", "CITY": "101", "S_NAME": "北町", "KIHON1": "0010", "KIHON2": "00", "KIHON3": "00", "KIGO_E": "E2", "SETAI": "0", "JINKO": "0", "X_CODE": "135.005", "Y_CODE": "35.005"}, {"rings": [make_rect(135.004, 35.004, 135.006, 35.006)]}),
    ({"KEY_CODE": "991010010", "PREF": "99", "CITY": "101", "S_NAME": "北町", "KIHON1": "0010", "KIHON2": "00", "KIHON3": "00", "KIGO_E": "E3", "SETAI": "", "JINKO": "", "X_CODE": "135.009", "Y_CODE": "35.009"}, {"rings": [make_rect(135.008, 35.008, 135.010, 35.010)]}),
]
e_rows_order2 = [e_rows_order1[2], e_rows_order1[1], e_rows_order1[0]]
norm1 = bdm.normalize_kigo_e_group("991010010", e_rows_order1, "r2ka99101.dbf", {})
norm2 = bdm.normalize_kigo_e_group("991010010", e_rows_order2, "r2ka99101.dbf", {})
assert norm1["setai"] == 320 and norm1["jinko"] == 740, f"Expected E1 stats 320/740, got {norm1}"
assert norm1 == norm2, "KIGO_E normalization must be 100% row-order independent"
assert len(norm1["rings"]) == 3, "All E1/E2/E3 rings must be preserved"
print("  ✅ 5.1 KIGO_E E1/E2/E3 row-order independence verified")

# 6. Rook point-touch non-adjacency & 7. IEEE-754 micro-gap normalization & 8. Artificial bridge prohibition
lat0_rad = math.radians(35.0)
b_topo_units = [
    # Unit 0 and Unit 1 touch only at a single corner point (135.001, 35.001) -> NOT Rook adjacent
    {"key_code": "991010001", "setai": 250, "jinko": 500, "x_code": 135.0005, "y_code": 35.0005, "rings": [make_rect(135.000, 35.000, 135.001, 35.001)]},
    {"key_code": "991010002", "setai": 250, "jinko": 500, "x_code": 135.0015, "y_code": 35.0015, "rings": [make_rect(135.001, 35.001, 135.002, 35.002)]},
    # Unit 2 shares an edge with Unit 0 with a 1e-14 IEEE-754 micro-gap -> normalized at round(coord, 9) -> Rook adjacent
    {"key_code": "991010003", "setai": 250, "jinko": 500, "x_code": 135.0005, "y_code": 35.0015, "rings": [[
        (135.000 + 1e-14, 35.001 - 1e-14),
        (135.001 - 1e-14, 35.001 + 1e-14),
        (135.001, 35.002),
        (135.000, 35.002),
        (135.000 + 1e-14, 35.001 - 1e-14)
    ]]},
    # Unit 3 is separated by a real 5m gap (0.00005 deg) -> NOT Rook adjacent (no artificial bridge)
    {"key_code": "991010004", "setai": 250, "jinko": 500, "x_code": 135.005, "y_code": 35.0005, "rings": [make_rect(135.00105, 35.000, 135.00205, 35.001)]},
]
adj_topo, slen_topo = bdm.build_canonical_rook_graph(b_topo_units, lat0_rad)
assert 1 not in adj_topo[0], "Point-touch only (length == 0) must NOT be Rook adjacent"
print("  ✅ 5.6 Rook point-touch non-adjacency verified")
assert 2 in adj_topo[0] and slen_topo[(0, 2)] > 50.0, "IEEE-754 1e-14 deg micro-gap must normalize to shared Rook edge at 9 decimals"
print("  ✅ 5.7 IEEE-754 micro-gap normalization (round(coord, 9)) verified")
assert len(adj_topo[3]) == 0, "Separated polygon must NOT be connected by any artificial bridge"
print("  ✅ 5.8 Artificial bridge prohibition verified")

# 9 & 10. 801..999 D1 threshold & exact 399.999 / 400.000 boundary
pt_meta = {
    "layer1_order": 1, "sort_key": ("カソウシ", "キタマチ", "00", "北町", "キタマチ"),
    "city_code": "99101", "city_name": "架空市", "parent_town_code": "991010001000",
    "raw_town_name": "北町", "resolved_reading": "キタマチ", "parent_town_name": "北町",
    "mlit_lat": 35.0, "mlit_lon": 135.0
}
a_900 = [{"key_code": "991010010", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 900, "jinko": 1800, "rings": []}]
# Step 1: 2 disconnected islands of 450 each, only 100m apart (D1 ~ 50m < 400m) -> still splits into K=2!
b_step1 = [
    {"key_code": "9910100101", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 450, "jinko": 900, "x_code": 135.0005, "y_code": 35.0005, "rings": [make_rect(135.000, 35.000, 135.001, 35.001)]},
    {"key_code": "9910100102", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 450, "jinko": 900, "x_code": 135.0025, "y_code": 35.0005, "rings": [make_rect(135.002, 35.000, 135.003, 35.001)]},
]
res_step1 = bdm.build_distribution_areas_for_parent_town(pt_meta, a_900, b_step1, {}, [])
assert len(res_step1) == 2 and res_step1[0]["matching_evidence"]["pattern_decision"] == "ODG01_STEP1_MULTI_MAJOR_ISLANDS_K2"
print("  ✅ 5.9 801..999 Step 1 (multi-island >=200) & Step 2 D1 decision verified")

# Step 2 exact boundary: D1 = 399.999 m -> K=1 vs D1 = 400.000 m -> K=2
# Find H0, H1 (with H0 + H1 = 900) and d_m such that H1 * d_m / 900 is 399.9994 vs 400.0001
# Take u0 at (35.000000, 135.000000) and u1 at (35.007195, 135.000000):
# dist_m(35.0, 135.0, 35.007195, 135.0) = 6378137 * radians(0.007195) = 800.9450787... m
# If H0 = 451, H1 = 449 (total 900): D1 = 449 * 800.9450787 / 900 = 399.582...
# Let's search for a 6-decimal (lat1, lon1) with H0=450, H1=450 (so D1 = 0.5 * dist_m):
# We want 0.5 * dist_m in [399.999, 400.0) and in [400.000, 400.001)!
d1_below_pt = None
d1_above_pt = None
for dlat_micro in range(7180, 7205):
    for dlon_micro in range(0, 500):
        lat1 = round(35.0 + dlat_micro * 1e-6, 6)
        lon1 = round(135.0 + dlon_micro * 1e-6, 6)
        l0 = math.radians((35.0 + lat1) / 2.0)
        dm = bdm.dist_m(35.0, 135.0, lat1, lon1, l0)
        d1_val = 0.5 * dm
        if d1_below_pt is None and 399.999 <= d1_val < 400.000:
            d1_below_pt = (lat1, lon1, d1_val)
        if d1_above_pt is None and 400.000 <= d1_val < 400.001:
            d1_above_pt = (lat1, lon1, d1_val)
        if d1_below_pt and d1_above_pt:
            break
    if d1_below_pt and d1_above_pt:
        break

assert d1_below_pt is not None and d1_above_pt is not None
b_399 = [
    {"key_code": "9910100101", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 450, "jinko": 900, "x_code": 135.0, "y_code": 35.0, "rings": [make_rect(135.0, 35.0, 135.005, 35.004)]},
    {"key_code": "9910100102", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 450, "jinko": 900, "x_code": d1_below_pt[1], "y_code": d1_below_pt[0], "rings": [make_rect(135.0, 35.004, 135.005, 35.008)]},
]
b_400 = [
    {"key_code": "9910100101", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 450, "jinko": 900, "x_code": 135.0, "y_code": 35.0, "rings": [make_rect(135.0, 35.0, 135.005, 35.004)]},
    {"key_code": "9910100102", "city_code": "99101", "s_name": "北町", "kihon1": "0010", "kihon2": "00", "setai": 450, "jinko": 900, "x_code": d1_above_pt[1], "y_code": d1_above_pt[0], "rings": [make_rect(135.0, 35.004, 135.005, 35.008)]},
]
res_399 = bdm.build_distribution_areas_for_parent_town(pt_meta, a_900, b_399, {}, [])
res_400 = bdm.build_distribution_areas_for_parent_town(pt_meta, a_900, b_400, {}, [])
assert len(res_399) == 1 and res_399[0]["pattern"] == "A_NORMAL", f"D1={d1_below_pt[2]} (<400.000) must stay K=1"
assert len(res_400) == 2 and res_400[0]["pattern"] == "B_SPLIT", f"D1={d1_above_pt[2]} (>=400.000) must split K=2"
print(f"  ✅ 5.10 D1 399.999 ({d1_below_pt[2]:.6f}m -> K=1) vs 400.000 ({d1_above_pt[2]:.6f}m -> K=2) boundary verified")

# 11. Seed tie smallest KEY_CODE & 15. Medoid smallest KEY_CODE tie
tie_units = [
    {"key_code": "991010099", "setai": 100, "jinko": 200, "x_code": 135.000, "y_code": 35.010},
    {"key_code": "991010001", "setai": 100, "jinko": 200, "x_code": 135.000, "y_code": 35.010},
    {"key_code": "991010050", "setai": 100, "jinko": 200, "x_code": 135.005, "y_code": 35.000},
    {"key_code": "991010002", "setai": 100, "jinko": 200, "x_code": 135.005, "y_code": 35.000},
]
s1 = bdm.select_seed1_index([0, 1, 2, 3], tie_units)
assert tie_units[s1]["key_code"] == "991010001", "Seed 1 tie-break must pick smallest KEY_CODE"
s2 = bdm.select_farthest_first_seed_index([0, 1, 2, 3], [s1], tie_units, lat0_rad)
assert tie_units[s2]["key_code"] == "991010002", "Seed 2..K tie-break must pick smallest KEY_CODE"
print("  ✅ 5.11 Seed 1 & Seed 2..K smallest KEY_CODE tie-break verified")

med_idx, _, _ = bdm.compute_medoid_and_dist([0, 1], tie_units, lat0_rad)
assert tie_units[med_idx]["key_code"] == "991010001", "Medoid tie-break must pick smallest KEY_CODE"
print("  ✅ 5.15 Medoid smallest KEY_CODE tie-break verified")

# 12. <200 independent cluster prohibition (minor island absorption & K decrement)
a_1050 = [{"key_code": "991010020", "city_code": "99101", "s_name": "北町", "kihon1": "0020", "kihon2": "00", "setai": 1050, "jinko": 2100, "rings": []}]
b_minor_island = [
    # Main island: 2 connected units of 480 and 470 = 950
    {"key_code": "9910100201", "city_code": "99101", "s_name": "北町", "kihon1": "0020", "kihon2": "00", "setai": 480, "jinko": 960, "x_code": 135.0005, "y_code": 35.0005, "rings": [make_rect(135.000, 35.000, 135.001, 35.001)]},
    {"key_code": "9910100202", "city_code": "99101", "s_name": "北町", "kihon1": "0020", "kihon2": "00", "setai": 470, "jinko": 940, "x_code": 135.0015, "y_code": 35.0005, "rings": [make_rect(135.001, 35.000, 135.002, 35.001)]},
    # Disconnected minor island: 100 households (<200) -> MUST be absorbed into nearest major cluster, never left as <200 cluster
    {"key_code": "9910100203", "city_code": "99101", "s_name": "北町", "kihon1": "0020", "kihon2": "00", "setai": 100, "jinko": 200, "x_code": 135.0035, "y_code": 35.0005, "rings": [make_rect(135.003, 35.000, 135.004, 35.001)]},
]
res_minor = bdm.build_distribution_areas_for_parent_town(pt_meta, a_1050, b_minor_island, {}, [])
assert all(r["households"] >= 200 for r in res_minor), "<200 independent cluster is strictly prohibited"
assert any(r["island_absorption"] for r in res_minor), "Absorbed <200 island must set island_absorption=True"
print("  ✅ 5.12 <200 independent cluster prohibition & minor island absorption verified")

# 14. ATOMIC_UNIT_TOO_LARGE (>700 single B unit)
a_850 = [{"key_code": "991010030", "city_code": "99101", "s_name": "北町", "kihon1": "0030", "kihon2": "00", "setai": 850, "jinko": 1700, "rings": []}]
b_850_single = [
    {"key_code": "9910100301", "city_code": "99101", "s_name": "北町", "kihon1": "0030", "kihon2": "00", "setai": 850, "jinko": 1700, "x_code": 135.0005, "y_code": 35.0005, "rings": [make_rect(135.000, 35.000, 135.001, 35.001)]}
]
res_large_unit = bdm.build_distribution_areas_for_parent_town(pt_meta, a_850, b_850_single, {}, [])
assert len(res_large_unit) == 1
assert res_large_unit[0]["single_large_basic_unit"] is True
assert res_large_unit[0]["granularity_exception"] == "ATOMIC_UNIT_TOO_LARGE"
print("  ✅ 5.14 ATOMIC_UNIT_TOO_LARGE flag on >700 single B unit verified")

# 16. PIP Gate (medoid outside polygon / inside hole falls back to deterministic interior point)
# C-shaped polygon whose medoid point (135.005, 35.005) lies outside the polygon (in the concave bay)
c_ring = [
    (135.000, 35.000), (135.010, 35.000), (135.010, 35.002),
    (135.002, 35.002), (135.002, 35.008), (135.010, 35.008),
    (135.010, 35.010), (135.000, 35.010), (135.000, 35.000)
]
b_pip_units = [
    {"key_code": "9910100401", "setai": 500, "jinko": 1000, "x_code": 135.006, "y_code": 35.005, "rings": [c_ring]}
]
rep_lat, rep_lon, c_src, c_val, u_rings = bdm.derive_cluster_representative_point([0], b_pip_units, lat0_rad)
assert c_src == "b_series_medoid_pip_fallback_pos" and c_val == "PASS_EVEN_ODD_PIP"
assert bdm.point_in_polygon_geometry(rep_lon, rep_lat, u_rings) is True
print("  ✅ 5.16 PIP Gate fallback to deterministic interior point when medoid is outside polygon verified")

# 2. A/B conservation failure -> Fail-Closed HARD STOP
a_mismatch = [{"key_code": "991010050", "city_code": "99101", "s_name": "北町", "kihon1": "0050", "kihon2": "00", "setai": 500, "jinko": 1000, "rings": []}]
b_mismatch = [{"key_code": "9910100501", "city_code": "99101", "s_name": "北町", "kihon1": "0050", "kihon2": "00", "setai": 499, "jinko": 1000, "x_code": 135.0, "y_code": 35.0, "rings": [make_rect(135.0, 35.0, 135.001, 35.001)]}]
caught_ab = False
try:
    bdm.build_distribution_areas_for_parent_town(pt_meta, a_mismatch, b_mismatch, {}, [])
except SystemExit as e:
    caught_ab = "Gate 2 A/B Conservation" in str(e)
assert caught_ab, "A/B demographic mismatch must trigger Fail-Closed SystemExit"
print("  ✅ 5.2 A/B conservation (diff == 0 pass & diff != 0 Fail-Closed HARD STOP) verified")

# Full End-to-End 4-Layer Compiler Synthetic Fixture covering items 3, 4, 5, 13, 17, 18, 19, 20, 21, 22
tmp_root = tempfile.mkdtemp(prefix="stage2b_e2e_")
try:
    # We create 4 parent towns in City "架空市" (99101):
    # Town 1: "あおば町" (1:1 normal Pattern A, H=350 -> e_stat_code populated)
    # Town 2: "いずみ町" (1:N merged Pattern A, 2 A-series areas H=200+250=450 -> e_stat_code blank)
    # Town 3: "うみべ町" (Pattern B split, H=1100 across 2 B-series KEY_CODEs sharing the SAME KIHON1/KIHON2/KIHON3 (same K_AREA!) + 1 zero-household B-unit -> splits into K=2 in 400..700 normal band, zero-household post-attached without changing rep point or stats, e_stat_code blank, numbered north->south (1),(2))
    # Town 4: "えきまえ町" (Pattern C 1:0 unmatched town, even though B-series has a matching S_NAME row -> households/population/e_stat_code blank, geometry:null, geometry_status=UNAVAILABLE_OFFICIAL_POLYGON, B S_NAME recorded only in provenance)
    ref_csv = os.path.join(tmp_root, "mlit_ref.csv")
    with open(ref_csv, "w", encoding="utf-8", newline="\\n") as f:
        w = csv.writer(f, lineterminator="\\n")
        w.writerow(["都道府県コード", "都道府県名", "市区町村コード", "市区町村名", "大字町丁目コード", "大字町丁目名", "緯度", "経度", "原典資料コード", "大字・字・丁目区分コード"])
        w.writerow(["99", "架空県", "99101", "架空市", "991010001000", "あおば町", "35.001000", "135.001000", "0", "1"])
        w.writerow(["99", "架空県", "99101", "架空市", "991010002000", "いずみ町", "35.002000", "135.002000", "0", "1"])
        w.writerow(["99", "架空県", "99101", "架空市", "991010003000", "うみべ町", "35.003000", "135.003000", "0", "1"])
        w.writerow(["99", "架空県", "99101", "架空市", "991010004000", "えきまえ町", "35.004000", "135.004000", "0", "1"])

    abr_csv = os.path.join(tmp_root, "abr.csv")
    with open(abr_csv, "w", encoding="utf-8", newline="\\n") as f:
        w = csv.writer(f, lineterminator="\\n")
        w.writerow(["lg_code", "city_name", "city_kana", "machiaza_type", "oaza_cho", "oaza_cho_kana", "chome", "chome_number", "koaza", "koaza_kana"])
        w.writerow(["991019", "架空市", "カソウシ", "1", "あおば町", "アオバチョウ", "", "", "", ""])
        w.writerow(["991019", "架空市", "カソウシ", "1", "いずみ町", "イズミチョウ", "", "", "", ""])
        w.writerow(["991019", "架空市", "カソウシ", "1", "うみべ町", "ウミベチョウ", "", "", "", ""])
        w.writerow(["991019", "架空市", "カソウシ", "1", "えきまえ町", "エキマエチョウ", "", "", "", ""])

    estat_reconcil = os.path.join(tmp_root, "estat_reconcil.json")
    with open(estat_reconcil, "w", encoding="utf-8") as f:
        json.dump({
            "991010021": {"reconciled_town_name": "いずみ町", "skeleton_town_name": "いずみ町", "city_code": "99101"},
            "991010022": {"reconciled_town_name": "いずみ町", "skeleton_town_name": "いずみ町", "city_code": "99101"},
            "99101:えきまえ町": {
                "city_code": "99101",
                "skeleton_town_name": "えきまえ町",
                "reconciled_status": "no_independent_estat_small_area",
                "source_provider": "総務省統計局",
                "source_document_title": "令和2年国勢調査 小地域境界データ",
                "source_url": "https://www.e-stat.go.jp/",
                "source_section_or_page": "えきまえ町",
                "verified_date": "2026-10-27"
            }
        }, f, ensure_ascii=False)

    estat_a_dir = os.path.join(tmp_root, "estat_a", "99101")
    estat_b_dir = os.path.join(tmp_root, "estat_b", "99101")
    os.makedirs(estat_a_dir, exist_ok=True)
    os.makedirs(estat_b_dir, exist_ok=True)

    a_records = [
        {"CITY": "101", "S_NAME": "あおば町", "KEY_CODE": "991010010", "KIHON1": "0010", "KIHON2": "00", "KIHON3": "00", "KIGO_E": "", "SETAI": 350, "JINKO": 700, "X_CODE": 135.001, "Y_CODE": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        {"CITY": "101", "S_NAME": "いずみ町北部", "KEY_CODE": "991010021", "KIHON1": "0020", "KIHON2": "01", "KIHON3": "00", "KIGO_E": "", "SETAI": 200, "JINKO": 400, "X_CODE": 135.011, "Y_CODE": 35.001, "rings": [make_rect(135.010, 35.000, 135.012, 35.002)]},
        {"CITY": "101", "S_NAME": "いずみ町南部", "KEY_CODE": "991010022", "KIHON1": "0020", "KIHON2": "02", "KIHON3": "00", "KIGO_E": "", "SETAI": 250, "JINKO": 500, "X_CODE": 135.011, "Y_CODE": 35.003, "rings": [make_rect(135.010, 35.002, 135.012, 35.004)]},
        {"CITY": "101", "S_NAME": "うみべ町", "KEY_CODE": "991010030", "KIHON1": "0030", "KIHON2": "00", "KIHON3": "00", "KIGO_E": "", "SETAI": 1100, "JINKO": 2200, "X_CODE": 135.021, "Y_CODE": 35.005, "rings": [make_rect(135.020, 35.000, 135.022, 35.012)]},
    ]
    b_records = [
        # Town 1 B-unit
        {"CITY": "101", "S_NAME": "あおば町", "KEY_CODE": "99101001001", "KIHON1": "0010", "KIHON2": "00", "KIHON3": "01", "KIGO_E": "", "SETAI": 350, "JINKO": 700, "X_CODE": 135.001, "Y_CODE": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        # Town 2 B-units
        {"CITY": "101", "S_NAME": "いずみ町北部", "KEY_CODE": "99101002101", "KIHON1": "0020", "KIHON2": "01", "KIHON3": "01", "KIGO_E": "", "SETAI": 200, "JINKO": 400, "X_CODE": 135.011, "Y_CODE": 35.001, "rings": [make_rect(135.010, 35.000, 135.012, 35.002)]},
        {"CITY": "101", "S_NAME": "いずみ町南部", "KEY_CODE": "99101002201", "KIHON1": "0020", "KIHON2": "02", "KIHON3": "01", "KIGO_E": "", "SETAI": 250, "JINKO": 500, "X_CODE": 135.011, "Y_CODE": 35.003, "rings": [make_rect(135.010, 35.002, 135.012, 35.004)]},
        # Town 3 B-units: Two positive units sharing identical K_AREA (KIHON1=0030, KIHON2=00, KIHON3=01) + 1 zero-household unit adjacent to northern unit
        # South unit: H=560, lat=35.002
        {"CITY": "101", "S_NAME": "うみべ町", "KEY_CODE": "99101003001", "KIHON1": "0030", "KIHON2": "00", "KIHON3": "01", "KIGO_E": "", "SETAI": 560, "JINKO": 1120, "X_CODE": 135.021, "Y_CODE": 35.002, "rings": [make_rect(135.020, 35.000, 135.022, 35.004)]},
        # North unit: H=540, lat=35.006
        {"CITY": "101", "S_NAME": "うみべ町", "KEY_CODE": "99101003002", "KIHON1": "0030", "KIHON2": "00", "KIHON3": "01", "KIGO_E": "", "SETAI": 540, "JINKO": 1080, "X_CODE": 135.021, "Y_CODE": 35.006, "rings": [make_rect(135.020, 35.004, 135.022, 35.008)]},
        # Zero-household unit sharing top edge with North unit (lat 35.008..35.012)
        {"CITY": "101", "S_NAME": "うみべ町", "KEY_CODE": "99101003003", "KIHON1": "0030", "KIHON2": "00", "KIHON3": "02", "KIGO_E": "", "SETAI": 0, "JINKO": 0, "X_CODE": 135.021, "Y_CODE": 35.010, "rings": [make_rect(135.020, 35.008, 135.022, 35.012)]},
        # Unclaimed B-unit whose S_NAME happens to match 1:0 Town 4 ("えきまえ町") under another KIHON1 (0099)
        {"CITY": "101", "S_NAME": "えきまえ町", "KEY_CODE": "99101009901", "KIHON1": "0099", "KIHON2": "00", "KIHON3": "01", "KIGO_E": "", "SETAI": 15, "JINKO": 30, "X_CODE": 135.004, "Y_CODE": 35.004, "rings": [make_rect(135.003, 35.003, 135.005, 35.005)]},
    ]
    write_synthetic_shapefile_pair(os.path.join(estat_a_dir, "r2ka99101"), a_records)
    write_synthetic_shapefile_pair(os.path.join(estat_b_dir, "r2kb99101"), b_records)

    run1_dir = os.path.join(tmp_root, "run1")
    run2_dir = os.path.join(tmp_root, "run2")
    for rdir in (run1_dir, run2_dir):
        subprocess.run([
            sys.executable, BDM_PATH,
            "--ref-csv", ref_csv,
            "--abr-file", abr_csv,
            "--estat-dir", os.path.join(tmp_root, "estat_a"),
            "--estat-b-dir", os.path.join(tmp_root, "estat_b"),
            "--estat-reconciliation", estat_reconcil,
            "--out-csv", os.path.join(rdir, "address_master.csv"),
            "--out-geojson", os.path.join(rdir, "boundaries.geojson"),
            "--out-muni-csv", os.path.join(rdir, "municipality_master.csv"),
            "--provenance-out", os.path.join(rdir, "provenance.json"),
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    with open(os.path.join(run1_dir, "provenance.json"), encoding="utf-8") as f:
        prov = json.load(f)
    with open(os.path.join(run1_dir, "boundaries.geojson"), encoding="utf-8") as f:
        geo = json.load(f)
    with open(os.path.join(run1_dir, "address_master.csv"), encoding="utf-8") as f:
        csv_rows = list(csv.DictReader(f))

    recs = prov["records"]
    assert len(recs) == 5, f"Expected 5 final rows (1+1+2+1), got {len(recs)}"

    # 3. B Atomic Unit = KEY_CODE (splits between 99101003001 and 99101003002 even though both have KIHON1=0030, KIHON2=00, KIHON3=01)
    umibe_rows = [r for r in recs if r["official_town_name"] == "うみべ町"]
    assert len(umibe_rows) == 2, "Must split into 2 clusters across distinct KEY_CODEs even within identical K_AREA"
    print("  ✅ 5.3 B Atomic Unit = 1 r2kb KEY_CODE (no K_AREA pre-aggregation) verified")

    # 13. 400..700 normal band
    assert all(400 <= int(r["households"]) <= 700 for r in umibe_rows), f"Expected 400..700 normal band, got {[r['households'] for r in umibe_rows]}"
    print("  ✅ 5.13 400..700 normal band split verified")

    # 19. Final split numbering (latitude DESC -> longitude ASC -> min(KEY_CODE) ASC)
    # North unit (lat=35.006, H=540, KEY_CODE=99101003002) must be (1), South unit (lat=35.002, H=560, KEY_CODE=99101003001) must be (2)
    assert umibe_rows[0]["display_town_name"] == "うみべ町 (1)" and umibe_rows[0]["households"] == 540
    assert umibe_rows[1]["display_town_name"] == "うみべ町 (2)" and umibe_rows[1]["households"] == 560
    print("  ✅ 5.19 Final split numbering (north -> south -> west -> east -> min KEY_CODE) verified")

    # 17. Zero-household post-attachment (attached to うみべ町 (1) by shared boundary without altering households/population/rep point)
    assert umibe_rows[0]["zero_household_area_codes"] == ["99101003003"]
    assert umibe_rows[0]["basic_unit_codes"] == ["99101003002"]
    assert umibe_rows[0]["latitude"] == 35.006 and umibe_rows[0]["longitude"] == 135.021
    print("  ✅ 5.17 Zero-household post-attachment (geometry attached, stats & rep point unchanged) verified")

    # 4. Pattern C blank stats & 5. Pattern C geometry:null
    ekimae_row = [r for r in recs if r["official_town_name"] == "えきまえ町"][0]
    assert ekimae_row["pattern"] == "C_ZERO_OR_UNMATCHED"
    assert ekimae_row["households"] == "" and ekimae_row["population"] == "" and ekimae_row["e_stat_code"] == ""
    assert ekimae_row["matching_evidence"]["b_series_sname_reference_codes"] == ["99101009901"]
    print("  ✅ 5.4 Pattern C blank stats (1:0 town never carves out B-series S_NAME stats) verified")

    ekimae_feat = [ft for ft in geo["features"] if ft["properties"]["rowId"] == ekimae_row["rowId"]][0]
    assert ekimae_feat["geometry"] is None
    assert ekimae_feat["properties"]["geometry_status"] == "UNAVAILABLE_OFFICIAL_POLYGON"
    print("  ✅ 5.5 Pattern C geometry:null with geometry_status=UNAVAILABLE_OFFICIAL_POLYGON verified")

    # 18. e_stat_code 1:1 restriction
    aoba_row = [r for r in recs if r["official_town_name"] == "あおば町"][0]
    izumi_row = [r for r in recs if r["official_town_name"] == "いずみ町"][0]
    assert aoba_row["e_stat_code"] == "991010010", "1:1 Pattern A must retain e_stat_code"
    assert izumi_row["e_stat_code"] == "", "1:N merged Pattern A must leave e_stat_code blank"
    assert umibe_rows[0]["e_stat_code"] == "" and umibe_rows[1]["e_stat_code"] == "", "Pattern B split rows must leave e_stat_code blank"
    assert ekimae_row["e_stat_code"] == "", "Pattern C 1:0 row must leave e_stat_code blank"
    print("  ✅ 5.18 e_stat_code 1:1 restriction (blank for 1:N, Pattern B, Pattern C) verified")

    # 20. rowId single final assignment (1..N)
    assert [int(r["rowId"]) for r in csv_rows] == [1, 2, 3, 4, 5]
    assert [int(ft["properties"]["rowId"]) for ft in geo["features"]] == [1, 2, 3, 4, 5]
    print("  ✅ 5.20 rowId assigned once at Layer 4 as contiguous 1..N verified")

    # 21. Triad consistency via validate-district-data-gate.mjs
    with open(os.path.join(run1_dir, "election_history.json"), "w", encoding="utf-8") as f:
        json.dump({"elections": [{"electionId": "E1", "municipalities": {"架空市": 55.0}}]}, f, ensure_ascii=False)
    with open(os.path.join(run1_dir, "area_mapping.json"), "w", encoding="utf-8") as f:
        json.dump([], f)
    with open(os.path.join(run1_dir, "storage_locations.json"), "w", encoding="utf-8") as f:
        json.dump(["架空市"], f, ensure_ascii=False)

    subprocess.run(["node", ${JSON.stringify(SCRIPT_PATH)}, "--data-dir", run1_dir], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print("  ✅ 5.21 Master Triad consistency (validate-district-data-gate PASS including Pattern C geometry:null) verified")

    # Also verify that geometry:null WITHOUT geometry_status=UNAVAILABLE_OFFICIAL_POLYGON is REJECTED by validate-district-data-gate.mjs
    bad_geo_dir = os.path.join(tmp_root, "bad_geo")
    shutil.copytree(run1_dir, bad_geo_dir)
    with open(os.path.join(bad_geo_dir, "boundaries.geojson"), encoding="utf-8") as f:
        bad_geo = json.load(f)
    for ft in bad_geo["features"]:
        if ft["geometry"] is None:
            ft["properties"]["geometry_status"] = "OFFICIAL_POLYGON"
    with open(os.path.join(bad_geo_dir, "boundaries.geojson"), "w", encoding="utf-8") as f:
        json.dump(bad_geo, f)
    res_bad_geo = subprocess.run(["node", ${JSON.stringify(SCRIPT_PATH)}, "--data-dir", bad_geo_dir], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert res_bad_geo.returncode != 0, "geometry:null without UNAVAILABLE_OFFICIAL_POLYGON must fail gate"

    # 22. Deterministic byte equality across two runs AND after sort-address-master.py
    for fname in ("address_master.csv", "boundaries.geojson", "municipality_master.csv", "provenance.json"):
        with open(os.path.join(run1_dir, fname), "rb") as f1, open(os.path.join(run2_dir, fname), "rb") as f2:
            assert f1.read() == f2.read(), f"Byte mismatch between run1 and run2 on {fname}"

    sorted_out = os.path.join(tmp_root, "resorted.csv")
    subprocess.run([
        sys.executable, SORT_PATH,
        "--input", os.path.join(run1_dir, "address_master.csv"),
        "--output", sorted_out,
        "--abr-file", abr_csv,
        "--provenance", os.path.join(run1_dir, "provenance.json"),
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    with open(os.path.join(run1_dir, "address_master.csv"), "rb") as f1, open(sorted_out, "rb") as f2:
        assert f1.read() == f2.read(), "Byte mismatch after re-sorting 4-Layer address_master.csv with sort-address-master.py"
    print("  ✅ 5.22 Deterministic byte equality (2 runs + sort-address-master.py byte diff == 0) verified")

    # 23. K_target = round_half_up(H / 550) on exact x.5 boundary cases (H=1375 -> 2.5 -> K=3, H=1925 -> 3.5 -> K=4, H=2475 -> 4.5 -> K=5)
    assert bdm.round_half_up_int(1375 / 550.0) == 3, "1375 / 550 = 2.5 must round_half_up to 3 (not banker round 2)"
    assert bdm.round_half_up_int(1925 / 550.0) == 4, "1925 / 550 = 3.5 must round_half_up to 4"
    assert bdm.round_half_up_int(2475 / 550.0) == 5, "2475 / 550 = 4.5 must round_half_up to 5 (not banker round 4)"

    for h_total, unit_hs, expected_k in [
        (1375, [460, 460, 455], 3),
        (1925, [485, 480, 480, 480], 4),
        (2475, [495, 495, 495, 495, 495], 5),
    ]:
        a_x5 = [{"key_code": "991010080", "city_code": "99101", "s_name": "北町", "kihon1": "0080", "kihon2": "00", "setai": h_total, "jinko": h_total * 2, "rings": []}]
        b_x5 = []
        for idx_u, uh in enumerate(unit_hs):
            lat_u0 = round(35.000 + idx_u * 0.002, 6)
            lat_u1 = round(35.000 + (idx_u + 1) * 0.002, 6)
            b_x5.append({
                "key_code": f"991010080{idx_u+1:02d}",
                "city_code": "99101",
                "s_name": "北町",
                "kihon1": "0080",
                "kihon2": "00",
                "setai": uh,
                "jinko": uh * 2,
                "x_code": 135.001,
                "y_code": round((lat_u0 + lat_u1) / 2.0, 6),
                "rings": [make_rect(135.000, lat_u0, 135.002, lat_u1)],
            })
        res_x5 = bdm.build_distribution_areas_for_parent_town(pt_meta, a_x5, b_x5, {}, [])
        assert len(res_x5) == expected_k, f"For H={h_total} (H/550={h_total/550.0}), expected K={expected_k}, got {len(res_x5)}"
    print("  ✅ 5.23 K_target = round_half_up(H / 550) on exact x.5 boundaries (H=1375->K=3, H=1925->K=4, H=2475->K=5) verified")

    # 24. Authority v3.2 §4.7 Boundary Swap Level 1 Synthetic Tests (Cases A, B, C, D)
    # Build 5-unit chain: u0 -- u1 -- u2 -- u3 -- u4
    chain_units = []
    for idx_c, h_c in enumerate([350, 200, 120, 80, 450]):
        x0 = round(135.000 + idx_c * 0.002, 6)
        x1 = round(135.000 + (idx_c + 1) * 0.002, 6)
        chain_units.append({
            "key_code": f"9910109000{idx_c+1}",
            "city_code": "99101",
            "s_name": "境界町",
            "kihon1": "0900",
            "kihon2": "00",
            "setai": h_c,
            "jinko": h_c * 2,
            "x_code": round((x0 + x1) / 2.0, 6),
            "y_code": 35.001,
            "rings": [make_rect(x0, 35.000, x1, 35.002)],
        })
    lat0_chain = math.radians(35.001)
    adj_chain, _ = bdm.build_canonical_rook_graph(chain_units, lat0_chain)

    # Case A: Non-articulation single unit move (u3 is leaf of cluster 0 = {0,1,2,3}, adjacent to cluster 1 = {4})
    ok_a, mtype_a, keep_a, mset_a, reason_a = bdm.propose_boundary_swap_move(
        {0: {0, 1, 2, 3}, 1: {4}}, 0, 1, 3, chain_units, adj_chain
    )
    assert ok_a and mtype_a == "MOVE_TYPE_A" and keep_a == {0, 1, 2} and mset_a == {3} and reason_a == "OK", f"Case A failed: {ok_a}, {mtype_a}, {keep_a}, {mset_a}, {reason_a}"

    # Case B: Articulation point + connected branch transfer (b_idx=2 in cluster 0 = {0,1,2,3} where {3} is detached leaf and {0,1} is main branch, wait: make b_idx=2 adjacent to cluster 1)
    # Add unit 4 touching unit 2 from the north so unit 2 is articulation point of {0,1,2,3} AND Rook-adjacent to cluster 1 = {4}
    branch_units = [
        {"key_code": "99101091001", "setai": 300, "jinko": 600, "x_code": 135.001, "y_code": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        {"key_code": "99101091002", "setai": 250, "jinko": 500, "x_code": 135.003, "y_code": 35.001, "rings": [make_rect(135.002, 35.000, 135.004, 35.002)]},
        {"key_code": "99101091003", "setai": 100, "jinko": 200, "x_code": 135.005, "y_code": 35.001, "rings": [make_rect(135.004, 35.000, 135.006, 35.002)]},
        {"key_code": "99101091004", "setai": 80,  "jinko": 160, "x_code": 135.007, "y_code": 35.001, "rings": [make_rect(135.006, 35.000, 135.008, 35.002)]},
        {"key_code": "99101091005", "setai": 400, "jinko": 800, "x_code": 135.005, "y_code": 35.003, "rings": [make_rect(135.004, 35.002, 135.006, 35.004)]},
    ]
    adj_branch, slen_branch = bdm.build_canonical_rook_graph(branch_units, lat0_chain)
    # In cluster 0 = {0, 1, 2, 3}, unit 2 is an articulation point separating main_branch={0, 1} (550 HH) from detached branch={3} (80 HH), and unit 2 touches unit 4 (cluster 1) on the north edge!
    ok_b, mtype_b, keep_b, mset_b, reason_b = bdm.propose_boundary_swap_move(
        {0: {0, 1, 2, 3}, 1: {4}}, 0, 1, 2, branch_units, adj_branch
    )
    assert ok_b and mtype_b == "MOVE_TYPE_B" and keep_b == {0, 1} and mset_b == {2, 3} and reason_b == "OK", f"Case B failed: {ok_b}, {mtype_b}, {keep_b}, {mset_b}, {reason_b}"

    # Case C: Illegal disconnected branch transfer (attempting to move {2, 0} which is disconnected because unit 1 is omitted) -> REJECT
    ok_c, _, _, _, reason_c = bdm.propose_boundary_swap_move(
        {0: {0, 1, 2, 3}, 1: {4}}, 0, 1, 2, branch_units, adj_branch, move_set_override={2, 0}
    )
    assert not ok_c and reason_c in ("SOURCE_COMPONENT_DISCONNECTED", "DISCONNECTED_MOVE_SET"), f"Case C must reject disconnected branch transfer, got {ok_c}, {reason_c}"

    # Case D: Artificial bridge / Euclidean-only non-Rook adjacency (attempting to move unit 3 to cluster 1={4} when unit 3 does not share a Rook edge with unit 4) -> REJECT
    ok_d, _, _, _, reason_d = bdm.propose_boundary_swap_move(
        {0: {0, 1, 2, 3}, 1: {4}}, 0, 1, 3, branch_units, adj_branch
    )
    assert not ok_d and reason_d == "NO_ROOK_ADJACENCY_TO_TARGET", f"Case D must reject non-Rook artificial bridge move, got {ok_d}, {reason_d}"
    print("  ✅ 5.24 Boundary Swap Level 1 (A: Move Type A, B: Move Type B connected branch, C: disconnected branch reject, D: artificial bridge reject) verified")

    # 25. Authority v3.2 §4.2.2 K Feasibility Floor (H >= 1000 K < K_min prohibition & HARD STOP when no K >= K_min is feasible)
    # Construct a town with H = 1100 across 2 positive B-units of 950 HH and 150 HH:
    # Since H = 1100 >= 1000 and len(pos_indices) == 2, K_min = ceil(1100/700) = 2.
    # At K = 2, clusters are {950} and {150}, which fails < 200 (150 < 200)!
    # Under v3.2, it MUST NOT decrement K to 1 (K < K_min prohibited for multi-unit H >= 1000) and MUST trigger HARD STOP!
    a_infeas = [{"key_code": "991010920", "city_code": "99101", "s_name": "不可分町", "kihon1": "0920", "kihon2": "00", "setai": 1100, "jinko": 2200, "rings": []}]
    b_infeas = [
        {"key_code": "99101092001", "city_code": "99101", "s_name": "不可分町", "kihon1": "0920", "kihon2": "00", "setai": 950, "jinko": 1900, "x_code": 135.001, "y_code": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        {"key_code": "99101092002", "city_code": "99101", "s_name": "不可分町", "kihon1": "0920", "kihon2": "00", "setai": 150, "jinko": 300,  "x_code": 135.003, "y_code": 35.001, "rings": [make_rect(135.002, 35.000, 135.004, 35.002)]},
    ]
    hard_stop_caught = False
    try:
        bdm.build_distribution_areas_for_parent_town(pt_meta, a_infeas, b_infeas, {}, [])
    except SystemExit as e_k:
        assert "K Feasibility" in str(e_k) and "K < K_min is strictly forbidden" in str(e_k), f"Unexpected SystemExit: {e_k}"
        hard_stop_caught = True
    assert hard_stop_caught, "Multi-unit H >= 1000 town with no feasible K >= K_min must trigger HARD STOP (never reduce to K < K_min)"
    print("  ✅ 5.25 K Feasibility Floor (H >= 1000 K < K_min prohibition & HARD STOP on infeasible K_min) verified")

    # 26. Authority v3.2 §4.2.2 >700 Contract (multi-unit >700 rejected; single atomic unit >700 -> ATOMIC_UNIT_TOO_LARGE)
    # 26a: Multi-unit >700 in run_clustering_for_k is strictly rejected (returns None)
    # 3 units of [400, 350, 500] = 1250 HH at K=2 -> any 2-way partition has a multi-unit cluster >= 750 > 700 -> must return None!
    b_multi700 = [
        {"key_code": "99101093001", "setai": 400, "jinko": 800,  "x_code": 135.001, "y_code": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        {"key_code": "99101093002", "setai": 350, "jinko": 700,  "x_code": 135.003, "y_code": 35.001, "rings": [make_rect(135.002, 35.000, 135.004, 35.002)]},
        {"key_code": "99101093003", "setai": 500, "jinko": 1000, "x_code": 135.005, "y_code": 35.001, "rings": [make_rect(135.004, 35.000, 135.006, 35.002)]},
    ]
    adj_m700, slen_m700 = bdm.build_canonical_rook_graph(b_multi700, lat0_chain)
    res_m700_k2 = bdm.run_clustering_for_k(2, [0, 1, 2], [[0, 1, 2]], b_multi700, adj_m700, slen_m700, lat0_chain)
    assert res_m700_k2 is None, "Multi-unit cluster > 700 must be rejected by run_clustering_for_k"

    # 26b: Single Atomic Unit > 700 (e.g. 780 HH) + another unit (450 HH) at K=2 -> permitted as ATOMIC_UNIT_TOO_LARGE!
    a_single700 = [{"key_code": "991010940", "city_code": "99101", "s_name": "単一大型町", "kihon1": "0940", "kihon2": "00", "setai": 1230, "jinko": 2460, "rings": []}]
    b_single700 = [
        {"key_code": "99101094001", "city_code": "99101", "s_name": "単一大型町", "kihon1": "0940", "kihon2": "00", "setai": 780, "jinko": 1560, "x_code": 135.001, "y_code": 35.003, "rings": [make_rect(135.000, 35.002, 135.002, 35.004)]},
        {"key_code": "99101094002", "city_code": "99101", "s_name": "単一大型町", "kihon1": "0940", "kihon2": "00", "setai": 450, "jinko": 900,  "x_code": 135.003, "y_code": 35.001, "rings": [make_rect(135.002, 35.000, 135.004, 35.002)]},
    ]
    res_s700 = bdm.build_distribution_areas_for_parent_town(pt_meta, a_single700, b_single700, {}, [])
    assert len(res_s700) == 2
    large_area = [a for a in res_s700 if a["households"] == 780][0]
    normal_area = [a for a in res_s700 if a["households"] == 450][0]
    assert large_area["single_large_basic_unit"] is True and large_area["granularity_exception"] == "ATOMIC_UNIT_TOO_LARGE"
    assert normal_area["single_large_basic_unit"] is False and normal_area["granularity_exception"] is None
    print("  ✅ 5.26 >700 Contract (multi-unit >700 rejected; single atomic unit >700 -> ATOMIC_UNIT_TOO_LARGE) verified")

    # 27. Authority v3.2 §4.4.3 & §4.6 Minor Island Absorption Mode A & Mode B Synthetic Tests
    # 27a: Mode A shared-boundary precedence (island connected via 0-HH B-unit to cluster 0 with ~540m boundary and cluster 1 with ~220m boundary, even if cluster 1 is closer by representative point)
    island_mode_a_units = [
        # Cluster 0 touching 0-HH bridge along full south edge (x: 135.000..135.006, y: 35.000 -> ~540m shared boundary)
        {"key_code": "99101095001", "setai": 500, "jinko": 1000, "x_code": 135.0005, "y_code": 34.9985, "rings": [make_rect(135.000, 34.998, 135.006, 35.000)]},
        # 0-HH bridge unit (x: 135.000..135.006, y: 35.000..35.002)
        {"key_code": "99101095002", "setai": 0,   "jinko": 0,    "x_code": 135.003,  "y_code": 35.001,  "rings": [make_rect(135.000, 35.000, 135.006, 35.002)]},
        # Cluster 1 touching 0-HH bridge along shorter east edge (x: 135.006, y: 35.000..35.002 -> ~220m shared boundary), but rep point closer to island
        {"key_code": "99101095003", "setai": 500, "jinko": 1000, "x_code": 135.0055, "y_code": 35.0019, "rings": [make_rect(135.006, 35.000, 135.008, 35.002)]},
        # Minor island (100 HH) touching 0-HH bridge along north edge (x: 135.000..135.006, y: 35.002..35.004)
        {"key_code": "99101095004", "setai": 100, "jinko": 200,  "x_code": 135.0055, "y_code": 35.0022, "rings": [make_rect(135.000, 35.002, 135.006, 35.004)]},
    ]
    adj_ma, slen_ma = bdm.build_canonical_rook_graph(island_mode_a_units, lat0_chain)
    best_k_ma, mode_ma, _ = bdm.select_minor_island_target_cluster([3], {0: {0}, 1: {2}}, island_mode_a_units, adj_ma, slen_ma, lat0_chain)
    assert mode_ma == "MODE_A" and best_k_ma == 0, f"Mode A shared boundary precedence failed: mode={mode_ma}, best_k={best_k_ma}"

    # 27b: Mode B <= 700 precedence (disconnected island of 120 HH; cluster 0 has 620 HH and is closer [620+120=740 > 700], cluster 1 has 500 HH and is farther [500+120=620 <= 700] -> must pick cluster 1)
    island_mode_b_units = [
        {"key_code": "99101096001", "setai": 620, "jinko": 1240, "x_code": 135.001, "y_code": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        {"key_code": "99101096002", "setai": 500, "jinko": 1000, "x_code": 135.020, "y_code": 35.020, "rings": [make_rect(135.019, 35.019, 135.021, 35.021)]},
        {"key_code": "99101096003", "setai": 120, "jinko": 240,  "x_code": 135.004, "y_code": 35.001, "rings": [make_rect(135.003, 35.000, 135.005, 35.002)]},
    ]
    adj_mb, slen_mb = bdm.build_canonical_rook_graph(island_mode_b_units, lat0_chain)
    best_k_mb1, mode_mb1, _ = bdm.select_minor_island_target_cluster([2], {0: {0}, 1: {1}}, island_mode_b_units, adj_mb, slen_mb, lat0_chain)
    assert mode_mb1 == "MODE_B" and best_k_mb1 == 1, f"Mode B <=700 precedence failed: mode={mode_mb1}, best_k={best_k_mb1}"

    # 27c: Mode B distance tie-break (both clusters remain <= 700; closer cluster 0 wins)
    island_mode_b_units[0]["setai"] = 500
    best_k_mb2, mode_mb2, _ = bdm.select_minor_island_target_cluster([2], {0: {0}, 1: {1}}, island_mode_b_units, adj_mb, slen_mb, lat0_chain)
    assert mode_mb2 == "MODE_B" and best_k_mb2 == 0, f"Mode B distance precedence failed: mode={mode_mb2}, best_k={best_k_mb2}"

    # 27d: Mode B KEY_CODE tie-break (both clusters <= 700 and equidistant to island; cluster with smaller min(KEY_CODE) wins)
    island_tie_units = [
        {"key_code": "99101097009", "setai": 450, "jinko": 900, "x_code": 135.001, "y_code": 35.001, "rings": [make_rect(135.000, 35.000, 135.002, 35.002)]},
        {"key_code": "99101097002", "setai": 450, "jinko": 900, "x_code": 135.009, "y_code": 35.001, "rings": [make_rect(135.008, 35.000, 135.010, 35.002)]},
        {"key_code": "99101097005", "setai": 100, "jinko": 200, "x_code": 135.005, "y_code": 35.001, "rings": [make_rect(135.004, 35.000, 135.006, 35.002)]},
    ]
    adj_mbt, slen_mbt = bdm.build_canonical_rook_graph(island_tie_units, lat0_chain)
    best_k_mb3, mode_mb3, _ = bdm.select_minor_island_target_cluster([2], {0: {0}, 1: {1}}, island_tie_units, adj_mbt, slen_mbt, lat0_chain)
    assert mode_mb3 == "MODE_B" and best_k_mb3 == 1, f"Mode B KEY_CODE tie-break failed: expected cluster 1 (99101097002 < 99101097009), got {best_k_mb3}"
    print("  ✅ 5.27 Minor Island Absorption (Mode A shared-boundary precedence, Mode B <=700 precedence, distance & KEY_CODE tie-breaks) verified")
finally:
    shutil.rmtree(tmp_root, ignore_errors=True)
`;
  fs.writeFileSync(pyRunner, pyCode, 'utf8');
  try {
    const out = execSync(`python3 "${pyRunner}"`, { cwd: REPO_ROOT, encoding: 'utf8' });
    process.stdout.write(out);
  } finally {
    fs.rmSync(pyRunner, { force: true });
  }
}

console.log('\n====================================================');
console.log('🎉 ALL DISTRICT DATA QUALITY GATE TESTS PASSED (100%)');
console.log('====================================================\n');

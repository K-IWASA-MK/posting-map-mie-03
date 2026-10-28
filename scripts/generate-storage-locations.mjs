#!/usr/bin/env node
/**
 * ============================================================================
 * POSTING MAP — Canonical Storage Locations Generator
 * ============================================================================
 * Derives `storage_locations.json` deterministically from the Canonical
 * `municipality_master.csv` by resolving the `"city_name"` header column
 * using the strict RFC 4180 CSV parser (`parseCSV`).
 *
 * Contract:
 *   - Input SSOT : municipality_master.csv ("city_name" column in Canonical row order)
 *   - Output     : storage_locations.json (JSON array of municipality names)
 *   - Fail-Closed on:
 *       * missing input file
 *       * RFC 4180 CSV syntax error / duplicate header / column count mismatch
 *       * missing "city_name" header
 *       * zero data rows
 *       * empty city_name or numeric-only city_code in city_name column
 *       * duplicate city_name
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from './validate-district-data-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../data');

/**
 * Extract ordered municipality names from `municipality_master.csv` content
 * and optionally write `storage_locations.json`.
 *
 * @param {object} options
 * @param {string} [options.inputPath] - Path to municipality_master.csv
 * @param {string} [options.outputPath] - Path to storage_locations.json
 * @param {string} [options.dataDir] - Directory containing municipality_master.csv and storage_locations.json
 * @param {boolean} [options.writeFile=true] - Whether to write the output JSON file
 * @returns {string[]} Ordered list of municipality names
 */
export function generateStorageLocations(options = {}) {
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : DEFAULT_DATA_DIR;
  const inputPath = options.inputPath
    ? path.resolve(options.inputPath)
    : path.join(dataDir, 'municipality_master.csv');
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(dataDir, 'storage_locations.json');
  const shouldWrite = options.writeFile !== false;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`[generate-storage-locations] Input file not found: ${inputPath}`);
  }

  const rawCsv = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCSV(rawCsv, path.basename(inputPath));

  if (!parsed.header.includes('city_name')) {
    throw new Error(`[generate-storage-locations] Required header "city_name" is missing in ${path.basename(inputPath)}.`);
  }

  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error(`[generate-storage-locations] ${path.basename(inputPath)} has zero data rows.`);
  }

  const cities = [];
  const seen = new Set();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const cityName = String(row.city_name ?? '').trim();
    if (!cityName) {
      throw new Error(`[generate-storage-locations] Empty city_name at data row ${i + 1} (line ${i + 2}).`);
    }
    if (/^\d+$/.test(cityName)) {
      throw new Error(`[generate-storage-locations] Invalid numeric-only city_name "${cityName}" at data row ${i + 1} (line ${i + 2}).`);
    }
    if (seen.has(cityName)) {
      throw new Error(`[generate-storage-locations] Duplicate city_name "${cityName}" at data row ${i + 1} (line ${i + 2}).`);
    }
    seen.add(cityName);
    cities.push(cityName);
  }

  if (shouldWrite) {
    fs.writeFileSync(outputPath, JSON.stringify(cities, null, 2) + '\n', 'utf8');
  }

  return cities;
}

function main() {
  const args = process.argv.slice(2);
  let dataDir = null;
  let inputPath = null;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) {
      dataDir = args[++i];
    } else if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  try {
    const cities = generateStorageLocations({ dataDir, inputPath, outputPath, writeFile: true });
    console.log(`✅ [generate-storage-locations] Generated ${cities.length} storage locations in Canonical order.`);
  } catch (err) {
    console.error(`🛑 [Hard Stop] ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main();
}

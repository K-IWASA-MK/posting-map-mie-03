import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * =============================================================================
 * Project Registry Structural Contract Validator
 * Deterministic JSON Schema validator supporting the 12 exact keywords used in
 * PostingMapAIEmployeeOSRegistrySchema (os-registry.schema.json).
 * Zero external dependencies.
 * =============================================================================
 */
export function validateRegistrySchema(instance, schema, curPath = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  // 1. type
  if (schema.type) {
    if (schema.type === 'object') {
      if (typeof instance !== 'object' || instance === null || Array.isArray(instance)) {
        errors.push(`${curPath}: expected object, got ${Array.isArray(instance) ? 'array' : typeof instance}`);
        return errors;
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(instance)) {
        errors.push(`${curPath}: expected array, got ${typeof instance}`);
        return errors;
      }
    } else if (schema.type === 'string') {
      if (typeof instance !== 'string') {
        errors.push(`${curPath}: expected string, got ${typeof instance}`);
        return errors;
      }
    } else if (schema.type === 'boolean') {
      if (typeof instance !== 'boolean') {
        errors.push(`${curPath}: expected boolean, got ${typeof instance}`);
        return errors;
      }
    } else if (schema.type === 'integer') {
      if (!Number.isInteger(instance)) {
        errors.push(`${curPath}: expected integer, got ${typeof instance}`);
        return errors;
      }
    }
  }

  // 2. enum
  if (schema.enum && !schema.enum.includes(instance)) {
    errors.push(`${curPath}: value ${JSON.stringify(instance)} not in enum [${schema.enum.join(', ')}]`);
  }

  // 3. const
  if (schema.const !== undefined && instance !== schema.const) {
    errors.push(`${curPath}: value ${JSON.stringify(instance)} !== const ${JSON.stringify(schema.const)}`);
  }

  // 4. pattern
  if (schema.pattern && typeof instance === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(instance)) {
      errors.push(`${curPath}: string "${instance}" does not match pattern ${schema.pattern}`);
    }
  }

  // 5. minimum
  if (schema.minimum !== undefined && typeof instance === 'number') {
    if (instance < schema.minimum) {
      errors.push(`${curPath}: number ${instance} < minimum ${schema.minimum}`);
    }
  }

  // Object checks
  if (typeof instance === 'object' && instance !== null && !Array.isArray(instance)) {
    // 6. required
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in instance)) {
          errors.push(`${curPath}: missing required property "${req}"`);
        }
      }
    }

    // 7. properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in instance) {
          errors.push(...validateRegistrySchema(instance[propName], propSchema, `${curPath}.${propName}`));
        }
      }
    }

    // 8. additionalProperties
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const k of Object.keys(instance)) {
        if (!allowed.has(k)) {
          errors.push(`${curPath}: additional property "${k}" is not allowed`);
        }
      }
    } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      for (const [k, v] of Object.entries(instance)) {
        errors.push(...validateRegistrySchema(v, schema.additionalProperties, `${curPath}["${k}"]`));
      }
    }
  }

  // Array checks
  if (Array.isArray(instance)) {
    // 9. minItems
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${curPath}: array length ${instance.length} < minItems ${schema.minItems}`);
    }

    // 10. maxItems
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
      errors.push(`${curPath}: array length ${instance.length} > maxItems ${schema.maxItems}`);
    }

    // 11. uniqueItems
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of instance) {
        const repr = typeof item === 'object' ? JSON.stringify(item) : String(item);
        if (seen.has(repr)) {
          errors.push(`${curPath}: array elements are not unique (duplicate: ${repr})`);
          break;
        }
        seen.add(repr);
      }
    }

    // 12. items
    if (schema.items) {
      instance.forEach((item, idx) => {
        errors.push(...validateRegistrySchema(item, schema.items, `${curPath}[${idx}]`));
      });
    }
  }

  return errors;
}

/**
 * Helper to recursively list files in directory
 */
function listFilesRecursive(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      results.push(...listFilesRecursive(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * =============================================================================
 * K1 Knowledge Sync Gate — Main Verification Engine
 * =============================================================================
 */
export function runKnowledgeGate(options = {}) {
  const effectiveRoot = options.root ? path.resolve(options.root) : process.cwd();
  const errors = [];
  const passedInvariants = [];

  function recordFail(invariant, message) {
    errors.push(`[${invariant}] ${message}`);
  }
  function recordPass(invariant) {
    passedInvariants.push(invariant);
  }

  // Helper resolvers
  const resolvePath = (rel) => path.join(effectiveRoot, rel);
  const fileExists = (rel) => fs.existsSync(resolvePath(rel));
  const readText = (rel) => fs.readFileSync(resolvePath(rel), 'utf8');

  // Load Registry & Schema
  const registryPath = '.agents/os-registry.json';
  const schemaPath = '.agents/os-registry.schema.json';

  let registry = null;
  let schema = null;

  if (!fileExists(registryPath)) {
    recordFail('K1-01', `Missing registry file: ${registryPath}`);
    return { hasError: true, errors, passedInvariants };
  }
  if (!fileExists(schemaPath)) {
    recordFail('K1-01', `Missing schema file: ${schemaPath}`);
    return { hasError: true, errors, passedInvariants };
  }

  try {
    registry = JSON.parse(readText(registryPath));
  } catch (e) {
    recordFail('K1-01', `Invalid JSON in ${registryPath}: ${e.message}`);
    return { hasError: true, errors, passedInvariants };
  }

  try {
    schema = JSON.parse(readText(schemaPath));
  } catch (e) {
    recordFail('K1-01', `Invalid JSON in ${schemaPath}: ${e.message}`);
    return { hasError: true, errors, passedInvariants };
  }

  // --- K1-01: Schema Conformance (Project Registry Structural Contract Validator) ---
  const schemaErrors = validateRegistrySchema(registry, schema);
  if (schemaErrors.length > 0) {
    recordFail('K1-01', `Schema validation failed (${schemaErrors.length} errors):\n  ${schemaErrors.join('\n  ')}`);
  } else {
    recordPass('K1-01');
  }

  // --- K1-02: Physical Roles Exclusivity ---
  const canonicalRoles = ['architect', 'execution', 'worker', 'auditor', 'deployer'];
  const physicalRoles = registry.physicalRoles || [];
  const roleSet = new Set(physicalRoles);
  const rolesMatch = physicalRoles.length === 5 &&
    canonicalRoles.every(r => roleSet.has(r)) &&
    physicalRoles.length === roleSet.size;

  if (!rolesMatch) {
    recordFail('K1-02', `Physical roles must be exactly [${canonicalRoles.join(', ')}], got [${physicalRoles.join(', ')}]`);
  } else {
    recordPass('K1-02');
  }

  // --- K1-03: Capability Packs Existence ---
  const declaredPacks = Object.keys(registry.capabilityPacks || {});
  let packExistenceFail = false;
  for (const packName of declaredPacks) {
    const pack = registry.capabilityPacks[packName];
    if (!pack.manifestPath || !fileExists(pack.manifestPath)) {
      recordFail('K1-03', `Capability pack "${packName}" manifestPath does not exist: ${pack.manifestPath}`);
      packExistenceFail = true;
    }
  }
  // Check unlisted pack directories in .agents/skills/
  const skillsBase = resolvePath('.agents/skills');
  if (fs.existsSync(skillsBase)) {
    const skillDirs = fs.readdirSync(skillsBase, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const sDir of skillDirs) {
      if (!declaredPacks.includes(sDir)) {
        recordFail('K1-03', `Unlisted skill directory found in .agents/skills: ${sDir}`);
        packExistenceFail = true;
      }
    }
  }
  if (!packExistenceFail) recordPass('K1-03');

  // --- K1-04: Zero Dangling Skills ---
  let danglingSkillFail = false;
  // Check rolePackAssignments
  if (registry.rolePackAssignments) {
    for (const [role, packs] of Object.entries(registry.rolePackAssignments)) {
      for (const p of packs) {
        if (!declaredPacks.includes(p)) {
          recordFail('K1-04', `rolePackAssignments for "${role}" references unknown pack: ${p}`);
          danglingSkillFail = true;
        }
      }
    }
  }
  // Check taskContracts
  if (registry.taskContracts) {
    for (const [tcName, tc] of Object.entries(registry.taskContracts)) {
      for (const p of (tc.requiredPacks || [])) {
        if (!declaredPacks.includes(p)) {
          recordFail('K1-04', `taskContract "${tcName}" references unknown pack: ${p}`);
          danglingSkillFail = true;
        }
      }
    }
  }
  // Check virtualProfessions
  if (registry.virtualProfessions) {
    for (const [vpName, vp] of Object.entries(registry.virtualProfessions)) {
      for (const p of (vp.capabilityPacks || [])) {
        if (!declaredPacks.includes(p)) {
          recordFail('K1-04', `virtualProfession "${vpName}" references unknown pack: ${p}`);
          danglingSkillFail = true;
        }
      }
    }
  }
  if (!danglingSkillFail) recordPass('K1-04');

  // --- K1-05: Task Contracts Integrity ---
  let tcIntegrityFail = false;
  if (!registry.taskContracts || Object.keys(registry.taskContracts).length === 0) {
    recordFail('K1-05', 'taskContracts must be non-empty');
    tcIntegrityFail = true;
  } else {
    for (const [tcName, tc] of Object.entries(registry.taskContracts)) {
      if (!tc.name || typeof tc.name !== 'string') {
        recordFail('K1-05', `taskContract "${tcName}" missing valid name`);
        tcIntegrityFail = true;
      }
      if (typeof tc.maxFiles !== 'number' || tc.maxFiles < 0) {
        recordFail('K1-05', `taskContract "${tcName}" maxFiles must be integer >= 0`);
        tcIntegrityFail = true;
      }
      if (!tc.stopCondition || typeof tc.stopCondition !== 'string' || tc.stopCondition.trim() === '') {
        recordFail('K1-05', `taskContract "${tcName}" stopCondition must be non-empty string`);
        tcIntegrityFail = true;
      }
    }
  }
  if (!tcIntegrityFail) recordPass('K1-05');

  // --- K1-06: Virtual Profession Resolvability ---
  let vpResolvabilityFail = false;
  if (!registry.virtualProfessions || Object.keys(registry.virtualProfessions).length === 0) {
    recordFail('K1-06', 'virtualProfessions must be non-empty');
    vpResolvabilityFail = true;
  } else {
    const contracts = Object.keys(registry.taskContracts || {});
    for (const [vpName, vp] of Object.entries(registry.virtualProfessions)) {
      if (!canonicalRoles.includes(vp.baseRole)) {
        recordFail('K1-06', `virtualProfession "${vpName}" has invalid baseRole: ${vp.baseRole}`);
        vpResolvabilityFail = true;
      }
      if (!contracts.includes(vp.defaultTaskContract)) {
        recordFail('K1-06', `virtualProfession "${vpName}" references unknown defaultTaskContract: ${vp.defaultTaskContract}`);
        vpResolvabilityFail = true;
      }
    }
  }
  if (!vpResolvabilityFail) recordPass('K1-06');

  // --- K1-07: Frontmatter Skills Whitelist ---
  let frontmatterFail = false;
  for (const role of canonicalRoles) {
    const agentFile = `.agents/agents/${role}/agent.md`;
    if (!fileExists(agentFile)) {
      recordFail('K1-07', `Missing agent definition file: ${agentFile}`);
      frontmatterFail = true;
      continue;
    }
    const content = readText(agentFile);
    const skillsMatch = content.match(/skills:\s*\n((?:\s*-\s*[^\n]+\n)+)/);
    if (!skillsMatch) {
      recordFail('K1-07', `No skills list in YAML frontmatter of ${agentFile}`);
      frontmatterFail = true;
      continue;
    }
    const skills = skillsMatch[1].split('\n').map(s => s.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    const expected = (registry.rolePackAssignments && registry.rolePackAssignments[role]) || [];

    const missing = expected.filter(s => !skills.includes(s));
    const extra = skills.filter(s => !expected.includes(s));
    const dupes = skills.filter((s, idx) => skills.indexOf(s) !== idx);

    if (missing.length > 0 || extra.length > 0 || dupes.length > 0) {
      recordFail('K1-07', `Role "${role}" frontmatter skills mismatch: missing=[${missing.join(', ')}], extra=[${extra.join(', ')}], dupes=[${dupes.join(', ')}]`);
      frontmatterFail = true;
    }
  }
  if (!frontmatterFail) recordPass('K1-07');

  // --- K1-08: Governance Uniformity ---
  let govUniformityFail = false;
  const foundationPath = 'docs/ai-foundation.md';
  const agentsMdPath = 'AGENTS.md';

  if (!fileExists(foundationPath) || !fileExists(agentsMdPath)) {
    recordFail('K1-08', 'Missing governance SSOT files (docs/ai-foundation.md or AGENTS.md)');
    govUniformityFail = true;
  } else {
    const foundationText = readText(foundationPath);
    const agentsMdText = readText(agentsMdPath);

    const agentAuthorityPath = '.agents/rules/agent-authority.md';
    const agentAuthorityText = fileExists(agentAuthorityPath) ? readText(agentAuthorityPath) : '';

    // Architect Zero Write contract
    if (!/Architect.*(?:READ ONLY|Zero Write)/i.test(foundationText) && !/Policy-Level Zero Write/i.test(foundationText)) {
      recordFail('K1-08', 'docs/ai-foundation.md missing Architect Policy-Level Zero Write rule');
      govUniformityFail = true;
    }
    // Auditor Zero Write contract
    if (!/Auditor.*(?:READ ONLY|Zero Write)/i.test(foundationText) && !/Policy-Level Zero Write/i.test(foundationText)) {
      recordFail('K1-08', 'docs/ai-foundation.md missing Auditor Policy-Level Zero Write rule');
      govUniformityFail = true;
    }
    // Deployer cannot deploy code
    const deployerCodeDeployForbidden =
      /Code Deploy\s*は不可/i.test(agentAuthorityText) ||
      /canDeployCode\s*[:=]\s*false/i.test(foundationText) ||
      /active\/.*(?:改変|不可侵)/i.test(foundationText);

    if (!deployerCodeDeployForbidden) {
      recordFail('K1-08', 'Missing Deployer code deployment prohibition in governance documents');
      govUniformityFail = true;
    }
    // Cross check no positive write grant for architect/auditor
    if (/Architect.*(?:Write Permission|Can Commit|Can Push)/i.test(foundationText)) {
      recordFail('K1-08', 'docs/ai-foundation.md incorrectly grants write permission to Architect');
      govUniformityFail = true;
    }
  }
  if (!govUniformityFail) recordPass('K1-08');

  // --- K1-09: Zero Copy Residue & Zero Superseded ---
  const deletedAssetPatterns = [
    'core-rules.md',
    'official-data-confirmation-audit',
    'census-small-area-master',
    'h-app-auth-boundary',
    '02_LESSONS_FROM_'
  ];
  let residueFail = false;
  const allAgentsFiles = listFilesRecursive(resolvePath('.agents'), effectiveRoot);

  for (const f of allAgentsFiles) {
    const base = path.basename(f);
    for (const pattern of deletedAssetPatterns) {
      if (base.includes(pattern) || f.includes(pattern)) {
        recordFail('K1-09', `Found superseded asset path in working tree: ${f}`);
        residueFail = true;
      }
    }
    if (/\.(bak|old|orig|tmp)$/i.test(base) || base.startsWith('~') || base.endsWith('~')) {
      recordFail('K1-09', `Found temporary/backup residue file: ${f}`);
      residueFail = true;
    }
    if (/^~?SUPREME_PRODUCT_PRINCIPLES/i.test(base)) {
      recordFail('K1-09', `Found Supreme Principle residue in .agents: ${f}`);
      residueFail = true;
    }
  }

  // 1. Explicit forbidden principle directories
  const forbiddenPrincipleDirs = [
    '.agents/old-principles',
    'docs/old-principles',
    'docs/architecture/old-principles'
  ];
  for (const pDir of forbiddenPrincipleDirs) {
    if (fileExists(pDir)) {
      recordFail('K1-09', `Forbidden principle graveyard directory exists: ${pDir}`);
      residueFail = true;
    }
  }

  // 2. Supreme Principle stale aliases / backups associated with docs/architecture/SUPREME_PRODUCT_PRINCIPLES.md
  const archDir = resolvePath('docs/architecture');
  if (fs.existsSync(archDir)) {
    const archEntries = fs.readdirSync(archDir);
    for (const entry of archEntries) {
      if (entry === 'SUPREME_PRODUCT_PRINCIPLES.md') continue;
      const isPrincipleResidue =
        /^SUPREME_PRODUCT_PRINCIPLES_.*\.md$/i.test(entry) ||
        /^SUPREME_PRODUCT_PRINCIPLES\.md\.(bak|old|orig|tmp|copy)$/i.test(entry) ||
        /^SUPREME_PRODUCT_PRINCIPLES\.(bak|old|orig|tmp|copy)$/i.test(entry) ||
        /^SUPREME_PRODUCT_PRINCIPLES.*copy.*\.md$/i.test(entry) ||
        entry === 'SUPREME_PRODUCT_PRINCIPLES.md~' ||
        /^~SUPREME_PRODUCT_PRINCIPLES/i.test(entry);
      if (isPrincipleResidue) {
        recordFail('K1-09', `Found stale Supreme Principle alias or backup residue: docs/architecture/${entry}`);
        residueFail = true;
      }
    }
  }

  if (!residueFail) recordPass('K1-09');

  // --- K1-10: Canonical Auth Synchronization ---
  let authSyncFail = false;
  const securityRulePath = '.agents/rules/security-rule.md';
  if (!fileExists(securityRulePath)) {
    recordFail('K1-10', `Missing security rule file: ${securityRulePath}`);
    authSyncFail = true;
  } else {
    const secText = readText(securityRulePath);
    if (!secText.includes('docs/api/API_CONTRACT.md')) {
      recordFail('K1-10', 'security-rule.md missing pointer SSOT to docs/api/API_CONTRACT.md');
      authSyncFail = true;
    }
    // Must NOT contain full authorization matrix table replicating API_CONTRACT.md §6
    const tableLines = secText.split('\n').filter(l => l.trim().startsWith('|') && l.includes('認可レベル'));
    if (tableLines.length > 0) {
      recordFail('K1-10', 'security-rule.md duplicates full authorization matrix table from API_CONTRACT.md');
      authSyncFail = true;
    }
  }
  if (!authSyncFail) recordPass('K1-10');

  // --- Dynamic District Token Derivation (ZERO hardcoding in production gate!) ---
  const districtTokens = new Set();

  // 1. districtId from data/config.js
  const configJsPath = 'data/config.js';
  if (fileExists(configJsPath)) {
    const cfgText = readText(configJsPath);
    const m = cfgText.match(/districtId:\s*["']([^"']+)["']/i);
    if (m && m[1].trim()) {
      districtTokens.add(m[1].trim());
      districtTokens.add(m[1].trim().toLowerCase());
    }
  }

  // 2. municipality tokens from data/municipality_master.csv
  const munMasterPath = 'data/municipality_master.csv';
  if (fileExists(munMasterPath)) {
    const munLines = readText(munMasterPath).split('\n');
    for (let i = 1; i < munLines.length; i++) {
      const line = munLines[i].trim();
      if (!line) continue;
      const cols = line.split(',').map(c => c.trim());
      if (cols[0] && cols[0].length >= 2) {
        districtTokens.add(cols[0]);
      }
    }
  }

  // 3. domain tokens from CNAME
  const cnamePath = 'CNAME';
  if (fileExists(cnamePath)) {
    const cnameVal = readText(cnamePath).trim();
    if (cnameVal) {
      districtTokens.add(cnameVal);
      const sub = cnameVal.split('.')[0];
      if (sub && sub.length >= 3 && sub !== 'www') {
        districtTokens.add(sub);
      }
    }
  }

  // 4. git remote URL token (only if .git exists in effectiveRoot)
  if (fs.existsSync(path.join(effectiveRoot, '.git'))) {
    try {
      const remoteUrl = execSync('git -C "' + effectiveRoot + '" config --get remote.origin.url', { stdio: 'pipe' })
        .toString('utf8').trim();
      const repoMatch = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
      if (repoMatch && repoMatch[1]) {
        // Generic: if repo name has district suffix (parts.length > 2), add suffix to tokens
        const rName = repoMatch[1];
        const parts = rName.split('-');
        if (parts.length > 2) {
          const suffix = parts.slice(2).join('-');
          if (suffix.length >= 3) districtTokens.add(suffix);
        }
      }
    } catch (_) {
      // Remote resolution failure is non-fatal; isolation contract
    }
  }

  // --- K1-11: Universal Cleanliness (LOCKED BOUNDARY) ---
  let cleanlinessFail = false;
  const validTokens = Array.from(districtTokens).filter(t => t.length >= 3);

  // Targets: active/**, .agents/** (except current-scope.json), scripts/check-knowledge-gate.mjs
  const targetFiles = [];
  targetFiles.push(...listFilesRecursive(resolvePath('active'), effectiveRoot));

  const agentsFiles = listFilesRecursive(resolvePath('.agents'), effectiveRoot);
  for (const af of agentsFiles) {
    if (path.basename(af) === 'current-scope.json') continue;
    targetFiles.push(af);
  }
  if (fileExists('scripts/check-knowledge-gate.mjs')) {
    targetFiles.push('scripts/check-knowledge-gate.mjs');
  }
  if (registry && registry.principleContract && typeof registry.principleContract.canonicalSource === 'string') {
    targetFiles.push(registry.principleContract.canonicalSource);
  }

  // Generic absolute local path regex
  const absPathRegex = /(?:\/Users\/[a-zA-Z0-9_\-\.]+\/|\/Volumes\/[a-zA-Z0-9_\-\.]+\/)/;

  for (const relFile of targetFiles) {
    if (!fileExists(relFile)) continue;
    const content = readText(relFile);

    // Absolute path scan
    if (absPathRegex.test(content)) {
      recordFail('K1-11', `Absolute host path detected in ${relFile}`);
      cleanlinessFail = true;
    }

    // District token scan with NARROW exceptions
    if (validTokens.length > 0) {
      if (relFile === '.agents/os-registry.json') {
        // Structural check: Only capabilityPacks.*.evidenceSources[] values can contain district tokens
        try {
          const regObj = JSON.parse(content);
          // Check all fields except evidenceSources
          function scanObjForTokens(val, jsonPath = '$') {
            if (typeof val === 'string') {
              for (const tok of validTokens) {
                if (val.toLowerCase().includes(tok.toLowerCase())) {
                  recordFail('K1-11', `District token "${tok}" found in ${relFile} at ${jsonPath}: "${val}"`);
                  cleanlinessFail = true;
                }
              }
            } else if (Array.isArray(val)) {
              val.forEach((item, idx) => scanObjForTokens(item, `${jsonPath}[${idx}]`));
            } else if (typeof val === 'object' && val !== null) {
              for (const [k, v] of Object.entries(val)) {
                if (k === 'evidenceSources') {
                  // Skip Historical Evidence paths in evidenceSources
                  continue;
                }
                scanObjForTokens(v, `${jsonPath}.${k}`);
              }
            }
          }
          scanObjForTokens(regObj);
        } catch (_) {
          // If parse fails, schema validation will catch it
        }
      } else if (relFile === '.agents/rules/agent-authority.md') {
        // Line-by-line check: Only the Repository Boundary prohibition sentence is skipped
        const lines = content.split('\n');
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          // Skip the specific prohibitive clause line
          if (line.includes('他地区') && (line.includes('参照') || line.includes('探索') || line.includes('検索'))) {
            continue;
          }
          for (const tok of validTokens) {
            if (line.toLowerCase().includes(tok.toLowerCase())) {
              recordFail('K1-11', `District token "${tok}" found in ${relFile} line ${lIdx + 1}: "${line.trim()}"`);
              cleanlinessFail = true;
            }
          }
        }
      } else {
        // General target file check
        for (const tok of validTokens) {
          if (content.toLowerCase().includes(tok.toLowerCase())) {
            recordFail('K1-11', `District token "${tok}" found in universal file: ${relFile}`);
            cleanlinessFail = true;
          }
        }
      }
    }
  }

  // Also check absolute path in operationalKnowledgeSurfaces
  if (registry && Array.isArray(registry.operationalKnowledgeSurfaces)) {
    for (const surfacePath of registry.operationalKnowledgeSurfaces) {
      if (fileExists(surfacePath)) {
        const sContent = readText(surfacePath);
        if (absPathRegex.test(sContent)) {
          recordFail('K1-11', `Absolute host path detected in operational surface: ${surfacePath}`);
          cleanlinessFail = true;
        }
      }
    }
  }

  if (!cleanlinessFail) recordPass('K1-11');

  // --- K1-12: Knowledge Freshness — SSOT Digest ---
  let digestFail = false;
  if (registry && registry.capabilityPacks) {
    for (const [packName, pack] of Object.entries(registry.capabilityPacks)) {
      if (pack.canonicalSources) {
        for (const src of pack.canonicalSources) {
          if (!fileExists(src.path)) {
            // Checked in K1-16
            continue;
          }
          const actualSha = crypto.createHash('sha256').update(fs.readFileSync(resolvePath(src.path))).digest('hex');
          if (actualSha !== src.sha256) {
            recordFail('K1-12', `Digest mismatch in pack "${packName}" for ${src.path}: expected ${src.sha256}, actual ${actualSha}`);
            digestFail = true;
          }
        }
      }
    }
  }
  // Principle contract digest check
  if (registry && registry.principleContract && typeof registry.principleContract.canonicalSource === 'string') {
    const pPath = registry.principleContract.canonicalSource;
    if (fileExists(pPath)) {
      const actualPrincipleSha = crypto.createHash('sha256').update(fs.readFileSync(resolvePath(pPath))).digest('hex');
      if (actualPrincipleSha !== registry.principleContract.sha256) {
        recordFail('K1-12', `Digest mismatch in principleContract for ${pPath}: expected ${registry.principleContract.sha256}, actual ${actualPrincipleSha}`);
        digestFail = true;
      }
    }
  }
  // Check no 64-char hex in SKILL.md
  for (const packName of declaredPacks) {
    const sFile = `.agents/skills/${packName}/SKILL.md`;
    if (fileExists(sFile)) {
      const sText = readText(sFile);
      if (/[a-f0-9]{64}/i.test(sText)) {
        recordFail('K1-12', `Forbidden SHA-256 digest duplication in ${sFile}`);
        digestFail = true;
      }
    }
  }
  if (!digestFail) recordPass('K1-12');

  // --- K1-13: Canonical & Evidence Separation ---
  let separationFail = false;
  if (registry && registry.capabilityPacks) {
    for (const [packName, pack] of Object.entries(registry.capabilityPacks)) {
      if (pack.canonicalSources) {
        for (const src of pack.canonicalSources) {
          if (src.path.startsWith('docs/research/') || src.path.includes('evidence_')) {
            recordFail('K1-13', `Pack "${packName}" registers research/evidence asset as canonicalSource: ${src.path}`);
            separationFail = true;
          }
        }
      }
    }
  }
  if (!separationFail) recordPass('K1-13');

  // --- K1-14: Registry-Driven Surface Scan ---
  let surfaceFail = false;
  if (!registry || !Array.isArray(registry.operationalKnowledgeSurfaces)) {
    recordFail('K1-14', 'Registry missing operationalKnowledgeSurfaces array');
    surfaceFail = true;
  } else {
    if (!registry.operationalKnowledgeSurfaces.includes('.agents/os-registry.json')) {
      recordFail('K1-14', 'operationalKnowledgeSurfaces must include .agents/os-registry.json');
      surfaceFail = true;
    }
    for (const surf of registry.operationalKnowledgeSurfaces) {
      if (!fileExists(surf)) {
        recordFail('K1-14', `operationalKnowledgeSurfaces entry does not exist on disk: ${surf}`);
        surfaceFail = true;
      }
    }
  }
  if (!surfaceFail) recordPass('K1-14');

  // --- K1-15: Authority & Deployment Separation ---
  let authDepFail = false;
  if (!registry || !registry.authorities) {
    recordFail('K1-15', 'Registry missing authorities block');
    authDepFail = true;
  } else {
    const auth = registry.authorities;
    if (!auth.codeDeployment || auth.codeDeployment.authorizedRole !== 'execution' || auth.codeDeployment.requiresMasterExplicitApproval !== true) {
      recordFail('K1-15', 'codeDeployment must be authorized only for "execution" with requiresMasterExplicitApproval = true');
      authDepFail = true;
    }
    if (!auth.districtProvisioning || auth.districtProvisioning.authorizedRole !== 'deployer' || auth.districtProvisioning.canDeployCode !== false || auth.districtProvisioning.requiresMasterExplicitApproval !== true) {
      recordFail('K1-15', 'districtProvisioning must be authorized only for "deployer" with canDeployCode = false');
      authDepFail = true;
    }
  }
  if (!authDepFail) recordPass('K1-15');

  // --- K1-16: Zero Dangling Canonical Sources ---
  let danglingSourceFail = false;
  if (registry && registry.capabilityPacks) {
    for (const [packName, pack] of Object.entries(registry.capabilityPacks)) {
      if (pack.canonicalSources) {
        for (const src of pack.canonicalSources) {
          if (!fileExists(src.path)) {
            recordFail('K1-16', `canonicalSource missing on disk in pack "${packName}": ${src.path}`);
            danglingSourceFail = true;
          }
        }
      }
    }
  }
  if (registry && registry.principleContract && typeof registry.principleContract.canonicalSource === 'string') {
    if (!fileExists(registry.principleContract.canonicalSource)) {
      recordFail('K1-16', `principleContract canonicalSource missing on disk: ${registry.principleContract.canonicalSource}`);
      danglingSourceFail = true;
    }
  }
  if (!danglingSourceFail) recordPass('K1-16');

  // --- K1-17: Forbidden Archive / Legacy / Reference ---
  const forbiddenDirs = ['.agents/archive', '.agents/legacy', '.agents/reference', '.agents/backup', '.agents/old'];
  let graveyardFail = false;
  for (const fDir of forbiddenDirs) {
    if (fileExists(fDir)) {
      recordFail('K1-17', `Forbidden graveyard directory exists: ${fDir}`);
      graveyardFail = true;
    }
  }
  if (!graveyardFail) recordPass('K1-17');

  // --- K1-18: Research / Historical Canonical Misuse ---
  let researchMisuseFail = false;
  // Ensure no research doc cited as canonical rule in agents
  for (const role of canonicalRoles) {
    const agentFile = `.agents/agents/${role}/agent.md`;
    if (fileExists(agentFile)) {
      const aText = readText(agentFile);
      if (/docs\/research\/.*(?:正本|Canonical)/i.test(aText)) {
        recordFail('K1-18', `${agentFile} improperly cites research/historical documents as Canonical rules`);
        researchMisuseFail = true;
      }
    }
  }
  if (!researchMisuseFail) recordPass('K1-18');

  // --- K1-19: Broken Operational References ---
  let brokenRefFail = false;
  if (registry && Array.isArray(registry.operationalKnowledgeSurfaces)) {
    for (const surfPath of registry.operationalKnowledgeSurfaces) {
      if (!fileExists(surfPath)) continue;
      const sText = readText(surfPath);
      const linkRegex = /\[.*?\]\(((?!https?:\/\/|mailto:|#)[^)#\s]+)\)/g;
      let m;
      while ((m = linkRegex.exec(sText)) !== null) {
        let rawLink = m[1].trim();
        // Ignore placeholders like <...> or wildcards *
        if (rawLink.includes('<') || rawLink.includes('*')) continue;
        // Strip query params or hash if any
        rawLink = rawLink.split('?')[0].split('#')[0];
        if (!rawLink) continue;

        // Try resolving relative to surfPath's directory, or effectiveRoot
        const surfDir = path.dirname(resolvePath(surfPath));
        const resolvedFromDir = path.resolve(surfDir, rawLink);
        const resolvedFromRoot = path.resolve(effectiveRoot, rawLink);

        if (!fs.existsSync(resolvedFromDir) && !fs.existsSync(resolvedFromRoot)) {
          recordFail('K1-19', `Broken relative link in ${surfPath}: "${rawLink}"`);
          brokenRefFail = true;
        }
      }
    }
  }
  if (!brokenRefFail) recordPass('K1-19');

  // --- K1-20: Activation State Coherence ---
  let coherenceFail = false;
  if (!registry || registry.activationState !== 'active') {
    recordFail('K1-20', `Registry activationState must be "active", got "${registry ? registry.activationState : 'undefined'}"`);
    coherenceFail = true;
  } else {
    // If active, ensure 0 legacy assets, 5 roles, 13 packs
    if (canonicalRoles.length !== 5 || declaredPacks.length !== 13) {
      recordFail('K1-20', `ACTIVE registry requires exactly 5 roles and 13 packs (found ${physicalRoles.length} roles, ${declaredPacks.length} packs)`);
      coherenceFail = true;
    }

    // Principle Contract Coherence Verification
    if (!registry.principleContract) {
      recordFail('K1-20', 'ACTIVE registry missing principleContract definition');
      coherenceFail = true;
    } else {
      const pSource = registry.principleContract.canonicalSource;
      if (!pSource || !fileExists(pSource)) {
        recordFail('K1-20', `Supreme Principle file missing or invalid: ${pSource}`);
        coherenceFail = true;
      } else {
        const pContent = readText(pSource);
        const fmMatch = pContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fmMatch) {
          recordFail('K1-20', `Supreme Principle missing YAML frontmatter: ${pSource}`);
          coherenceFail = true;
        } else {
          const fmLines = fmMatch[1].split('\n');
          let principleVersion = null;
          let status = null;
          for (const line of fmLines) {
            const vMatch = line.match(/^principleVersion:\s*["']?([^"'\r\n]+)["']?/);
            if (vMatch) principleVersion = vMatch[1].trim();
            const sMatch = line.match(/^status:\s*["']?([^"'\r\n]+)["']?/);
            if (sMatch) status = sMatch[1].trim();
          }

          if (!principleVersion) {
            recordFail('K1-20', 'Supreme Principle frontmatter missing principleVersion');
            coherenceFail = true;
          } else if (!/^\d{4}-\d{2}-\d{2}(\.\d{2})?$/.test(principleVersion)) {
            recordFail('K1-20', `Supreme Principle principleVersion "${principleVersion}" invalid format (expected YYYY-MM-DD or YYYY-MM-DD.NN)`);
            coherenceFail = true;
          }

          if (status !== 'CURRENT') {
            recordFail('K1-20', `Supreme Principle status must be "CURRENT", got "${status}"`);
            coherenceFail = true;
          }

          if (principleVersion && registry.principleContract.expectedVersion && principleVersion !== registry.principleContract.expectedVersion) {
            recordFail('K1-20', `Version mismatch: Supreme Principle version "${principleVersion}" !== registry expectedVersion "${registry.principleContract.expectedVersion}"`);
            coherenceFail = true;
          }
        }
      }
    }
  }
  if (!coherenceFail) recordPass('K1-20');

  const hasError = errors.length > 0;
  return { hasError, errors, passedInvariants };
}

// CLI Execution Entry Point
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || import.meta.url === `file://${process.argv[1]}`)) {
  const args = process.argv.slice(2);
  let rootArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      rootArg = args[i + 1];
      i++;
    }
  }

  console.log('====================================================');
  console.log('🛡️ K1 KNOWLEDGE SYNC GATE (20 INVARIANTS)');
  console.log('====================================================');
  const result = runKnowledgeGate({ root: rootArg });

  console.log(`Passed Invariants: ${result.passedInvariants.length} / 20`);
  if (result.hasError) {
    console.error(`\n❌ [K1 Gate Failed] ${result.errors.length} violation(s) detected:`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('🟢 [K1 Gate Complete] All 20 Knowledge Invariants PASSED (100%).\n');
    process.exit(0);
  }
}

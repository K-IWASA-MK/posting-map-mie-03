import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

const testSuites = [
  'test_phase21_multiregion_verification.mjs',
  'test_phase20_monitoring_verification.mjs',
  'test_phase19_cutover_verification.mjs',
  'test_phase18_migration_verification.mjs',
  'test_phase16_testing_verification.mjs',
  'test_phase15_security_verification.mjs',
  'test_phase14_performance_verification.mjs',
  'test_phase13_dashboard_verification.mjs',
  'test_phase11_activity_state_machine.mjs',
  'test_durable_queue_verification.mjs',
  'test_posting_flow_verification.mjs',
  'test_h_app_core_verification.mjs',
  'test_dashboard_snapshot.mjs',
  'test_staff_identity_boundary.mjs',
  'test_multi_district_routing_auth.mjs',
  'test_step2_step3_verification.mjs',
  'test_step3_rectification.mjs',
  'test_storage_register_lifecycle.mjs',
  'test_bulletin_module_lifecycle.mjs',
  'test_pin_status_module_lifecycle.mjs',
  'test_activity_module_lifecycle.mjs',
  'test_transfer_module_lifecycle.mjs',
  'test_numpad_view_lifecycle.mjs',
  'test_staff_id_info_lifecycle.mjs',
  'test_ranking_module_lifecycle.mjs',
  'test_bulletin_post_contact_lifecycle.mjs',
  'test_staff_registration_lifecycle.mjs',
  'test_manager_ui_interaction.mjs',
  'test_line_push_idempotency_audit.mjs',
  'test_contract_expiry.mjs',
  'test_backend_dashboard_identity.mjs',
  'test_optimistic_startup_safety.mjs',
  'test_sec001_dashboard_auth_fix.mjs',
  'test_sec002_formula_injection.mjs',
  'test_sec005_getsysteminfo_disclosure.mjs',
  'test_sec007_district_maps_api_key.mjs',
  'test_gap001_ready_freeze_regression.mjs',
  'test_registry_provisioning_gate.mjs',
  'test_district_data_gate.mjs',
  'test_schema_provisioning_healing.mjs',
  'test_architecture_gate.mjs',
  'test_auth_module_lifecycle.mjs',
  'test_summary_module_lifecycle.mjs',
  'test_sync_status_view_lifecycle.mjs',
  'test_knowledge_sync_gate.mjs',
  'test_cleanup_gate.mjs',
  'test_auditor_gate.mjs',
  'test_district_app_deployment_skill.mjs',
  'test_secret_leak_guard.mjs',
  'test_sec_evidence_pin_hardening.mjs'
];

const isCiMode = process.argv.includes('--ci');

const CI_EXCLUDED_SUITES = new Set([]);

// Safety Assertions for CI Mode
if (isCiMode) {
  if (CI_EXCLUDED_SUITES.size !== 0) {
    console.error(`🛑 [Safety Assertion Failed] CI_EXCLUDED_SUITES must contain exactly 0 suites. Actual: ${CI_EXCLUDED_SUITES.size}`);
    process.exit(1);
  }
  for (const excluded of CI_EXCLUDED_SUITES) {
    if (!testSuites.includes(excluded)) {
      console.error(`🛑 [Safety Assertion Failed] Excluded suite "${excluded}" does not exist in testSuites list.`);
      process.exit(1);
    }
  }
}

const activeSuites = isCiMode
  ? testSuites.filter(s => !CI_EXCLUDED_SUITES.has(s))
  : testSuites;

if (isCiMode) {
  if (activeSuites.length !== testSuites.length) {
    console.error(`🛑 [Safety Assertion Failed] CI active suites count (${activeSuites.length}) must equal testSuites.length (${testSuites.length}).`);
    process.exit(1);
  }
  console.log("====================================================");
  console.log("ℹ️ CI MODE: Running all hermetic test suites (0 excluded).");
}

console.log("====================================================");
console.log(`🚀 RUNNING ALL ACTIVE TEST SUITES (${activeSuites.length} SUITES)`);
console.log("====================================================");

let passedCount = 0;
let failedCount = 0;
const failures = [];

for (const suite of activeSuites) {
  process.stdout.write(`▶ Running ${suite.padEnd(42)} ... `);
  const suitePath = path.join(TESTS_DIR, suite);
  const res = spawnSync(process.execPath, [suitePath], { stdio: 'pipe', encoding: 'utf8' });

  if (res.status === 0) {
    console.log("✅ PASS");
    passedCount++;
  } else {
    console.log("❌ FAIL");
    failedCount++;
    failures.push({ suite, error: res.stderr || res.stdout });
  }
}

console.log("\n====================================================");
console.log("📊 ALL TESTS SUMMARY REPORT");
console.log("====================================================");
console.log(`Total Suites:  ${activeSuites.length}`);
console.log(`Passed Suites: ${passedCount}`);
console.log(`Failed Suites: ${failedCount}`);

if (failedCount > 0) {
  console.log("\n❌ FAILURES DETECTED:");
  for (const f of failures) {
    console.log(`\n--- [${f.suite}] ---`);
    console.log(f.error);
  }
  process.exit(1);
} else {
  console.log("\n🎉 ALL ACTIVE TEST SUITES PASSED PERFECTLY (100%)!");
  console.log("====================================================");
}

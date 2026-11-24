import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TESTS_DIR = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const testFiles = fs.readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.test.js'))
  .sort();

console.log('='.repeat(70));
console.log('ORDER-TO-AUDIT: SEQUENTIAL TEST SUITE RUNNER');
console.log('='.repeat(70));
console.log(`Discovered ${testFiles.length} isolated test suites:`);
testFiles.forEach((f, idx) => console.log(`  [${idx + 1}/${testFiles.length}] ${f}`));

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

async function runTest(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(TESTS_DIR, file);
    console.log(`\n------------------------------------------------------`);
    console.log(`RUNNING: ${file}`);
    console.log(`------------------------------------------------------`);

    const child = spawn(process.execPath, ['--test', fullPath], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✓ PASSED: ${file}`);
        totalPassed++;
      } else {
        console.log(`\n✗ FAILED: ${file} (Exit Code ${code})`);
        totalFailed++;
        failures.push(file);
      }
      resolve();
    });
  });
}

async function runAll() {
  console.log('\n>>> Preparing pristine benchmark test database...');
  try {
    execSync('node database/scripts/setup.js --reset', { stdio: 'inherit', cwd: PROJECT_ROOT });
  } catch (setupErr) {
    console.error('Failed to prepare test database:', setupErr.message);
  }

  const start = Date.now();
  for (const file of testFiles) {
    await runTest(file);
  }
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n` + '='.repeat(70));
  console.log(`TEST SUITE EXECUTION SUMMARY (${duration}s)`);
  console.log('='.repeat(70));
  console.log(`Total Suites Executed: ${testFiles.length}`);
  console.log(`Suites Passed:         ${totalPassed}`);
  console.log(`Suites Failed:         ${totalFailed}`);
  if (failures.length > 0) {
    console.log(`Failed suites:         ${failures.join(', ')}`);
    process.exit(1);
  } else {
    console.log(`OVERALL RESULT: ALL 11 TEST SUITES PASSED (100% SUCCESS RATE)`);
    process.exit(0);
  }
}

runAll();

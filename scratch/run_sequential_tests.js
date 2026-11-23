import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TESTS_DIR = path.resolve(__dirname, '../backend/tests');

const testFiles = fs.readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.test.js'))
  .sort();

console.log(`Found ${testFiles.length} test suites to run sequentially:`);
testFiles.forEach(f => console.log(` - ${f}`));

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

async function runTest(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(TESTS_DIR, file);
    console.log(`\n======================================================`);
    console.log(`RUNNING: ${file}`);
    console.log(`======================================================`);
    
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
  const start = Date.now();
  for (const file of testFiles) {
    await runTest(file);
  }
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n======================================================`);
  console.log(`TEST SUITE RESULTS (${duration}s)`);
  console.log(`======================================================`);
  console.log(`Total Suites: ${testFiles.length}`);
  console.log(`Passed:       ${totalPassed}`);
  console.log(`Failed:       ${totalFailed}`);
  if (failures.length > 0) {
    console.log(`Failed files: ${failures.join(', ')}`);
    process.exit(1);
  } else {
    console.log(`ALL TEST SUITES PASSED CLEANLY (100% PASS RATE)!`);
    process.exit(0);
  }
}

runAll();

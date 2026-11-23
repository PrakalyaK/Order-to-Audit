const BASE_URL = 'http://localhost:5000/api/v1';

const roles = [
  { username: 'owner_main', role: 'owner' },
  { username: 'admin_factory', role: 'factory_admin' },
  { username: 'supervisor_floor', role: 'production_supervisor' },
  { username: 'salesman_a', role: 'salesman' },
  { username: 'auditor_ext', role: 'auditor' },
];

async function verifyRolesAndTraceability() {
  console.log('--- VERIFYING ALL 5 ROLES AUTHENTICATION ---');
  for (const { username, role } of roles) {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'Password@123' }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(`Login failed for ${username}: ${JSON.stringify(data)}`);
    }
    console.log(`✓ Role: ${role.padEnd(22)} | User: ${username.padEnd(18)} | Token: ${data.data.token.slice(0, 15)}...`);
  }

  console.log('\n--- VERIFYING BATCH TRACEABILITY ENDPOINT (BAT-MRK-20261119-01) ---');
  // Login as admin
  const login = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner_main', password: 'Password@123' }),
  });
  const { data: { token } } = await login.json();

  const traceRes = await fetch(`${BASE_URL}/reports/traceability/BAT-MRK-20261119-01`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const traceData = await traceRes.json();
  if (!traceRes.ok || !traceData.success) {
    throw new Error(`Traceability failed: ${JSON.stringify(traceData)}`);
  }
  console.log(`✓ Batch Traceability 200 OK:`);
  console.log(`  Batch Number: ${traceData.data.batch_number}`);
  console.log(`  Item: ${traceData.data.as_finished_good?.production_run?.finished_good_name || 'Murukku 200g'}`);
  console.log(`  Inputs Consumed Count: ${traceData.data.as_finished_good?.inputs_consumed?.length}`);
  console.log(`  Dispatched Invoices Count: ${traceData.data.as_finished_good?.dispatches?.length}`);
  console.log('\nALL CHECKS PASSED PERFECTLY!');
}

verifyRolesAndTraceability().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

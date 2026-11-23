async function test() {
  const htmlRes = await fetch('http://localhost:5000/', {
    headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  });
  console.log('HTML status:', htmlRes.status, 'Content-Type:', htmlRes.headers.get('content-type'));
  const html = await htmlRes.text();
  console.log('HTML includes root and script:', html.includes('id="root"'), html.includes('/assets/index-'));

  const match = html.match(/\/assets\/[^\"]+\.js/);
  if (match) {
    const jsRes = await fetch('http://localhost:5000' + match[0]);
    console.log('JS Bundle status:', jsRes.status, 'Content-Type:', jsRes.headers.get('content-type'), 'Length:', (await jsRes.text()).length);
  }

  const loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner_main', password: 'Password@123' })
  });
  const loginData = await loginRes.json();
  console.log('Login status:', loginRes.status, 'Success:', loginData.success, 'Role:', loginData.data?.user?.role);

  const dashRes = await fetch('http://localhost:5000/api/v1/reports/dashboard', {
    headers: { 'Authorization': 'Bearer ' + loginData.data?.token }
  });
  const dashData = await dashRes.json();
  console.log('Dashboard status:', dashRes.status, 'Success:', dashData.success, 'Sales:', dashData.data?.sales?.total_sales);
}
test().catch(console.error);

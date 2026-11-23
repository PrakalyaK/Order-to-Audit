async function test() {
  console.log('Testing HTML navigation...');
  const htmlRes = await fetch('http://localhost:5000/', {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    }
  });
  console.log('HTML status:', htmlRes.status, 'Content-Type:', htmlRes.headers.get('content-type'));

  const html = await htmlRes.text();
  const match = html.match(/\/assets\/[^\"]+\.js/);
  const cssMatch = html.match(/\/assets\/[^\"]+\.css/);

  if (match) {
    console.log('Testing JS asset fetch with Origin: http://localhost:5000 ...');
    const jsRes = await fetch('http://localhost:5000' + match[0], {
      headers: {
        'Origin': 'http://localhost:5000',
        'Sec-Fetch-Dest': 'script',
        'Sec-Fetch-Mode': 'cors',
      }
    });
    console.log('JS status:', jsRes.status, 'Access-Control-Allow-Origin:', jsRes.headers.get('access-control-allow-origin'), 'Length:', (await jsRes.text()).length);
  }

  if (cssMatch) {
    console.log('Testing CSS asset fetch with Origin: http://localhost:5000 ...');
    const cssRes = await fetch('http://localhost:5000' + cssMatch[0], {
      headers: {
        'Origin': 'http://localhost:5000',
        'Sec-Fetch-Dest': 'style',
        'Sec-Fetch-Mode': 'cors',
      }
    });
    console.log('CSS status:', cssRes.status, 'Access-Control-Allow-Origin:', cssRes.headers.get('access-control-allow-origin'), 'Length:', (await cssRes.text()).length);
  }
}
test().catch(console.error);

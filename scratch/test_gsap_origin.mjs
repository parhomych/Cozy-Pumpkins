import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const html = `<!DOCTYPE html>
<html>
<body>
  <svg viewBox="0 0 731 1024" width="731" height="1024">
    <g id="joint" transform="translate(265 485)">
      <g id="rotator1">
        <rect x="-240" y="-64" width="262" height="110" fill="red" />
      </g>
    </g>
    <g id="joint2" transform="translate(265 485)">
      <g id="rotator2">
        <rect x="-240" y="-64" width="262" height="110" fill="blue" />
      </g>
    </g>
  </svg>
  <script src="/vendor/gsap.min.js"></script>
  <script>
    // Test 1: without transformOrigin
    gsap.set('#rotator1', { rotation: 30 });
    // Test 2: with transformOrigin "0px 0px"
    gsap.set('#rotator2', { transformOrigin: '0px 0px', rotation: 30 });
  </script>
</body>
</html>`;

// test html
fs.writeFileSync('scratch/test_origin.html', html);

const server = http.createServer((req, res) => {
  console.log('HTTP request:', req.url);
  if (req.url === '/' || req.url === '/test_origin.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync('scratch/test_origin.html'));
  } else if (req.url.startsWith('/vendor/')) {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(fs.readFileSync(path.join(process.cwd(), 'public', req.url)));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8791, async () => {
  const chromeProc = spawn(chromePath, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=9223',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1000));

  const targets = await new Promise((resolve) => {
    http.get('http://localhost:9223/json/list', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
  });

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => new Promise(r => {
    const curId = id++;
    pending.set(curId, r);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  await new Promise(r => ws.onopen = r);
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8791/test_origin.html' });
  await new Promise(r => setTimeout(r, 1200));

  const res = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const r1 = document.getElementById('rotator1');
        const r2 = document.getElementById('rotator2');
        return {
          r1_style_transform: r1 ? r1.style.transform : null,
          r1_attr_transform: r1 ? r1.getAttribute('transform') : null,
          r2_style_transform: r2 ? r2.style.transform : null,
          r2_attr_transform: r2 ? r2.getAttribute('transform') : null,
          gsap_defined: typeof gsap !== 'undefined'
        };
      })()
    `,
    returnByValue: true
  });

  console.log('Results:', res);

  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
});

import { spawn } from 'node:child_process';
import http from 'node:http';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9222',
  '--window-size=1400,900',
  'about:blank'
]);

// Wait 1s for Chrome to start
await new Promise((r) => setTimeout(r, 1000));

// Get WebSocket endpoint from Chrome
const versionData = await new Promise((resolve, reject) => {
  http.get('http://localhost:9222/json/version', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => resolve(JSON.parse(data)));
  }).on('error', reject);
});

console.log('Chrome version:', versionData.Browser);

// Get targets list
const listData = await new Promise((resolve, reject) => {
  http.get('http://localhost:9222/json/list', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => resolve(JSON.parse(data)));
  }).on('error', reject);
});

const target = listData.find(t => t.type === 'page') || listData[0];
const wsUrl = target.webSocketDebuggerUrl;
console.log('Connecting to page:', wsUrl);

const ws = new WebSocket(wsUrl);

let msgId = 1;
const pending = new Map();

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    console.log('[BROWSER CONSOLE]', msg.params.type, ...msg.params.args.map((a) => a.value || a.description));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
  }
  if (msg.id && pending.has(msg.id)) {
    const fn = pending.get(msg.id);
    pending.delete(msg.id);
    fn(msg.result);
  }
};

function send(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((r) => ws.onopen = r);

// Enable Runtime and Page
await send('Runtime.enable');
await send('Page.enable');

// Navigate to admin.html
await send('Page.navigate', { url: 'http://localhost:3000/admin.html' });

// Wait 2s for admin page to connect to socket and render pumpkins
await new Promise((r) => setTimeout(r, 2000));

// Evaluate test script in the page
const evalRes = await send('Runtime.evaluate', {
  expression: `
    (async () => {
      const logs = [];
      const canvas = document.querySelector('#scene-canvas');
      logs.push('Canvas size: ' + canvas.clientWidth + 'x' + canvas.clientHeight);

      const witch = document.querySelector('.witch-assistant');
      logs.push('Witch in DOM: ' + Boolean(witch));
      if (witch) {
        logs.push('Witch initial display/visibility: ' + witch.style.visibility + ' | transform: ' + witch.style.transform);
        logs.push('Witch initial rect: ' + JSON.stringify(witch.getBoundingClientRect()));
      }

      const pumpkins = document.querySelectorAll('.pumpkin-character');
      logs.push('Found pumpkins: ' + pumpkins.length);

      if (pumpkins.length > 0) {
        const first = pumpkins[0];
        logs.push('First pumpkin rect: ' + JSON.stringify(first.getBoundingClientRect()));
        logs.push('Clicking first pumpkin...');
        first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

        await new Promise(r => setTimeout(r, 400));
        const eyesSelect = document.querySelector('[data-slot="eyes"]');
        logs.push('Eyes select: ' + eyesSelect?.value);

        if (eyesSelect) {
          eyesSelect.value = eyesSelect.value === 'stars' ? 'sly' : 'stars';
          eyesSelect.dispatchEvent(new Event('change', { bubbles: true }));
          logs.push('Changed eyes to: ' + eyesSelect.value);

          // Monitor witch for 3 seconds
          for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 300));
            logs.push('T+' + ((i+1)*300) + 'ms -> vis: ' + witch.style.visibility + ' | tr: ' + witch.style.transform + ' | rect: ' + JSON.stringify(witch.getBoundingClientRect()));
          }
        }
      }
      return logs;
    })()
  `,
  awaitPromise: true,
  returnByValue: true
});

console.log('=== EVALUATION RESULTS ===');
console.log(evalRes?.result?.value);

// Capture screenshot
const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
if (screenshotRes?.data) {
  import('node:fs').then(fs => {
    fs.writeFileSync('scratch/admin_live_interaction.png', Buffer.from(screenshotRes.data, 'base64'));
    console.log('Saved admin_live_interaction.png');
  });
}

await new Promise(r => setTimeout(r, 500));

ws.close();
chromeProc.kill();
process.exit(0);

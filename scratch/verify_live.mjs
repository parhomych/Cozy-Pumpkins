import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9240',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9240/json/list', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => resolve(JSON.parse(data)));
  });
});

const target = listData.find((t) => t.type === 'page') || listData[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);

let msgId = 1;
const pending = new Map();

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const fn = pending.get(msg.id);
    pending.delete(msg.id);
    fn(msg);
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
await send('Runtime.enable');
await send('Page.enable');

// Wait 1.5s for pumpkins to load
await new Promise((r) => setTimeout(r, 1500));

// Select first pumpkin and trigger eye change
const setupRes = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const pumpkin = document.querySelector('.pumpkin-character');
      if (!pumpkin) return { error: 'no pumpkin found' };
      pumpkin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      return { ok: true, pumpkinRect: pumpkin.getBoundingClientRect() };
    })()
  `,
  returnByValue: true
});

console.log('Setup res:', JSON.stringify(setupRes?.result?.result?.value, null, 2));

await new Promise((r) => setTimeout(r, 500));

// Change eye selection
await send('Runtime.evaluate', {
  expression: `
    (() => {
      const eyesSelect = document.querySelector('[data-slot="eyes"]');
      if (!eyesSelect) return { error: 'no eyes select' };
      eyesSelect.value = eyesSelect.value === 'cute' ? 'stars' : 'cute';
      eyesSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return { changedTo: eyesSelect.value };
    })()
  `,
  returnByValue: true
});

console.log('Triggered eye change, capturing animation sequence...');

// Capture 10 frames over 3 seconds
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const snap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`scratch/live_frame_${i + 1}.png`, Buffer.from(snap.result.data, 'base64'));

  const status = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const witch = document.querySelector('.witch-assistant');
        if (!witch) return 'no witch';
        const armL = witch.querySelector('.joint-arm-left .rotator');
        const armR = witch.querySelector('.joint-arm-right .rotator');
        return {
          vis: witch.style.visibility,
          transform: witch.style.transform,
          left: witch.style.left,
          top: witch.style.top,
          armL_origin: armL?.getAttribute('data-svg-origin'),
          armL_transform: armL?.getAttribute('transform'),
          armR_origin: armR?.getAttribute('data-svg-origin'),
          armR_transform: armR?.getAttribute('transform')
        };
      })()
    `,
    returnByValue: true
  });
  console.log(`Frame ${i + 1}:`, status?.result?.result?.value);
}

ws.close();
chromeProc.kill();
process.exit(0);

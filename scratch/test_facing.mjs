import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9231',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9231/json/list', (res) => {
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
await send('Runtime.enable');
await send('Page.enable');

await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = window.__previewRenderer?.witchAssistant;
      if (!witch) return 'no witch';
      witch.show();
      witch.setPosition(960, 540);
      witch.setFacing(1); // Currently facing = 1
      return 'ok';
    })()
  `
});

await new Promise((r) => setTimeout(r, 500));

const snapFacing1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/witch_facing_1.png', Buffer.from(snapFacing1.data, 'base64'));

await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = window.__previewRenderer?.witchAssistant;
      witch.setFacing(-1);
    })()
  `
});

await new Promise((r) => setTimeout(r, 500));

const snapFacingMinus1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/witch_facing_minus1.png', Buffer.from(snapFacingMinus1.data, 'base64'));

console.log('Saved scratch/witch_facing_1.png and scratch/witch_facing_minus1.png');

ws.close();
chromeProc.kill();
process.exit(0);

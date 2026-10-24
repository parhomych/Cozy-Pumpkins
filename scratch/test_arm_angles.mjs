import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9270',
  '--window-size=1200,800',
  'http://localhost:3000/test_rig.html'
]);

await new Promise((r) => setTimeout(r, 1800));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9270/json/list', (res) => {
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

await new Promise((r) => setTimeout(r, 1000));

for (const ang of [0, 20, 35, 50]) {
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const witch = window.witch;
        gsap.set(witch.rotators.arm_left, { rotation: -${ang} });
        gsap.set(witch.rotators.arm_right, { rotation: ${ang} });
      })()
    `
  });
  await new Promise((r) => setTimeout(r, 100));
  const snap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`scratch/arm_test_${ang}.png`, Buffer.from(snap.data, 'base64'));
}

ws.close();
chromeProc.kill();
console.log('Arm tests captured!');

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9233',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9233/json/list', (res) => {
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

const evalCheck = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = window.__previewRenderer?.witchAssistant;
      if (!witch) return { error: 'no witch' };
      return { ok: true, transform: witch.element.style.transform };
    })()
  `,
  returnByValue: true
});

console.log('Eval check:', JSON.stringify(evalCheck, null, 2));

ws.close();
chromeProc.kill();
process.exit(0);

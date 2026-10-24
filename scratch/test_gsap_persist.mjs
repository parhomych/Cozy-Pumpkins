import { spawn } from 'node:child_process';
import http from 'node:http';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9235',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9235/json/list', (res) => {
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

const evalRes = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const armL = document.querySelector('.joint-arm-left .rotator');
      
      // Step 1: Set transformOrigin once
      gsap.set(armL, { transformOrigin: '240px 64px' });
      const step1 = armL.getAttribute('data-svg-origin');

      // Step 2: Animate with gsap.to without mentioning transformOrigin
      gsap.to(armL, { rotation: 45, duration: 0.1 });
      const step2 = armL.getAttribute('data-svg-origin');

      // Step 3: Animate with gsap.fromTo without mentioning transformOrigin
      gsap.fromTo(armL, { rotation: -30 }, { rotation: 30, duration: 0.1 });
      const step3 = armL.getAttribute('data-svg-origin');

      return { step1, step2, step3 };
    })()
  `,
  returnByValue: true
});

console.log('GSAP transformOrigin persistence:', JSON.stringify(evalRes?.result?.result?.value || evalRes, null, 2));

ws.close();
chromeProc.kill();
process.exit(0);

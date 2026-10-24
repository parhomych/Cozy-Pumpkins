import { spawn } from 'node:child_process';
import http from 'node:http';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9229',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9229/json/list', (res) => {
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

const evalRes = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const armL = document.querySelector('.joint-arm-left .rotator');
      gsap.set(armL, { transformOrigin: '240px 64px' });

      function getPt(armEl, x, y) {
        const ctm = armEl.getCTM();
        const pt = armEl.ownerSVGElement.createSVGPoint();
        pt.x = x;
        pt.y = y;
        const res = pt.matrixTransform(ctm);
        return { x: Math.round(res.x), y: Math.round(res.y) };
      }

      const shoulders = {};
      for (const rot of [-60, -30, 0, 30, 60]) {
        gsap.set(armL, { rotation: rot });
        shoulders['rot_' + rot] = getPt(armL, 0, 0);
      }
      return shoulders;
    })()
  `,
  returnByValue: true
});

console.log('Shoulder position at various rotations:');
console.log(JSON.stringify(evalRes?.result?.value, null, 2));

ws.close();
chromeProc.kill();
process.exit(0);

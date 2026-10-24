import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9232',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9232/json/list', (res) => {
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

// Test Idle Pose with proper origins
await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = window.__previewRenderer?.witchAssistant;
      const parts = {
        head: { x: 80, y: 21, pivotX: 365, pivotY: 440 },
        torso: { x: 179, y: 453, pivotX: 365, pivotY: 580 },
        arm_left: { x: 25, y: 421, pivotX: 265, pivotY: 485 },
        arm_right: { x: 413, y: 449, pivotX: 435, pivotY: 485 },
        wing_left: { x: 120, y: 420, pivotX: 265, pivotY: 465 },
        wing_right: { x: 425, y: 420, pivotX: 435, pivotY: 465 },
        leg_left: { x: 210, y: 640, pivotX: 280, pivotY: 680 },
        leg_right: { x: 345, y: 640, pivotX: 395, pivotY: 680 },
        tail: { x: 470, y: 705, pivotX: 485, pivotY: 715 },
      };

      for (const [k, meta] of Object.entries(parts)) {
        const el = witch.rotators[k];
        if (el) {
          gsap.set(el, { transformOrigin: (meta.pivotX - meta.x) + 'px ' + (meta.pivotY - meta.y) + 'px' });
        }
      }

      witch.show();
      witch.setPosition(960, 540);
      witch.setFacing(1); // Facing right
      witch._setPose('idle');
    })()
  `
});

await new Promise((r) => setTimeout(r, 400));
const snapIdle = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/pose_idle_facing_right.png', Buffer.from(snapIdle.data, 'base64'));

// Test Magic Pose
await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = window.__previewRenderer?.witchAssistant;
      gsap.to(witch.rotators.arm_left, { rotation: 25, duration: 0.1 });
      gsap.to(witch.rotators.arm_right, { rotation: -25, duration: 0.1 });
    })()
  `
});

await new Promise((r) => setTimeout(r, 400));
const snapMagic = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/pose_magic_facing_right.png', Buffer.from(snapMagic.data, 'base64'));

console.log('Saved poses successfully!');

ws.close();
chromeProc.kill();
process.exit(0);

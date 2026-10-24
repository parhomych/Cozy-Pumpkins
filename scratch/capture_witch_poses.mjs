import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9245;

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${port}`,
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1800));

const listData = await new Promise((resolve) => {
  http.get(`http://localhost:${port}/json/list`, (res) => {
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

// Wait for page to initialize
await new Promise((r) => setTimeout(r, 1000));

// Setup witch assistant in preview container
await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = window.__previewRenderer?.witchAssistant;
      if (!witch) return 'no witch';
      witch.show();
      witch.setPosition(960, 520);
      witch.setFacing(1); // facing right
      witch._setPose('idle');
      return 'ok';
    })()
  `
});

await new Promise((r) => setTimeout(r, 600));

// 1. Capture Idle
const snapIdle = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/snap_user_idle.png', Buffer.from(snapIdle.data, 'base64'));

// 2. Start Idle Breathing
await send('Runtime.evaluate', {
  expression: `window.__previewRenderer?.witchAssistant?.startIdle()`
});
await new Promise((r) => setTimeout(r, 800));
const snapBreathing = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/snap_user_breathing.png', Buffer.from(snapBreathing.data, 'base64'));

// 3. Start Walk
await send('Runtime.evaluate', {
  expression: `window.__previewRenderer?.witchAssistant?.startWalk()`
});
await new Promise((r) => setTimeout(r, 220));
const snapWalk = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/snap_user_walk.png', Buffer.from(snapWalk.data, 'base64'));

// 4. Start Magic
await send('Runtime.evaluate', {
  expression: `window.__previewRenderer?.witchAssistant?.performMagic(2.0)`
});
await new Promise((r) => setTimeout(r, 600));
const snapMagic = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/snap_user_magic.png', Buffer.from(snapMagic.data, 'base64'));

// 5. Start Celebrate
await send('Runtime.evaluate', {
  expression: `window.__previewRenderer?.witchAssistant?.celebrate()`
});
await new Promise((r) => setTimeout(r, 260));
const snapCelebrate = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/snap_user_celebrate.png', Buffer.from(snapCelebrate.data, 'base64'));

ws.close();
chromeProc.kill();
console.log('All screenshots captured successfully!');

import { spawn } from 'node:child_process';
import http from 'node:http';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chromeProc = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9241',
  '--window-size=1400,900',
  'http://localhost:3000/admin.html'
]);

await new Promise((r) => setTimeout(r, 1500));

const listData = await new Promise((resolve) => {
  http.get('http://localhost:9241/json/list', (res) => {
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

await new Promise((r) => setTimeout(r, 1500));

// Queue a mission entering from the right
await send('Runtime.evaluate', {
  expression: `
    (() => {
      const witch = document.querySelector('.witch-assistant');
      const pumpkin = document.querySelector('.pumpkin-character');
      const renderer = pumpkin?.__pumpkinRenderer || window.__previewRenderer;
      
      // Call queueMission with side: 'right'
      const witchObj = window.__adminWitchAssistant || (function() {
        // Find witch instance
        return pumpkin?.character?.renderer?.witchAssistant;
      })();

      return { ok: true };
    })()
  `,
  returnByValue: true
});

// Test walkTo directly on witchAssistant to test leftward movement
const walkTest = await send('Runtime.evaluate', {
  expression: `
    (async () => {
      // Find witch element
      const el = document.querySelector('.witch-assistant');
      // Create a WitchAssistant directly to test walk left
      const { WitchAssistant } = await import('/js/shared/witch-assistant.js?v=witch-assistant-20261025');
      const testWitch = new WitchAssistant(document.body);
      testWitch.setPosition(1500, 500);
      testWitch.show();

      // Walk from 1500 to 500 (moving left)
      const walkPromise = testWitch.walkTo(500, 500);
      
      await new Promise(r => setTimeout(r, 200));
      const midWalkTransform = testWitch.element.style.transform;
      const midWalkFacing = testWitch.facing;
      
      await walkPromise;
      const endWalkTransform = testWitch.element.style.transform;

      testWitch.destroy();
      return { midWalkTransform, midWalkFacing, endWalkTransform };
    })()
  `,
  awaitPromise: true,
  returnByValue: true
});

console.log('Leftward walk test result:');
console.log(JSON.stringify(walkTest?.result?.result?.value, null, 2));

ws.close();
chromeProc.kill();
process.exit(0);

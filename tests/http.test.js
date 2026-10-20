import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';
import { Database } from '../src/db/database.js';
import { testConfig } from './helpers.js';

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('server serves status and both user-facing HTML pages without leaking secrets', async () => {
  const runtime = createServer({ config: testConfig(), db: new Database(':memory:'), publicDir: fileURLToPath(new URL('../public/', import.meta.url)) });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const status = await request(port, '/api/status');
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body).ok, true);
    assert.equal(status.body.includes('TOKEN_ENCRYPTION_KEY'), false);
    assert.equal((await request(port, '/admin.html')).status, 200);
    assert.equal((await request(port, '/overlay.html')).status, 200);
    const cookie = status.headers['set-cookie']?.[0]?.split(';')[0];
    const donationBody = JSON.stringify({ id: 'http-donation-1', name: 'HTTP Viewer', amount: 100, currency: 'RUB', message: '!тыковка ведьма рожки' });
    const donation = await request(port, '/api/dev/donation', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: donationBody });
    assert.equal(donation.status, 201);
    assert.equal(JSON.parse(donation.body).result.pumpkin.customization.skin, 'witch');
    const duplicate = await request(port, '/api/dev/donation', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: donationBody });
    assert.equal(duplicate.status, 200);
    assert.equal(JSON.parse(duplicate.body).result.duplicate, true);
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

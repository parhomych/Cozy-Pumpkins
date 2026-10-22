import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';
import { Database } from '../src/db/database.js';
import { TokenStore } from '../src/auth/token-store.js';
import { testConfig } from './helpers.js';

class CloseTrackingWebSocket {
  static instances = [];

  constructor() {
    this.listeners = new Map();
    this.readyState = 1;
    this.closed = false;
    CloseTrackingWebSocket.instances.push(this);
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.listeners.get('close')?.();
  }
}

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
    const created = JSON.parse(donation.body).result.pumpkin;
    assert.equal(created.customization.skin, 'witch');
    assert.equal('animation' in created, false);
    const testReward = await request(port, '/api/dev/reward', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ action: 'pumpkin_tower' }) });
     assert.equal(testReward.status, 201);
     assert.equal(JSON.parse(testReward.body).result.test, true);
     assert.equal(JSON.parse(testReward.body).result.global, true);
     const updated = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ animation: { eyeFrequency: 2.5, mouthFrequency: 0.5 } }) });
    assert.equal(updated.status, 200);
     assert.deepEqual(JSON.parse(updated.body).settings.animation, { eyeFrequency: 2.5, mouthFrequency: 0.5 });
     const tower = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ towerAnimation: { swayAmplitude: 24, swayDuration: 3, lifetimeMinSeconds: 4, lifetimeMaxSeconds: 12, stackOrder: 'largest-first' } }) });
     assert.equal(tower.status, 200);
     assert.deepEqual(JSON.parse(tower.body).settings.towerAnimation, { swayAmplitude: 24, swayDuration: 3, rotationMultiplier: 1, bendMultiplier: 1, lifetimeMinSeconds: 4, lifetimeMaxSeconds: 12, stackOrder: 'largest-first' });
    const mapping = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ rewardMapping: { inflate: 'reward-inflate', ghost: ' reward-ghost ' } }) });
      assert.equal(mapping.status, 200);
    assert.deepEqual(JSON.parse(mapping.body).settings.rewardMapping, { inflate: 'reward-inflate', jump_on: '', morph_fly: '', bat: '', ghost: 'reward-ghost', pumpkin_tower: '' });
    const partialMapping = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ rewardMapping: { bat: 'reward-bat' } }) });
      assert.equal(partialMapping.status, 200);
    assert.deepEqual(JSON.parse(partialMapping.body).settings.rewardMapping, { inflate: 'reward-inflate', jump_on: '', morph_fly: '', bat: 'reward-bat', ghost: 'reward-ghost', pumpkin_tower: '' });
    const invalidMapping = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ rewardMapping: { jump_on: 42 } }) });
    assert.equal(invalidMapping.status, 400);
    assert.equal(JSON.parse(invalidMapping.body).error, 'invalid_reward_mapping');
    const publicRead = await request(port, '/api/settings');
     assert.deepEqual(JSON.parse(publicRead.body).settings.animation, { eyeFrequency: 2.5, mouthFrequency: 0.5 });
     assert.deepEqual(JSON.parse(publicRead.body).settings.towerAnimation, { swayAmplitude: 24, swayDuration: 3, rotationMultiplier: 1, bendMultiplier: 1, lifetimeMinSeconds: 4, lifetimeMaxSeconds: 12, stackOrder: 'largest-first' });
     const invalidTower = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ towerAnimation: { bendMultiplier: 99 } }) });
     assert.equal(invalidTower.status, 400);
     assert.equal(JSON.parse(invalidTower.body).error, 'invalid_tower_animation');
     const invalidTowerRange = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ towerAnimation: { lifetimeMinSeconds: 13 } }) });
     assert.equal(invalidTowerRange.status, 400);
     assert.equal(JSON.parse(invalidTowerRange.body).error, 'invalid_tower_animation');
     const invalidTowerOrder = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ towerAnimation: { stackOrder: 'smallest-first' } }) });
     assert.equal(invalidTowerOrder.status, 400);
     assert.equal(JSON.parse(invalidTowerOrder.body).error, 'invalid_tower_animation');
    const invalid = await request(port, '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ animation: { eyeFrequency: 0 } }) });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.parse(invalid.body).error, 'invalid_animation');
    const duplicate = await request(port, '/api/dev/donation', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: donationBody });
    assert.equal(duplicate.status, 200);
    assert.equal(JSON.parse(duplicate.body).result.duplicate, true);
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('spawn settings persist, reject invalid updates, and expose the read-only customization catalog', async () => {
  const config = testConfig();
  const runtime = createServer({ config, db: new Database(':memory:'), publicDir: null });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const firstRead = await request(port, '/api/settings');
    const defaults = JSON.parse(firstRead.body);
    assert.equal(defaults.settings.minSpawnDonation, 0);
    assert.equal(defaults.settings.spawnCommand, '!тыковка');
    assert.ok(Array.isArray(defaults.customizationCatalog));
    const skinGroup = defaults.customizationCatalog.find(({ slot }) => slot === 'skin');
    assert.ok(skinGroup.values.some(({ value, keywords }) => value === 'witch' && keywords.includes('ведьма')));

    const cookie = firstRead.headers['set-cookie']?.[0]?.split(';')[0];
    const update = await request(port, '/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ minSpawnDonation: 250, spawnCommand: '  !pumpkin  ' }),
    });
    assert.equal(update.status, 200);
    assert.equal(JSON.parse(update.body).settings.minSpawnDonation, 250);
    assert.equal(JSON.parse(update.body).settings.spawnCommand, '!pumpkin');
    for (const invalid of [
      { minSpawnDonation: -1 },
      { minSpawnDonation: 'Infinity' },
      { spawnCommand: '   ' },
      { spawnCommand: 'x'.repeat(65) },
    ]) {
      const response = await request(port, '/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(invalid),
      });
      assert.equal(response.status, 400);
    }
    const finalRead = await request(port, '/api/settings');
    assert.equal(JSON.parse(finalRead.body).settings.minSpawnDonation, 250);
    assert.equal(JSON.parse(finalRead.body).settings.spawnCommand, '!pumpkin');
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('growth thresholds use configured defaults, persist valid values, and reject invalid updates', async () => {
  const config = testConfig();
  const runtime = createServer({ config, db: new Database(':memory:'), publicDir: null });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const firstRead = await request(port, '/api/settings');
    const defaults = JSON.parse(firstRead.body);
    assert.deepEqual(defaults.settings.growthThresholds, config.thresholds);
    const cookie = firstRead.headers['set-cookie']?.[0]?.split(';')[0];
    const validThresholds = { stage2: 350, stage3: 1200, stage4: 4500 };
    const update = await request(port, '/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ growthThresholds: validThresholds }),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(JSON.parse(update.body).settings.growthThresholds, validThresholds);

    for (const invalid of [
      { stage2: '', stage3: 1000, stage4: 3000 },
      { stage2: -1, stage3: 1000, stage4: 3000 },
      { stage2: 300, stage3: 300, stage4: 3000 },
      { stage2: 500, stage3: 400, stage4: 3000 },
      { stage2: 300, stage3: 1000 },
    ]) {
      const response = await request(port, '/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ growthThresholds: invalid }),
      });
      assert.equal(response.status, 400);
    }
    const finalRead = await request(port, '/api/settings');
    assert.deepEqual(JSON.parse(finalRead.body).settings.growthThresholds, validThresholds);
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('growth multipliers use configured defaults, persist four valid values, and reject invalid updates', async () => {
  const config = testConfig();
  const runtime = createServer({ config, db: new Database(':memory:'), publicDir: null });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const firstRead = await request(port, '/api/settings');
    const defaults = JSON.parse(firstRead.body);
    assert.deepEqual(defaults.settings.growthMultipliers, config.growthMultipliers);
    const cookie = firstRead.headers['set-cookie']?.[0]?.split(';')[0];
    const validMultipliers = { stage1: 0.5, stage2: 0.8, stage3: 1.15, stage4: 1.4 };
    const update = await request(port, '/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ growthMultipliers: validMultipliers }),
    });
    assert.equal(update.status, 200);
    assert.deepEqual(JSON.parse(update.body).settings.growthMultipliers, validMultipliers);
    for (const invalid of [
      { stage1: 0, stage2: 0.8, stage3: 1.15, stage4: 1.4 },
      { stage1: -1, stage2: 0.8, stage3: 1.15, stage4: 1.4 },
      { stage1: 0.5, stage2: 'x', stage3: 1.15, stage4: 1.4 },
      { stage1: 0.5, stage2: 0.8, stage3: 1.15 },
    ]) {
      const response = await request(port, '/api/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ growthMultipliers: invalid }),
      });
      assert.equal(response.status, 400);
    }
    const finalRead = await request(port, '/api/settings');
    assert.deepEqual(JSON.parse(finalRead.body).settings.growthMultipliers, validMultipliers);
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('Twitch reward catalog requires auth and returns only normalized public reward fields', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization });
    return new Response(JSON.stringify({
      data: [{
        id: 'reward-1',
        title: 'Pumpkin bounce',
        cost: 250,
        is_enabled: true,
        is_user_input_required: false,
      }],
      pagination: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const config = testConfig({ TWITCH_CLIENT_ID: 'test-client-id', TWITCH_CLIENT_SECRET: 'private-client-secret' });
  const runtime = createServer({ config, db: new Database(':memory:'), fetchImpl, publicDir: null });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const disconnected = await request(port, '/api/twitch/rewards');
    assert.equal(disconnected.status, 200);
    assert.equal(JSON.parse(disconnected.body).connected, false);
    assert.deepEqual(JSON.parse(disconnected.body).rewards, []);
    assert.equal(calls.length, 0);

    runtime.tokenStore.save('twitch', {
      accessToken: 'private-access-token',
      providerUserId: 'broadcaster-1',
      providerLogin: 'cozypumpkins',
    });
    runtime.statuses.set('twitch', { authStatus: 'Connected' });
    const response = await request(port, '/api/twitch/rewards');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      connected: true,
      rewards: [{
        id: 'reward-1',
        title: 'Pumpkin bounce',
        cost: 250,
        isEnabled: true,
        isUserInputRequired: false,
      }],
    });
    assert.equal(calls[0].authorization, 'Bearer private-access-token');
    assert.equal(calls[0].url, 'https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=broadcaster-1');
    assert.equal(response.body.includes('private-access-token'), false);
    assert.equal(response.body.includes('private-client-secret'), false);
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('Twitch reward catalog failures are safe and leave mappings intact', async () => {
  const config = testConfig({ TWITCH_CLIENT_ID: 'test-client-id' });
  const runtime = createServer({
    config,
    db: new Database(':memory:'),
    fetchImpl: async () => new Response('private provider error', { status: 403 }),
    publicDir: null,
  });
  runtime.db.updateSettings({ rewardMapping: { inflate: 'saved-reward' } }, config);
  runtime.tokenStore.save('twitch', { accessToken: 'private-access-token', providerUserId: 'broadcaster-1' });
  runtime.statuses.set('twitch', { authStatus: 'Connected' });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const response = await request(port, '/api/twitch/rewards');
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { error: 'twitch_scope_missing' });
    assert.equal(response.body.includes('private provider error'), false);
    assert.equal(runtime.db.getSettings(config).rewardMapping.inflate, 'saved-reward');
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('saved Twitch authorization is not reported as live and stays independent from DonationAlerts', async () => {
  const config = testConfig();
  const db = new Database(':memory:');
  const tokens = new TokenStore(db, config.tokenEncryptionKey);
  tokens.save('twitch', { accessToken: 'twitch-private-token', providerUserId: 'broadcaster-1', providerLogin: 'cozypumpkins' });
  tokens.save('donationalerts', { accessToken: 'da-private-token', providerUserId: 'da-account', providerLogin: 'donorhost' });
  const runtime = createServer({ config, db, publicDir: null });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(runtime.server.address().port, '/api/status');
    const integrations = JSON.parse(response.body).integrations;
    const twitch = integrations.find(({ provider }) => provider === 'twitch');
    const donationAlerts = integrations.find(({ provider }) => provider === 'donationalerts');
    assert.equal(twitch.authStatus, 'Connected');
    assert.equal(twitch.connectionStatus, 'Disconnected');
    assert.equal(twitch.account, 'cozypumpkins');
    assert.equal(donationAlerts.authStatus, 'Connected');
    assert.equal(JSON.stringify(integrations).includes('private-token'), false);
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('donation OAuth callbacks start providers independently and logout stops only the selected client', async () => {
  const config = testConfig({
    DA_CLIENT_ID: 'da-client',
    DA_CLIENT_SECRET: 'da-secret',
    DONATEX_CLIENT_ID: 'donatex-client',
    DONATEX_CLIENT_SECRET: 'donatex-secret',
    MEMEALERTS_CLIENT_ID: 'memealerts-client',
    MEMEALERTS_CLIENT_SECRET: 'memealerts-secret',
  });
  const db = new Database(':memory:');
  const runtime = createServer({
    config,
    db,
    publicDir: null,
    fetchImpl: async (url) => {
      if (url.endsWith('/oauth/token') || url.endsWith('/api/connect/token')) {
        return new Response(JSON.stringify({ access_token: 'provider-access-token', refresh_token: 'provider-refresh-token', expires_in: 3600 }));
      }
      return new Response(JSON.stringify({ data: { id: 'provider-account-id', username: 'channel-name', displayName: 'Channel Name' } }));
    },
  });
  const started = [];
  const stopped = [];
  for (const provider of ['donationalerts', 'donatex', 'memealerts']) {
    runtime.providerEvents[provider].start = async () => { started.push(provider); };
    runtime.providerEvents[provider].stop = async () => { stopped.push(provider); };
  }
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const statusResponse = await request(port, '/api/status');
    const cookie = statusResponse.headers['set-cookie']?.[0]?.split(';')[0];
    for (const provider of ['donationalerts', 'donatex', 'memealerts']) {
      const authorization = new URL(runtime.oauth.authorizationUrl(provider));
      const query = new URLSearchParams({ code: 'provider-auth-code', state: authorization.searchParams.get('state') });
      const callback = await request(port, `/api/auth/${provider}/callback?${query}`);
      assert.equal(callback.status, 302);
      assert.equal(runtime.statuses.public(provider).authStatus, 'Connected');
      assert.deepEqual(started, ['donationalerts', 'donatex', 'memealerts'].slice(0, started.length));
    }
    const integrations = JSON.parse((await request(port, '/api/status')).body).integrations;
    assert.equal(integrations.length, 4);
    assert.equal(JSON.stringify(integrations).includes('provider-account-id'), false);
    const logout = await request(port, '/api/auth/memealerts/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.deepEqual(stopped, ['memealerts']);
    assert.equal(runtime.tokenStore.get('memealerts'), null);
    assert.notEqual(runtime.tokenStore.get('donationalerts'), null);
    assert.notEqual(runtime.tokenStore.get('donatex'), null);
  } finally {
    await runtime.shutdown();
    db.close();
  }
});

test('Twitch logout stops its listener and clears local tokens even if remote revoke is unreachable', async () => {
  const order = [];
  const config = testConfig({ TWITCH_CLIENT_ID: 'test-client-id' });
  const db = new Database(':memory:');
  const tokens = new TokenStore(db, config.tokenEncryptionKey);
  tokens.save('twitch', { accessToken: 'twitch-private-token', providerUserId: 'broadcaster-1', providerLogin: 'cozypumpkins' });
  tokens.save('donationalerts', { accessToken: 'da-private-token', providerUserId: 'da-account', providerLogin: 'donorhost' });
  const runtime = createServer({
    config,
    db,
    publicDir: null,
    fetchImpl: async () => {
      order.push('revoke');
      throw new Error('network error includes no safe provider confirmation');
    },
  });
  const stop = runtime.twitchEventSub.stop.bind(runtime.twitchEventSub);
  runtime.twitchEventSub.stop = async (options) => { order.push('stop'); return stop(options); };
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const initial = await request(port, '/api/status');
    const cookie = initial.headers['set-cookie']?.[0]?.split(';')[0];
    const response = await request(port, '/api/auth/twitch/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(order, ['stop', 'revoke']);
    assert.equal(JSON.parse(response.body).remoteRevoked, false);
    assert.equal(response.body.includes('twitch-private-token'), false);
    assert.equal(runtime.tokenStore.get('twitch'), null);
    assert.equal(runtime.statuses.public('twitch').authStatus, 'Disconnected');
    assert.equal(runtime.statuses.public('twitch').connectionStatus, 'Disconnected');
    assert.equal(runtime.statuses.public('donationalerts').authStatus, 'Connected');
    assert.equal(runtime.tokenStore.get('donationalerts').accessToken, 'da-private-token');
  } finally {
    runtime.db.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('server shutdown stops Twitch EventSub and leaves DonationAlerts connected', async () => {
  CloseTrackingWebSocket.instances = [];
  const config = testConfig();
  const db = new Database(':memory:');
  const tokens = new TokenStore(db, config.tokenEncryptionKey);
  tokens.save('twitch', { accessToken: 'twitch-private-token', providerUserId: 'broadcaster-1' });
  tokens.save('donationalerts', { accessToken: 'da-private-token', providerUserId: 'da-account' });
  const runtime = createServer({ config, db, publicDir: null, WebSocketImpl: CloseTrackingWebSocket });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  try {
    await runtime.twitchEventSub.start();
    assert.equal(CloseTrackingWebSocket.instances.length, 1);
    await runtime.shutdown();
    assert.equal(CloseTrackingWebSocket.instances[0].closed, true);
    assert.equal(runtime.server.listening, false);
    assert.equal(runtime.statuses.public('twitch').connectionStatus, 'Disconnected');
    assert.equal(runtime.statuses.public('donationalerts').authStatus, 'Connected');
  } finally {
    if (runtime.server.listening) await runtime.shutdown();
    db.close();
  }
});

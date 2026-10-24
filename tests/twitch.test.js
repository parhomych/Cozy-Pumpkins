import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TwitchEventSub } from '../src/integrations/twitch-eventsub.js';
import { TwitchApiClient } from '../src/integrations/twitch-api.js';
import { createApp } from '../server.js';
import { Database } from '../src/db/database.js';
import { RewardService } from '../src/engine/rewards.js';
import { testConfig } from './helpers.js';

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.readyState = 1;
    this.closed = false;
    this.closeCalls = [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, event = {}) {
    this.listeners.get(type)?.(event);
  }

  message(payload) {
    this.emit('message', { data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }

  close(code = 1000, reason = '') {
    if (code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException('invalid code', 'InvalidAccessError');
    }
    if (this.readyState === 2 || this.readyState === 3) return;
    this.closeCalls.push({ code, reason });
    this.readyState = 2;
    this.closed = true;
    this.emit('close');
    this.readyState = 3;
  }
}

test('EventSub subscribes on welcome, delivers only valid redemptions, and resumes on reconnect', async () => {
  MockWebSocket.instances = [];
  const statuses = [];
  const redemptions = [];
  const subscriptions = [];
  const timers = [];
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) },
    twitchApi: {
      async createRedemptionSubscription(value) {
        subscriptions.push(value);
        return { type: 'channel.channel_points_custom_reward_redemption.add', status: 'enabled' };
      },
    },
    statuses: { set: (_provider, value) => statuses.push(value) },
    onRedemption: (value) => redemptions.push(value),
    WebSocketImpl: MockWebSocket,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
  });

  await client.start();
  const first = MockWebSocket.instances[0];
  assert.equal(first.url, 'wss://eventsub.wss.twitch.tv/ws');
  first.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'session-1', keepalive_timeout_seconds: 10 } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(subscriptions, [{
    accessToken: 'private-token',
    broadcasterId: 'broadcaster-1',
    sessionId: 'session-1',
  }]);
  assert.equal(statuses.at(-1).connectionStatus, 'Listening');

  first.message({ metadata: { message_type: 'session_keepalive' }, payload: {} });
  first.message({
    metadata: {
      message_type: 'notification',
      subscription_type: 'channel.channel_points_custom_reward_redemption.add',
    },
    payload: { event: { id: 'redemption-1', reward: { id: 'reward-1' } } },
  });
  first.message({
    metadata: { message_type: 'notification', subscription_type: 'channel.follow' },
    payload: { event: { id: 'not-a-redemption' } },
  });
  first.message('{invalid json');
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].id, 'redemption-1');

  first.message({
    metadata: { message_type: 'session_reconnect' },
    payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?keep=1' } },
  });
  const second = MockWebSocket.instances[1];
  assert.equal(second.url, 'wss://eventsub.wss.twitch.tv/ws?keep=1');
  assert.equal(first.closed, true);
  second.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'session-2', keepalive_timeout_seconds: 10 } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(subscriptions.length, 1);
  assert.equal(statuses.at(-1).connectionStatus, 'Listening');
  assert.equal(timers.length > 0, true);
  await client.stop();
  assert.equal(second.closed, true);
  assert.equal(statuses.at(-1).connectionStatus, 'Disconnected');
});

test('EventSub uses a refreshed Twitch access token when creating redemption subscriptions', async () => {
  MockWebSocket.instances = [];
  let tokenCalls = 0;
  let subscribedWith;
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'stale-token', providerUserId: 'broadcaster-1' }) },
    getAccessToken: async () => `fresh-token-${++tokenCalls}`,
    twitchApi: {
      async createRedemptionSubscription(value) { subscribedWith = value.accessToken; },
    },
    statuses: { set: () => {} },
    WebSocketImpl: MockWebSocket,
    logger: { warn() {} },
  });

  await client.start();
  MockWebSocket.instances[0].message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'session-fresh-token', keepalive_timeout_seconds: 10 } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(tokenCalls, 2);
  assert.equal(subscribedWith, 'fresh-token-2');
  await client.stop();
});

test('EventSub keepalive timeout schedules reconnect and closes the socket once with a valid code', async () => {
  MockWebSocket.instances = [];
  const statuses = [];
  const timers = [];
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) },
    twitchApi: { async createRedemptionSubscription() { return {}; } },
    statuses: { set: (_provider, value) => statuses.push(value) },
    WebSocketImpl: MockWebSocket,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
    logger: { warn() {} },
  });

  await client.start();
  const socket = MockWebSocket.instances[0];
  socket.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'session-timeout', keepalive_timeout_seconds: 1 } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const keepalive = timers.find((timer) => timer.delay === 2000 && !timer.cleared);
  assert.ok(keepalive);

  assert.doesNotThrow(() => keepalive.callback());
  assert.deepEqual(socket.closeCalls.map(({ code }) => code), [4001]);
  assert.equal(statuses.at(-1).connectionStatus, 'Retrying');
  assert.ok(timers.find((timer) => timer.delay === 1000 && !timer.cleared));
  await client.stop();
});

test('EventSub keeps retrying after more than eight interruptions with a capped delay', async () => {
  MockWebSocket.instances = [];
  const timers = [];
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) },
    twitchApi: { async createRedemptionSubscription() { return {}; } },
    statuses: { set: () => {} },
    WebSocketImpl: MockWebSocket,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
    logger: { warn() {} },
  });

  await client.start();
  const retryDelays = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    client.scheduleReconnect('Simulated temporary interruption.');
    const retry = timers.filter((timer) => timer.delay <= 30_000 && !timer.cleared).at(-1);
    retryDelays.push(retry.delay);
    retry.callback();
  }

  assert.equal(client.running, true);
  assert.equal(client.reconnectAttempts, 10);
  assert.equal(retryDelays.at(-1), 30_000);
  await client.stop();
});

test('EventSub does not reset retry backoff until a keepalive proves the connection healthy', async () => {
  MockWebSocket.instances = [];
  const timers = [];
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) },
    twitchApi: { async createRedemptionSubscription() { return {}; } },
    statuses: { set: () => {} },
    WebSocketImpl: MockWebSocket,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
    logger: { warn() {} },
  });

  await client.start();
  client.scheduleReconnect('Simulated initial interruption.');
  const firstRetry = timers.find((timer) => timer.delay === 1000 && !timer.cleared);
  firstRetry.callback();
  const reconnected = MockWebSocket.instances.at(-1);
  reconnected.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'unstable-session', keepalive_timeout_seconds: 10 } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.reconnectAttempts, 1);
  client.scheduleReconnect('Simulated repeated timeout.');
  assert.ok(timers.find((timer) => timer.delay === 2000 && !timer.cleared));

  await client.stop();
});

test('EventSub reconnect still schedules when closing the old socket throws', async () => {
  MockWebSocket.instances = [];
  const timers = [];
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) },
    twitchApi: { async createRedemptionSubscription() { return {}; } },
    statuses: { set: () => {} },
    WebSocketImpl: MockWebSocket,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
    logger: { warn() {} },
  });

  await client.start();
  const socket = MockWebSocket.instances[0];
  socket.close = () => { throw new DOMException('invalid code', 'InvalidAccessError'); };

  assert.doesNotThrow(() => client.scheduleReconnect('Testing reconnect close failure.'));
  assert.ok(timers.find((timer) => timer.delay === 1000 && !timer.cleared));
  await client.stop();
});

test('Twitch Helix client pages rewards and returns safe errors', async () => {
  const requests = [];
  const config = testConfig({ TWITCH_CLIENT_ID: 'client-id' });
  const tokenStore = { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) };
  const pages = [
    { data: [{ id: 'reward-1', title: 'First', cost: 10, is_enabled: true }], pagination: { cursor: 'next' } },
    { data: [{ id: 'reward-2', title: 'Second', cost: 20, is_enabled: false }], pagination: {} },
  ];
  const api = new TwitchApiClient({
    config,
    tokenStore,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    },
  });
  assert.deepEqual(await api.listChannelRewards(), [
    { id: 'reward-1', title: 'First', cost: 10, isEnabled: true, isUserInputRequired: false },
    { id: 'reward-2', title: 'Second', cost: 20, isEnabled: false, isUserInputRequired: false },
  ]);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /after=next/u);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-token');

  const rejected = new TwitchApiClient({
    config,
    tokenStore,
    fetchImpl: async () => new Response('token must not leak', { status: 403 }),
  });
  await assert.rejects(rejected.listChannelRewards(), { message: 'twitch_scope_missing' });
});

test('EventSub retries interrupted sockets, recovers, and stops on revoked subscription', async () => {
  MockWebSocket.instances = [];
  const statuses = [];
  const timers = [];
  const client = new TwitchEventSub({
    tokenStore: { get: () => ({ accessToken: 'private-token', providerUserId: 'broadcaster-1' }) },
    twitchApi: { async createRedemptionSubscription() {
      return { type: 'channel.channel_points_custom_reward_redemption.add', status: 'enabled' };
    } },
    statuses: { set: (_provider, value) => statuses.push(value) },
    WebSocketImpl: MockWebSocket,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
  });
  await client.start();
  MockWebSocket.instances[0].emit('close');
  assert.equal(statuses.at(-1).connectionStatus, 'Retrying');
  const retry = timers.find((timer) => timer.delay === 1000 && !timer.cleared);
  assert.ok(retry);
  retry.callback();
  assert.equal(MockWebSocket.instances.length, 2);
  const recovered = MockWebSocket.instances[1];
  recovered.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'recovered-session', keepalive_timeout_seconds: 10 } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statuses.at(-1).connectionStatus, 'Listening');
  recovered.message({ metadata: { message_type: 'revocation' }, payload: {} });
  assert.equal(statuses.at(-1).connectionStatus, 'Error');
  assert.equal(client.running, false);
  await client.stop();
  assert.equal(recovered.closed, true);
  assert.equal(statuses.at(-1).connectionStatus, 'Disconnected');
});

test('server wiring applies an appearance redemption only to the mapped viewer pumpkin once', async () => {
  MockWebSocket.instances = [];
  const config = testConfig({ TWITCH_CLIENT_ID: 'test-client' });
  const db = new Database(':memory:');
  const runtime = createApp({
    config,
    db,
    publicDir: null,
    WebSocketImpl: MockWebSocket,
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{ type: 'channel.channel_points_custom_reward_redemption.add', status: 'enabled' }],
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }),
  }).locals.cozyPumpkins;
  const events = [];
  runtime.setBroadcast((event, payload) => events.push([event, payload]));
  try {
    runtime.db.updateSettings({ rewardMapping: { pumpkin_customization: 'reward-appearance' }, customizationRewardMode: 'single' }, config);
    runtime.tokenStore.save('twitch', { accessToken: 'private-token', providerUserId: 'broadcaster-1', providerLogin: 'cozypumpkins' });
    runtime.statuses.set('twitch', { authStatus: 'Connected' });
    const viewerPumpkin = runtime.donations.handle({
      id: 'donation-owner',
      userId: 'viewer-1',
      username: 'viewer-one',
      name: 'Viewer-One',
      amount: 100,
      currency: 'RUB',
      message: '!тыковка',
    }).pumpkin;
    const otherPumpkin = runtime.donations.handle({
      id: 'donation-other-viewer',
      userId: 'viewer-2',
      username: 'viewer-two',
      name: 'Viewer Two',
      amount: 100,
      currency: 'RUB',
      message: '!тыковка',
    }).pumpkin;
    runtime.db.updatePumpkin(otherPumpkin.id, { twitchUserId: 'viewer-2', twitchUsername: 'viewer-two' });
    await runtime.twitchEventSub.start();
    const socket = MockWebSocket.instances[0];
    socket.message({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-1', keepalive_timeout_seconds: 30 } },
    });

    await new Promise((resolve) => setImmediate(resolve));
    const notification = {
      metadata: {
        message_type: 'notification',
        subscription_type: 'channel.channel_points_custom_reward_redemption.add',
      },
      payload: { event: {
        id: 'redemption-1',
        user_id: 'viewer-1',
        user_login: 'viewer-one',
        reward: { id: 'reward-appearance', title: 'Pumpkin appearance' },
        user_input: '!neca_eyes',
      } },
    };
    socket.message(notification);
    await new Promise((resolve) => setImmediate(resolve));
    socket.message(notification);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.db.getPumpkin(viewerPumpkin.id).customization.eyes, 'neca_eyes');
    assert.equal(runtime.db.getPumpkin(viewerPumpkin.id).customization.mouth, viewerPumpkin.customization.mouth);
    assert.equal(runtime.db.getPumpkin(viewerPumpkin.id).twitchUserId, 'viewer-1');
    assert.equal(runtime.db.getPumpkin(viewerPumpkin.id).twitchUsername, 'viewer-one');
    assert.deepEqual(runtime.db.getPumpkin(otherPumpkin.id).customization, otherPumpkin.customization);
    assert.equal(events.filter(([event]) => event === 'pumpkin:updated').length, 1);
    assert.equal(events.find(([event]) => event === 'pumpkin:updated')[1].pumpkin.id, viewerPumpkin.id);
    await runtime.twitchEventSub.stop();
  } finally {
    await runtime.twitchEventSub.stop();
    runtime.db.close();
  }
});

test('Twitch appearance redemption survives closing and reopening the application database', () => {
  const config = testConfig();
  const directory = mkdtempSync(path.join(tmpdir(), 'cozy-pumpkin-twitch-appearance-'));
  const databasePath = path.join(directory, 'scene.sqlite');
  try {
    const db = new Database(databasePath);
    db.updateSettings({
      rewardMapping: { pumpkin_customization: 'appearance-reward' },
      customizationRewardMode: 'single',
    }, config);
    const timestamp = new Date().toISOString();
    db.insertPumpkin({
      id: 'persisted-viewer-pumpkin',
      ownerKey: 'persisted-viewer',
      ownerNormalized: 'persisted-viewer',
      displayName: 'Persisted Viewer',
      totalDonated: 0,
      currency: 'RUB',
      stage: 1,
      x: 500,
      y: config.scene.groundY,
      isAirborne: false,
      parentId: null,
      stackOffsetY: null,
      customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'none' },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.updatePumpkin('persisted-viewer-pumpkin', { twitchUserId: 'persisted-viewer' });
    const service = new RewardService({ db, config });
    const result = service.handle({
      id: 'persisted-appearance-redemption',
      rewardId: 'appearance-reward',
      userId: 'persisted-viewer',
      userLogin: 'persisted-viewer',
      input: 'ghost skin',
    });
    assert.equal(result.status, 'customization_applied');
    db.close();

    const reopened = new Database(databasePath);
    assert.equal(reopened.getSettings(config).rewardMapping.pumpkin_customization, 'appearance-reward');
    assert.equal(reopened.getPumpkin('persisted-viewer-pumpkin').customization.skin, 'ghost');
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

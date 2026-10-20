import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchEventSub } from '../src/integrations/twitch-eventsub.js';
import { TwitchApiClient } from '../src/integrations/twitch-api.js';
import { createApp } from '../server.js';
import { Database } from '../src/db/database.js';
import { testConfig } from './helpers.js';

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
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

  close() {
    this.closed = true;
    this.emit('close');
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

test('server wiring applies an EventSub redemption to the mapped viewer pumpkin once', async () => {
  MockWebSocket.instances = [];
  const config = testConfig({ TWITCH_CLIENT_ID: 'test-client', TWITCH_REWARD_INFLATE_ID: 'reward-inflate' });
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
    runtime.db.updateSettings({ rewardMapping: { inflate: 'reward-inflate' } }, config);
    runtime.tokenStore.save('twitch', { accessToken: 'private-token', providerUserId: 'broadcaster-1', providerLogin: 'cozypumpkins' });
    runtime.statuses.set('twitch', { authStatus: 'Connected' });
    runtime.donations.handle({
      id: 'donation-owner',
      userId: 'viewer-1',
      username: 'viewer-one',
      name: 'Viewer One',
      amount: 100,
      currency: 'RUB',
    });
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
        reward: { id: 'reward-inflate', title: 'Pumpkin bounce' },
        user_input: '',
      } },
    };
    socket.message(notification);
    await new Promise((resolve) => setImmediate(resolve));
    socket.message(notification);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.filter(([event]) => event === 'pumpkin:action').length, 1);
    assert.equal(events.find(([event]) => event === 'pumpkin:action')[1].id, runtime.db.listPumpkins()[0].id);
    await runtime.twitchEventSub.stop();
  } finally {
    await runtime.twitchEventSub.stop();
    runtime.db.close();
  }
});

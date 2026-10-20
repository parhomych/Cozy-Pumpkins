import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { HttpTransportType } from '@microsoft/signalr';
import { OAuthAdapters, verifyOAuthState } from '../src/auth/oauth-adapters.js';
import { IntegrationStatus, PROVIDERS } from '../src/integrations/status.js';
import { CentrifugoEventClient } from '../src/integrations/centrifugo-client.js';
import { LegacyCentrifugoEventClient } from '../src/integrations/legacy-centrifugo-client.js';
import { DonationAlertsEvents, normalizeDonationAlertsEvent } from '../src/integrations/donationalerts-events.js';
import { MemeAlertsEvents } from '../src/integrations/memealerts-events.js';
import { DONATEX_HUB_ENDPOINT, DonatExEvents, normalizeDonatExEvent } from '../src/integrations/donatex-events.js';
import { createServer } from '../server.js';
import { testConfig } from './helpers.js';
import { testDatabase } from './helpers.js';

const providerConfig = testConfig({
  DA_CLIENT_ID: 'da-client',
  DA_CLIENT_SECRET: 'da-secret',
  DONATEX_CLIENT_ID: 'dx-client',
  DONATEX_CLIENT_SECRET: 'dx-secret',
  MEMEALERTS_CLIENT_ID: 'ma-client',
  MEMEALERTS_CLIENT_SECRET: 'ma-secret',
});

class ProtocolWebSocket {
  static instances = [];

  constructor() {
    this.OPEN = 1;
    this.readyState = 0;
    this.sent = [];
    ProtocolWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = this.OPEN;
      this.onopen?.({});
    });
  }

  send(message) {
    this.sent.push(message);
    for (const rawCommand of message.split('\n')) {
      if (!rawCommand) continue;
      const command = JSON.parse(rawCommand);
      const result = command.method === undefined
        ? { client: 'd558c046-c679-43e3-a62d-65989ab55f7c', version: '2.2.1' }
        : { type: 1, channel: command.params.channel, data: { info: {} } };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: command.id, result }) }));
    }
  }

  close() {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ reason: '' }));
  }
}

test('donation providers have independent public lifecycle status', () => {
  const statuses = new IntegrationStatus();
  assert.deepEqual(PROVIDERS, ['twitch', 'donationalerts', 'donatex', 'memealerts']);
  for (const provider of ['donationalerts', 'donatex', 'memealerts']) {
    statuses.set(provider, { authStatus: 'Connected', connectionStatus: 'Listening', account: `${provider}-account` });
  }
  statuses.set('donatex', { connectionStatus: 'Retrying', message: 'donatex_unavailable' });
  assert.equal(statuses.public('donationalerts').connectionStatus, 'Listening');
  assert.equal(statuses.public('memealerts').connectionStatus, 'Listening');
  assert.equal(statuses.public('donatex').connectionStatus, 'Retrying');
  for (const status of statuses.all()) {
    assert.equal('accessToken' in status, false);
    assert.equal('refreshToken' in status, false);
    assert.deepEqual(Object.keys(status).sort(), ['account', 'authStatus', 'connectionStatus', 'message', 'provider']);
  }
  assert.throws(() => statuses.set('unknown', { connectionStatus: 'Listening' }), /unsupported_provider/);
});

test('each donation provider uses a provider-bound OAuth state and documented authorization scope', () => {
  const oauth = new OAuthAdapters({ config: providerConfig, tokenStore: {}, statuses: {} });
  const expected = new Map([
    ['donationalerts', ['https://www.donationalerts.com/oauth/authorize', 'oauth-user-show oauth-donation-subscribe']],
    ['donatex', ['https://donatex.gg/api/connect/authorize', 'openid offline_access donations.subscribe user.read']],
    ['memealerts', ['https://memealerts.com/oauth/authorize', 'oauth-user-show oauth-donation-subscribe']],
  ]);
  for (const [provider, [endpoint, scope]] of expected) {
    const url = new URL(oauth.authorizationUrl(provider));
    assert.equal(`${url.origin}${url.pathname}`, endpoint);
    assert.equal(url.searchParams.get('scope'), scope);
    assert.equal(verifyOAuthState(url.searchParams.get('state'), providerConfig.sessionSecret, provider), true);
    assert.equal(verifyOAuthState(url.searchParams.get('state'), providerConfig.sessionSecret, 'twitch'), false);
    assert.equal(url.searchParams.get('redirect_uri'), providerConfig[provider].redirectUri);
  }
});

test('DonationAlerts and Meme Alerts identities expose the private socket connection token', async () => {
  for (const provider of ['donationalerts', 'memealerts']) {
    const oauth = new OAuthAdapters({
      config: providerConfig,
      tokenStore: {},
      statuses: {},
      fetchImpl: async () => new Response(JSON.stringify({
        data: { id: 'channel-1', username: 'pumpkins', socket_connection_token: `socket-${provider}` },
      })),
    });
    assert.deepEqual(await oauth.fetchIdentity(provider, `access-${provider}`), {
      id: 'channel-1',
      login: 'pumpkins',
      displayName: 'pumpkins',
      socketConnectionToken: `socket-${provider}`,
    });
  }
});

test('DonatEx callback exchanges the code with its PKCE verifier and validates channel identity', async () => {
  const calls = [];
  let savedToken;
  const oauth = new OAuthAdapters({
    config: providerConfig,
    now: () => 1_800_000_000_000,
    tokenStore: { save: (provider, token) => { savedToken = { provider, token }; } },
    statuses: { set: (provider, status) => calls.push({ provider, status }) },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/connect/token')) return new Response(JSON.stringify({
        access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600,
        scope: 'openid offline_access donations.subscribe user.read',
      }), { status: 200 });
      return new Response(JSON.stringify({ data: { id: 'channel-1', username: 'pumpkins', displayName: 'Pumpkins' } }), { status: 200 });
    },
  });
  const url = new URL(oauth.authorizationUrl('donatex'));
  const state = url.searchParams.get('state');
  const result = await oauth.callback('donatex', 'one-time-code', state);
  const verifier = new URLSearchParams(calls.find((call) => call.url.endsWith('/api/connect/token')).options.body).get('code_verifier');
  assert.equal(cryptoChallenge(verifier), url.searchParams.get('code_challenge'));
  assert.deepEqual(result, { connected: true, account: 'Pumpkins' });
  assert.equal(savedToken.provider, 'donatex');
  assert.equal(savedToken.token.providerUserId, 'channel-1');
  assert.equal(savedToken.token.providerLogin, 'pumpkins');
  assert.equal(calls.find((call) => call.url.endsWith('/api/v1/user/me')).options.headers.Authorization, 'Bearer private-access');
});

test('Centrifugo adapter refreshes tokens through SDK callbacks and reports isolated lifecycle', async () => {
  const statuses = [];
  const statusMessages = [];
  const publications = [];
  const subscription = new EventEmitter();
  subscription.subscribe = () => {};
  subscription.unsubscribe = () => {};
  subscription.setToken = (token) => { subscription.token = token; };
  const client = new EventEmitter();
  let subscriptionOptions;
  client.newSubscription = (channel, options) => {
    assert.equal(channel, '$alerts:donation_channel-1');
    assert.equal(typeof options.getToken, 'function');
    subscriptionOptions = options;
    return subscription;
  };
  client.connect = () => {};
  client.disconnect = () => { client.disconnected = true; };
  let clientOptions;
  const adapter = new CentrifugoEventClient({
    provider: 'memealerts',
    endpoint: 'wss://memealerts.com/connection/websocket',
    channel: '$alerts:donation_channel-1',
    getConnectionToken: async () => 'private-socket-token',
    getSubscriptionToken: async (_context, clientId) => `private-channel-token-${clientId}`,
    onEvent: (event) => publications.push(event),
    onStatus: (status) => {
      statuses.push(status.connectionStatus);
      statusMessages.push(status.message);
    },
    clientFactory: (endpoint, options) => {
      assert.equal(endpoint, 'wss://memealerts.com/connection/websocket');
      clientOptions = options;
      return client;
    },
    logger: { warn() {} },
  });
  adapter.start();
  assert.equal(typeof clientOptions.getToken, 'function');
  assert.equal(await clientOptions.getToken(), 'private-socket-token');
  assert.equal(await subscription.listenerCount('publication'), 1);
  const pendingChannelToken = subscriptionOptions.getToken({ channel: '$alerts:donation_channel-1' });
  client.emit('connected', { client: 'client-id-first' });
  assert.equal(await pendingChannelToken, 'private-channel-token-client-id-first');
  subscription.emit('subscribed');
  subscription.emit('publication', { data: { id: 'event-1' } });
  client.emit('disconnected', { code: 3003, reason: 'custom disconnect' });
  assert.equal(subscription.token, '');
  client.emit('disconnected', { code: 3501, reason: 'bad request' });
  assert.deepEqual(statuses, ['Listening', 'Retrying', 'Error']);
  assert.deepEqual(statusMessages.slice(-2), [
    'centrifugo_error_3003_custom_disconnect',
    'centrifugo_error_3501_bad_request',
  ]);
  const reconnectChannelToken = subscriptionOptions.getToken({ channel: '$alerts:donation_channel-1' });
  client.emit('connected', { client: 'client-id-reconnected' });
  assert.equal(await reconnectChannelToken, 'private-channel-token-client-id-reconnected');
  assert.deepEqual(publications, [{ id: 'event-1' }]);
  adapter.stop();
  assert.equal(client.disconnected, true);
  assert.equal(statuses.at(-1), 'Disconnected');
});

test('DonationAlerts adapter obtains a private channel token and emits normalized donations', async () => {
  const requests = [];
  let clientOptions;
  const donations = [];
  const adapter = new DonationAlertsEvents({
    oauth: {
      getAccessToken: async () => 'private-access-token',
      fetchIdentity: async () => ({ id: 'channel-1', socketConnectionToken: 'private-da-socket-token' }),
    },
    tokenStore: { get: () => ({ accessToken: 'private-access-token', providerUserId: 'channel-1' }) },
    onDonation: (event) => donations.push(event),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ channels: [{ channel: '$alerts:donation_channel-1', token: 'private-channel-token' }] }));
    },
    eventClientFactory: (options) => {
      clientOptions = options;
      return { start() {}, stop() {} };
    },
  });
  await adapter.start();
  assert.equal(clientOptions.channel, '$alerts:donation_channel-1');
  assert.equal(await clientOptions.getConnectionToken(), 'private-da-socket-token');
  const clientId = 'd558c046-c679-43e3-a62d-65989ab55f7c';
  assert.equal(await clientOptions.getSubscriptionToken({}, clientId), 'private-channel-token');
  assert.equal(requests[0].url, 'https://www.donationalerts.com/api/v1/centrifuge/subscribe');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-access-token');
  const subscriptionRequest = JSON.parse(requests[0].options.body);
  assert.deepEqual(subscriptionRequest.channels, ['$alerts:donation_channel-1']);
  assert.equal(subscriptionRequest.client, clientId);
  clientOptions.onEvent({ id: 'donation-1', username: 'Viewer', amount: '15', currency: 'rub', message: '!тыква' });
  assert.deepEqual(donations, [{
    provider: 'donationalerts', id: 'donation-1', ownerId: null, name: 'Viewer',
    amount: 15, currency: 'RUB', message: '!тыква',
  }]);
  await adapter.stop();
  assert.equal(normalizeDonationAlertsEvent({ id: 'broken' }), null);
});

test('DonationAlerts legacy Centrifugo client uses assigned client IDs and refreshes both private tokens', async () => {
  const client = new EventEmitter();
  const subscription = new EventEmitter();
  const statuses = [];
  const publications = [];
  let clientOptions;
  let connectionToken;
  let subscriptionTokenRequest;
  client.setToken = (token) => { connectionToken = token; };
  client.subscribe = (channel) => {
    assert.equal(channel, '$alerts:donation_channel-1');
    return subscription;
  };
  client.connect = () => { client.connected = true; };
  client.disconnect = () => { client.disconnected = true; };
  const adapter = new LegacyCentrifugoEventClient({
    provider: 'donationalerts',
    endpoint: 'wss://centrifugo.donationalerts.com/connection/websocket',
    channel: '$alerts:donation_channel-1',
    getConnectionToken: async () => 'private-socket-token',
    getSubscriptionToken: async (channel, clientId) => {
      subscriptionTokenRequest = { channel, clientId };
      return 'private-channel-token';
    },
    onEvent: (event) => publications.push(event),
    onStatus: (status) => statuses.push(status),
    clientFactory: (endpoint, options) => {
      assert.equal(endpoint, 'wss://centrifugo.donationalerts.com/connection/websocket');
      clientOptions = options;
      return client;
    },
    logger: { warn() {} },
  });

  await adapter.start();
  assert.equal(connectionToken, 'private-socket-token');
  assert.equal(client.connected, true);
  const refreshResult = await new Promise((resolve) => clientOptions.onRefresh({}, resolve));
  assert.deepEqual(refreshResult, { status: 200, data: { token: 'private-socket-token' } });

  const authorizationResult = await new Promise((resolve) => clientOptions.onPrivateSubscribe({
    data: { client: 'assigned-centifugo-client-id', channels: ['$alerts:donation_channel-1'] },
  }, resolve));
  assert.deepEqual(subscriptionTokenRequest, {
    channel: '$alerts:donation_channel-1',
    clientId: 'assigned-centifugo-client-id',
  });
  assert.deepEqual(authorizationResult, {
    status: 200,
    data: { channels: [{ channel: '$alerts:donation_channel-1', token: 'private-channel-token' }] },
  });

  client.emit('connect', { client: 'assigned-centifugo-client-id' });
  subscription.emit('subscribe');
  subscription.emit('publish', { data: { id: 'donation-1' } });
  assert.deepEqual(publications, [{ id: 'donation-1' }]);
  assert.deepEqual(statuses.map((status) => status.connectionStatus), ['Retrying', 'Listening']);

  adapter.stop();
  assert.equal(client.disconnected, true);
  assert.equal(statuses.at(-1).connectionStatus, 'Disconnected');
});

test('DonationAlerts v2.2.1 wire protocol connects with legacy frames', async () => {
  ProtocolWebSocket.instances = [];
  const statuses = [];
  const adapter = new LegacyCentrifugoEventClient({
    provider: 'donationalerts',
    endpoint: 'wss://centrifugo.donationalerts.com/connection/websocket',
    channel: '$alerts:donation_channel-1',
    getConnectionToken: async () => 'private-socket-token',
    getSubscriptionToken: async (_channel, clientId) => {
      assert.equal(clientId, 'd558c046-c679-43e3-a62d-65989ab55f7c');
      return 'private-channel-token';
    },
    onEvent() {},
    onStatus: (status) => statuses.push(status.connectionStatus),
    websocket: ProtocolWebSocket,
    logger: { warn() {} },
  });

  const listening = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('legacy_subscription_timed_out')), 1000);
    const original = adapter.onStatus;
    adapter.onStatus = (status) => {
      original(status);
      if (status.connectionStatus === 'Listening') {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
  await adapter.start();
  await listening;

  const commands = ProtocolWebSocket.instances[0].sent
    .flatMap((message) => message.split('\n'))
    .filter(Boolean)
    .map((message) => JSON.parse(message));
  assert.equal(commands[0].method, undefined);
  assert.equal(commands[0].params.token, 'private-socket-token');
  assert.equal(commands.some((command) => command.method === 1
    && command.params.channel === '$alerts:donation_channel-1'
    && command.params.token === 'private-channel-token'), true);
  assert.equal(statuses.at(-1), 'Listening');
  adapter.stop();
});

test('Meme Alerts adapter uses legacy Centrifugo frames with its assigned client ID', async () => {
  ProtocolWebSocket.instances = [];
  let subscriptionRequest;
  let markListening;
  let timeout;
  const listening = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('memealerts_legacy_subscription_timed_out')), 1000);
    markListening = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
  const statuses = {
    set(provider, patch) {
      if (provider === 'memealerts' && patch.connectionStatus === 'Listening') markListening();
    },
  };
  const adapter = new MemeAlertsEvents({
    oauth: {
      getAccessToken: async () => 'private-access-token',
      fetchIdentity: async () => ({ id: 'ma-user-7', socketConnectionToken: 'private-socket-token' }),
    },
    tokenStore: { get: () => ({ accessToken: 'private-access-token', providerUserId: 'ma-user-7' }) },
    onDonation() {},
    statuses,
    fetchImpl: async (_url, options) => {
      subscriptionRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({
        data: { channels: [{ channel: '$alerts:donation_ma-user-7', token: 'private-channel-token' }] },
      }));
    },
    websocket: ProtocolWebSocket,
    logger: { warn() {} },
  });

  await adapter.start();
  await listening;
  const commands = ProtocolWebSocket.instances[0].sent
    .flatMap((message) => message.split('\n'))
    .filter(Boolean)
    .map((message) => JSON.parse(message));
  assert.equal(commands[0].method, undefined);
  assert.equal(commands[0].params.token, 'private-socket-token');
  assert.deepEqual(subscriptionRequest, {
    channels: ['$alerts:donation_ma-user-7'],
    client: 'd558c046-c679-43e3-a62d-65989ab55f7c',
  });
  assert.equal(commands.some((command) => command.method === 1
    && command.params.channel === '$alerts:donation_ma-user-7'
    && command.params.token === 'private-channel-token'), true);
  await adapter.stop();
});

test('Meme Alerts adapter fetches a private channel token using refreshed credentials', async () => {
  const requests = [];
  let clientOptions;
  let accessTokenCalls = 0;
  const adapter = new MemeAlertsEvents({
    oauth: {
      getAccessToken: async () => { accessTokenCalls += 1; return `access-${accessTokenCalls}`; },
      fetchIdentity: async () => ({
        id: 'ma-user-7',
        socketConnectionToken: `private-ma-socket-token-${accessTokenCalls}`,
      }),
    },
    tokenStore: { get: () => ({ accessToken: 'stored-access', providerUserId: 'ma-user-7' }) },
    onDonation() {},
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ data: { channels: [{ channel: '$alerts:donation_ma-user-7', token: 'private-ma-channel-token' }] } }));
    },
    eventClientFactory: (options) => {
      clientOptions = options;
      return { start() {}, stop() {} };
    },
  });
  await adapter.start();
  assert.equal(clientOptions.endpoint, 'wss://memealerts.com/connection/websocket');
  assert.equal(clientOptions.channel, '$alerts:donation_ma-user-7');
  assert.equal(await clientOptions.getConnectionToken(), 'private-ma-socket-token-1');
  const clientId = '36ce4aa1-7a16-49f1-91a9-9fbefcb3fb99';
  assert.equal(await clientOptions.getSubscriptionToken({}, clientId), 'private-ma-channel-token');
  assert.equal(accessTokenCalls, 2);
  assert.equal(JSON.parse(requests[0].options.body).client, clientId);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-2');
  assert.equal(requests[0].url, 'https://memealerts.com/api/v1/centrifuge/subscribe');
});

test('DonatEx SignalR adapter reconnects and suppresses same-ID rerun events', async () => {
  const handlers = new Map();
  const statuses = [];
  const donations = [];
  let reconnecting;
  let reconnected;
  let closed;
  let accessTokenFactory;
  let retries;
  let transportOptions;
  const connection = {
    on: (name, handler) => handlers.set(name, handler),
    onreconnecting: (handler) => { reconnecting = handler; },
    onreconnected: (handler) => { reconnected = handler; },
    onclose: (handler) => { closed = handler; },
    start: async () => {},
    stop: async () => {},
  };
  const adapter = new DonatExEvents({
    oauth: { getAccessToken: async () => 'private-donatex-token' },
    onDonation: (event) => donations.push(event),
    statuses: { set: (provider, status) => statuses.push({ provider, status }) },
    connectionFactory: (url, getToken, retryDelays, options) => {
      assert.equal(url, DONATEX_HUB_ENDPOINT);
      accessTokenFactory = getToken;
      retries = retryDelays;
      transportOptions = options;
      return connection;
    },
    logger: { warn() {} },
  });
  await adapter.start();
  assert.equal(await accessTokenFactory(), 'private-donatex-token');
  assert.deepEqual(retries, [0, 2000, 5000, 10000, 30000]);
  assert.deepEqual(transportOptions, { transport: HttpTransportType.WebSockets });
  const payload = { id: 'dx-rerun-1', username: 'Viewer', amount: 75, currency: 'rub', message: '!тыква gold' };
  handlers.get('DonationCreated')(payload);
  handlers.get('DonationRerun')(payload);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(donations, [normalizeDonatExEvent(payload)]);
  reconnecting();
  reconnected();
  assert.deepEqual(statuses.slice(-2).map((item) => item.status.connectionStatus), ['Retrying', 'Listening']);
  closed(new Error('transport details should not be exposed'));
  assert.equal(statuses.at(-1).status.connectionStatus, 'Error');
  assert.notEqual(statuses.at(-1).status.message, 'transport details should not be exposed');
});

test('DonatEx failed WebSocket startup reports an integration error without affecting other providers', async () => {
  const statuses = [];
  let closeHandler;
  const connection = {
    on() {},
    onreconnecting() {},
    onreconnected() {},
    onclose(handler) { closeHandler = handler; },
    start: async () => {
      closeHandler(new Error('WebSocket failed to connect'));
      throw new Error('WebSocket failed to connect');
    },
    stop: async () => {},
  };
  const adapter = new DonatExEvents({
    oauth: { getAccessToken: async () => 'private-donatex-token' },
    onDonation() {},
    statuses: { set: (provider, patch) => statuses.push({ provider, patch }) },
    connectionFactory: (_url, _getToken, _retryDelays, options) => {
      assert.deepEqual(options, { transport: HttpTransportType.WebSockets });
      return connection;
    },
    logger: { warn() {} },
  });

  await assert.rejects(adapter.start(), /donatex_connection_failed/u);
  assert.equal(adapter.connection, null);
  assert.deepEqual(statuses.slice(-2), [
    { provider: 'donatex', patch: { connectionStatus: 'Error', message: 'donatex_connection_closed' } },
    { provider: 'donatex', patch: { connectionStatus: 'Error', message: 'donatex_connection_failed' } },
  ]);
  assert.equal(statuses.some(({ provider }) => provider !== 'donatex'), false);
});

test('provider event normalizers map donation identity, amount, currency and message', async () => {
  const [
    { normalizeDonationAlertsEvent },
    { normalizeDonatExEvent },
    { normalizeMemeAlertsEvent },
  ] = await Promise.all([
    import('../src/integrations/donationalerts-events.js'),
    import('../src/integrations/donatex-events.js'),
    import('../src/integrations/memealerts-events.js'),
  ]);
  assert.deepEqual(normalizeDonationAlertsEvent({
    id: 'da-1', username: 'Viewer', amount: 20, currency: 'RUB', message: '!тыква ghost',
  }), {
    provider: 'donationalerts', id: 'da-1', ownerId: null, name: 'Viewer',
    amount: 20, currency: 'RUB', message: '!тыква ghost',
  });
  assert.deepEqual(normalizeDonatExEvent({
    id: 'dx-1', username: 'Viewer', amount: 30, currency: 'RUB', message: '!тыква gold',
  }), {
    provider: 'donatex', id: 'dx-1', ownerId: null, name: 'Viewer',
    amount: 30, currency: 'RUB', message: '!тыква gold',
  });
  assert.deepEqual(normalizeMemeAlertsEvent({
    reason: 'new',
    data: { id: 'ma-1', username: 'Viewer', amount: 40, type: 'currency', message: '!тыква stars' },
  }), {
    provider: 'memealerts', id: 'ma-1', ownerId: null, name: 'Viewer',
    amount: 40, currency: 'RUB', message: '!тыква stars',
  });
});

test('Meme Alerts coin events are not mislabeled as scene currency', async () => {
  const { normalizeMemeAlertsEvent } = await import('../src/integrations/memealerts-events.js');
  const event = normalizeMemeAlertsEvent({
    reason: 'new', data: { id: 'ma-coins', username: 'Viewer', amount: 50, type: 'coins', message: '' },
  });
  assert.equal(event.currency, 'MEMECOIN');
});

test('server routes one normalized mocked donation from each provider through the common engine', async () => {
  const clientOptions = {};
  const signalHandlers = new Map();
  const signalConnection = {
    on: (name, handler) => signalHandlers.set(name, handler),
    onreconnecting() {},
    onreconnected() {},
    onclose() {},
    start: async () => {},
    stop: async () => {},
  };
  let pumpkinId = 0;
  const config = testConfig();
  const db = testDatabase(config);
  const runtime = createServer({
    config,
    db,
    publicDir: null,
    fetchImpl: async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/api/v1/user/oauth')) {
        const provider = requestUrl.includes('donationalerts.com') ? 'donationalerts' : 'memealerts';
        return new Response(JSON.stringify({
          data: { id: `${provider}-channel`, username: `${provider}-user`, socket_connection_token: `${provider}-socket-token` },
        }));
      }
      if (requestUrl.endsWith('/api/v1/centrifuge/subscribe')) {
        const { channels } = JSON.parse(options.body);
        return new Response(JSON.stringify({ channels: channels.map((channel) => ({ channel, token: 'private-channel-token' })) }));
      }
      throw new Error(`Unexpected test fetch: ${requestUrl}`);
    },
    providerEventFactories: {
      donationalerts: {
        eventClientFactory: (options) => {
          clientOptions.donationalerts = options;
          return { start() {}, stop() {} };
        },
      },
      donatex: { connectionFactory: () => signalConnection },
      memealerts: {
        eventClientFactory: (options) => {
          clientOptions.memealerts = options;
          return { start() {}, stop() {} };
        },
      },
    },
  });
  runtime.donations.idFactory = () => `provider-pumpkin-${++pumpkinId}`;
  for (const provider of ['donationalerts', 'donatex', 'memealerts']) {
    runtime.tokenStore.save(provider, { accessToken: `${provider}-access`, providerUserId: `${provider}-channel` });
  }
  try {
    await runtime.providerEvents.donationalerts.start();
    await runtime.providerEvents.donatex.start();
    await runtime.providerEvents.memealerts.start();

    const sharedId = 'provider-collision';
    const donationAlertsPayload = {
      id: sharedId, donor_id: 'da-viewer', username: 'DA Viewer', amount: 50, currency: 'RUB', message: '!тыковка ghost',
    };
    clientOptions.donationalerts.onEvent(donationAlertsPayload);
    clientOptions.donationalerts.onEvent(donationAlertsPayload);
    signalHandlers.get('DonationCreated')({
      id: sharedId, userId: 'dx-viewer', username: 'DonatEx Viewer', amount: 60, currency: 'RUB', message: '!тыковка witch',
    });
    clientOptions.memealerts.onEvent({
      reason: 'new',
      data: { id: sharedId, user_id: 'ma-viewer', username: 'Meme Viewer', amount: 70, currency: 'RUB', type: 'currency', message: '!тыковка gold' },
    });

    const pumpkins = db.listPumpkins();
    assert.equal(pumpkins.length, 3);
    assert.deepEqual(pumpkins.map(({ ownerKey }) => ownerKey).sort(), ['da:da-viewer', 'donatex:dx-viewer', 'memealerts:ma-viewer']);
    assert.deepEqual(pumpkins.map(({ customization }) => customization.skin).sort(), ['ghost', 'gold', 'witch']);
  } finally {
    await runtime.shutdown();
    db.close();
  }
});

function cryptoChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

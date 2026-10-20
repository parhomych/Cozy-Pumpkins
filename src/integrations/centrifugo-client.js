import { Centrifuge } from 'centrifuge';

const ENDPOINT = 'wss://centrifugo.donationalerts.com/connection/websocket';

function safeErrorCode(error) {
  const code = Number(error?.code ?? error?.error?.code);
  if (!Number.isInteger(code)) return 'centrifugo_subscription_failed';
  const detail = String(error?.reason ?? error?.error?.message ?? error?.message ?? '').trim().toLowerCase();
  const safeDetail = /^[a-z0-9 _.-]{1,64}$/u.test(detail)
    ? `_${detail.replace(/[\s.-]+/gu, '_')}`
    : '';
  return `centrifugo_error_${code}${safeDetail}`;
}
function disconnectStatus(error) {
  const code = Number(error?.code);
  return {
    connectionStatus: Number.isInteger(code) && code >= 3500 && code < 4000 ? 'Error' : 'Retrying',
    message: safeErrorCode(error),
  };
}
function safeEventError(error) {
  const reason = String(error?.message ?? '');
  return /^[a-z0-9_]+$/iu.test(reason) ? reason : 'invalid_event';
}

export class CentrifugoEventClient {
  constructor({
    provider,
    endpoint = ENDPOINT,
    channel,
    getConnectionToken,
    getSubscriptionToken,
    onEvent,
    onStatus = () => {},
    clientFactory = (url, options) => new Centrifuge(url, options),
    websocket = globalThis.WebSocket,
    logger = console,
  } = {}) {
    Object.assign(this, {
      provider, endpoint, channel, getConnectionToken, getSubscriptionToken,
      onEvent, onStatus, clientFactory, websocket, logger,
    });
    this.client = null;
    this.subscription = null;
  }

  start() {
    if (this.client) return;
    if (!this.provider || !this.channel || !this.getConnectionToken || !this.getSubscriptionToken || !this.onEvent) {
      throw new Error('centrifugo_client_configuration_invalid');
    }
    const options = {
      websocket: this.websocket,
      minReconnectDelay: 1000,
      maxReconnectDelay: 30000,
    };
    options.getToken = () => this.getConnectionToken();
    const client = this.clientFactory(this.endpoint, options);
    this.client = client;
    let subscription = null;
    let connectedClientId = null;
    let clientGeneration = 0;
    this.stopped = false;
    this.clientIdWaiters = new Set();
    const waitForClientId = () => {
      if (connectedClientId) return Promise.resolve(connectedClientId);
      if (this.stopped) return Promise.reject(new Error('centrifugo_client_stopped'));
      return new Promise((resolve, reject) => this.clientIdWaiters.add({ resolve, reject }));
    };
    client.on('connected', (context = {}) => {
      if (this.stopped) return;
      connectedClientId = context.client || null;
      if (!connectedClientId) return;
      clientGeneration += 1;
      for (const waiter of this.clientIdWaiters) waiter.resolve(connectedClientId);
      this.clientIdWaiters.clear();
    });
    client.on('connecting', () => this.onStatus({ connectionStatus: 'Retrying', message: null }));
    client.on('disconnected', (context = {}) => {
      connectedClientId = null;
      clientGeneration += 1;
      this.onStatus(disconnectStatus(context));
    });
    client.on('error', (context = {}) => {
      this.logger.warn('Centrifugo provider client reported an error', { provider: this.provider, reason: safeErrorCode(context) });
    });

    subscription = client.newSubscription(this.channel, {
      getToken: async (context) => {
        while (true) {
          const clientId = await waitForClientId();
          const generation = clientGeneration;
          const channelToken = await this.getSubscriptionToken(context, clientId);
          if (!this.client) throw new Error('centrifugo_client_stopped');
          if (generation === clientGeneration && clientId === connectedClientId) return channelToken;
        }
      },
      minResubscribeDelay: 1000,
      maxResubscribeDelay: 30000,
    });
    this.subscription = subscription;
    subscription.on('subscribed', () => this.onStatus({ connectionStatus: 'Listening', message: null }));
    subscription.on('subscribing', () => this.onStatus({ connectionStatus: 'Retrying', message: null }));
    subscription.on('unsubscribed', (context = {}) => this.onStatus({ connectionStatus: 'Error', message: safeErrorCode(context) }));
    subscription.on('error', (context = {}) => {
      this.onStatus({ connectionStatus: 'Retrying', message: safeErrorCode(context) });
      this.logger.warn('Centrifugo provider subscription failed', { provider: this.provider, reason: safeErrorCode(context) });
    });
    subscription.on('publication', (context = {}) => {
      try {
        this.onEvent(context.data);
      } catch (error) {
        this.logger.warn('Centrifugo event handler rejected a publication', { provider: this.provider, reason: safeEventError(error) });
      }
    });
    subscription.subscribe();
    client.connect();
  }

  stop() {
    const client = this.client;
    if (!client) return;
    this.client = null;
    this.stopped = true;
    for (const waiter of this.clientIdWaiters || []) waiter.reject(new Error('centrifugo_client_stopped'));
    this.clientIdWaiters?.clear();
    client.removeSubscription(this.subscription);
    this.subscription = null;
    client.disconnect();
    this.onStatus({ connectionStatus: 'Disconnected', message: null });
  }
}

export { ENDPOINT as DONATIONALERTS_CENTRIFUGO_ENDPOINT };

import Centrifuge from 'centrifuge-legacy';

const SAFE_DISCONNECT_REASONS = new Map([
  ['connection closed', 'connection_closed'],
  ['connect error', 'connect_error'],
  ['bad request', 'bad_request'],
  ['unauthorized', 'unauthorized'],
]);

function safeErrorCode(error, fallback) {
  const code = Number(error?.code ?? error?.error?.code);
  if (Number.isInteger(code)) return `centrifugo_error_${code}`;
  const reason = String(error?.reason ?? error?.error?.message ?? error?.message ?? '').trim().toLowerCase();
  const safeReason = SAFE_DISCONNECT_REASONS.get(reason);
  if (safeReason) return `centrifugo_${safeReason}`;
  return fallback;
}

function safeEventError(error) {
  const reason = String(error?.message ?? '');
  return /^[a-z0-9_]+$/iu.test(reason) ? reason : 'invalid_event';
}

export class LegacyCentrifugoEventClient {
  constructor({
    provider,
    endpoint,
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

  async start() {
    if (this.client) return;
    if (!this.provider || !this.endpoint || !this.channel || !this.getConnectionToken
      || !this.getSubscriptionToken || !this.onEvent) {
      throw new Error('centrifugo_client_configuration_invalid');
    }
    const connectionToken = await this.getConnectionToken();
    if (typeof connectionToken !== 'string' || !connectionToken) {
      throw new Error(`${this.provider}_socket_token_unavailable`);
    }
    this.stopped = false;
    const client = this.clientFactory(this.endpoint, {
      websocket: this.websocket,
      minRetry: 1000,
      maxRetry: 30000,
      onRefresh: (_context, callback) => {
        this.getConnectionToken().then(
          (token) => callback({ status: 200, data: { token } }),
          (error) => {
            if (!this.stopped) {
              const reason = safeErrorCode(error, `${this.provider}_socket_token_unavailable`);
              this.onStatus({ connectionStatus: 'Retrying', message: reason });
              this.logger.warn('Centrifugo connection token refresh failed', {
                provider: this.provider,
                reason,
              });
            }
            callback({ status: 500, error: true });
          },
        );
      },
      onPrivateSubscribe: ({ data }, callback) => {
        Promise.all(data.channels.map(async (channel) => ({
          channel,
          token: await this.getSubscriptionToken(channel, data.client),
        }))).then(
          (channels) => callback({ status: 200, data: { channels } }),
          (error) => {
            if (!this.stopped) {
              this.onStatus({
                connectionStatus: 'Retrying',
                message: safeErrorCode(error, `${this.provider}_subscription_token_failed`),
              });
              this.logger.warn('Centrifugo private channel authorization failed', {
                provider: this.provider,
                reason: safeErrorCode(error, `${this.provider}_subscription_token_failed`),
              });
            }
            callback({ status: 500, error: true });
          },
        );
      },
    });
    this.client = client;
    client.setToken(connectionToken);
    client.on('connect', () => {
      if (!this.stopped) this.onStatus({ connectionStatus: 'Retrying', message: null });
    });
    client.on('disconnect', (context = {}) => {
      if (!this.stopped) {
        this.onStatus({
          connectionStatus: context.reconnect ? 'Retrying' : 'Error',
          message: safeErrorCode(context, `${this.provider}_connection_failed`),
        });
      }
    });
    client.on('error', (context = {}) => {
      this.logger.warn('Centrifugo provider client reported an error', {
        provider: this.provider,
        reason: safeErrorCode(context, `${this.provider}_connection_failed`),
      });
    });
    const subscription = client.subscribe(this.channel);
    this.subscription = subscription;
    subscription.on('subscribe', () => {
      if (!this.stopped) this.onStatus({ connectionStatus: 'Listening', message: null });
    });
    subscription.on('unsubscribe', () => {
      if (!this.stopped) this.onStatus({ connectionStatus: 'Retrying', message: null });
    });
    subscription.on('error', (context = {}) => {
      if (!this.stopped) {
        this.onStatus({
          connectionStatus: 'Retrying',
          message: safeErrorCode(context, `${this.provider}_subscription_failed`),
        });
      }
    });
    subscription.on('publish', (context = {}) => {
      try {
        this.onEvent(context.data);
      } catch (error) {
        this.logger.warn('Centrifugo event handler rejected a publication', {
          provider: this.provider,
          reason: safeEventError(error),
        });
      }
    });
    client.connect();
  }

  stop() {
    const client = this.client;
    if (!client) return;
    this.stopped = true;
    this.client = null;
    this.subscription = null;
    client.disconnect();
    this.onStatus({ connectionStatus: 'Disconnected', message: null });
  }
}

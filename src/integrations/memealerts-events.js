import { CentrifugoEventClient } from './centrifugo-client.js';

const API = 'https://memealerts.com/api/v1';
const ENDPOINT = 'wss://memealerts.com/connection/websocket';
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const START_RETRY_DELAYS = [2000, 5000, 15000];

function safeApiError(error, fallback) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return `${fallback}_timeout`;
  const reason = String(error?.message ?? '');
  return /^memealerts_[a-z0-9_]+$/u.test(reason) ? reason : fallback;
}

export function normalizeMemeAlertsEvent(input) {
  const event = input?.data?.data ?? input?.data ?? input;
  const id = event?.id ?? event?.donation_id;
  const name = event?.username ?? event?.user_name ?? event?.name ?? event?.user?.name;
  const amount = Number(event?.amount);
  const eventType = String(event?.type ?? '').toLowerCase();
  const currency = String(event?.currency ?? event?.currency_code ?? (eventType === 'coins' ? 'MEMECOIN' : 'RUB')).trim().toUpperCase();
  if (id == null || !String(id).trim() || typeof name !== 'string' || !name.trim()
    || !Number.isFinite(amount) || amount <= 0 || !currency) return null;
  const ownerId = event?.donor_id ?? event?.user_id ?? event?.user?.id ?? null;
  return {
    provider: 'memealerts',
    id: String(id).trim(),
    ownerId: ownerId == null ? null : String(ownerId),
    name: name.trim(),
    amount,
    currency,
    message: typeof event.message === 'string' ? event.message : '',
  };
}

export class MemeAlertsEvents {
  constructor({
    oauth,
    tokenStore,
    onDonation,
    statuses,
    fetchImpl = globalThis.fetch,
    eventClientFactory = (options) => new CentrifugoEventClient(options),
    websocket = globalThis.WebSocket,
    logger = console,
    retryDelays = START_RETRY_DELAYS,
  } = {}) {
    Object.assign(this, {
      oauth, tokenStore, onDonation, statuses, fetch: fetchImpl,
      eventClientFactory, websocket, logger, retryDelays,
    });
    this.client = null;
    this.startPromise = null;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.clientGeneration = 0;
    this.stopped = false;
  }

  async requestSubscriptionToken(channel, clientId) {
    if (!CLIENT_ID_PATTERN.test(String(clientId || ''))) throw new Error('memealerts_centrifugo_client_id_invalid');
    const accessToken = await this.oauth.getAccessToken('memealerts');
    let response;
    try {
      response = await this.fetch(`${API}/centrifuge/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ channels: [channel], client: clientId }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new Error(safeApiError(error, 'memealerts_subscription_token_failed'));
    }
    if (!response.ok) {
      if (response.status === 408) throw new Error('memealerts_subscription_token_failed_timeout');
      if (response.status === 429) throw new Error('memealerts_subscription_token_failed_rate_limited');
      if (response.status >= 500) throw new Error('memealerts_subscription_token_failed_unavailable');
      throw new Error('memealerts_subscription_token_failed');
    }
    let body;
    try { body = await response.json(); } catch { throw new Error('memealerts_subscription_token_invalid'); }
    const channels = body?.channels ?? body?.data?.channels;
    const token = channels?.find((item) => item.channel === channel)?.token;
    if (typeof token !== 'string' || !token) throw new Error('memealerts_subscription_token_invalid');
    return token;
  }

  async start() {
    if (this.client) return;
    if (this.startPromise) return this.startPromise;
    this.stopped = false;
    this.startPromise = this.startConnection();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startConnection() {
    const token = this.tokenStore.get('memealerts');
    if (!token?.accessToken) throw new Error('memealerts_not_connected');
    let profile;
    try {
      profile = await this.oauth.fetchIdentity('memealerts', await this.oauth.getAccessToken('memealerts'));
    } catch (error) {
      const reason = safeApiError(error, 'memealerts_profile_failed');
      const retryable = /_(?:timeout|unavailable|rate_limited)$/u.test(reason);
      const delay = retryable && this.retryDelays.length
        ? this.retryDelays[Math.min(this.retryAttempt++, this.retryDelays.length - 1)]
        : undefined;
      if (!this.stopped && delay !== undefined) {
        this.statuses?.set('memealerts', { connectionStatus: 'Retrying', message: reason });
        this.logger.warn('Meme Alerts profile lookup failed; retry scheduled.', {
          provider: 'memealerts',
          reason,
        });
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.start().catch((retryError) => {
            this.logger.warn('Meme Alerts connection retry failed.', {
              provider: 'memealerts',
              reason: safeApiError(retryError, 'memealerts_connection_failed'),
            });
          });
        }, delay);
        return;
      }
      this.statuses?.set('memealerts', { connectionStatus: 'Error', message: reason });
      throw error;
    }
    if (this.stopped) return;
    if (!profile?.id) throw new Error('memealerts_account_unavailable');
    if (token.providerUserId && String(token.providerUserId) !== String(profile.id)) throw new Error('memealerts_account_changed');
    if (typeof profile.socketConnectionToken !== 'string' || !profile.socketConnectionToken) throw new Error('memealerts_socket_token_unavailable');
    if (!token.providerUserId) this.tokenStore.save('memealerts', { ...token, providerUserId: String(profile.id) });
    const channel = `$alerts:donation_${profile.id}`;
    const generation = ++this.clientGeneration;
    let socketToken = profile.socketConnectionToken;
    const getConnectionToken = async () => {
      if (socketToken) {
        const current = socketToken;
        socketToken = null;
        return current;
      }
      const freshProfile = await this.oauth.fetchIdentity('memealerts', await this.oauth.getAccessToken('memealerts'));
      if (String(freshProfile?.id) !== String(profile.id) || !freshProfile.socketConnectionToken) throw new Error('memealerts_socket_token_unavailable');
      return freshProfile.socketConnectionToken;
    };
    const client = this.eventClientFactory({
      provider: 'memealerts',
      endpoint: ENDPOINT,
      channel,
      getConnectionToken,
      getSubscriptionToken: (_context, clientId) => this.requestSubscriptionToken(channel, clientId),
      onEvent: (payload) => {
        const event = normalizeMemeAlertsEvent(payload);
        if (event) this.onDonation(event);
        else this.logger.warn('Meme Alerts donation event was rejected', { provider: 'memealerts', reason: 'invalid_event' });
      },
      onStatus: (patch) => {
        if (this.stopped || generation !== this.clientGeneration) return;
        if (patch.connectionStatus === 'Listening') this.retryAttempt = 0;
        this.statuses?.set('memealerts', patch);
        if (patch.connectionStatus === 'Error') this.scheduleConnectionRetry(patch.message);
      },
      websocket: this.websocket,
      logger: this.logger,
    });
    this.client = client;
    try {
      await client.start();
    } catch (error) {
      const reason = safeApiError(error, 'memealerts_connection_failed');
      this.scheduleConnectionRetry(reason);
      throw error;
    }
  }

  scheduleConnectionRetry(reason) {
    if (this.stopped || this.retryTimer) return;
    const delay = this.retryDelays.length
      ? this.retryDelays[Math.min(this.retryAttempt++, this.retryDelays.length - 1)]
      : undefined;
    const client = this.client;
    this.client = null;
    this.clientGeneration += 1;
    client?.stop();
    if (delay === undefined) {
      this.statuses?.set('memealerts', { connectionStatus: 'Error', message: reason });
      return;
    }
    const safeReason = /^[a-z0-9_]+$/iu.test(String(reason ?? ''))
      ? String(reason)
      : 'memealerts_connection_failed';
    this.statuses?.set('memealerts', { connectionStatus: 'Retrying', message: safeReason });
    this.logger.warn('Meme Alerts connection failed; retry scheduled.', {
      provider: 'memealerts',
      reason: safeReason,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start().catch((retryError) => {
        this.logger.warn('Meme Alerts connection retry failed.', {
          provider: 'memealerts',
          reason: safeApiError(retryError, 'memealerts_connection_failed'),
        });
      });
    }, delay);
  }

  async stop() {
    this.stopped = true;
    this.clientGeneration += 1;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    this.client = null;
    client?.stop();
  }
}

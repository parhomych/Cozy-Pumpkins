import { DONATIONALERTS_CENTRIFUGO_ENDPOINT } from './centrifugo-client.js';
import { LegacyCentrifugoEventClient } from './legacy-centrifugo-client.js';

const API = 'https://www.donationalerts.com/api/v1';
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

function safeApiError(error, fallback) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return `${fallback}_timeout`;
  return fallback;
}

export function normalizeDonationAlertsEvent(input) {
  const event = input?.data?.data ?? input?.data ?? input;
  const id = event?.id ?? event?.donation_id;
  const name = event?.username ?? event?.user_name ?? event?.name ?? event?.user?.name;
  const amount = Number(event?.amount);
  const currency = String(event?.currency ?? event?.currency_code ?? '').trim().toUpperCase();
  if (id == null || !String(id).trim() || typeof name !== 'string' || !name.trim()
    || !Number.isFinite(amount) || amount <= 0 || !currency) return null;
  const ownerId = event?.donor_id ?? event?.user_id ?? event?.user?.id ?? null;
  return {
    provider: 'donationalerts',
    id: String(id).trim(),
    ownerId: ownerId == null ? null : String(ownerId),
    name: name.trim(),
    amount,
    currency,
    message: typeof event.message === 'string' ? event.message : '',
  };
}

export class DonationAlertsEvents {
  constructor({
    oauth,
    tokenStore,
    onDonation,
    statuses,
    fetchImpl = globalThis.fetch,
    eventClientFactory = (options) => new LegacyCentrifugoEventClient(options),
    websocket = globalThis.WebSocket,
    logger = console,
  } = {}) {
    Object.assign(this, { oauth, tokenStore, onDonation, statuses, fetch: fetchImpl, eventClientFactory, websocket, logger });
    this.client = null;
  }

  async requestSubscriptionToken(channel, clientId) {
    if (!CLIENT_ID_PATTERN.test(String(clientId || ''))) throw new Error('donationalerts_centrifugo_client_id_invalid');
    const accessToken = await this.oauth.getAccessToken('donationalerts');
    let response;
    try {
      response = await this.fetch(`${API}/centrifuge/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ channels: [channel], client: clientId }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new Error(safeApiError(error, 'donationalerts_subscription_token_failed'));
    }
    if (!response.ok) throw new Error('donationalerts_subscription_token_failed');
    let body;
    try { body = await response.json(); } catch { throw new Error('donationalerts_subscription_token_invalid'); }
    const token = body?.channels?.find((item) => item.channel === channel)?.token;
    if (typeof token !== 'string' || !token) throw new Error('donationalerts_subscription_token_invalid');
    return token;
  }

  async start() {
    if (this.client) return;
    const token = this.tokenStore.get('donationalerts');
    if (!token?.accessToken) throw new Error('donationalerts_not_connected');
    const profile = await this.oauth.fetchIdentity('donationalerts', await this.oauth.getAccessToken('donationalerts'));
    if (!profile?.id) throw new Error('donationalerts_account_unavailable');
    if (token.providerUserId && String(token.providerUserId) !== String(profile.id)) throw new Error('donationalerts_account_changed');
    if (typeof profile.socketConnectionToken !== 'string' || !profile.socketConnectionToken) throw new Error('donationalerts_socket_token_unavailable');
    if (!token.providerUserId) this.tokenStore.save('donationalerts', { ...token, providerUserId: String(profile.id) });
    const channel = `$alerts:donation_${profile.id}`;
    let socketToken = profile.socketConnectionToken;
    const getConnectionToken = async () => {
      if (socketToken) {
        const current = socketToken;
        socketToken = null;
        return current;
      }
      const freshProfile = await this.oauth.fetchIdentity('donationalerts', await this.oauth.getAccessToken('donationalerts'));
      if (String(freshProfile?.id) !== String(profile.id) || !freshProfile.socketConnectionToken) throw new Error('donationalerts_socket_token_unavailable');
      return freshProfile.socketConnectionToken;
    };
    const client = this.eventClientFactory({
      provider: 'donationalerts',
      endpoint: DONATIONALERTS_CENTRIFUGO_ENDPOINT,
      channel,
      getConnectionToken,
      getSubscriptionToken: (_context, clientId) => this.requestSubscriptionToken(channel, clientId),
      onEvent: (payload) => {
        const event = normalizeDonationAlertsEvent(payload);
        if (event) this.onDonation(event);
        else this.logger.warn('DonationAlerts donation event was rejected', { provider: 'donationalerts', reason: 'invalid_event' });
      },
      onStatus: (patch) => this.statuses?.set('donationalerts', patch),
      websocket: this.websocket,
      logger: this.logger,
    });
    this.client = client;
    try {
      await client.start();
    } catch (error) {
      this.client = null;
      this.statuses?.set('donationalerts', { connectionStatus: 'Error', message: safeApiError(error, 'donationalerts_connection_failed') });
      throw error;
    }
  }

  async stop() {
    const client = this.client;
    this.client = null;
    client?.stop();
  }
}

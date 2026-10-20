import { HttpTransportType, HubConnectionBuilder } from '@microsoft/signalr';

export const DONATEX_HUB_ENDPOINT = 'https://donatex.gg/api/public-donations-hub';
const RECONNECT_DELAYS = [0, 2000, 5000, 10000, 30000];

function safeError(error, fallback) {
  const name = String(error?.name ?? '').toLowerCase();
  return name.includes('timeout') || name.includes('abort') ? `${fallback}_timeout` : fallback;
}

function createHubConnection(url, getAccessToken, _retryDelays, options) {
  return new HubConnectionBuilder()
    .withUrl(url, { accessTokenFactory: getAccessToken, ...options })
    .withAutomaticReconnect(RECONNECT_DELAYS)
    .build();
}

export function normalizeDonatExEvent(input) {
  const id = input?.id ?? input?.donationId ?? input?.donation_id;
  const sender = input?.user ?? input?.donor ?? {};
  const name = input?.username ?? input?.userName ?? input?.name ?? sender.username ?? sender.name;
  const amount = Number(input?.amount ?? input?.donationAmount ?? input?.donation_amount);
  const currency = String(input?.currency ?? input?.currencyCode ?? input?.currency_code ?? '').trim().toUpperCase();
  if (id == null || !String(id).trim() || typeof name !== 'string' || !name.trim()
    || !Number.isFinite(amount) || amount <= 0 || !currency) return null;
  const ownerId = input?.userId ?? input?.user_id ?? sender.id ?? null;
  return {
    provider: 'donatex',
    id: String(id).trim(),
    ownerId: ownerId == null ? null : String(ownerId),
    name: name.trim(),
    amount,
    currency,
    message: typeof (input?.message ?? input?.comment) === 'string' ? (input.message ?? input.comment) : '',
  };
}

export class DonatExEvents {
  constructor({
    oauth,
    onDonation,
    statuses,
    connectionFactory = createHubConnection,
    logger = console,
  } = {}) {
    Object.assign(this, { oauth, onDonation, statuses, connectionFactory, logger });
    this.connection = null;
    this.seenDonationIds = new Set();
    this.pendingDonationIds = new Set();
  }

  async dispatchDonation(payload) {
    const event = normalizeDonatExEvent(payload);
    if (!event) {
      this.logger.warn('DonatEx donation event was rejected', { provider: 'donatex', reason: 'invalid_event' });
      return;
    }
    if (this.seenDonationIds.has(event.id) || this.pendingDonationIds.has(event.id)) return;
    this.pendingDonationIds.add(event.id);
    try {
      await this.onDonation(event);
      this.seenDonationIds.add(event.id);
      if (this.seenDonationIds.size > 10000) this.seenDonationIds.delete(this.seenDonationIds.values().next().value);
    } catch (error) {
      this.logger.warn('DonatEx donation event could not be processed', { reason: safeError(error, 'donatex_event_rejected') });
    } finally {
      this.pendingDonationIds.delete(event.id);
    }
  }

  async start() {
    if (this.connection) return;
    const connection = this.connectionFactory(
      DONATEX_HUB_ENDPOINT,
      () => this.oauth.getAccessToken('donatex'),
      RECONNECT_DELAYS,
      { transport: HttpTransportType.WebSockets },
    );
    this.connection = connection;
    connection.on('DonationCreated', (event) => { void this.dispatchDonation(event); });
    connection.on('DonationRerun', (event) => { void this.dispatchDonation(event); });
    connection.onreconnecting(() => {
      if (this.connection === connection) this.statuses?.set('donatex', { connectionStatus: 'Retrying', message: null });
    });
    connection.onreconnected(() => {
      if (this.connection === connection) this.statuses?.set('donatex', { connectionStatus: 'Listening', message: null });
    });
    connection.onclose((error) => {
      if (this.connection !== connection) return;
      this.connection = null;
      this.statuses?.set('donatex', {
        connectionStatus: 'Error',
        message: error ? safeError(error, 'donatex_connection_closed') : 'donatex_connection_closed',
      });
    });
    this.statuses?.set('donatex', { connectionStatus: 'Retrying', message: null });
    try {
      await connection.start();
      if (this.connection === connection) this.statuses?.set('donatex', { connectionStatus: 'Listening', message: null });
    } catch (error) {
      if (this.connection === connection) this.connection = null;
      this.statuses?.set('donatex', { connectionStatus: 'Error', message: safeError(error, 'donatex_connection_failed') });
      throw new Error(safeError(error, 'donatex_connection_failed'));
    }
  }

  async stop() {
    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.stop();
    this.statuses?.set('donatex', { connectionStatus: 'Disconnected', message: null });
  }
}

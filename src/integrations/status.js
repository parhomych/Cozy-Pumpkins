export const PROVIDERS = ['twitch', 'donationalerts', 'donatex', 'memealerts'];
const TWITCH_AUTH_STATUSES = new Set(['Disconnected', 'Connected', 'Failed']);
const TWITCH_CONNECTION_STATUSES = new Set(['Disconnected', 'Listening', 'Retrying', 'Error']);
const DONATION_AUTH_STATUSES = new Set(['Disconnected', 'Connected', 'Failed']);
const DONATION_CONNECTION_STATUSES = new Set(['Disconnected', 'Listening', 'Retrying', 'Error']);

export class IntegrationStatus {
  constructor(db) {
    this.db = db;
    this.values = Object.fromEntries(PROVIDERS.map((provider) => [provider, {
      authStatus: 'Disconnected',
      connectionStatus: 'Disconnected',
      account: null,
      message: null,
    }]));
  }
  set(provider, patch) {
    if (!PROVIDERS.includes(provider)) throw new Error('unsupported_provider');
    if (provider === 'twitch') {
      if (patch.authStatus !== undefined && !TWITCH_AUTH_STATUSES.has(patch.authStatus)) throw new Error('invalid_twitch_auth_status');
      if (patch.connectionStatus !== undefined && !TWITCH_CONNECTION_STATUSES.has(patch.connectionStatus)) throw new Error('invalid_twitch_connection_status');
    } else {
      if (patch.authStatus !== undefined && !DONATION_AUTH_STATUSES.has(patch.authStatus)) throw new Error('invalid_donation_auth_status');
      if (patch.connectionStatus !== undefined && !DONATION_CONNECTION_STATUSES.has(patch.connectionStatus)) throw new Error('invalid_donation_connection_status');
    }
    this.values[provider] = { ...this.values[provider], ...patch };
    return this.public(provider);
  }
  public(provider) {
    const value = this.values[provider];
    if (!value) throw new Error('unsupported_provider');
    return {
      provider,
      authStatus: value.authStatus,
      connectionStatus: value.connectionStatus,
      account: value.account,
      message: value.message,
    };
  }
  all() { return PROVIDERS.map((provider) => this.public(provider)); }
  loadTokens(tokenStore) {
    for (const provider of PROVIDERS) {
      const token = tokenStore.get(provider);
      if (token?.accessToken) {
        this.values[provider] = {
          ...this.values[provider],
          authStatus: 'Connected',
          connectionStatus: 'Disconnected',
          account: token.providerLogin || null,
        };
      }
    }
  }
}

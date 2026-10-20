export const PROVIDERS = ['twitch', 'donationalerts'];
const TWITCH_AUTH_STATUSES = new Set(['Disconnected', 'Connected', 'Failed']);
const TWITCH_CONNECTION_STATUSES = new Set(['Disconnected', 'Listening', 'Retrying', 'Error']);

export class IntegrationStatus {
  constructor(db) {
    this.db = db;
    this.values = Object.fromEntries(PROVIDERS.map((provider) => [provider, {
      authStatus: provider === 'twitch' ? 'Disconnected' : 'Not connected',
      connectionStatus: provider === 'twitch' ? 'Disconnected' : 'Not connected',
      account: null,
      message: null,
    }]));
  }
  set(provider, patch) {
    if (provider === 'twitch') {
      if (patch.authStatus !== undefined && !TWITCH_AUTH_STATUSES.has(patch.authStatus)) throw new Error('invalid_twitch_auth_status');
      if (patch.connectionStatus !== undefined && !TWITCH_CONNECTION_STATUSES.has(patch.connectionStatus)) throw new Error('invalid_twitch_connection_status');
    }
    this.values[provider] = { ...this.values[provider], ...patch };
    return this.public(provider);
  }
  public(provider) { const value = this.values[provider]; return { provider, ...value }; }
  all() { return PROVIDERS.map((provider) => this.public(provider)); }
  loadTokens(tokenStore) {
    for (const provider of PROVIDERS) {
      const token = tokenStore.get(provider);
      if (token?.accessToken) {
        this.values[provider] = {
          ...this.values[provider],
          authStatus: 'Connected',
          connectionStatus: provider === 'twitch' ? 'Disconnected' : 'Not connected',
          account: token.providerLogin || null,
          providerUserId: token.providerUserId || null,
          providerLogin: token.providerLogin || null,
        };
      }
    }
  }
}

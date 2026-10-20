export const PROVIDERS = ['twitch', 'donationalerts'];
export class IntegrationStatus {
  constructor(db) { this.db = db; this.values = Object.fromEntries(PROVIDERS.map((provider) => [provider, { authStatus: 'Not connected', connectionStatus: 'Not connected', message: null }])); }
  set(provider, patch) { this.values[provider] = { ...this.values[provider], ...patch }; return this.public(provider); }
  public(provider) { const value = this.values[provider]; return { provider, ...value }; }
  all() { return PROVIDERS.map((provider) => this.public(provider)); }
  loadTokens(tokenStore) { for (const provider of PROVIDERS) if (tokenStore.get(provider)?.accessToken) this.values[provider] = { ...this.values[provider], authStatus: 'Connected', connectionStatus: 'Not connected' }; }
}

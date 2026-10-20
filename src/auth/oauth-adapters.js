import crypto from 'node:crypto';

function oauthState(secret, provider) { const nonce = crypto.randomBytes(24).toString('base64url'); const mac = crypto.createHmac('sha256', secret).update(`${provider}.${nonce}`).digest('base64url'); return `${provider}.${nonce}.${mac}`; }
export function verifyOAuthState(value, secret, provider) { const [kind, nonce, signature] = String(value || '').split('.'); if (kind !== provider || !nonce || !signature) return false; const expected = crypto.createHmac('sha256', secret).update(`${provider}.${nonce}`).digest('base64url'); const actual = Buffer.from(signature); const wanted = Buffer.from(expected); return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted); }

export class OAuthAdapters {
  constructor({ config, tokenStore, statuses, twitchApi = null, logger = console, fetchImpl = globalThis.fetch } = {}) { this.config = config; this.tokenStore = tokenStore; this.statuses = statuses; this.twitchApi = twitchApi; this.logger = logger; this.fetch = fetchImpl; }
  authorizationUrl(provider) {
    const c = this.config[provider]; if (!c.clientId) return null;
    const state = oauthState(this.config.sessionSecret, provider); const params = new URLSearchParams({ response_type: 'code', client_id: c.clientId, redirect_uri: c.redirectUri, state });
    if (provider === 'twitch') { params.set('scope', 'channel:read:redemptions'); return `https://id.twitch.tv/oauth2/authorize?${params}`; }
    params.set('scope', 'oauth-user-show oauth-donation-subscribe'); return `https://www.donationalerts.com/oauth/authorize?${params}`;
  }
  async callback(provider, code, state) {
    const c = this.config[provider]; if (!c.clientId || !c.clientSecret) throw new Error(`${provider}_credentials_missing`);
    if (!verifyOAuthState(state, this.config.sessionSecret, provider)) throw new Error('invalid_oauth_state');
    if (!this.fetch) throw new Error('fetch_unavailable');
    const endpoint = provider === 'twitch' ? 'https://id.twitch.tv/oauth2/token' : 'https://www.donationalerts.com/oauth/token';
    const response = await this.fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, code, grant_type: 'authorization_code', redirect_uri: c.redirectUri }) });
    if (!response.ok) throw new Error(`${provider}_oauth_failed`);
    const token = await response.json();
    const identity = provider === 'twitch' ? await this.twitchApi?.getAuthenticatedUser(token.access_token) : null;
    if (provider === 'twitch' && (!identity?.id || !identity?.login)) throw new Error('twitch_account_unavailable');
    this.tokenStore.save(provider, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Math.floor(Date.now() / 1000) + token.expires_in : null,
      scopes: Array.isArray(token.scope) ? token.scope.join(' ') : token.scope || '',
      providerUserId: identity?.id || null,
      providerLogin: identity?.login || null,
    });
    this.statuses.set(provider, {
      authStatus: 'Connected',
      connectionStatus: provider === 'twitch' ? 'Disconnected' : 'Not connected',
      account: identity?.displayName || identity?.login || null,
      providerUserId: identity?.id || null,
      providerLogin: identity?.login || null,
      message: null,
    });
    return { connected: true, account: identity?.displayName || identity?.login || null };
  }
  async logout(provider) {
    const token = this.tokenStore.get(provider); let remoteRevoked = false; let message = 'Локально отключено.';
    if (provider === 'twitch' && token?.accessToken && this.config.twitch.clientId && this.fetch) {
      try {
        const response = await this.fetch(`https://id.twitch.tv/oauth2/revoke?client_id=${encodeURIComponent(this.config.twitch.clientId)}&token=${encodeURIComponent(token.accessToken)}`, { method: 'POST' });
        remoteRevoked = response.ok;
        message = response.ok ? 'Токен отозван у Twitch.' : 'Twitch не подтвердил отзыв токена; локальное подключение отключено.';
      } catch {
        message = 'Не удалось подтвердить отзыв токена у Twitch; локальное подключение отключено.';
        this.logger.warn('Twitch token revocation could not be confirmed.');
      }
    } else if (provider === 'donationalerts') message = 'Локально отключено; удалённый отзыв DonationAlerts не подтверждён.';
    this.tokenStore.delete(provider);
    const disconnected = provider === 'twitch' ? 'Disconnected' : 'Not connected';
    this.statuses.set(provider, { authStatus: disconnected, connectionStatus: disconnected, account: null, providerUserId: null, providerLogin: null, message });
    return { remoteRevoked, message };
  }
}

import crypto from 'node:crypto';

const PROVIDERS = new Set(['twitch', 'donationalerts', 'donatex', 'memealerts']);
const DONATION_PROVIDERS = ['donationalerts', 'donatex', 'memealerts'];
const OAUTH = {
  twitch: {
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',
    scope: 'channel:read:redemptions',
  },
  donationalerts: {
    authorize: 'https://www.donationalerts.com/oauth/authorize',
    token: 'https://www.donationalerts.com/oauth/token',
    scope: 'oauth-user-show oauth-donation-subscribe',
  },
  donatex: {
    authorize: 'https://donatex.gg/api/connect/authorize',
    token: 'https://donatex.gg/api/connect/token',
    scope: 'openid offline_access donations.subscribe user.read',
    pkce: true,
  },
  memealerts: {
    authorize: 'https://memealerts.com/oauth/authorize',
    token: 'https://memealerts.com/oauth/token',
    scope: 'oauth-user-show oauth-donation-subscribe',
  },
};

function oauthState(secret, provider) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(`${provider}.${nonce}`).digest('base64url');
  return `${provider}.${nonce}.${mac}`;
}

function tokenForm(response, provider, current = {}) {
  const value = response?.data ?? response;
  if (!value?.access_token) throw new Error(`${provider}_oauth_invalid_response`);
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token || current.refreshToken || null,
    expiresAt: value.expires_in ? Math.floor(Date.now() / 1000) + Number(value.expires_in) : null,
    scopes: Array.isArray(value.scope) ? value.scope.join(' ') : value.scope || current.scopes || '',
    providerUserId: current.providerUserId || null,
    providerLogin: current.providerLogin || null,
  };
}

function profileFields(provider, response) {
  const profile = response?.data?.data ?? response?.data ?? response;
  const id = profile?.id ?? profile?.user_id;
  const login = profile?.login ?? profile?.username ?? profile?.code ?? profile?.user_name;
  const displayName = profile?.displayName ?? profile?.display_name ?? profile?.name ?? login;
  if (!id || !login) throw new Error(`${provider}_account_unavailable`);
  return { id: String(id), login: String(login), displayName: String(displayName || login) };
}

export function verifyOAuthState(value, secret, provider) {
  const [kind, nonce, signature] = String(value || '').split('.');
  if (kind !== provider || !nonce || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${provider}.${nonce}`).digest('base64url');
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

export class OAuthAdapters {
  constructor({ config, tokenStore, statuses, twitchApi = null, logger = console, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    Object.assign(this, { config, tokenStore, statuses, twitchApi, logger, fetch: fetchImpl, now });
    this.pkceChallenges = new Map();
    this.refreshes = new Map();
  }

  authorizationUrl(provider) {
    if (!PROVIDERS.has(provider)) throw new Error('unsupported_provider');
    const config = this.config[provider];
    if (!config?.clientId) return null;
    const state = oauthState(this.config.sessionSecret, provider);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      scope: OAUTH[provider].scope,
    });
    if (OAUTH[provider].pkce) {
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      this.pkceChallenges.set(state, { verifier, expiresAt: this.now() + 10 * 60 * 1000 });
      for (const [key, value] of this.pkceChallenges) if (value.expiresAt <= this.now()) this.pkceChallenges.delete(key);
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${OAUTH[provider].authorize}?${params}`;
  }

  async requestJson(url, options, errorCode) {
    if (!this.fetch) throw new Error('fetch_unavailable');
    let response;
    try {
      response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error(`${errorCode}_timeout`);
      throw new Error(`${errorCode}_unavailable`);
    }
    if (!response.ok) throw new Error(errorCode);
    try {
      return response.status === 204 ? null : await response.json();
    } catch {
      throw new Error(`${errorCode}_invalid_response`);
    }
  }

  async fetchIdentity(provider, accessToken) {
    if (provider === 'twitch') return this.twitchApi?.getAuthenticatedUser(accessToken);
    const endpoint = provider === 'donatex'
      ? 'https://donatex.gg/api/v1/user/me'
      : `https://${provider === 'donationalerts' ? 'www.donationalerts.com' : 'memealerts.com'}/api/v1/user/oauth`;
    const response = await this.requestJson(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }, `${provider}_profile_failed`);
    const rawProfile = response?.data?.data ?? response?.data ?? response;
    return {
      ...profileFields(provider, response),
      socketConnectionToken: rawProfile?.socket_connection_token ?? rawProfile?.socketConnectionToken ?? null,
    };
  }

  async exchangeToken(provider, body) {
    return this.requestJson(OAUTH[provider].token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body),
    }, `${provider}_oauth_failed`);
  }

  async callback(provider, code, state) {
    if (!PROVIDERS.has(provider)) throw new Error('unsupported_provider');
    const config = this.config[provider];
    if (!config?.clientId || !config?.clientSecret) throw new Error(`${provider}_credentials_missing`);
    if (typeof code !== 'string' || !code || !verifyOAuthState(state, this.config.sessionSecret, provider)) throw new Error('invalid_oauth_state');
    const body = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    };
    if (OAUTH[provider].pkce) {
      const challenge = this.pkceChallenges.get(state);
      this.pkceChallenges.delete(state);
      if (!challenge || challenge.expiresAt <= this.now()) throw new Error('oauth_state_expired');
      body.code_verifier = challenge.verifier;
    }
    if (!this.fetch) throw new Error('fetch_unavailable');
    const response = await this.exchangeToken(provider, body);
    const token = tokenForm(response, provider);
    let identity = null;
    try {
      identity = await this.fetchIdentity(provider, token.accessToken);
    } catch (error) {
      if (provider === 'twitch' || provider === 'donatex') throw error;
      this.logger.warn('Donation provider profile lookup failed', { provider, reason: error.message });
    }
    if (identity?.id) token.providerUserId = identity.id;
    if (identity?.login) token.providerLogin = identity.login;
    this.tokenStore.save(provider, token);
    const account = identity?.displayName || identity?.login || provider;
    this.statuses.set(provider, {
      authStatus: 'Connected',
      connectionStatus: 'Disconnected',
      account,
      providerUserId: identity?.id || null,
      providerLogin: identity?.login || null,
      message: null,
    });
    return { connected: true, account };
  }

  async getAccessToken(provider) {
    if (!DONATION_PROVIDERS.includes(provider)) throw new Error('unsupported_provider');
    const token = this.tokenStore.get(provider);
    if (!token?.accessToken) throw new Error(`${provider}_not_connected`);
    if (!token.refreshToken || !token.expiresAt || token.expiresAt > Math.floor(this.now() / 1000) + 60) return token.accessToken;
    if (!this.refreshes.has(provider)) {
      const refresh = this.refreshToken(provider, token);
      this.refreshes.set(provider, refresh);
      refresh.finally(() => this.refreshes.delete(provider)).catch(() => {});
    }
    return (await this.refreshes.get(provider)).accessToken;
  }

  async refreshToken(provider, current) {
    const config = this.config[provider];
    if (!config?.clientId || !config?.clientSecret) throw new Error(`${provider}_credentials_missing`);
    const response = await this.exchangeToken(provider, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    });
    const next = tokenForm(response, provider, current);
    this.tokenStore.save(provider, next);
    return next;
  }

  async logout(provider) {
    if (!PROVIDERS.has(provider)) throw new Error('unsupported_provider');
    const token = this.tokenStore.get(provider);
    let remoteRevoked = false;
    let message = 'Локально отключено.';
    if (provider === 'twitch' && token?.accessToken && this.config.twitch.clientId && this.fetch) {
      try {
        const response = await this.fetch(`https://id.twitch.tv/oauth2/revoke?client_id=${encodeURIComponent(this.config.twitch.clientId)}&token=${encodeURIComponent(token.accessToken)}`, { method: 'POST', signal: AbortSignal.timeout(8000) });
        remoteRevoked = response.ok;
        message = response.ok ? 'Токен отозван у Twitch.' : 'Twitch не подтвердил отзыв токена; локальное подключение отключено.';
      } catch {
        message = 'Не удалось подтвердить отзыв токена у Twitch; локальное подключение отключено.';
        this.logger.warn('Twitch token revocation could not be confirmed.');
      }
    } else if (provider === 'donatex' && token?.refreshToken && this.fetch) {
      const config = this.config.donatex;
      try {
        const response = await this.fetch('https://donatex.gg/api/connect/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: token.refreshToken, client_id: config.clientId, client_secret: config.clientSecret }),
          signal: AbortSignal.timeout(8000),
        });
        remoteRevoked = response.ok;
        message = response.ok ? 'Токен отозван у DonatEx.' : 'DonatEx не подтвердил отзыв токена; локальное подключение отключено.';
      } catch {
        message = 'Не удалось подтвердить отзыв токена у DonatEx; локальное подключение отключено.';
        this.logger.warn('DonatEx token revocation could not be confirmed.');
      }
    } else if (provider !== 'twitch') {
      message = `Локально отключено; ${provider} не подтвердил удалённый отзыв токена.`;
    }
    this.tokenStore.delete(provider);
    const disconnected = 'Disconnected';
    this.statuses.set(provider, {
      authStatus: disconnected,
      connectionStatus: disconnected,
      account: null,
      providerUserId: null,
      providerLogin: null,
      message,
    });
    return { remoteRevoked, message };
  }
}

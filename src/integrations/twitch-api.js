const HELIX_BASE = 'https://api.twitch.tv/helix';

function safeProviderError(status) {
  if (status === 401) return 'twitch_auth_failed';
  if (status === 403) return 'twitch_scope_missing';
  if (status === 429) return 'twitch_rate_limited';
  if (status >= 500) return 'twitch_unavailable';
  return 'twitch_request_failed';
}

export class TwitchApiClient {
  constructor({ config, tokenStore, getAccessToken = null, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
    Object.assign(this, { config, tokenStore, getAccessToken, fetch: fetchImpl, timeoutMs });
  }

  async request(path, { accessToken, method = 'GET', body } = {}) {
    if (!this.config?.twitch?.clientId || !accessToken || !this.fetch) {
      throw new Error(!accessToken ? 'twitch_not_connected' : 'twitch_credentials_missing');
    }
    let response;
    try {
      response = await this.fetch(`${HELIX_BASE}${path}`, {
        method,
        headers: {
          'Client-Id': this.config.twitch.clientId,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('twitch_request_timeout');
      throw new Error('twitch_unavailable');
    }
    if (!response.ok) throw new Error(safeProviderError(response.status));
    try {
      return await response.json();
    } catch {
      throw new Error('twitch_invalid_response');
    }
  }

  async getAuthenticatedUser(accessToken) {
    const data = await this.request('/users', { accessToken });
    const user = data?.data?.[0];
    if (!user?.id || !user?.login) throw new Error('twitch_user_unavailable');
    return { id: String(user.id), login: String(user.login), displayName: String(user.display_name || user.login) };
  }

  async listChannelRewards() {
    const token = this.tokenStore?.get('twitch');
    if (!token?.accessToken) throw new Error('twitch_not_connected');
    if (!token.providerUserId) throw new Error('twitch_account_unavailable');
    const accessToken = this.getAccessToken ? await this.getAccessToken() : token.accessToken;

    const rewards = [];
    let cursor = null;
    do {
      const query = new URLSearchParams({ broadcaster_id: token.providerUserId });
      if (cursor) query.set('after', cursor);
      const data = await this.request(`/channel_points/custom_rewards?${query}`, { accessToken });
      for (const reward of data?.data || []) {
        if (!reward?.id || typeof reward.title !== 'string') continue;
        rewards.push({
          id: String(reward.id),
          title: reward.title,
          cost: Number.isFinite(Number(reward.cost)) ? Number(reward.cost) : 0,
          isEnabled: Boolean(reward.is_enabled),
          isUserInputRequired: Boolean(reward.is_user_input_required),
        });
      }
      cursor = data?.pagination?.cursor || null;
    } while (cursor);
    return rewards;
  }

  async createRedemptionSubscription({ accessToken, broadcasterId, sessionId }) {
    const response = await this.request('/eventsub/subscriptions', {
      accessToken,
      method: 'POST',
      body: {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: 'websocket', session_id: sessionId },
      },
    });
    const subscription = response?.data?.find((entry) => entry.type === 'channel.channel_points_custom_reward_redemption.add');
    if (!subscription || subscription.status !== 'enabled') throw new Error('twitch_subscription_not_enabled');
    return subscription;
  }
}

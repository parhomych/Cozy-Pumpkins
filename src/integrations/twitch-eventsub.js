const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';
const MAX_RECONNECT_DELAY_MS = 30_000;

function listen(socket, type, handler) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(type, handler);
  else if (typeof socket.on === 'function') socket.on(type, handler);
  else throw new Error('twitch_websocket_invalid');
}

function eventData(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value?.data !== undefined) return eventData(value.data);
  return String(value);
}

export class TwitchEventSub {
  constructor({
    tokenStore,
    twitchApi,
    getAccessToken = null,
    statuses,
    onRedemption,
    broadcast = () => {},
    WebSocketImpl = globalThis.WebSocket,
    logger = console,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = {}) {
    Object.assign(this, { tokenStore, twitchApi, getAccessToken });
    this.statuses = statuses;
    this.onRedemption = onRedemption;
    this.broadcast = broadcast;
    this.WebSocketImpl = WebSocketImpl;
    this.logger = logger;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.socket = null;
    this.reconnectTimer = null;
    this.keepaliveTimer = null;
    this.keepaliveTimeoutMs = 10_000;
    this.running = false;
    this.reconnectAttempts = 0;
    this.generation = 0;
    this.token = null;
    this.broadcasterId = null;
  }

  setStatus(connectionStatus, message = null) {
    const status = this.statuses?.set('twitch', { connectionStatus, message });
    if (status) this.broadcast('integration:status', status);
  }

  async start() {
    const token = this.tokenStore?.get('twitch');
    if (!token?.accessToken || !token.providerUserId) {
      this.setStatus('Disconnected', 'Twitch account is not connected.');
      return false;
    }
    if (typeof this.WebSocketImpl !== 'function') {
      this.setStatus('Error', 'WebSocket support is unavailable.');
      return false;
    }
    await this.stop({ updateStatus: false });
    this.running = true;
    this.token = token;
    this.broadcasterId = token.providerUserId;
    this.reconnectAttempts = 0;
    this.setStatus('Retrying', 'Connecting to Twitch live events.');
    try {
      await this.refreshAccessToken();
    } catch (error) {
      if (this.isRetryableConnectionError(error)) {
        this.scheduleReconnect('Twitch authorization refresh is temporarily unavailable.');
        return true;
      }
      this.running = false;
      this.setStatus('Error', 'Twitch authorization expired. Reconnect Twitch to resume.');
      return false;
    }
    this.connect(EVENTSUB_URL, true);
    return true;
  }

  async refreshAccessToken() {
    if (!this.getAccessToken) return this.token?.accessToken;
    const accessToken = await this.getAccessToken();
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('twitch_not_connected');
    if (this.token) this.token = { ...this.token, accessToken };
    return accessToken;
  }

  isRetryableConnectionError(error) {
    return /_(?:timeout|unavailable|rate_limited)$/u.test(String(error?.message || ''));
  }

  connect(url, subscribe) {
    if (!this.running) return;
    let socket;
    try {
      socket = new this.WebSocketImpl(url);
    } catch {
      this.scheduleReconnect('Unable to open the Twitch live connection.');
      return;
    }
    this.socket = socket;
    const generation = ++this.generation;
    listen(socket, 'message', (event) => {
      if (this.socket === socket && this.running) void this.handleMessage(socket, generation, event, subscribe);
    });
    listen(socket, 'error', () => {
      if (this.socket === socket && this.running) this.scheduleReconnect('The Twitch live connection encountered an error.');
    });
    listen(socket, 'close', () => {
      if (this.socket === socket && this.running) this.scheduleReconnect('The Twitch live connection was interrupted.');
    });
  }

  async handleMessage(socket, generation, message, subscribe) {
    let envelope;
    try {
      envelope = JSON.parse(eventData(message));
    } catch {
      this.logger.warn('Ignored an invalid Twitch EventSub message.');
      return;
    }
    const type = envelope?.metadata?.message_type;
    if (type === 'session_welcome') {
      const session = envelope?.payload?.session;
      if (!session?.id) {
        this.scheduleReconnect('Twitch did not provide a live session.');
        return;
      }
      this.keepaliveTimeoutMs = Math.max(1_000, Number(session.keepalive_timeout_seconds || 10) * 1000) + 1_000;
      this.resetKeepalive(socket);
      if (subscribe) {
        try {
          const accessToken = await this.refreshAccessToken();
          await this.twitchApi.createRedemptionSubscription({
            accessToken,
            broadcasterId: this.broadcasterId,
            sessionId: session.id,
          });
        } catch (error) {
          if (this.socket === socket && this.generation === generation) {
            if (!this.isRetryableConnectionError(error)
              && (error?.message === 'twitch_auth_failed' || error?.message === 'twitch_scope_missing'
                || String(error?.message || '').startsWith('twitch_oauth_')
                || error?.message === 'twitch_refresh_token_missing')) {
              this.running = false;
              this.clearTimers();
              this.setStatus('Error', error.message === 'twitch_scope_missing'
                ? 'Reconnect Twitch and grant permission to read channel point redemptions.'
                : 'Twitch authorization expired. Reconnect Twitch to resume.');
              socket.close(1000, 'Twitch authorization is no longer valid');
              return;
            }
            this.logger.warn('Twitch EventSub subscription request failed.');
            this.scheduleReconnect('Unable to subscribe to Twitch reward activations.');
          }
          return;
        }
      }
      if (this.socket === socket && this.generation === generation) {
        this.setStatus('Listening');
      }
      return;
    }
    if (type === 'session_keepalive') {
      this.reconnectAttempts = 0;
      this.resetKeepalive(socket);
      return;
    }
    if (type === 'session_reconnect') {
      const url = envelope?.payload?.session?.reconnect_url;
      if (typeof url !== 'string' || !url.startsWith('wss://')) {
        this.scheduleReconnect('Twitch provided an invalid reconnect address.');
        return;
      }
      const previous = this.socket;
      this.connect(url, false);
      if (previous && previous !== this.socket) previous.close(1000, 'EventSub session handoff');
      return;
    }
    if (type === 'revocation') {
      this.running = false;
      this.clearTimers();
      this.setStatus('Error', 'Twitch revoked the reward activation subscription. Reconnect Twitch to resume.');
      socket.close(1000, 'EventSub subscription revoked');
      return;
    }
    if (type === 'notification') {
      if (envelope?.metadata?.subscription_type !== REDEMPTION_TYPE || !envelope?.payload?.event?.id || !envelope?.payload?.event?.reward?.id) {
        this.logger.warn('Ignored an invalid or unrelated Twitch EventSub notification.');
        return;
      }
      this.reconnectAttempts = 0;
      this.resetKeepalive(socket);
      try {
        await this.onRedemption?.(envelope.payload.event);
      } catch (error) {
        this.logger.warn('Twitch reward activation could not be processed.', { reason: error?.message === 'invalid_redemption_event' ? 'invalid_redemption_event' : 'processing_failed' });
      }
    }
  }

  resetKeepalive(socket) {
    if (this.keepaliveTimer) this.clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = this.setTimeout(() => {
      if (this.running && this.socket === socket) {
        this.logger.warn('Twitch EventSub keepalive timed out.');
        this.scheduleReconnect('Twitch EventSub keepalive timed out.');
      }
    }, this.keepaliveTimeoutMs);
  }

  scheduleReconnect(message) {
    if (!this.running || this.reconnectTimer) return;
    const socket = this.socket;
    this.socket = null;
    if (this.keepaliveTimer) this.clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * (2 ** Math.min(this.reconnectAttempts - 1, 5)), MAX_RECONNECT_DELAY_MS);
    this.setStatus('Retrying', message);
    this.reconnectTimer = this.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.connect(EVENTSUB_URL, true);
    }, delay);
    this.closeForReconnect(socket);
  }

  closeForReconnect(socket) {
    if (!socket || (socket.readyState !== 0 && socket.readyState !== 1)) return;
    try {
      socket.close(4001, 'EventSub reconnect');
    } catch {
      this.logger.warn('Unable to close Twitch EventSub socket during reconnect.');
    }
  }

  clearTimers() {
    if (this.reconnectTimer) this.clearTimeout(this.reconnectTimer);
    if (this.keepaliveTimer) this.clearTimeout(this.keepaliveTimer);
    this.reconnectTimer = null;
    this.keepaliveTimer = null;
  }

  async stop({ updateStatus = true } = {}) {
    this.running = false;
    this.generation += 1;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.token = null;
    this.broadcasterId = null;
    if (socket && socket.readyState !== 3) socket.close(1000, 'EventSub stopped');
    if (updateStatus) this.setStatus('Disconnected');
  }
}

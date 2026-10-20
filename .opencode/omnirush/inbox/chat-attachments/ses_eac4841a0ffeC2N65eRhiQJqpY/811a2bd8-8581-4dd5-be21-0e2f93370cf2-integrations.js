import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { ValidationError } from './model.js';

const definitions = {
  donationalerts: { authorize: 'https://www.donationalerts.com/oauth/authorize', token: 'https://www.donationalerts.com/oauth/token', api: 'https://www.donationalerts.com/api/v1', redirect: 'http://localhost:3000/auth/callback', scope: 'oauth-user-show oauth-donation-subscribe' },
  twitch: { authorize: 'https://id.twitch.tv/oauth2/authorize', token: 'https://id.twitch.tv/oauth2/token', api: 'https://api.twitch.tv/helix', redirect: 'http://localhost:3000/auth/twitch/callback', scope: 'channel:read:redemptions' },
};
const text = (v, max = 128) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const hash = v => createHash('sha256').update(v).digest('hex');
const nicknameKey = v => typeof v === 'string' ? v.normalize('NFKC').trim().toLowerCase() : '';
const failure = (kind = 'provider', providerStatus) => Object.assign(
  new ValidationError('Provider unavailable; check configuration and reconnect', 502),
  { failureKind: kind, providerStatus }
);

export class Integrations {
  constructor({ model, dataFile, settingsFile, keyFile, fetch = globalThis.fetch, WebSocket = globalThis.WebSocket, now = Date.now, background = true, logger = console }) {
    Object.assign(this, { model, fetch, WebSocket, now, background, logger });
    this.file = settingsFile || join(dirname(dataFile), 'integrations.enc');
    this.keyFile = keyFile || join(dirname(dataFile), 'integrations.key');
    this.saved = Object.fromEntries(Object.keys(definitions).map(p => [p, { clientId: '', clientSecret: '', mappings: [] }]));
    this.runtime = Object.fromEntries(Object.keys(definitions).map(p => [p, { status: 'disconnected', error: null, rewards: [], generation: 0, phase: 'idle' }]));
    this.states = new Map(); this.tasks = new Set(); this.queue = Promise.resolve();
  }

  async init() {
    let encrypted;
    try { encrypted = await readFile(this.file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read integration settings'); }
    if (encrypted) {
      try {
        this.key = await readFile(this.keyFile);
        const record = JSON.parse(encrypted);
        const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
        this.saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString());
      } catch { throw new Error('Cannot decrypt integration settings; original files preserved'); }
    }
    const mappings = this.saved.twitch.mappings;
    this.saved.twitch.mappings = mappings.filter(v => v.action !== 'spawn');
    if (mappings.length !== this.saved.twitch.mappings.length) await this.persist();
    if (this.background) {
      for (const p of Object.keys(definitions)) if (this.saved[p].tokens) this.launch(p, () => this.resume(p));
      this.maintenance = setInterval(() => {
        for (const p of Object.keys(definitions)) if (this.saved[p].tokens) this.launch(p, async () => {
          await this.access(p);
          if (p === 'twitch' && this.now() - (this.runtime[p].validatedAt || 0) >= 3600000) await this.validateTwitch();
        });
      }, 60000);
      this.maintenance.unref();
    }
    return this;
  }

  persist() {
    const snapshot = JSON.stringify(this.saved);
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      if (!this.key) {
        await mkdir(dirname(this.keyFile), { recursive: true });
        try { this.key = await readFile(this.keyFile); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const key = randomBytes(32);
          try { await writeFile(this.keyFile, key, { flag: 'wx', mode: 0o600 }); this.key = key; }
          catch (race) { if (race.code !== 'EEXIST') throw race; this.key = await readFile(this.keyFile); }
        }
      }
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const data = Buffer.concat([cipher.update(snapshot), cipher.final()]);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { flag: 'wx', mode: 0o600 });
        await rename(temporary, this.file);
      } finally { await rm(temporary, { force: true }); }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  status() {
    return Object.fromEntries(Object.entries(definitions).map(([p, d]) => {
      const s = this.saved[p], r = this.runtime[p];
      return [p, { clientId: s.clientId, clientSecretConfigured: Boolean(s.clientSecret), configured: Boolean(s.clientId && s.clientSecret), authorized: Boolean(s.tokens), redirectUri: d.redirect, connected: Boolean(s.tokens && r.account), account: r.account || null, status: r.status, error: r.error,
        ...(p === 'twitch' ? { rewards: structuredClone(r.rewards), mappings: structuredClone(s.mappings) } : {}) }];
    }));
  }

  async settings(p, input) {
    if (!input || !text(input.clientId) || (input.clientSecret !== undefined && typeof input.clientSecret !== 'string') || (input.clientSecret && !text(input.clientSecret, 4096))
      || (input.redirectUri !== undefined && input.redirectUri !== definitions[p].redirect)) throw new ValidationError('Invalid settings or callback URI');
    const s = this.saved[p], secret = input.clientSecret?.trim() || s.clientSecret;
    if (s.clientId !== input.clientId.trim() || s.clientSecret !== secret) { this.stop(p); delete s.tokens; s.mappings = []; }
    s.clientId = input.clientId.trim(); s.clientSecret = secret;
    await this.persist(); return this.status()[p];
  }

  connect(p, response) {
    const s = this.saved[p];
    if (!s.clientId || !s.clientSecret) throw new ValidationError('Configure client ID and secret first');
    for (const [key, entry] of this.states) if (entry.expires <= this.now() || entry.provider === p) this.states.delete(key);
    const state = randomBytes(32).toString('hex'), browser = randomBytes(32).toString('hex');
    this.states.set(state, { provider: p, browser: hash(browser), expires: this.now() + 600000, generation: this.runtime[p].generation });
    response.setHeader('Set-Cookie', `ghost_oauth_${p}=${browser}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600`);
    const url = new URL(definitions[p].authorize);
    url.search = new URLSearchParams({ client_id: s.clientId, redirect_uri: definitions[p].redirect, response_type: 'code', scope: definitions[p].scope, state }).toString();
    return { url: url.href };
  }

  async callback(p, request, response, url) {
    const state = url.searchParams.get('state'), pending = this.states.get(state);
    if (pending?.provider === p) this.states.delete(state);
    response.setHeader('Set-Cookie', `ghost_oauth_${p}=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0`);
    const cookie = (request.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`ghost_oauth_${p}=`))?.split('=')[1] || '';
    let result = 'error';
    if (pending && pending.provider === p && pending.expires > this.now() && pending.browser === hash(cookie) && pending.generation === this.runtime[p].generation
      && url.searchParams.getAll('state').length === 1 && url.searchParams.getAll('code').length === 1 && !url.searchParams.has('error') && text(url.searchParams.get('code'), 4096)) {
      try {
        await this.exchange(p, { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: definitions[p].redirect });
        await this.resume(p); result = 'connected';
      } catch { this.error(p); }
    }
    response.writeHead(303, { Location: `/?integration=${p}&result=${result}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end();
  }

  async request(url, options = {}) {
    try {
      const response = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) { const error = failure('http', response.status); error.unauthorized = response.status === 401; throw error; }
      return response.status === 204 ? {} : await response.json();
    } catch (error) { if (error instanceof ValidationError) throw error; throw failure('network'); }
  }

  async exchange(p, grant) {
    const s = this.saved[p], generation = this.runtime[p].generation;
    const tokens = await this.request(definitions[p].token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, scope: definitions[p].scope, ...grant }).toString() });
    if (generation !== this.runtime[p].generation || this.closed) throw failure();
    if (!text(tokens.access_token, 16384) || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) throw failure();
    s.tokens = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || s.tokens?.refreshToken, expiresAt: this.now() + Number(tokens.expires_in) * 1000 };
    await this.persist(); return s.tokens.accessToken;
  }

  async access(p, force = false) {
    const r = this.runtime[p], tokens = this.saved[p].tokens;
    if (!tokens) throw new ValidationError('Connect integration first', 409);
    if (!force && tokens.expiresAt > this.now() + 60000) return tokens.accessToken;
    if (!r.refreshing) r.refreshing = this.exchange(p, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken || '' }).finally(() => { r.refreshing = null; });
    return r.refreshing;
  }

  async api(p, path, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.access(p, attempt === 1);
      try { return await this.request(definitions[p].api + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(p === 'twitch' ? { 'Client-Id': this.saved[p].clientId } : {}), ...options.headers } }); }
      catch (error) { if (!error.unauthorized || attempt === 1) throw error; }
    }
  }

  async validateTwitch() {
    const generation = this.runtime.twitch.generation;
    let v;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { v = await this.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${await this.access('twitch', attempt === 1)}` } }); break; }
      catch (error) { if (!error.unauthorized || attempt === 1) throw error; }
    }
    if (generation !== this.runtime.twitch.generation || this.closed) throw failure();
    if (v.client_id !== this.saved.twitch.clientId || !v.scopes?.includes('channel:read:redemptions') || !text(v.user_id)) {
      this.stop('twitch'); delete this.saved.twitch.tokens; await this.persist(); throw new ValidationError('Twitch account or required scope invalid; reconnect', 409);
    }
    this.runtime.twitch.validatedAt = this.now();
    this.runtime.twitch.account = { id: v.user_id, name: String(v.login || v.user_id).slice(0, 128) };
  }

  async resume(p) {
    const r = this.runtime[p], generation = r.generation;
    r.status = 'connecting'; r.error = null;
    r.phase = p === 'twitch' ? 'twitch-validation' : 'user-oauth';
    if (p === 'twitch') { await this.validateTwitch(); await this.rewards(); }
    else {
      const { data } = await this.api(p, '/user/oauth');
      if (!text(String(data?.id || '')) || !text(data?.socket_connection_token, 16384)) throw failure();
      if (generation !== r.generation || this.closed) return;
      r.account = { id: String(data.id), name: String(data.name || data.code || data.id).slice(0, 128) }; r.socketToken = data.socket_connection_token;
    }
    if (generation !== r.generation || this.closed) return;
    r.phase = 'websocket-connect';
    if (this.background) this.open(p); else r.status = 'connected';
  }

  async rewards() {
    const account = this.runtime.twitch.account, generation = this.runtime.twitch.generation;
    if (!account) throw new ValidationError('Connect Twitch first', 409);
    const { data } = await this.api('twitch', `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(account.id)}`);
    if (!Array.isArray(data)) throw failure();
    if (generation !== this.runtime.twitch.generation || this.closed) throw failure();
    this.runtime.twitch.rewards = data.map(v => ({ id: String(v.id), title: String(v.title), cost: Number(v.cost), isEnabled: Boolean(v.is_enabled), isUserInputRequired: Boolean(v.is_user_input_required) }));
    return { rewards: structuredClone(this.runtime.twitch.rewards) };
  }

  async mappings(input) {
    if (!input || !Array.isArray(input.mappings) || input.mappings.length > 100) throw new ValidationError('Invalid reward mappings');
    const ids = new Set();
    const mappings = input.mappings.map(v => {
      if (!v || !text(v.rewardId) || ids.has(v.rewardId) || !['blanket', 'possession', 'boo', 'bump', 'dance'].includes(v.action)
        || (v.object !== undefined && (v.action !== 'possession' || !this.model.config.objects.includes(v.object)))) throw new ValidationError('Invalid or duplicate reward mapping');
      ids.add(v.rewardId); return { rewardId: v.rewardId, action: v.action, ...(v.object === undefined ? {} : { object: v.object }) };
    });
    this.saved.twitch.mappings = mappings; await this.persist(); return { mappings: structuredClone(mappings) };
  }

  async donation(event) {
    const account = this.runtime.donationalerts.account;
    if (!account || !event || !text(String(event.id || '')) || !text(event.username) || !Number.isFinite(Number(event.amount)) || Number(event.amount) <= 0) return;
    // DA display names are unverified and must never control Twitch identities.
    const name = event.username.trim();
    await this.model.donate({ viewerId: `da:${account.id}:${hash(nicknameKey(name))}`, nickname: name, amount: Number(event.amount), message: typeof event.message === 'string' ? event.message : '', eventId: `da:${account.id}:${event.id}` });
  }

  async redemption(event) {
    const account = this.runtime.twitch.account;
    if (!account || event?.broadcaster_user_id !== account.id || !text(event.user_id) || !text(event.id)) return;
    const mapping = this.saved.twitch.mappings.find(v => v.rewardId === event.reward?.id);
    if (!mapping) return;
    if (!['blanket', 'possession', 'boo', 'bump', 'dance'].includes(mapping.action)) throw new ValidationError('Twitch rewards cannot create ghosts; update the reward mapping');
    const ghosts = this.model.state().ghosts;
    const names = [event.user_login, event.user_name].map(nicknameKey).filter(Boolean);
    const actors = ghosts.filter(v => names.includes(nicknameKey(v.nickname)));
    if (actors.length !== 1) throw new ValidationError(actors.length ? 'Twitch nickname is ambiguous; use a unique donor nickname' : 'No ghost matches the Twitch nickname; donate with that nickname first');
    const viewerId = actors[0].viewerId, eventId = `twitch:${account.id}:${event.id}`;
    const input = { viewerId, eventId, type: mapping.action };
    if (mapping.action === 'possession' && mapping.object) input.object = mapping.object;
    if (['boo', 'bump'].includes(mapping.action) && event.user_input?.trim()) {
      const target = event.user_input.trim();
      const exact = ghosts.find(v => v.viewerId === target), matches = ghosts.filter(v => nicknameKey(v.nickname) === nicknameKey(target));
      if (!exact && matches.length !== 1) throw new ValidationError('Target must be viewer ID or unique nickname');
      input.targetViewerId = (exact || matches[0]).viewerId;
    }
    return this.model.interact(input);
  }

  error(p) { this.runtime[p].error = 'Integration unavailable; check settings, permissions, or reconnect'; this.runtime[p].status = 'error'; }
  reconnecting(p) { this.runtime[p].error = null; this.runtime[p].status = 'reconnecting'; }
  async event(operation, p) {
    try { await operation(); if (p) this.runtime[p].error = null; }
    catch (error) {
      if (!(error instanceof ValidationError) || error.status >= 500) throw error;
      if (p) this.runtime[p].error = error.message;
    }
  }
  launch(p, operation) {
    if (this.closed) return Promise.resolve();
    const generation = this.runtime[p].generation;
    const task = Promise.resolve().then(operation).catch(error => {
      if (this.closed || generation !== this.runtime[p].generation) return;
      const kind = error instanceof ValidationError ? error.failureKind || `validation-${error.status}` : 'unexpected';
      const providerStatus = Number.isInteger(error?.providerStatus) ? `, providerStatus=${error.providerStatus}` : '';
      this.logger.error(`[integration:${p}] ${this.runtime[p].phase} failed (${kind}${providerStatus})`);
      const socket = this.runtime[p].socket;
      if (this.background && this.saved[p].tokens) this.reconnecting(p);
      else this.error(p);
      if (socket) socket.close();
      else this.retry(p);
    }).finally(() => this.tasks.delete(task));
    this.tasks.add(task); return task;
  }
  retry(p) {
    const r = this.runtime[p];
    if (this.closed || !this.background || !this.saved[p].tokens) return false;
    if (r.retry) return true;
    r.retry = setTimeout(() => { r.retry = null; this.launch(p, () => this.resume(p)); }, 5000); r.retry.unref();
    return true;
  }

  open(p, reconnectUrl) {
    const r = this.runtime[p], generation = r.generation, previous = r.socket;
    r.phase = 'websocket-connect';
    const url = reconnectUrl || (p === 'twitch' ? 'wss://eventsub.wss.twitch.tv/ws' : 'wss://centrifugo.donationalerts.com/connection/websocket');
    if (p === 'twitch') { const u = new URL(url); if (u.protocol !== 'wss:' || u.hostname !== 'eventsub.wss.twitch.tv' || u.port || u.username || u.password) throw failure(); }
    const socket = new this.WebSocket(url);
    if (reconnectUrl) r.handover = socket; else { r.socket = socket; previous?.close(); }
    const active = () => !this.closed && r.generation === generation && (r.socket === socket || r.handover === socket);
    let watchdog, authorizationExpiry, closeFallback, closeScheduled = false;
    const finishClose = event => {
      socket.cleanup(); if (!active()) return;
      if (r.handover === socket) r.handover = null;
      if (r.socket === socket) r.socket = null;
      if (Number.isInteger(event?.code) && event.code !== 1000) {
        this.logger.error(`[integration:${p}] ${r.phase} closed (websocket-close-${event.code})`);
      }
      this.reconnecting(p); if (!r.handover) this.retry(p);
    };
    socket.cleanup = () => { clearTimeout(watchdog); clearTimeout(authorizationExpiry); clearTimeout(closeFallback); };
    const heartbeat = (seconds = 60) => { clearTimeout(watchdog); watchdog = setTimeout(() => socket.close(), Math.min(2147483647, (seconds + 5) * 1000)); watchdog.unref(); };
    heartbeat(20);
    socket.addEventListener('open', () => { if (!active()) return socket.close(); if (p === 'donationalerts') { r.phase = 'centrifugo-auth'; socket.send(JSON.stringify({ id: 1, params: { token: r.socketToken } })); } });
    socket.addEventListener('message', message => this.launch(p, async () => {
      if (!active()) return;
      for (const line of String(message.data).split('\n').filter(Boolean)) {
        if (!active()) return;
        const data = JSON.parse(line);
        if (p === 'donationalerts') {
          heartbeat(); if (data.error) { socket.close(); throw failure(); }
          if (data.id === 1 && data.result?.client) {
            r.phase = 'channel-token';
            if (data.result.expires && Number.isFinite(data.result.ttl) && data.result.ttl > 0) {
              clearTimeout(authorizationExpiry);
              authorizationExpiry = setTimeout(() => socket.close(), Math.min(2147483647, data.result.ttl * 1000));
              authorizationExpiry.unref();
            }
            const channel = `$alerts:donation_${r.account.id}`;
            const subscribed = await this.api(p, '/centrifuge/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: data.result.client, channels: [channel] }) });
            const signed = subscribed.channels?.find(v => v.channel === channel);
            if (!signed?.token) { socket.close(); throw failure(); }
            if (active()) { r.phase = 'channel-subscribe'; socket.send(JSON.stringify({ id: 2, method: 1, params: { channel, token: signed.token } })); }
          } else if (data.id === 2 || data.result?.type === 1) { r.status = 'connected'; r.error = null; r.phase = 'connected'; }
          else if (data.result?.data) { const event = data.result.data.data || data.result.data; await this.event(() => this.donation(typeof event === 'string' ? JSON.parse(event) : event), p); }
        } else {
          const type = data.metadata?.message_type, payload = data.payload;
          heartbeat(r.keepalive || 60);
          if (type === 'session_welcome') {
            r.keepalive = payload.session.keepalive_timeout_seconds || 60; heartbeat(r.keepalive);
            if (reconnectUrl) { r.socket = socket; r.handover = null; previous?.close(); }
            else await this.api(p, '/eventsub/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: r.account.id }, transport: { method: 'websocket', session_id: payload.session.id } }) });
            if (!active()) return;
            r.status = 'connected'; r.error = null;
          } else if (type === 'session_reconnect') this.open(p, payload.session.reconnect_url);
          else if (type === 'revocation') { this.error(p); socket.close(); }
          else if (type === 'notification' && payload.subscription?.type === 'channel.channel_points_custom_reward_redemption.add') await this.event(() => this.redemption(payload.event), p);
        }
      }
    }));
    socket.addEventListener('error', () => {
      if (!active() || closeScheduled) return;
      closeScheduled = true;
      this.logger.error(`[integration:${p}] ${r.phase} failed (websocket-error)`);
      this.reconnecting(p);
      queueMicrotask(() => {
        if (!active()) return;
        if (socket.readyState === 3) { finishClose(); return; }
        closeFallback = setTimeout(() => finishClose(), 1000);
        closeFallback.unref();
        if (socket.readyState !== 2) socket.close();
      });
    });
    socket.addEventListener('close', finishClose);
  }

  stop(p) {
    const r = this.runtime[p]; r.generation++;
    clearTimeout(r.retry); r.retry = null; r.socket?.cleanup?.(); r.handover?.cleanup?.(); r.socket?.close(); r.handover?.close();
    r.socket = null; r.handover = null; r.account = null; r.socketToken = null; r.rewards = []; r.status = 'disconnected'; r.error = null;
    for (const [key, pending] of this.states) if (pending.provider === p) this.states.delete(key);
  }
  async disconnect(p) { this.stop(p); delete this.saved[p].tokens; await this.persist(); return this.status()[p]; }
  async close() { this.closed = true; clearInterval(this.maintenance); for (const p of Object.keys(definitions)) this.stop(p); await Promise.all([...this.tasks]); await this.queue; this.states.clear(); }

  async handle(request, response, url, { body, json }) {
    const callback = url.pathname === '/auth/callback' ? 'donationalerts' : url.pathname === '/auth/twitch/callback' ? 'twitch' : null;
    if (!callback && !url.pathname.startsWith('/api/integrations')) return false;
    // Literal hosts and a loopback peer block DNS rebinding and remote administration.
    if (!['localhost:3000', '127.0.0.1:3000', '[::1]:3000'].includes(request.headers.host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) throw new ValidationError('Integrations require http://localhost:3000', 403);
    if (request.method === 'POST' && request.headers.origin !== `http://${request.headers.host}`) throw new ValidationError('Same-origin request required', 403);
    response.setHeader('Cache-Control', 'no-store');
    if (callback && request.method === 'GET') { await this.callback(callback, request, response, url); return true; }
    if (request.method === 'GET' && url.pathname === '/api/integrations') { json(response, 200, this.status()); return true; }
    const match = /^\/api\/integrations\/(donationalerts|twitch)\/(settings|connect|disconnect|rewards|mappings)$/.exec(url.pathname);
    if (!match) { json(response, 404, { error: 'Not found' }); return true; }
    const [, p, op] = match; let result;
    if (p === 'twitch' && op === 'rewards' && request.method === 'GET') result = await this.rewards();
    else if (request.method !== 'POST' || op === 'rewards') { json(response, 405, { error: 'Method not allowed' }); return true; }
    else if (op === 'settings') result = await this.settings(p, await body(request));
    else if (op === 'connect') {
      // Host-only OAuth cookies must be issued on the registered callback host.
      result = request.headers.host === 'localhost:3000' ? this.connect(p, response) : { url: 'http://localhost:3000/', canonicalRequired: true };
    }
    else if (op === 'disconnect') result = await this.disconnect(p);
    else if (p === 'twitch' && op === 'mappings') result = await this.mappings(await body(request));
    else { json(response, 404, { error: 'Not found' }); return true; }
    json(response, 200, result); return true;
  }
}
export async function createIntegrations(options) { return new Integrations(options).init(); }

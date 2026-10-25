import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { loadConfig } from './src/config.js';
import { Database } from './src/db/database.js';
import { TokenStore } from './src/auth/token-store.js';
import { sessionMiddleware } from './src/auth/session.js';
import { IntegrationStatus } from './src/integrations/status.js';
import { OAuthAdapters } from './src/auth/oauth-adapters.js';
import { DonationService } from './src/engine/donations.js';
import { RewardService } from './src/engine/rewards.js';
import { createPumpkinMovementScheduler } from './src/engine/pumpkin-movement.js';
import { JoinedStackService } from './src/engine/joined-stack-service.js';
import { TwitchApiClient } from './src/integrations/twitch-api.js';
import { TwitchEventSub } from './src/integrations/twitch-eventsub.js';
import { DonationAlertsEvents } from './src/integrations/donationalerts-events.js';
import { DonatExEvents } from './src/integrations/donatex-events.js';
import { MemeAlertsEvents } from './src/integrations/memealerts-events.js';
import { createApiRouter } from './src/http/api.js';
import { attachSocketHandlers } from './src/socket/handlers.js';
import { createLogger } from './src/utils/logger.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ config = loadConfig(), db = null, logger = createLogger(), publicDir = path.join(ROOT, 'public'), io = null, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, providerEventFactories = {} } = {}) {
  const database = db || new Database(config.databasePath);
  database.getSettings(config);
  const tokenStore = new TokenStore(database, config.tokenEncryptionKey);
  const statuses = new IntegrationStatus(database); statuses.loadTokens(tokenStore);
  const app = express(); app.disable('x-powered-by'); app.use(sessionMiddleware({ secret: config.sessionSecret }));
  const broadcaster = { current: () => {} };
  const broadcast = (event, payload) => broadcaster.current(event, payload);
  const movementSchedulerRef = { current: null };
  const joinedStackService = new JoinedStackService({ db: database, config, logger, broadcast });
  const donations = new DonationService({ db: database, config, logger, emit: broadcast });
  const rewards = new RewardService({ db: database, config, logger, emit: broadcast, joinedStackService });
  const twitchApi = new TwitchApiClient({ config, tokenStore, fetchImpl });
  const oauth = new OAuthAdapters({ config, tokenStore, statuses, twitchApi, logger, fetchImpl });
  twitchApi.getAccessToken = () => oauth.getAccessToken('twitch');
  const twitchEventSub = new TwitchEventSub({
    tokenStore,
    twitchApi,
    getAccessToken: () => oauth.getAccessToken('twitch'),
    statuses,
    onRedemption: (event) => rewards.handle(event),
    WebSocketImpl,
    logger,
    broadcast,
  });
  const providerEvents = {
    donationalerts: new DonationAlertsEvents({ ...providerEventFactories.donationalerts, oauth, tokenStore, statuses, onDonation: (event) => donations.handle(event), fetchImpl, websocket: WebSocketImpl, logger }),
    donatex: new DonatExEvents({ ...providerEventFactories.donatex, oauth, statuses, onDonation: (event) => donations.handle(event), logger }),
    memealerts: new MemeAlertsEvents({ ...providerEventFactories.memealerts, oauth, tokenStore, statuses, onDonation: (event) => donations.handle(event), fetchImpl, websocket: WebSocketImpl, logger }),
  };
  app.locals.cozyPumpkins = { config, db: database, tokenStore, statuses, oauth, donations, rewards, joinedStackService, twitchApi, twitchEventSub, providerEvents, broadcast, setBroadcast: (fn) => { broadcaster.current = fn; }, setMovementScheduler: (scheduler) => { movementSchedulerRef.current = scheduler; } };
  app.use('/api', createApiRouter({ config, db: database, statuses, oauth, tokenStore, donations, rewards, twitchApi, twitchEventSub, providerEvents, broadcast, onMovementSettingsUpdated: () => movementSchedulerRef.current?.settingsUpdated(), logger, publicDir: null }));
  if (publicDir) app.use(express.static(publicDir, { index: false }));
  app.use((error, req, res, next) => { if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' }); if (res.headersSent) return next(error); logger.error('Unhandled HTTP error', { reason: error?.message }); return res.status(500).json({ error: 'internal_error' }); });
  if (io) { broadcaster.current = (event, payload) => io.emit(event, payload); attachSocketHandlers(io, { config, db: database, statuses, logger, joinedStackService }); }
  return app;
}

export function createServer(options = {}) {
  const config = options.config || loadConfig(); const app = createApp({ ...options, config }); const server = http.createServer(app); const io = new SocketIOServer(server, { cors: { origin: false } });
  const cozy = app.locals.cozyPumpkins;
  const logger = options.logger || createLogger();
  const movementScheduler = createPumpkinMovementScheduler({
    db: cozy.db,
    config,
    joinedStackService: cozy.joinedStackService,
    broadcast: (event, payload) => io.emit(event, payload),
    onError: (error) => logger.error('Pumpkin movement scheduler failed', { reason: error?.message }),
  });
  cozy.setMovementScheduler(movementScheduler);
  let towerResumeTimer = null;
  const broadcast = (event, payload) => {
    if (event === 'pumpkin:action' && payload?.action === 'pumpkin_tower') {
      movementScheduler.pauseAll();
      clearTimeout(towerResumeTimer);
      towerResumeTimer = setTimeout(() => {
        towerResumeTimer = null;
        movementScheduler.resumeAll();
      }, (Math.max(0, Number(payload.lifetimeSeconds) || 0) + 3) * 1000);
      towerResumeTimer.unref?.();
    }
    io.emit(event, payload);
  };
  const stopMovement = () => {
    movementScheduler.stop();
    cozy.joinedStackService.stop();
    clearTimeout(towerResumeTimer);
    towerResumeTimer = null;
  };
  server.once('close', stopMovement);
  cozy.setBroadcast(broadcast); cozy.broadcast = broadcast; cozy.donations.emit = broadcast; cozy.rewards.emit = broadcast;
  attachSocketHandlers(io, { config, db: cozy.db, statuses: cozy.statuses, logger, movementScheduler, joinedStackService: cozy.joinedStackService });
  cozy.joinedStackService.start();
  movementScheduler.start();
  const shutdown = async () => {
    stopMovement();
    const results = await Promise.allSettled([
      cozy.twitchEventSub.stop(),
      ...Object.values(cozy.providerEvents).map((client) => client.stop()),
    ]);
    await new Promise((resolve) => io.close(resolve));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, 'One or more provider integrations failed to stop.');
  };
  return { app, server, io, config, ...cozy, movementScheduler, shutdown };
}

export async function startServer(options = {}) {
  const runtime = createServer(options);
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(runtime.config.port, runtime.config.host, resolve);
  });
  const eventClients = {
    twitch: runtime.twitchEventSub,
    ...runtime.providerEvents,
  };
  for (const [provider, client] of Object.entries(eventClients)) {
    if (!runtime.tokenStore.get(provider)?.accessToken) continue;
    try {
      await client.start();
    } catch (error) {
      (options.logger || createLogger()).warn('Provider event client could not start; other integrations remain active.', {
        provider,
        reason: error?.message || `${provider}_connection_failed`,
      });
    }
  }
  (options.logger || createLogger()).info('Server listening', { host: runtime.config.host, port: runtime.config.port }); return runtime;
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) startServer().then((runtime) => {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.shutdown().catch((error) => {
      console.error('[cozy-pumpkins] shutdown failed', error.message);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}).catch((error) => { console.error('[cozy-pumpkins] startup failed', error.message); process.exitCode = 1; });

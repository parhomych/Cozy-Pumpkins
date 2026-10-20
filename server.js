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
import { TwitchApiClient } from './src/integrations/twitch-api.js';
import { TwitchEventSub } from './src/integrations/twitch-eventsub.js';
import { createApiRouter } from './src/http/api.js';
import { attachSocketHandlers } from './src/socket/handlers.js';
import { createLogger } from './src/utils/logger.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ config = loadConfig(), db = null, logger = createLogger(), publicDir = path.join(ROOT, 'public'), io = null, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
  const database = db || new Database(config.databasePath);
  database.getSettings(config);
  const tokenStore = new TokenStore(database, config.tokenEncryptionKey);
  const statuses = new IntegrationStatus(database); statuses.loadTokens(tokenStore);
  const app = express(); app.disable('x-powered-by'); app.use(sessionMiddleware({ secret: config.sessionSecret }));
  const broadcaster = { current: () => {} };
  const broadcast = (event, payload) => broadcaster.current(event, payload);
  const donations = new DonationService({ db: database, config, logger, emit: broadcast });
  const rewards = new RewardService({ db: database, config, logger, emit: broadcast });
  const twitchApi = new TwitchApiClient({ config, tokenStore, fetchImpl });
  const twitchEventSub = new TwitchEventSub({
    tokenStore,
    twitchApi,
    statuses,
    onRedemption: (event) => rewards.handle(event),
    WebSocketImpl,
    logger,
    broadcast,
  });
  const oauth = new OAuthAdapters({ config, tokenStore, statuses, twitchApi, logger, fetchImpl });
  app.locals.cozyPumpkins = { config, db: database, tokenStore, statuses, oauth, donations, rewards, twitchApi, twitchEventSub, broadcast, setBroadcast: (fn) => { broadcaster.current = fn; } };
  app.use('/api', createApiRouter({ config, db: database, statuses, oauth, tokenStore, donations, twitchApi, twitchEventSub, broadcast, logger, publicDir: null }));
  if (publicDir) app.use(express.static(publicDir, { index: false }));
  app.use((error, req, res, next) => { if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' }); if (res.headersSent) return next(error); logger.error('Unhandled HTTP error', { reason: error?.message }); return res.status(500).json({ error: 'internal_error' }); });
  if (io) { broadcaster.current = (event, payload) => io.emit(event, payload); attachSocketHandlers(io, { config, db: database, statuses, logger }); }
  return app;
}

export function createServer(options = {}) {
  const config = options.config || loadConfig(); const app = createApp({ ...options, config }); const server = http.createServer(app); const io = new SocketIOServer(server, { cors: { origin: false } });
  const cozy = app.locals.cozyPumpkins; const broadcast = (event, payload) => io.emit(event, payload); cozy.setBroadcast(broadcast); cozy.broadcast = broadcast; cozy.donations.emit = broadcast; cozy.rewards.emit = broadcast;
  attachSocketHandlers(io, { config, db: cozy.db, statuses: cozy.statuses, logger: options.logger || createLogger() });
  const shutdown = async () => {
    await cozy.twitchEventSub.stop();
    await new Promise((resolve) => io.close(resolve));
  };
  return { app, server, io, config, ...cozy, shutdown };
}

export async function startServer(options = {}) {
  const runtime = createServer(options);
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(runtime.config.port, runtime.config.host, resolve);
  });
  if (runtime.tokenStore.get('twitch')?.accessToken) await runtime.twitchEventSub.start();
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

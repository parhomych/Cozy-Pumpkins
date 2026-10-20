import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { requireAdminSession } from '../auth/session.js';
import { publicConfig } from '../config.js';
import { publicPumpkin } from '../engine/donations.js';
import { normalizeName, normalizeText, finiteNumber } from '../utils/normalize.js';
import { normalizeZone, isPositionValid, clampPosition, validateParentLink, relocateInvalidPumpkins } from '../engine/spatial-rules.js';
import { sanitizeCustomization } from '../engine/customization-parser.js';
import { animationPatch } from '../engine/animation.js';
import { rewardMappingPatch } from '../engine/rewards.js';
import { customizationCatalog } from '../engine/customization-parser.js';
import { validateGrowthThresholds, validateSpawnSettings } from '../engine/donation-settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function safeError(res, error, fallback = 'request_failed') { const code = error?.message && /^[a-z0-9_]+$/i.test(error.message) ? error.message : fallback; return res.status(code.includes('required') ? 401 : 400).json({ error: code }); }
function statusesPayload(statuses) { return statuses.all ? statuses.all() : []; }
export function createApiRouter({ config, db, statuses, oauth, tokenStore, donations = null, twitchApi = null, twitchEventSub = null, providerEvents = {}, broadcast = () => {}, logger = console, publicDir = path.join(ROOT, 'public') } = {}) {
  const router = express.Router(); router.use(express.json({ limit: '64kb' }));
  router.get('/status', (req, res) => res.json({ ok: true, config: publicConfig(config), integrations: statusesPayload(statuses), devSimulator: config.nodeEnv !== 'production', serverTime: new Date().toISOString() }));
  router.get('/pumpkins', (req, res) => res.json({ pumpkins: db.listPumpkins().map(publicPumpkin) }));
  router.get('/pumpkins/:id', (req, res) => { const pumpkin = db.getPumpkin(req.params.id); return pumpkin ? res.json({ pumpkin: publicPumpkin(pumpkin) }) : res.status(404).json({ error: 'pumpkin_not_found' }); });
  router.get('/settings', (req, res) => { const settings = db.getSettings(config); res.json({ settings: { groundY: settings.groundY, noGoZone: settings.noGoZone, pumpkinCurrency: settings.pumpkinCurrency, rewardMapping: settings.rewardMapping, animation: settings.animation, minSpawnDonation: settings.minSpawnDonation, spawnCommand: settings.spawnCommand, growthThresholds: settings.growthThresholds }, customizationCatalog: customizationCatalog() }); });

  for (const provider of ['twitch', 'donationalerts', 'donatex', 'memealerts']) {
    router.get(`/auth/${provider}`, requireAdminSession, (req, res) => {
      const url = oauth.authorizationUrl(provider);
      return url ? res.redirect(url) : res.status(503).json({ error: `${provider}_credentials_missing` });
    });
    router.get(`/auth/${provider}/callback`, async (req, res) => {
      try {
        await oauth.callback(provider, req.query.code, req.query.state);
      } catch (error) {
        const reason = /^[a-z0-9_]+$/iu.test(error?.message || '') ? error.message : 'oauth_failed';
        logger.warn('OAuth callback failed', { provider, reason });
        statuses.set(provider, { authStatus: 'Failed', connectionStatus: 'Error', message: reason });
        broadcast('integration:status', statuses.public(provider));
        return res.status(400).json({ error: 'oauth_failed' });
      }
      try {
        if (provider === 'twitch') await twitchEventSub?.start();
        else {
          const eventClient = providerEvents[provider];
          if (!eventClient) throw new Error(`${provider}_client_unavailable`);
          await eventClient.start();
        }
      } catch (error) {
        const reason = /^[a-z0-9_]+$/iu.test(error?.message || '') ? error.message : `${provider}_connection_failed`;
        logger.warn('Provider event client failed to start after OAuth', { provider, reason });
        statuses.set(provider, { connectionStatus: 'Error', message: reason });
      }
      try {
        broadcast('integration:status', statuses.public(provider));
      } catch (error) {
        logger.warn('Provider status broadcast failed', { provider, reason: error?.message || 'status_broadcast_failed' });
      }
      return res.redirect('/admin.html?oauth=connected');
    });
    router.post(`/auth/${provider}/logout`, requireAdminSession, async (req, res) => {
      try {
        if (provider === 'twitch') await twitchEventSub?.stop({ updateStatus: false });
        else await providerEvents[provider]?.stop();
        res.json(await oauth.logout(provider));
        broadcast('integration:status', statuses.public(provider));
      } catch (error) {
        const reason = /^[a-z0-9_]+$/iu.test(error?.message || '') ? error.message : 'logout_failed';
        logger.warn('Provider logout failed', { provider, reason });
        safeError(res, error, 'logout_failed');
      }
    });
  }
  router.get('/twitch/rewards', requireAdminSession, async (req, res) => {
    const token = tokenStore.get('twitch');
    if (statuses.public('twitch').authStatus !== 'Connected' || !token?.accessToken) {
      return res.json({ connected: false, rewards: [], message: 'Connect a Twitch broadcaster account to load channel rewards.' });
    }
    try {
      const rewards = await twitchApi.listChannelRewards();
      return res.json({ connected: true, rewards });
    } catch (error) {
      const allowed = new Set(['twitch_not_connected', 'twitch_credentials_missing', 'twitch_account_unavailable', 'twitch_auth_failed', 'twitch_scope_missing', 'twitch_rate_limited', 'twitch_unavailable', 'twitch_invalid_response', 'twitch_user_unavailable', 'twitch_request_timeout', 'twitch_request_failed']);
      const code = allowed.has(error?.message) ? error.message : 'twitch_request_failed';
      logger.warn('Twitch reward catalog request failed', { reason: code });
      if (code === 'twitch_auth_failed' || code === 'twitch_scope_missing') {
        await twitchEventSub?.stop({ updateStatus: false });
        const message = code === 'twitch_scope_missing'
          ? 'Reconnect Twitch and grant permission to read channel point redemptions.'
          : 'Twitch authorization expired. Reconnect Twitch to load channel rewards.';
        const status = statuses.set('twitch', { authStatus: 'Failed', connectionStatus: 'Error', message });
        broadcast('integration:status', status);
      }
      return res.status(code === 'twitch_not_connected' ? 401 : 502).json({ error: code });
    }
  });

  router.post('/dev/donation', requireAdminSession, (req, res) => {
    if (config.nodeEnv === 'production' || !donations) return res.status(404).json({ error: 'development_simulator_disabled' });
    try {
      const result = donations.handle(req.body || {});
      return res.status(result.duplicate ? 200 : 201).json({ result });
    } catch (error) {
      return safeError(res, error, 'invalid_donation_event');
    }
  });

  router.patch('/pumpkins/:id', requireAdminSession, (req, res) => {
    try {
      const current = db.getPumpkin(req.params.id); if (!current) return res.status(404).json({ error: 'pumpkin_not_found' });
      const body = req.body || {}; const patch = {};
      if (body.customization !== undefined) patch.customization = sanitizeCustomization(body.customization, current.customization);
      if (body.twitchUsername !== undefined) patch.twitchUsername = normalizeName(body.twitchUsername) || null;
      if (body.twitchUserId !== undefined) patch.twitchUserId = body.twitchUserId ? normalizeText(body.twitchUserId, 128) : null;
      if (body.displayName !== undefined) { const name = normalizeText(body.displayName, 128); if (!name) return res.status(400).json({ error: 'invalid_display_name' }); patch.displayName = name; }
      if (body.stage !== undefined) { const stage = finiteNumber(body.stage, { min: 1, max: 4 }); if (!Number.isInteger(stage)) return res.status(400).json({ error: 'invalid_stage' }); patch.stage = stage; }
      if (body.x !== undefined || body.y !== undefined) { const x = body.x === undefined ? current.x : finiteNumber(body.x); const y = body.y === undefined ? current.y : finiteNumber(body.y); if (x === null || y === null || !isPositionValid({ ...current, ...patch }, x, y, { scene: config.scene, noGoZone: db.getSettings(config).noGoZone })) return res.status(400).json({ error: 'invalid_position' }); patch.x = x; patch.y = y; }
      if (body.parentId !== undefined) { const check = validateParentLink(current.id, body.parentId || null, db.listPumpkins()); if (!check.valid) return res.status(400).json({ error: check.reason }); patch.parentId = body.parentId || null; }
      const pumpkin = db.updatePumpkin(current.id, patch); broadcast('pumpkin:updated', { pumpkin: publicPumpkin(pumpkin) }); return res.json({ pumpkin: publicPumpkin(pumpkin) });
    } catch (error) { return safeError(res, error); }
  });
  router.delete('/pumpkins/:id', requireAdminSession, (req, res) => { if (!db.deletePumpkin(req.params.id)) return res.status(404).json({ error: 'pumpkin_not_found' }); broadcast('pumpkin:deleted', { id: req.params.id }); return res.status(204).end(); });
  router.delete('/pumpkins', requireAdminSession, (req, res) => { if (req.body?.confirmation !== true) return res.status(400).json({ error: 'confirmation_required' }); db.clearPumpkins(); broadcast('pumpkin:cleared', {}); return res.status(204).end(); });
  router.patch('/settings', requireAdminSession, (req, res) => {
    try {
      const body = req.body || {}; const current = db.getSettings(config); const patch = {};
      if (body.growthThresholds !== undefined) patch.growthThresholds = validateGrowthThresholds(body.growthThresholds);
      if (body.noGoZone !== undefined) patch.noGoZone = normalizeZone(body.noGoZone, config.scene);
      if (body.groundY !== undefined) { const groundY = finiteNumber(body.groundY, { min: 0, max: config.scene.height }); if (groundY === null) throw new Error('invalid_ground_y'); patch.groundY = groundY; }
      if (body.rewardMapping !== undefined) { const rewardMapping = rewardMappingPatch(body.rewardMapping, current.rewardMapping); if (!rewardMapping) throw new Error('invalid_reward_mapping'); patch.rewardMapping = rewardMapping; }
      Object.assign(patch, validateSpawnSettings(body));
      const animationInput = body.animation !== undefined ? body.animation : (body.eyeFrequency !== undefined || body.mouthFrequency !== undefined ? { eyeFrequency: body.eyeFrequency, mouthFrequency: body.mouthFrequency } : undefined);
      if (animationInput !== undefined) { const animation = animationPatch(animationInput, current.animation); if (!animation) throw new Error('invalid_animation'); patch.animation = animation; }
      const relocated = [];
      const settings = db.transaction(() => {
        const value = db.updateSettings(patch, config);
        if (patch.noGoZone) {
          for (const moved of relocateInvalidPumpkins(db.listPumpkins(), { scene: config.scene, noGoZone: value.noGoZone })) {
            const updated = db.updatePumpkin(moved.id, { x: moved.x, y: moved.y });
            relocated.push(publicPumpkin(updated));
          }
        }
        return value;
      });
      for (const pumpkin of relocated) broadcast('pumpkin:updated', { pumpkin });
      broadcast('settings:updated', { settings: { groundY: settings.groundY, noGoZone: settings.noGoZone, pumpkinCurrency: settings.pumpkinCurrency, rewardMapping: settings.rewardMapping, animation: settings.animation, minSpawnDonation: settings.minSpawnDonation, spawnCommand: settings.spawnCommand, growthThresholds: settings.growthThresholds } });
      broadcast('settings:nogo-updated', { noGoZone: settings.noGoZone }); return res.json({ settings });
    } catch (error) { return safeError(res, error); }
  });
  if (publicDir) router.use(express.static(publicDir, { index: false }));
  return router;
}

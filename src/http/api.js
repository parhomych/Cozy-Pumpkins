import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { requireAdminSession } from '../auth/session.js';
import { publicConfig } from '../config.js';
import { publicPumpkin } from '../engine/donations.js';
import { normalizeName, normalizeText, finiteNumber } from '../utils/normalize.js';
import { normalizeZone, isPositionValid, clampPosition, validateParentLink, relocateInvalidPumpkins } from '../engine/spatial-rules.js';
import { sanitizeCustomization } from '../engine/customization-parser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function safeError(res, error, fallback = 'request_failed') { const code = error?.message && /^[a-z0-9_]+$/i.test(error.message) ? error.message : fallback; return res.status(code.includes('required') ? 401 : 400).json({ error: code }); }
function statusesPayload(statuses) { return statuses.all ? statuses.all() : []; }
export function createApiRouter({ config, db, statuses, oauth, tokenStore, donations = null, broadcast = () => {}, logger = console, publicDir = path.join(ROOT, 'public') } = {}) {
  const router = express.Router(); router.use(express.json({ limit: '64kb' }));
  router.get('/status', (req, res) => res.json({ ok: true, config: publicConfig(config), integrations: statusesPayload(statuses), devSimulator: config.nodeEnv !== 'production', serverTime: new Date().toISOString() }));
  router.get('/pumpkins', (req, res) => res.json({ pumpkins: db.listPumpkins().map(publicPumpkin) }));
  router.get('/pumpkins/:id', (req, res) => { const pumpkin = db.getPumpkin(req.params.id); return pumpkin ? res.json({ pumpkin: publicPumpkin(pumpkin) }) : res.status(404).json({ error: 'pumpkin_not_found' }); });
  router.get('/settings', (req, res) => { const settings = db.getSettings(config); res.json({ settings: { groundY: settings.groundY, noGoZone: settings.noGoZone, pumpkinCurrency: settings.pumpkinCurrency, rewardMapping: settings.rewardMapping } }); });

  router.get('/auth/twitch', requireAdminSession, (req, res) => { const url = oauth.authorizationUrl('twitch'); return url ? res.redirect(url) : res.status(503).json({ error: 'twitch_credentials_missing' }); });
  router.get('/auth/donationalerts', requireAdminSession, (req, res) => { const url = oauth.authorizationUrl('donationalerts'); return url ? res.redirect(url) : res.status(503).json({ error: 'donationalerts_credentials_missing' }); });
  for (const provider of ['twitch', 'donationalerts']) {
    router.get(`/auth/${provider}/callback`, async (req, res) => { try { await oauth.callback(provider, req.query.code, req.query.state); res.redirect('/admin.html?oauth=connected'); } catch (error) { logger.warn('OAuth callback failed', { provider, reason: error.message }); res.status(400).json({ error: 'oauth_failed' }); } });
    router.post(`/auth/${provider}/logout`, requireAdminSession, async (req, res) => { try { res.json(await oauth.logout(provider)); broadcast('integration:status', statuses.public(provider)); } catch (error) { logger.warn('Provider logout failed', { provider, reason: error.message }); safeError(res, error, 'logout_failed'); } });
  }
  router.get('/twitch/rewards', requireAdminSession, (req, res) => res.json({ rewards: [], message: statuses.public('twitch').authStatus === 'Connected' ? 'Provider reward adapter not started' : 'Twitch is not connected' }));

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
      if (body.noGoZone !== undefined) patch.noGoZone = normalizeZone(body.noGoZone, config.scene);
      if (body.groundY !== undefined) { const groundY = finiteNumber(body.groundY, { min: 0, max: config.scene.height }); if (groundY === null) throw new Error('invalid_ground_y'); patch.groundY = groundY; }
      if (body.rewardMapping !== undefined) { if (!body.rewardMapping || typeof body.rewardMapping !== 'object' || Array.isArray(body.rewardMapping)) throw new Error('invalid_reward_mapping'); patch.rewardMapping = Object.fromEntries(Object.entries(body.rewardMapping).filter(([key, value]) => ['inflate', 'jump_on', 'morph_fly', 'bat', 'ghost'].includes(key) && typeof value === 'string').map(([key, value]) => [key, normalizeText(value, 128)])); }
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
      broadcast('settings:nogo-updated', { noGoZone: settings.noGoZone }); return res.json({ settings });
    } catch (error) { return safeError(res, error); }
  });
  if (publicDir) router.use(express.static(publicDir, { index: false }));
  return router;
}

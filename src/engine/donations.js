import crypto from 'node:crypto';
import { normalizeName, normalizeText, finiteNumber, safeId } from '../utils/normalize.js';
import { DEFAULT_CUSTOMIZATION, parseCustomization, sanitizeCustomization } from './customization-parser.js';
import { findSpawnPosition, isPositionValid } from './spatial-rules.js';

const DONATION_PROVIDERS = new Set(['donationalerts', 'donatex', 'memealerts']);

export function stageForTotal(total, thresholds) { if (total >= thresholds.stage4) return 4; if (total >= thresholds.stage3) return 3; if (total >= thresholds.stage2) return 2; return 1; }
export function publicPumpkin(pumpkin) {
  if (!pumpkin) return null;
  return { id: pumpkin.id, ownerNormalized: pumpkin.ownerNormalized, displayName: pumpkin.displayName, twitchUserId: pumpkin.twitchUserId, twitchUsername: pumpkin.twitchUsername, totalDonated: pumpkin.totalDonated, currency: pumpkin.currency, stage: pumpkin.stage, x: pumpkin.x, y: pumpkin.y, isAirborne: pumpkin.isAirborne, parentId: pumpkin.parentId, stackOffsetY: pumpkin.stackOffsetY, customization: sanitizeCustomization(pumpkin.customization) };
}
function parseDonation(raw) {
  const provider = raw?.provider ?? 'donationalerts';
  if (!DONATION_PROVIDERS.has(provider)) throw new Error('invalid_donation_event');
  const eventId = safeId(raw?.id ?? raw?.event_id ?? raw?.donation_id);
  const sender = raw?.sender || raw?.user || {};
  const rawName = raw?.displayName ?? raw?.name ?? sender.name ?? sender.username ?? raw?.username;
  const displayName = typeof rawName === 'string' ? normalizeText(rawName, 128) : '';
  const ownerId = safeId(raw?.ownerId ?? raw?.userId ?? sender.id ?? sender.user_id);
  const ownerNormalized = normalizeName(raw?.username ?? raw?.owner ?? sender.username ?? sender.name ?? displayName);
  const rawAmount = raw?.amount ?? raw?.donation_amount;
  const amount = typeof rawAmount === 'number' ? finiteNumber(rawAmount, { min: 0.0000001, max: 1e12 }) : null;
  const rawCurrency = raw?.currency ?? raw?.currency_code;
  const currency = typeof rawCurrency === 'string' ? normalizeText(rawCurrency, 16).toUpperCase() : '';
  const rawMessage = raw?.message ?? raw?.comment;
  const message = rawMessage === undefined || rawMessage === null ? '' : typeof rawMessage === 'string' ? normalizeText(rawMessage, 4000) : null;
  if (!eventId || !displayName || !ownerNormalized || amount === null || !/^[A-Z][A-Z0-9_-]{1,15}$/u.test(currency) || message === null) throw new Error('invalid_donation_event');
  const ownerKey = provider === 'donationalerts'
    ? ownerId ? `da:${ownerId}` : `name:${ownerNormalized}`
    : ownerId ? `${provider}:${ownerId}` : `name:${provider}:${ownerNormalized}`;
  return { provider, eventId, displayName, ownerId, ownerNormalized, ownerKey, amount, currency, message };
}
export class DonationService {
  constructor({ db, config, logger = console, emit = () => {}, idFactory = () => crypto.randomUUID(), now = () => new Date() } = {}) { Object.assign(this, { db, config, logger, emit, idFactory, now }); }
  handle(raw) {
    const event = parseDonation(raw); const receivedAt = this.now().toISOString(); let result;
    this.db.transaction(() => {
      if (!this.db.insertDonation({ ...event, receivedAt, processedAt: receivedAt })) { result = { duplicate: true, eventId: event.eventId }; return; }
      const settings = this.db.getSettings(this.config);
      let pumpkin = this.db.findPumpkinByOwner(event.ownerKey);
      if (!pumpkin && event.provider === 'donationalerts' && event.ownerId) {
        pumpkin = this.db.findPumpkinByOwner(`name:${event.ownerNormalized}`);
      }
      if (event.currency !== settings.pumpkinCurrency) {
        result = { duplicate: false, eventId: event.eventId, pumpkin: pumpkin ? publicPumpkin(pumpkin) : null, spawned: false, ignored: true, reason: 'currency_mismatch', currencyApplied: false };
        return;
      }
      const context = { scene: this.config.scene, noGoZone: settings.noGoZone };
      const oldStage = pumpkin?.stage ?? 1;
      let spawned = false;
      if (!pumpkin) {
        const command = parseCustomization(event.message, DEFAULT_CUSTOMIZATION, settings.spawnCommand);
        if (event.amount < settings.minSpawnDonation) {
          result = { duplicate: false, eventId: event.eventId, pumpkin: null, spawned: false, ignored: true, reason: 'spawn_threshold_not_met', currencyApplied: true };
          return;
        }
        if (!command.commandDetected) {
          result = { duplicate: false, eventId: event.eventId, pumpkin: null, spawned: false, ignored: true, reason: 'spawn_command_missing', currencyApplied: true };
          return;
        }
        const seed = { stage: 1, x: 0, y: this.config.scene.groundY, customization: DEFAULT_CUSTOMIZATION };
        const position = findSpawnPosition(seed, this.db.listPumpkins(), context);
        if (!position || !isPositionValid(seed, position.x, position.y, context)) {
          result = { duplicate: false, eventId: event.eventId, pumpkin: null, spawned: false, ignored: true, reason: 'no_safe_spawn_position', currencyApplied: true };
          return;
        }
        pumpkin = this.db.insertPumpkin({ id: this.idFactory(), ownerKey: event.ownerKey, ownerNormalized: event.ownerNormalized, displayName: event.displayName, twitchUserId: null, twitchUsername: null, totalDonated: 0, currency: settings.pumpkinCurrency, stage: 1, x: position.x, y: position.y, isAirborne: false, parentId: null, stackOffsetY: null, customization: DEFAULT_CUSTOMIZATION, createdAt: receivedAt, updatedAt: receivedAt });
        spawned = true;
      }
      const customization = parseCustomization(event.message, pumpkin.customization, settings.spawnCommand);
      const total = pumpkin.totalDonated + event.amount;
      const stage = stageForTotal(total, this.config.thresholds); const patch = { totalDonated: total, stage, displayName: event.displayName, ownerNormalized: event.ownerNormalized };
      if (customization.recognized) patch.customization = customization.customization;
      pumpkin = this.db.updatePumpkin(pumpkin.id, patch);
      result = { duplicate: false, eventId: event.eventId, pumpkin: publicPumpkin(pumpkin), spawned, evolved: oldStage !== stage, previousStage: oldStage, currencyApplied: true };
    });
    if (result.duplicate || result.ignored) return result;
    this.emit(result.spawned ? 'pumpkin:spawned' : 'pumpkin:updated', { pumpkin: result.pumpkin });
    if (result.evolved) this.emit('pumpkin:evolved', { id: result.pumpkin.id, stage: result.pumpkin.stage, totalDonated: result.pumpkin.totalDonated });
    return result;
  }
}
export { parseDonation };

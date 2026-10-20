import crypto from 'node:crypto';
import { normalizeName, normalizeText, finiteNumber, safeId } from '../utils/normalize.js';
import { DEFAULT_CUSTOMIZATION, parseCustomization, sanitizeCustomization } from './customization-parser.js';
import { findSpawnPosition, isPositionValid } from './spatial-rules.js';

export function stageForTotal(total, thresholds) { if (total >= thresholds.stage4) return 4; if (total >= thresholds.stage3) return 3; if (total >= thresholds.stage2) return 2; return 1; }
export function publicPumpkin(pumpkin) {
  if (!pumpkin) return null;
  return { id: pumpkin.id, ownerNormalized: pumpkin.ownerNormalized, displayName: pumpkin.displayName, twitchUserId: pumpkin.twitchUserId, twitchUsername: pumpkin.twitchUsername, totalDonated: pumpkin.totalDonated, currency: pumpkin.currency, stage: pumpkin.stage, x: pumpkin.x, y: pumpkin.y, isAirborne: pumpkin.isAirborne, parentId: pumpkin.parentId, stackOffsetY: pumpkin.stackOffsetY, customization: sanitizeCustomization(pumpkin.customization) };
}
function parseDonation(raw) {
  const eventId = safeId(raw?.id ?? raw?.event_id ?? raw?.donation_id);
  const sender = raw?.sender || raw?.user || {};
  const displayName = normalizeText(raw?.displayName ?? raw?.name ?? sender.name ?? sender.username ?? raw?.username, 128);
  const ownerId = safeId(raw?.ownerId ?? raw?.userId ?? sender.id ?? sender.user_id);
  const ownerNormalized = normalizeName(raw?.username ?? raw?.owner ?? sender.username ?? sender.name ?? displayName);
  const amount = finiteNumber(raw?.amount ?? raw?.donation_amount, { min: 0.0000001, max: 1e12 });
  const currency = normalizeText(raw?.currency ?? raw?.currency_code, 16).toUpperCase(); const message = normalizeText(raw?.message ?? raw?.comment, 4000);
  if (!eventId || !displayName || !ownerNormalized || amount === null || !currency) throw new Error('invalid_donation_event');
  return { eventId, displayName, ownerId, ownerNormalized, ownerKey: ownerId ? `da:${ownerId}` : `name:${ownerNormalized}`, amount, currency, message };
}
export class DonationService {
  constructor({ db, config, logger = console, emit = () => {}, idFactory = () => crypto.randomUUID(), now = () => new Date() } = {}) { Object.assign(this, { db, config, logger, emit, idFactory, now }); }
  handle(raw) {
    const event = parseDonation(raw); const receivedAt = this.now().toISOString(); let result;
    this.db.transaction(() => {
      if (!this.db.insertDonation({ ...event, receivedAt, processedAt: receivedAt })) { result = { duplicate: true, eventId: event.eventId }; return; }
      const settings = this.db.getSettings(this.config); let pumpkin = this.db.findPumpkinByOwner(event.ownerKey);
      if (!pumpkin && event.ownerKey.startsWith('name:')) pumpkin = this.db.findPumpkinByOwner(`name:${event.ownerNormalized}`);
      const context = { scene: this.config.scene, noGoZone: settings.noGoZone }; const oldStage = pumpkin?.stage ?? 1; const spawned = !pumpkin;
      if (!pumpkin) {
        const seed = { stage: 1, x: 0, y: this.config.scene.groundY, customization: DEFAULT_CUSTOMIZATION };
        const position = findSpawnPosition(seed, this.db.listPumpkins(), context);
        pumpkin = this.db.insertPumpkin({ id: this.idFactory(), ownerKey: event.ownerKey, ownerNormalized: event.ownerNormalized, displayName: event.displayName, twitchUserId: event.ownerId || null, twitchUsername: null, totalDonated: 0, currency: settings.pumpkinCurrency, stage: 1, x: position.x, y: position.y, isAirborne: false, parentId: null, stackOffsetY: null, customization: DEFAULT_CUSTOMIZATION, createdAt: receivedAt, updatedAt: receivedAt });
      }
      const customization = parseCustomization(event.message, pumpkin.customization);
      const total = event.currency === settings.pumpkinCurrency ? pumpkin.totalDonated + event.amount : pumpkin.totalDonated;
      const stage = stageForTotal(total, this.config.thresholds); const patch = { totalDonated: total, stage, displayName: event.displayName, ownerNormalized: event.ownerNormalized };
      if (customization.recognized) patch.customization = customization.customization;
      pumpkin = this.db.updatePumpkin(pumpkin.id, patch);
      result = { duplicate: false, eventId: event.eventId, pumpkin: publicPumpkin(pumpkin), spawned, evolved: oldStage !== undefined && oldStage !== stage, previousStage: oldStage, currencyApplied: event.currency === settings.pumpkinCurrency };
    });
    if (result.duplicate) return result;
    if (!result.currencyApplied) this.logger.warn('Donation currency does not match configured currency', { eventId: result.eventId, currency: event.currency });
    this.emit(result.spawned ? 'pumpkin:spawned' : 'pumpkin:updated', { pumpkin: result.pumpkin });
    if (result.evolved) this.emit('pumpkin:evolved', { id: result.pumpkin.id, stage: result.pumpkin.stage, totalDonated: result.pumpkin.totalDonated });
    return result;
  }
}
export { parseDonation };

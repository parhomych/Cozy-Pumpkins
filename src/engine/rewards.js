import { normalizeName, normalizeText, safeId } from '../utils/normalize.js';
import { publicPumpkin } from './donations.js';
import { buildTowerPlan } from './pumpkin-tower.js';
import { parseCustomizationRequest, sanitizeCustomization } from './customization-parser.js';

export const REWARD_ACTIONS = Object.freeze(['inflate', 'jump_on', 'morph_fly', 'bat', 'ghost', 'pumpkin_tower', 'pumpkin_customization']);

// Returns a complete, safe mapping patch. Unknown action keys are ignored for
// forwards compatibility; empty IDs remain valid to preserve disabled mappings.
export function sanitizeRewardMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const action of REWARD_ACTIONS) {
    if (!(action in value)) continue;
    if (typeof value[action] !== 'string') return null;
    const rewardId = normalizeText(value[action], 128);
    result[action] = rewardId;
  }
  return result;
}

export function rewardMappingPatch(value, current = {}) {
  const sanitized = sanitizeRewardMapping(value);
  if (!sanitized) return null;
  const mapping = { ...current, ...sanitized };
  const rewardIds = Object.values(mapping).filter(Boolean);
  if (new Set(rewardIds).size !== rewardIds.length) return null;
  return mapping;
}

function parseRedemption(raw) {
  const redemptionId = safeId(raw?.id ?? raw?.redemption_id ?? raw?.redemption?.id); const reward = raw?.reward || {};
  const rewardId = safeId(raw?.rewardId ?? raw?.reward_id ?? reward.id); const user = raw?.user || raw?.redeemer || {};
  const userId = safeId(raw?.userId ?? raw?.user_id ?? user.id); const userLogin = normalizeName(raw?.userLogin ?? raw?.user_login ?? user.login ?? user.username);
  const rawInput = String(raw?.input ?? raw?.user_input ?? raw?.redemption?.user_input ?? '').normalize('NFKC');
  const input = normalizeText(rawInput, 256);
  if (!redemptionId || !rewardId || (!userId && !userLogin)) throw new Error('invalid_redemption_event');
  return { redemptionId, rewardId, userId, userLogin, input, inputTooLong: rawInput.length > 256 };
}
function randomUnit(random) {
  const value = Number(random?.());
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
}
function mappedAction(rewardId, mapping) { for (const [action, id] of Object.entries(mapping || {})) if (id && id === rewardId) return action; return null; }
export class RewardService {
  constructor({ db, config, logger = console, emit = () => {}, random = Math.random } = {}) { Object.assign(this, { db, config, logger, emit, random }); }
  handle(raw) {
    const event = parseRedemption(raw); const now = new Date().toISOString(); let result; let autoLinkedPumpkinId = null;
    this.db.transaction(() => {
      const settings = this.db.getSettings(this.config);
      const action = mappedAction(event.rewardId, settings.rewardMapping);
      const { inputTooLong, ...redemption } = event;
      if (!this.db.insertRedemption({ ...redemption, status: action || 'ignored_reward', receivedAt: now, processedAt: now })) {
        result = { duplicate: true, redemptionId: event.redemptionId };
        return;
      }
      if (!action) {
        result = { duplicate: false, redemptionId: event.redemptionId, status: 'ignored_reward' };
        return;
      }
      let pumpkin = this.db.findPumpkinByTwitch(event.userId, event.userLogin);
      if (pumpkin && event.userId && !pumpkin.twitchUserId) {
        pumpkin = this.db.updatePumpkin(pumpkin.id, {
          twitchUserId: event.userId,
          twitchUsername: event.userLogin || pumpkin.twitchUsername,
        });
        autoLinkedPumpkinId = pumpkin.id;
      }
      if (!pumpkin && event.userLogin) {
        const nameMatch = this.db.findUnlinkedPumpkinByDisplayName(event.userLogin, event.userId);
        if (nameMatch) {
          pumpkin = this.db.updatePumpkin(nameMatch.id, {
            twitchUserId: event.userId || null,
            twitchUsername: event.userLogin,
          });
          autoLinkedPumpkinId = pumpkin.id;
        }
      }
      if (action === 'pumpkin_tower') {
        result = this._runPumpkinTower(settings, { redemptionId: event.redemptionId });
        return;
      }
      if (!pumpkin) {
        result = { duplicate: false, redemptionId: event.redemptionId, status: 'no_pumpkin_for_user', action };
        return;
      }
      if (action === 'pumpkin_customization') {
        if (inputTooLong) {
          result = { duplicate: false, redemptionId: event.redemptionId, status: 'ignored_input_too_long', action };
          return;
        }
        const changes = parseCustomizationRequest(event.input);
        if (!changes.length) {
          result = { duplicate: false, redemptionId: event.redemptionId, status: 'ignored_unrecognized_customization', action };
          return;
        }
        const customizationPatch = {};
        for (const change of settings.customizationRewardMode === 'all' ? changes : changes.slice(0, 1)) {
          customizationPatch[change.slot] = change.value;
        }
        const customization = sanitizeCustomization(customizationPatch, pumpkin.customization);
        result = {
          duplicate: false,
          redemptionId: event.redemptionId,
          status: 'customization_applied',
          action,
          pumpkin: publicPumpkin(this.db.updatePumpkin(pumpkin.id, { customization })),
        };
        return;
      }
      const context = { scene: this.config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers };
      result = this.applyAction(action, pumpkin, event.input, context);
    });
    if (result.duplicate) return result;
    if (autoLinkedPumpkinId) {
      this.emit('pumpkin:updated', { pumpkin: publicPumpkin(this.db.getPumpkin(autoLinkedPumpkinId)) });
    }
    if (result.status === 'no_pumpkin_for_user' || result.status === 'ignored_reward' || result.status === 'ignored_input_too_long' || result.status === 'ignored_unrecognized_customization' || result.status === 'no_safe_tower_layout' || result.status === 'no_pumpkins') return result;
    if (result.action === 'pumpkin_customization') {
      if (result.pumpkin.id !== autoLinkedPumpkinId) this.emit('pumpkin:updated', { pumpkin: result.pumpkin });
      return result;
    }
    if (result.global) {
      this.emit('pumpkin:action', { id: null, action: result.action, ...result.payload });
      return result;
    }
    for (const pumpkin of result.updatedPumpkins || []) {
      if (pumpkin.id !== autoLinkedPumpkinId) this.emit('pumpkin:updated', { pumpkin });
    }
    if (result.pumpkin && result.pumpkin.id !== autoLinkedPumpkinId) this.emit('pumpkin:updated', { pumpkin: result.pumpkin });
    this.emit('pumpkin:action', { id: result.pumpkin?.id || null, action: result.action, ...result.payload });
    return result;
  }
  testAction(action) {
    if (action !== 'pumpkin_tower') throw new Error('unsupported_dev_action');
    let result;
    this.db.transaction(() => { result = this._runPumpkinTower(this.db.getSettings(this.config), { test: true }); });
    if (result.status === 'no_pumpkins' || result.status === 'no_safe_tower_layout') return result;
    this.emit('pumpkin:action', { id: null, action: result.action, ...result.payload });
    return result;
  }
  _runPumpkinTower(settings, { redemptionId = null, test = false } = {}) {
    const all = this.db.listPumpkins();
    const context = { scene: this.config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers };
    const plan = buildTowerPlan(all, context, this.random, settings.towerAnimation.stackOrder);
    if (plan?.mode === 'empty') return { duplicate: false, redemptionId, status: 'no_pumpkins', action: 'pumpkin_tower', test };
    if (!plan) return { duplicate: false, redemptionId, status: 'no_safe_tower_layout', action: 'pumpkin_tower', test };
    const { lifetimeMinSeconds, lifetimeMaxSeconds } = settings.towerAnimation;
    const lifetimeSeconds = lifetimeMinSeconds + (lifetimeMaxSeconds - lifetimeMinSeconds) * randomUnit(this.random);
    for (const final of plan.finalPositions) this.db.updatePumpkin(final.id, { x: final.x, y: final.y, parentId: null, stackOffsetY: null, isAirborne: false });
    const finalPumpkins = this.db.listPumpkins().map(publicPumpkin);
    return {
      action: 'pumpkin_tower',
      global: true,
      redemptionId,
      test,
      updatedPumpkins: finalPumpkins,
      payload: {
        global: true,
        ...(test ? { test: true } : {}),
        mode: plan.mode,
        direction: plan.direction,
        sway: plan.sway,
        groundY: plan.groundY,
        lifetimeSeconds,
        participants: plan.participants,
        finalPositions: plan.finalPositions,
        finalPumpkins,
      },
    };
  }
  applyAction(action, pumpkin, input, context) {
    void input; void context;
    return { action, pumpkin: publicPumpkin(pumpkin), payload: { status: 'abstract_action' } };
  }
}
export { parseRedemption };

import { normalizeName, normalizeText, safeId } from '../utils/normalize.js';
import { dimensionsFor, isPositionValid, clampPosition, validateParentLink } from './spatial-rules.js';
import { publicPumpkin } from './donations.js';

function parseRedemption(raw) {
  const redemptionId = safeId(raw?.id ?? raw?.redemption_id ?? raw?.redemption?.id); const reward = raw?.reward || {};
  const rewardId = safeId(raw?.rewardId ?? raw?.reward_id ?? reward.id); const user = raw?.user || raw?.redeemer || {};
  const userId = safeId(raw?.userId ?? raw?.user_id ?? user.id); const userLogin = normalizeName(raw?.userLogin ?? raw?.user_login ?? user.login ?? user.username);
  const input = normalizeText(raw?.input ?? raw?.user_input ?? raw?.redemption?.user_input, 256);
  if (!redemptionId || !rewardId || (!userId && !userLogin)) throw new Error('invalid_redemption_event');
  return { redemptionId, rewardId, userId, userLogin, input };
}
function mappedAction(rewardId, mapping) { for (const [action, id] of Object.entries(mapping || {})) if (id && id === rewardId) return action; return null; }
export class RewardService {
  constructor({ db, config, logger = console, emit = () => {}, random = Math.random } = {}) { Object.assign(this, { db, config, logger, emit, random }); }
  handle(raw) {
    const event = parseRedemption(raw); const now = new Date().toISOString(); let result;
    this.db.transaction(() => {
      const action = mappedAction(event.rewardId, this.db.getSettings(this.config).rewardMapping);
      if (!this.db.insertRedemption({ ...event, status: action || 'ignored_reward', receivedAt: now, processedAt: now })) { result = { duplicate: true, redemptionId: event.redemptionId }; return; }
      const pumpkin = this.db.findPumpkinByTwitch(event.userId, event.userLogin);
      if (!pumpkin) { result = { duplicate: false, redemptionId: event.redemptionId, status: 'no_pumpkin_for_user', action }; return; }
      const settings = this.db.getSettings(this.config); const context = { scene: this.config.scene, noGoZone: settings.noGoZone };
      if (!action) { result = { duplicate: false, redemptionId: event.redemptionId, status: 'ignored_reward', pumpkin: publicPumpkin(pumpkin) }; return; }
      result = this.applyAction(action, pumpkin, event.input, context);
    });
    if (result.duplicate || result.status === 'no_pumpkin_for_user' || result.status === 'ignored_reward') return result;
    for (const pumpkin of result.updatedPumpkins || []) this.emit('pumpkin:updated', { pumpkin });
    if (result.pumpkin) this.emit('pumpkin:updated', { pumpkin: result.pumpkin });
    this.emit('pumpkin:action', { id: result.pumpkin.id, action: result.action, ...result.payload });
    return result;
  }
  applyAction(action, pumpkin, input, context) {
    if (action === 'inflate') {
      const neighbors = this.db.listPumpkins().filter((p) => p.id !== pumpkin.id && Math.hypot(p.x - pumpkin.x, p.y - pumpkin.y) <= 160);
      const pushes = neighbors.map((neighbor) => { const dx = neighbor.x - pumpkin.x || (neighbor.id > pumpkin.id ? 1 : -1); const destination = clampPosition(neighbor, neighbor.x + Math.sign(dx) * 180, neighbor.y, context); const updated = this.db.updatePumpkin(neighbor.id, { x: destination.x, y: destination.y }); return { id: neighbor.id, x: destination.x, y: destination.y, pumpkin: publicPumpkin(updated) }; });
      return { action, pumpkin: publicPumpkin(pumpkin), updatedPumpkins: pushes.map((push) => push.pumpkin), payload: { durationSeconds: 5, scale: 1.8, pushes: pushes.map(({ id, x, y }) => ({ id, x, y })) } };
    }
    if (action === 'jump_on') {
      const all = this.db.listPumpkins(); const wanted = normalizeName(input); let target = all.find((p) => p.id !== pumpkin.id && (normalizeName(p.twitchUsername) === wanted || normalizeName(p.displayName) === wanted));
      if (!target) target = all.filter((p) => p.id !== pumpkin.id && Math.hypot(p.x - pumpkin.x, p.y - pumpkin.y) <= 400).sort((a, b) => Math.hypot(a.x - pumpkin.x, a.y - pumpkin.y) - Math.hypot(b.x - pumpkin.x, b.y - pumpkin.y))[0];
      if (!target) return { action, pumpkin: publicPumpkin(pumpkin), payload: { status: 'no_target' } };
      const parentCheck = validateParentLink(pumpkin.id, target.id, all); if (!parentCheck.valid) return { action, pumpkin: publicPumpkin(pumpkin), payload: { status: parentCheck.reason } };
      const targetSize = dimensionsFor(target); const position = clampPosition(pumpkin, target.x, target.y - targetSize.height, context);
      const updated = this.db.updatePumpkin(pumpkin.id, { parentId: target.id, stackOffsetY: -targetSize.height, x: position.x, y: position.y });
      return { action, pumpkin: publicPumpkin(updated), payload: { targetId: target.id } };
    }
    if (action === 'morph_fly' || action === 'bat' || action === 'ghost') {
      const form = action === 'morph_fly' ? (this.random() < 0.5 ? 'bat' : 'ghost') : action; const target = clampPosition(pumpkin, this.random() * context.scene.width, context.scene.height * (0.25 + this.random() * 0.45), context);
      const updated = this.db.updatePumpkin(pumpkin.id, { x: target.x, y: target.y, isAirborne: true, parentId: null, stackOffsetY: null });
      return { action: 'morph_fly', pumpkin: publicPumpkin(updated), payload: { form, targetX: target.x, targetY: target.y } };
    }
    return { action, pumpkin: publicPumpkin(pumpkin), payload: { status: 'unsupported_action' } };
  }
}
export { parseRedemption };

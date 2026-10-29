import { socketHasAdminSession } from '../auth/session.js';
import { publicPumpkin, stageForTotal } from '../engine/donations.js';
import { validateGrowthStages } from '../engine/growth-stages.js';
import { isPositionValid, clampPosition, validateParentLink, normalizeZone, relocateInvalidPumpkins } from '../engine/spatial-rules.js';
import { sanitizeCustomization } from '../engine/customization-parser.js';
import { finiteNumber, normalizeName, normalizeText } from '../utils/normalize.js';
import { animationPatch } from '../engine/animation.js';
import { rewardMappingPatch } from '../engine/rewards.js';
import { validateGrowthThresholds, validateGrowthMultipliers, validateSpawnSettings } from '../engine/donation-settings.js';
import { towerAnimationPatch } from '../engine/tower-animation.js';
import { pumpkinNameFontSize } from '../engine/pumpkin-name-settings.js';
import { roamingSettingsPatch } from '../engine/roaming-settings.js';
import { landingParticlesPatch } from '../engine/landing-particles.js';
import { neighborStackAnimationPatch } from '../engine/neighbor-stack-animation.js';

function publicSettings(settings) { return { groundY: settings.groundY, noGoZone: settings.noGoZone, showPumpkinNames: settings.showPumpkinNames, pumpkinNameFontSize: settings.pumpkinNameFontSize, pumpkinCurrency: settings.pumpkinCurrency, rewardMapping: settings.rewardMapping, customizationRewardMode: settings.customizationRewardMode, animation: settings.animation, towerAnimation: settings.towerAnimation, neighborStackAnimation: settings.neighborStackAnimation, landingParticles: settings.landingParticles, minSpawnDonation: settings.minSpawnDonation, spawnCommand: settings.spawnCommand, growthThresholds: settings.growthThresholds, growthStages: settings.growthStages, growthMultipliers: settings.growthMultipliers, roamingIntervalSeconds: settings.roamingIntervalSeconds, roamingSpeed: settings.roamingSpeed, roamingJumpHeight: settings.roamingJumpHeight, roamingMinDistance: settings.roamingMinDistance, roamingMaxDistance: settings.roamingMaxDistance }; }
function safeScene(db, config, statuses, joinedStackService) { const settings = db.getSettings(config); return { pumpkins: db.listPumpkins().map(publicPumpkin), joinedStacks: joinedStackService?.activeSnapshots() || [], settings: publicSettings(settings), authStatus: statuses.all() }; }
function adminOnly(socket, handler) { return (...args) => { if (!socket.data.admin) { socket.emit('operation:error', { operation: args[0]?.operation || 'admin', message: 'admin_session_required' }); if (typeof args[1] === 'function') args[1]({ ok: false, error: 'admin_session_required' }); return; } return handler(...args); }; }
export function attachSocketHandlers(io, { config, db, statuses, logger = console, onBroadcast = () => {}, movementScheduler = null, joinedStackService = null } = {}) {
  io.use((socket, next) => { socket.data.admin = socketHasAdminSession(socket.handshake.headers.cookie, config.sessionSecret); next(); });
  io.on('connection', (socket) => {
    socket.emit('scene:init', safeScene(db, config, statuses, joinedStackService)); const drag = new Map();
    socket.on('admin:pumpkin:move-start', adminOnly(socket, (payload = {}) => { const p = db.getPumpkin(payload.id); const x = finiteNumber(payload.x); const y = finiteNumber(payload.y); if (!p || x === null || y === null) return socket.emit('operation:error', { operation: 'move-start', message: 'invalid_pumpkin_or_position' }); movementScheduler?.pause(p.id, socket.id); const settings = db.getSettings(config); const position = clampPosition(p, x, y, { scene: config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers }); drag.set(p.id, { sequence: -1, x: position.x, y: position.y }); io.emit('pumpkin:move', { id: p.id, ...position, isAirborne: p.isAirborne, sequence: -1 }); }));
    socket.on('admin:pumpkin:move', adminOnly(socket, (payload = {}) => { const state = drag.get(payload.id); const p = db.getPumpkin(payload.id); const sequence = finiteNumber(payload.sequence, { min: 0 }); const x = finiteNumber(payload.x); const y = finiteNumber(payload.y); if (!state || !p || sequence === null || sequence <= state.sequence || x === null || y === null) return; const settings = db.getSettings(config); const position = clampPosition(p, x, y, { scene: config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers }); Object.assign(state, position, { sequence }); io.emit('pumpkin:move', { id: p.id, ...position, isAirborne: p.isAirborne, sequence }); }));
    socket.on('admin:pumpkin:move-end', adminOnly(socket, (payload = {}) => { const state = drag.get(payload.id); const p = db.getPumpkin(payload.id); if (!state || !p) return; const settings = db.getSettings(config); const x = finiteNumber(payload.x); const y = finiteNumber(payload.y); const position = x === null || y === null ? state : clampPosition(p, x, y, { scene: config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers }); const isAirborne = position.y < settings.groundY - 0.1; const endpoint = isAirborne ? clampPosition(p, position.x, settings.groundY, { scene: config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers }) : position; const updated = db.updatePumpkin(p.id, { x: endpoint.x, y: endpoint.y, isAirborne: false }); drag.delete(p.id); movementScheduler?.resume(p.id, socket.id); io.emit('pumpkin:move-ended', { id: p.id, x: updated.x, y: updated.y, fromX: position.x, fromY: position.y, groundY: settings.groundY, isAirborne }); }));
    socket.on('admin:pumpkin:update', adminOnly(socket, (payload = {}) => {
      const p = db.getPumpkin(payload.id);
      if (!p || !payload.patch || typeof payload.patch !== 'object') return;
      const value = payload.patch;
      if (value.showDisplayName !== undefined && typeof value.showDisplayName !== 'boolean') {
        return socket.emit('operation:error', { operation: 'pumpkin-update', message: 'invalid_show_display_name' });
      }
      const patch = {};
      if (value.customization) patch.customization = sanitizeCustomization(value.customization, p.customization);
      if (value.displayName !== undefined) {
        const name = normalizeText(value.displayName, 128);
        if (!name) return socket.emit('operation:error', { operation: 'pumpkin-update', message: 'invalid_display_name' });
        patch.displayName = name;
      }
      if (value.twitchUsername !== undefined) patch.twitchUsername = normalizeName(value.twitchUsername) || null;
      if (value.twitchUserId !== undefined) patch.twitchUserId = normalizeText(value.twitchUserId, 128) || null;
      if (value.showDisplayName !== undefined) patch.showDisplayName = value.showDisplayName;
      if (value.stage !== undefined && Number.isInteger(value.stage) && value.stage >= 1 && value.stage <= 4) patch.stage = value.stage;
      const updated = db.updatePumpkin(p.id, patch);
      io.emit('pumpkin:updated', { pumpkin: publicPumpkin(updated) });
    }));
    socket.on('admin:pumpkin:delete', adminOnly(socket, ({ id } = {}) => {
      try {
        joinedStackService?.removePumpkin(id);
        if (db.deletePumpkin(id)) { movementScheduler?.remove(id); io.emit('pumpkin:deleted', { id }); }
      } catch (error) {
        logger.error('Pumpkin deletion blocked by joined-stack cleanup', { id, reason: error?.message });
        socket.emit('operation:error', { operation: 'pumpkin-delete', message: error.message });
      }
    }));
    socket.on('admin:pumpkins:clear', adminOnly(socket, (payload = {}) => { if (payload.confirmation === true) { joinedStackService?.clear(); db.clearPumpkins(); movementScheduler?.reset(); io.emit('pumpkin:cleared', {}); } }));
     const updateSettings = adminOnly(socket, (payload = {}, acknowledge) => {
       try {
         const current = db.getSettings(config); const patch = {};
         Object.assign(patch, roamingSettingsPatch(payload, current));
         if (payload.noGoZone !== undefined) patch.noGoZone = normalizeZone(payload.noGoZone, config.scene);
         if (payload.showPumpkinNames !== undefined) {
           if (typeof payload.showPumpkinNames !== 'boolean') throw new Error('invalid_show_pumpkin_names');
           patch.showPumpkinNames = payload.showPumpkinNames;
         }
         if (payload.pumpkinNameFontSize !== undefined) {
           const fontSize = pumpkinNameFontSize(payload.pumpkinNameFontSize);
           if (fontSize === null) throw new Error('invalid_pumpkin_name_font_size');
           patch.pumpkinNameFontSize = fontSize;
         }
         if (payload.rewardMapping !== undefined) { const rewardMapping = rewardMappingPatch(payload.rewardMapping, current.rewardMapping); if (!rewardMapping) throw new Error('invalid_reward_mapping'); patch.rewardMapping = rewardMapping; }
         if (payload.customizationRewardMode !== undefined) {
           if (!['single', 'all'].includes(payload.customizationRewardMode)) throw new Error('invalid_customization_reward_mode');
           patch.customizationRewardMode = payload.customizationRewardMode;
         }
          if (payload.growthThresholds !== undefined) patch.growthThresholds = validateGrowthThresholds(payload.growthThresholds);
          if (payload.growthStages !== undefined) patch.growthStages = validateGrowthStages(payload.growthStages);
          if (payload.growthMultipliers !== undefined) patch.growthMultipliers = validateGrowthMultipliers(payload.growthMultipliers);
         Object.assign(patch, validateSpawnSettings(payload));
         const animationInput = payload.animation !== undefined ? payload.animation : (payload.eyeFrequency !== undefined || payload.mouthFrequency !== undefined ? { eyeFrequency: payload.eyeFrequency, mouthFrequency: payload.mouthFrequency } : undefined);
          if (animationInput !== undefined) { const animation = animationPatch(animationInput, current.animation); if (!animation) throw new Error('invalid_animation'); patch.animation = animation; }
          if (payload.towerAnimation !== undefined) { const towerAnimation = towerAnimationPatch(payload.towerAnimation, current.towerAnimation); if (!towerAnimation) throw new Error('invalid_tower_animation'); patch.towerAnimation = towerAnimation; }
          if (payload.neighborStackAnimation !== undefined) { const neighborStackAnimation = neighborStackAnimationPatch(payload.neighborStackAnimation, current.neighborStackAnimation); if (!neighborStackAnimation) throw new Error('invalid_neighbor_stack_animation'); patch.neighborStackAnimation = neighborStackAnimation; }
          if (payload.landingParticles !== undefined) { const landingParticles = landingParticlesPatch(payload.landingParticles, current.landingParticles); if (!landingParticles) throw new Error('invalid_landing_particles'); patch.landingParticles = landingParticles; }
         if (!Object.keys(patch).length) return;
          const noGoZone = patch.noGoZone || current.noGoZone; const relocated = [];
         const settings = db.transaction(() => {
           const next = db.updateSettings(patch, config);
           if (patch.noGoZone || patch.growthMultipliers || patch.growthStages || patch.growthThresholds) {
            const pumpkins = db.listPumpkins();
            const nextStages = new Map(pumpkins.map((pumpkin) => [pumpkin.id, stageForTotal(pumpkin.totalDonated, next.growthThresholds, next.growthStages)]));
            const stagedPumpkins = pumpkins.map((pumpkin) => ({ ...pumpkin, stage: nextStages.get(pumpkin.id) }));
            const movedPositions = new Map(relocateInvalidPumpkins(stagedPumpkins, { scene: config.scene, noGoZone, growthMultipliers: next.growthMultipliers }).map((moved) => [moved.id, moved]));
            for (const currentPumpkin of pumpkins) {
              const nextStage = nextStages.get(currentPumpkin.id);
              const pumpkinPatch = { stage: nextStage };
              const moved = movedPositions.get(currentPumpkin.id);
              if (moved) Object.assign(pumpkinPatch, { x: moved.x, y: moved.y });
              if (nextStage !== currentPumpkin.stage || moved) {
                const updated = db.updatePumpkin(currentPumpkin.id, pumpkinPatch);
                relocated.push(publicPumpkin(updated));
              }
            }
          }
           return next;
         });
         if (patch.roamingIntervalSeconds !== undefined) movementScheduler?.settingsUpdated();
         for (const pumpkin of relocated) io.emit('pumpkin:updated', { pumpkin });
         io.emit('settings:updated', { settings: publicSettings(settings) });
         if (patch.noGoZone) io.emit('settings:nogo-updated', { noGoZone: settings.noGoZone });
         acknowledge?.({ ok: true, settings: publicSettings(settings) });
          } catch (error) { socket.emit('operation:error', { operation: payload.showPumpkinNames !== undefined || payload.pumpkinNameFontSize !== undefined || payload.rewardMapping !== undefined || payload.customizationRewardMode !== undefined || payload.growthThresholds !== undefined || payload.growthStages !== undefined || payload.growthMultipliers !== undefined || payload.animation !== undefined || payload.towerAnimation !== undefined || payload.neighborStackAnimation !== undefined || payload.landingParticles !== undefined || payload.eyeFrequency !== undefined || payload.mouthFrequency !== undefined || payload.minSpawnDonation !== undefined || payload.spawnCommand !== undefined || payload.roamingIntervalSeconds !== undefined || payload.roamingSpeed !== undefined || payload.roamingJumpHeight !== undefined || payload.roamingMinDistance !== undefined || payload.roamingMaxDistance !== undefined ? 'settings-update' : 'nogo-update', message: error.message }); acknowledge?.({ ok: false, error: error.message }); }
     });
     socket.on('admin:settings:update', updateSettings);
     socket.on('admin:settings:nogo-update', updateSettings);
    socket.on('disconnect', () => { for (const [id, state] of drag) if (state) { db.updatePumpkin(id, { x: state.x, y: state.y }); movementScheduler?.resume(id, socket.id); } });
  });
  onBroadcast((event, payload) => io.emit(event, payload));
  return io;
}

import { socketHasAdminSession } from '../auth/session.js';
import { publicPumpkin } from '../engine/donations.js';
import { isPositionValid, clampPosition, validateParentLink, normalizeZone, relocateInvalidPumpkins } from '../engine/spatial-rules.js';
import { sanitizeCustomization } from '../engine/customization-parser.js';
import { finiteNumber, normalizeName, normalizeText } from '../utils/normalize.js';

function safeScene(db, config, statuses) { const settings = db.getSettings(config); return { pumpkins: db.listPumpkins().map(publicPumpkin), settings: { groundY: settings.groundY, noGoZone: settings.noGoZone, pumpkinCurrency: settings.pumpkinCurrency, rewardMapping: settings.rewardMapping }, authStatus: statuses.all() }; }
function adminOnly(socket, handler) { return (...args) => { if (!socket.data.admin) { socket.emit('operation:error', { operation: args[0]?.operation || 'admin', message: 'admin_session_required' }); return; } return handler(...args); }; }
export function attachSocketHandlers(io, { config, db, statuses, logger = console, onBroadcast = () => {} } = {}) {
  io.use((socket, next) => { socket.data.admin = socketHasAdminSession(socket.handshake.headers.cookie, config.sessionSecret); next(); });
  io.on('connection', (socket) => {
    socket.emit('scene:init', safeScene(db, config, statuses)); const drag = new Map();
    socket.on('admin:pumpkin:move-start', adminOnly(socket, (payload = {}) => { const p = db.getPumpkin(payload.id); const x = finiteNumber(payload.x); const y = finiteNumber(payload.y); if (!p || x === null || y === null) return socket.emit('operation:error', { operation: 'move-start', message: 'invalid_pumpkin_or_position' }); const settings = db.getSettings(config); const position = clampPosition(p, x, y, { scene: config.scene, noGoZone: settings.noGoZone }); drag.set(p.id, { sequence: -1, x: position.x, y: position.y }); io.emit('pumpkin:move', { id: p.id, ...position, isAirborne: p.isAirborne, sequence: -1 }); }));
    socket.on('admin:pumpkin:move', adminOnly(socket, (payload = {}) => { const state = drag.get(payload.id); const p = db.getPumpkin(payload.id); const sequence = finiteNumber(payload.sequence, { min: 0 }); const x = finiteNumber(payload.x); const y = finiteNumber(payload.y); if (!state || !p || sequence === null || sequence <= state.sequence || x === null || y === null) return; const settings = db.getSettings(config); const position = clampPosition(p, x, y, { scene: config.scene, noGoZone: settings.noGoZone }); Object.assign(state, position, { sequence }); io.emit('pumpkin:move', { id: p.id, ...position, isAirborne: p.isAirborne, sequence }); }));
    socket.on('admin:pumpkin:move-end', adminOnly(socket, (payload = {}) => { const state = drag.get(payload.id); const p = db.getPumpkin(payload.id); if (!state || !p) return; const settings = db.getSettings(config); const x = finiteNumber(payload.x); const y = finiteNumber(payload.y); const position = x === null || y === null ? state : clampPosition(p, x, y, { scene: config.scene, noGoZone: settings.noGoZone }); const updated = db.updatePumpkin(p.id, { x: position.x, y: position.y }); drag.delete(p.id); io.emit('pumpkin:move-ended', { id: p.id, x: updated.x, y: updated.y, isAirborne: updated.isAirborne }); io.emit('pumpkin:updated', { pumpkin: publicPumpkin(updated) }); }));
    socket.on('admin:pumpkin:update', adminOnly(socket, (payload = {}) => { const p = db.getPumpkin(payload.id); if (!p || !payload.patch || typeof payload.patch !== 'object') return; const patch = {}; const value = payload.patch; if (value.customization) patch.customization = sanitizeCustomization(value.customization, p.customization); if (value.twitchUsername !== undefined) patch.twitchUsername = normalizeName(value.twitchUsername) || null; if (value.twitchUserId !== undefined) patch.twitchUserId = normalizeText(value.twitchUserId, 128) || null; if (value.stage !== undefined && Number.isInteger(value.stage) && value.stage >= 1 && value.stage <= 4) patch.stage = value.stage; const updated = db.updatePumpkin(p.id, patch); io.emit('pumpkin:updated', { pumpkin: publicPumpkin(updated) }); }));
    socket.on('admin:pumpkin:delete', adminOnly(socket, ({ id } = {}) => { if (db.deletePumpkin(id)) io.emit('pumpkin:deleted', { id }); }));
    socket.on('admin:pumpkins:clear', adminOnly(socket, (payload = {}) => { if (payload.confirmation === true) { db.clearPumpkins(); io.emit('pumpkin:cleared', {}); } }));
    socket.on('admin:settings:nogo-update', adminOnly(socket, (payload = {}) => {
      try {
        const noGoZone = normalizeZone(payload.noGoZone, config.scene); const relocated = [];
        const settings = db.transaction(() => {
          const next = db.updateSettings({ noGoZone }, config);
          for (const moved of relocateInvalidPumpkins(db.listPumpkins(), { scene: config.scene, noGoZone })) {
            const updated = db.updatePumpkin(moved.id, { x: moved.x, y: moved.y }); relocated.push(publicPumpkin(updated));
          }
          return next;
        });
        for (const pumpkin of relocated) io.emit('pumpkin:updated', { pumpkin });
        io.emit('settings:nogo-updated', { noGoZone: settings.noGoZone });
      } catch (error) { socket.emit('operation:error', { operation: 'nogo-update', message: error.message }); }
    }));
    socket.on('admin:animation:test', adminOnly(socket, ({ id, action } = {}) => { const p = db.getPumpkin(id); if (p && ['inflate', 'jump_on', 'morph_fly'].includes(action)) io.emit('pumpkin:action', { id, action, test: true }); }));
    socket.on('disconnect', () => { for (const [id, state] of drag) if (state) db.updatePumpkin(id, { x: state.x, y: state.y }); });
  });
  onBroadcast((event, payload) => io.emit(event, payload));
  return io;
}

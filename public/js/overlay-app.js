import { PumpkinRenderer } from './shared/pumpkin-renderer.js?v=stage1-face-20261022';

const connectionPill = document.querySelector('#connection-state');
const canvas = document.querySelector('#overlay-scene');
const renderer = new PumpkinRenderer(canvas, { interactive: false });
let socket = null;

function showConnection(text, visible = true) { if (connectionPill) { connectionPill.textContent = text; connectionPill.classList.toggle('visible', visible); } }
function handleAction(payload = {}) { if (payload.action) renderer.action(payload.id, payload.action, payload); }
function connect() {
  if (typeof globalThis.io !== 'function') { showConnection('Socket.IO unavailable'); return; }
  socket = globalThis.io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => showConnection('Live', false));
  socket.on('disconnect', () => showConnection('Reconnecting…'));
  socket.on('connect_error', () => showConnection('Reconnecting…'));
  socket.io?.on('reconnect_attempt', () => showConnection('Reconnecting…'));
  socket.on('scene:init', (scene = {}) => { renderer.setSettings(scene.settings || {}); renderer.sync(Array.isArray(scene.pumpkins) ? scene.pumpkins : []); showConnection('Live', false); });
  socket.on('settings:updated', ({ settings } = {}) => renderer.setSettings(settings || {}));
  socket.on('pumpkin:spawned', ({ pumpkin }) => renderer.add(pumpkin, { immediate: true }));
  socket.on('pumpkin:updated', ({ pumpkin }) => renderer.update(pumpkin));
  socket.on('pumpkin:move', (payload) => renderer.applyMove(payload));
  socket.on('pumpkin:move-ended', (payload) => renderer.finishMove(payload));
  socket.on('pumpkin:evolved', (payload = {}) => { renderer.characters.get(payload.id)?.evolve(payload.stage); });
  socket.on('pumpkin:action', handleAction);
  socket.on('pumpkin:deleted', ({ id }) => renderer.remove(id));
  socket.on('pumpkin:cleared', () => renderer.clear());
}
connect();
window.addEventListener('resize', () => renderer.characters.forEach((character) => character.setPositionImmediate(character.x, character.y, character.isAirborne)));

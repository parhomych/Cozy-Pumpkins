import { PumpkinRenderer } from './shared/pumpkin-renderer.js';
import { PumpkinCharacter } from './shared/pumpkin-character.js';
import { eventToLogical, rectToCss, clamp } from './shared/coordinate-mapper.js';

const SCENE_WIDTH = 1920;
const SCENE_HEIGHT = 1080;
const REFERENCE_ARTWORK_SIZE = 1095;
const REFERENCE_DISPLAY_SIZE = 220;
// Mirror the shared renderer's 1095 x 1095 viewBox rendered at 220 logical pixels.
const STAGE_SCALES = Object.freeze([0.58, 0.82, 1, 1.12]);
const PUMPKIN_PADDING = 65;
const DEFAULT_ANIMATION = Object.freeze({ eyeFrequency: 1, mouthFrequency: 1 });
const ANIMATION_MIN = 0.1;
const ANIMATION_MAX = 10;
const REWARD_ACTIONS = Object.freeze(['inflate', 'jump_on', 'morph_fly', 'bat', 'ghost']);
const DEFAULT_REWARD_MAPPING = Object.freeze(Object.fromEntries(REWARD_ACTIONS.map((action) => [action, ''])));

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const canvas = $('#scene-canvas'); const previewFrame = $('#preview-frame'); const zoneElement = $('#nogo-zone');
const renderer = new PumpkinRenderer(canvas, { interactive: true, onSelect: (id, pumpkin, event) => { selectPumpkin(id); if (event) beginDrag(id, event); } });
const state = { pumpkins: new Map(), settings: { groundY: 980, noGoZone: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, animation: { ...DEFAULT_ANIMATION }, rewardMapping: { ...DEFAULT_REWARD_MAPPING } }, twitchRewards: [], selectedId: null, socket: null, drag: null, zoneDrag: null, settingsSaveTimer: null, previewCharacter: null };

function toast(message) { const el = $('#toast'); if (!el) return; el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 2600); }
function setSocketState(label, kind = '') { $('#socket-status').textContent = label; const dot = $('#socket-dot'); dot.className = `status-dot ${kind}`; }
function displayName(p) { return p?.displayName || p?.ownerNormalized || 'Unnamed pumpkin'; }
function selected() { return state.selectedId ? state.pumpkins.get(state.selectedId) : null; }
function normalized(value) { return String(value || '').trim().toLowerCase(); }
function animationFrequency(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, ANIMATION_MIN, ANIMATION_MAX) : fallback;
}
function zone() { return state.settings.noGoZone || { enabled: false, x: 0, y: 0, width: 0, height: 0 }; }
function renderZone() {
  const current = zone(); zoneElement.classList.toggle('enabled', Boolean(current.enabled && current.width > 0 && current.height > 0));
  if (current.enabled) Object.assign(zoneElement.style, rectToCss(current, previewFrame));
  $('#zone-x').value = Math.round(current.x || 0); $('#zone-y').value = Math.round(current.y || 0); $('#zone-width').value = Math.round(current.width || 0); $('#zone-height').value = Math.round(current.height || 0);
  $('#toggle-zone').textContent = current.enabled ? 'Disable zone' : 'Enable zone';
}
function setZone(next, { persist = true } = {}) {
  state.settings.noGoZone = { ...zone(), ...next, enabled: next.enabled ?? zone().enabled };
  state.settings.noGoZone.x = clamp(Number(state.settings.noGoZone.x) || 0, 0, SCENE_WIDTH); state.settings.noGoZone.y = clamp(Number(state.settings.noGoZone.y) || 0, 0, SCENE_HEIGHT);
  state.settings.noGoZone.width = clamp(Number(state.settings.noGoZone.width) || 0, 0, SCENE_WIDTH - state.settings.noGoZone.x); state.settings.noGoZone.height = clamp(Number(state.settings.noGoZone.height) || 0, 0, SCENE_HEIGHT - state.settings.noGoZone.y);
  renderZone(); if (persist) scheduleSettingsSave();
}
function scheduleSettingsSave() { clearTimeout(state.settingsSaveTimer); state.settingsSaveTimer = setTimeout(() => { state.socket?.emit('admin:settings:update', { noGoZone: state.settings.noGoZone, animation: state.settings.animation, rewardMapping: state.settings.rewardMapping }); }, 180); }
function pumpkinDimensions(pumpkin) {
  const rawStage = Number(pumpkin?.stage);
  const stage = Number.isFinite(rawStage) ? clamp(Math.round(rawStage), 1, 4) : 1;
  const size = REFERENCE_ARTWORK_SIZE * (REFERENCE_DISPLAY_SIZE / REFERENCE_ARTWORK_SIZE) * STAGE_SCALES[stage - 1];
  return { width: size, height: size };
}
function localSafePosition(p, x, y) {
  const { width, height } = pumpkinDimensions(p); const half = width / 2; const padding = PUMPKIN_PADDING;
  // Horizontal scene edges use the artwork edge; padding remains in the
  // vertical ground limits and No-Go Zone collision test below.
  const minX = half; const maxX = SCENE_WIDTH - half;
  const minY = height + padding; const maxY = SCENE_HEIGHT - padding;
  const requestedX = Number.isFinite(Number(x)) ? Number(x) : minX;
  const requestedY = Number.isFinite(Number(y)) ? Number(y) : maxY;
  let nextX = clamp(requestedX, minX, maxX); let nextY = clamp(requestedY, minY, maxY);
  const z = zone();
  const overlapsZone = (candidateX, candidateY) => candidateX - half - padding < z.x + z.width && candidateX + half + padding > z.x && candidateY - height - padding < z.y + z.height && candidateY + padding > z.y;
  if (z.enabled && z.width && z.height && overlapsZone(nextX, nextY)) {
    const options = [
      { x: z.x - half - padding, y: nextY }, { x: z.x + z.width + half + padding, y: nextY },
      { x: nextX, y: z.y - padding }, { x: nextX, y: z.y + z.height + height + padding },
    ].map((v) => ({ x: clamp(v.x, minX, maxX), y: clamp(v.y, minY, maxY) })).filter((v) => !overlapsZone(v.x, v.y));
    if (options.length) {
      const best = options.sort((a, b) => Math.hypot(a.x - requestedX, a.y - requestedY) - Math.hypot(b.x - requestedX, b.y - requestedY))[0]; nextX = best.x; nextY = best.y;
    }
  }
  return { x: nextX, y: nextY };
}
function selectPumpkin(id) { if (!state.pumpkins.has(id)) { state.selectedId = null; renderer.setSelected(null); renderInspector(); return; } state.selectedId = id; renderer.setSelected(id); renderInspector(); }
function renderInspector() {
  const p = selected(); $('#inspector-empty').hidden = Boolean(p); $('#inspector-form').hidden = !p; $('#selected-stage').textContent = p ? `Stage ${p.stage}` : '—';
  if (!p) { $('#character-preview').replaceChildren(); state.previewCharacter?.destroy(); state.previewCharacter = null; return; }
  $('#owner-name').textContent = displayName(p); $('#total-donated').textContent = `${Number(p.totalDonated || 0).toLocaleString()} ${p.currency || ''}`; $('#display-name').value = p.displayName || ''; $('#twitch-username').value = p.twitchUsername || '';
  const customization = p.customization || {}; for (const select of $$('[data-slot]')) select.value = customization[select.dataset.slot] || select.options[0]?.value;
  state.previewCharacter?.destroy(); state.previewCharacter = new PumpkinCharacter({ ...p, x: 110, y: 150 }, { interactive: false, positioning: 'local', animationSettings: state.settings.animation }); state.previewCharacter.setPositionImmediate(110, 150, false); $('#character-preview').append(state.previewCharacter.root); state.previewCharacter.startIdle();
}
function renderAnimationSettings() { const animation = { ...DEFAULT_ANIMATION, ...(state.settings.animation || {}) }; $('#eye-frequency').value = animation.eyeFrequency; $('#mouth-frequency').value = animation.mouthFrequency; renderer.setSettings({ animation }); state.previewCharacter?.setAnimationSettings(animation).restartIdle(); }
function renderRewardMapping() {
  const mapping = { ...DEFAULT_REWARD_MAPPING, ...(state.settings.rewardMapping || {}) };
  for (const action of REWARD_ACTIONS) {
    const select = $(`[data-reward-action="${action}"]`); if (!select) continue;
    const selectedId = mapping[action] || ''; const options = [new Option('Disabled', '')];
    for (const reward of state.twitchRewards) {
      const availability = reward.isEnabled ? '' : ' (disabled on Twitch)';
      const option = new Option(`${reward.title} · ${reward.cost} points${availability}`, reward.id);
      option.disabled = !reward.isEnabled;
      options.push(option);
    }
    if (selectedId && !state.twitchRewards.some((reward) => reward.id === selectedId)) {
      const unavailable = new Option(`Unavailable reward (${selectedId})`, selectedId);
      unavailable.dataset.unavailable = 'true';
      options.push(unavailable);
    }
    select.replaceChildren(...options);
    select.value = selectedId;
  }
}
function readRewardMapping() { return Object.fromEntries(REWARD_ACTIONS.map((action) => [action, $(`[data-reward-action="${action}"]`)?.value.trim() || ''])); }
function saveRewardMapping() {
  const mapping = readRewardMapping(); const ids = Object.values(mapping).filter(Boolean);
  if (new Set(ids).size !== ids.length) { $('#reward-mapping-state').textContent = 'Duplicate reward assignment: each Twitch reward can be assigned to only one action.'; return; }
  state.settings.rewardMapping = { ...DEFAULT_REWARD_MAPPING, ...mapping }; $('#reward-mapping-state').textContent = 'Saving reward mapping…'; scheduleSettingsSave();
}
function rewardErrorMessage(code) {
  const messages = {
    twitch_not_connected: 'Connect Twitch before loading rewards.',
    twitch_scope_missing: 'Reconnect Twitch and grant permission to read channel point redemptions.',
    twitch_auth_failed: 'Twitch authorization expired. Reconnect Twitch and try again.',
    twitch_rate_limited: 'Twitch is limiting requests. Try again shortly.',
    twitch_request_timeout: 'Twitch did not respond in time. Try again.',
    twitch_unavailable: 'Twitch is temporarily unavailable. Try again shortly.',
  };
  return messages[code] || 'Unable to load Twitch rewards. Saved assignments have been preserved.';
}
async function loadTwitchRewards() {
  const button = $('#refresh-twitch-rewards'); const status = $('#twitch-rewards-state');
  button.disabled = true; status.textContent = 'Loading Twitch rewards…';
  try {
    const response = await fetch('/api/twitch/rewards', { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'twitch_request_failed');
    if (!body.connected) { status.textContent = body.message || 'Connect Twitch to load rewards.'; return; }
    state.twitchRewards = Array.isArray(body.rewards) ? body.rewards : [];
    renderRewardMapping();
    status.textContent = state.twitchRewards.length ? `Loaded ${state.twitchRewards.length} Twitch rewards.` : 'This channel has no channel point rewards.';
  } catch (error) {
    status.textContent = rewardErrorMessage(error.message);
  } finally {
    button.disabled = false;
  }
}
function setAnimationSettings(next, { persist = true } = {}) {
  const current = { ...DEFAULT_ANIMATION, ...(state.settings.animation || {}) };
  state.settings.animation = {
    eyeFrequency: animationFrequency(next.eyeFrequency, current.eyeFrequency),
    mouthFrequency: animationFrequency(next.mouthFrequency, current.mouthFrequency),
  };
  renderAnimationSettings();
  if (persist) scheduleSettingsSave();
}
function upsertPumpkin(pumpkin) { if (!pumpkin?.id) return; state.pumpkins.set(pumpkin.id, pumpkin); renderer.add(pumpkin, { immediate: true }); if (state.selectedId === pumpkin.id) renderInspector(); }
function removePumpkin(id) { state.pumpkins.delete(id); renderer.remove(id); if (state.selectedId === id) selectPumpkin(null); }
function renderSearch() {
  const query = normalized($('#pumpkin-search').value); const results = [...state.pumpkins.values()].filter((p) => !query || [p.displayName, p.ownerNormalized, p.twitchUsername].some((value) => normalized(value).includes(query))).slice(0, 30); const box = $('#search-results'); box.replaceChildren();
  for (const p of results) { const button = document.createElement('button'); button.className = 'search-result'; button.dataset.id = p.id; button.innerHTML = `${displayName(p)}<small>Stage ${p.stage} · ${Number(p.totalDonated || 0).toLocaleString()} ${p.currency || ''}</small>`; button.addEventListener('click', () => { selectPumpkin(p.id); box.classList.remove('open'); $('#pumpkin-search').value = displayName(p); }); box.append(button); }
  box.classList.toggle('open', Boolean(query && results.length));
}
function patchPumpkin(patch, { persist = true } = {}) { const p = selected(); if (!p) return; const next = { ...p, ...patch, customization: { ...p.customization, ...(patch.customization || {}) } }; state.pumpkins.set(p.id, next); renderer.update(next, { immediate: true }); if (state.previewCharacter) { state.previewCharacter.data = next; state.previewCharacter.applyCustomization(next.customization); } if (persist) state.socket?.emit('admin:pumpkin:update', { id: p.id, patch }); }
function beginDrag(id, event) {
  if (state.drag || event.button !== undefined && event.button !== 0) return; const p = state.pumpkins.get(id); if (!p) return; event.preventDefault(); event.stopPropagation(); selectPumpkin(id);
  const point = eventToLogical(event, canvas); const offset = { x: point.x - p.x, y: point.y - p.y }; state.drag = { id, offset, sequence: -1, lastSent: 0, pending: null, timer: null, pointerId: event.pointerId };
  try { canvas.setPointerCapture(event.pointerId); } catch {} const candidate = localSafePosition(p, point.x - offset.x, point.y - offset.y); state.socket?.emit('admin:pumpkin:move-start', { id, x: candidate.x, y: candidate.y }); renderer.setPosition(id, candidate.x, candidate.y, { immediate: true, isAirborne: p.isAirborne });
}
function sendDragMove(force = false) { const drag = state.drag; if (!drag || !drag.pending) return; const now = performance.now(); if (!force && now - drag.lastSent < 16) { clearTimeout(drag.timer); drag.timer = setTimeout(() => sendDragMove(true), 17); return; } const next = drag.pending; drag.pending = null; drag.sequence += 1; drag.lastSent = now; state.socket?.emit('admin:pumpkin:move', { id: drag.id, x: next.x, y: next.y, sequence: drag.sequence }); }
function moveDrag(event) { const drag = state.drag; if (!drag) return; const p = state.pumpkins.get(drag.id); if (!p) return; const point = eventToLogical(event, canvas); const next = localSafePosition(p, point.x - drag.offset.x, point.y - drag.offset.y); renderer.setPosition(drag.id, next.x, next.y, { immediate: true, isAirborne: p.isAirborne }); drag.pending = next; sendDragMove(); }
function endDrag() { const drag = state.drag; if (!drag) return; clearTimeout(drag.timer); sendDragMove(true); const p = state.pumpkins.get(drag.id); if (p) { const character = renderer.characters.get(drag.id); const next = localSafePosition(p, character?.x ?? p.x, character?.y ?? p.y); state.socket?.emit('admin:pumpkin:move-end', { id: drag.id, x: next.x, y: next.y }); } try { canvas.releasePointerCapture(drag.pointerId); } catch {} state.drag = null; }
function beginZone(event) {
  if (event.target.closest('.resize-handle')) return; event.preventDefault(); event.stopPropagation(); const point = eventToLogical(event, previewFrame); const z = zone(); state.zoneDrag = { mode: 'move', start: point, zone: { ...z }, pointerId: event.pointerId }; try { previewFrame.setPointerCapture(event.pointerId); } catch {}
}
function beginResize(event) { event.preventDefault(); event.stopPropagation(); const point = eventToLogical(event, previewFrame); const z = zone(); state.zoneDrag = { mode: event.currentTarget.dataset.handle, start: point, zone: { ...z }, pointerId: event.pointerId }; try { previewFrame.setPointerCapture(event.pointerId); } catch {} }
function moveZone(event) { const drag = state.zoneDrag; if (!drag) return; const point = eventToLogical(event, previewFrame); const dx = point.x - drag.start.x; const dy = point.y - drag.start.y; let next = { ...drag.zone };
  if (drag.mode === 'move') { next.x = drag.zone.x + dx; next.y = drag.zone.y + dy; } else { if (drag.mode.includes('w')) { next.x = drag.zone.x + dx; next.width = drag.zone.width - dx; } if (drag.mode.includes('e')) next.width = drag.zone.width + dx; if (drag.mode.includes('n')) { next.y = drag.zone.y + dy; next.height = drag.zone.height - dy; } if (drag.mode.includes('s')) next.height = drag.zone.height + dy; }
  if (next.width < 40) { if (drag.mode.includes('w')) next.x = next.x + next.width - 40; next.width = 40; } if (next.height < 40) { if (drag.mode.includes('n')) next.y = next.y + next.height - 40; next.height = 40; } setZone(next);
}
function endZone() { if (!state.zoneDrag) return; try { previewFrame.releasePointerCapture(state.zoneDrag.pointerId); } catch {} state.zoneDrag = null; }
function updateProviderCard(value) { if (!value?.provider) return; const card = document.querySelector(`[data-provider="${value.provider}"]`); if (!card) return; const wasConnected = card.dataset.authenticated === 'true'; const disconnected = value.provider === 'twitch' ? 'Disconnected' : 'Not connected'; $('[data-auth-status]', card).textContent = value.authStatus || disconnected; $('[data-connection-status]', card).textContent = value.connectionStatus || disconnected; $('[data-account]', card).textContent = value.account || value.providerLogin || '—'; $('[data-provider-message]', card).textContent = value.message || ''; const button = $('.provider-action', card); const connected = value.authStatus === 'Connected'; card.dataset.authenticated = connected ? 'true' : 'false'; button.textContent = connected ? `Disconnect ${value.provider === 'donationalerts' ? 'DonationAlerts' : 'Twitch'}` : `Connect ${value.provider === 'donationalerts' ? 'DonationAlerts' : 'Twitch'}`; button.dataset.connected = connected ? 'true' : 'false'; if (value.provider === 'twitch' && connected && !wasConnected) void loadTwitchRewards(); }
function handleScene(scene = {}) { state.pumpkins.clear(); state.settings = { ...state.settings, ...(scene.settings || {}), animation: { ...DEFAULT_ANIMATION, ...(scene.settings?.animation || {}) }, rewardMapping: { ...DEFAULT_REWARD_MAPPING, ...(scene.settings?.rewardMapping || {}) } }; renderer.setSettings(state.settings); for (const p of scene.pumpkins || []) state.pumpkins.set(p.id, p); renderer.sync([...state.pumpkins.values()]); renderZone(); renderAnimationSettings(); renderRewardMapping(); renderSearch(); renderInspector(); for (const status of scene.authStatus || []) updateProviderCard(status); }
async function providerAction(provider, connected) { const path = `/api/auth/${provider}/${connected ? 'logout' : ''}`.replace(/\/$/, ''); if (!connected) { window.location.assign(`/api/auth/${provider}`); return; } try { const response = await fetch(path, { method: 'POST', headers: { 'Accept': 'application/json' } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'logout_failed'); toast(`${provider} disconnected locally`); } catch (error) { toast(error.message); } }
function connectSocket() { if (typeof globalThis.io !== 'function') { setSocketState('Socket.IO unavailable', 'error'); return; } const socket = globalThis.io(); state.socket = socket; socket.on('connect', () => setSocketState('Live', 'live')); socket.on('disconnect', () => { setSocketState('Reconnecting…', 'warn'); if (state.drag) endDrag(); }); socket.on('connect_error', () => setSocketState('Reconnecting…', 'warn')); socket.io?.on('reconnect_attempt', () => setSocketState('Reconnecting…', 'warn'));
    socket.on('scene:init', handleScene); socket.on('integration:status', updateProviderCard); socket.on('pumpkin:spawned', ({ pumpkin }) => { upsertPumpkin(pumpkin); renderSearch(); }); socket.on('pumpkin:updated', ({ pumpkin }) => { upsertPumpkin(pumpkin); renderSearch(); }); socket.on('pumpkin:move', (payload) => { if (!state.drag || state.drag.id !== payload.id) renderer.applyMove(payload); }); socket.on('pumpkin:move-ended', (payload) => { renderer.finishMove(payload); const p = state.pumpkins.get(payload.id); if (p) state.pumpkins.set(payload.id, { ...p, x: payload.x, y: payload.y }); }); socket.on('pumpkin:evolved', ({ id, stage, totalDonated }) => { const p = state.pumpkins.get(id); if (p) { p.stage = stage; p.totalDonated = totalDonated; upsertPumpkin(p); } }); socket.on('pumpkin:action', (payload) => renderer.action(payload.id, payload.action, payload)); socket.on('pumpkin:deleted', ({ id }) => { removePumpkin(id); renderSearch(); toast('Pumpkin deleted'); }); socket.on('pumpkin:cleared', () => { state.pumpkins.clear(); renderer.clear(); selectPumpkin(null); renderSearch(); toast('Scene cleared'); }); socket.on('settings:updated', ({ settings } = {}) => { state.settings = { ...state.settings, ...(settings || {}), animation: { ...DEFAULT_ANIMATION, ...(settings?.animation || state.settings.animation) }, rewardMapping: { ...DEFAULT_REWARD_MAPPING, ...(settings?.rewardMapping || state.settings.rewardMapping) } }; renderer.setSettings(state.settings); renderZone(); renderAnimationSettings(); renderRewardMapping(); if (settings?.rewardMapping) $('#reward-mapping-state').textContent = 'Reward mapping saved.'; }); socket.on('settings:nogo-updated', ({ noGoZone }) => { setZone(noGoZone, { persist: false }); }); socket.on('operation:error', ({ message }) => { if (message === 'invalid_reward_mapping') { $('#reward-mapping-state').textContent = 'Invalid reward mapping.'; renderRewardMapping(); } else $('#reward-mapping-state').textContent = $('#reward-mapping-state').textContent; toast(message || 'Operation rejected by server'); }); }
function wireUI() {
  $('#pumpkin-search').addEventListener('input', renderSearch); $('#pumpkin-search').addEventListener('focus', renderSearch); document.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap')) $('#search-results').classList.remove('open'); });
  canvas.addEventListener('pointermove', moveDrag); canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); window.addEventListener('blur', endDrag);
  zoneElement.addEventListener('pointerdown', beginZone); $$('.resize-handle', zoneElement).forEach((handle) => handle.addEventListener('pointerdown', beginResize)); previewFrame.addEventListener('pointermove', moveZone); previewFrame.addEventListener('pointerup', endZone); previewFrame.addEventListener('pointercancel', endZone);
  $('#toggle-zone').addEventListener('click', () => setZone(zone().enabled ? { enabled: false } : { enabled: true, x: 1420, y: 150, width: 360, height: 300 }));
   $$('#zone-x, #zone-y, #zone-width, #zone-height').forEach((input) => input.addEventListener('input', () => setZone({ [input.id.replace('zone-', '')]: Number(input.value) })));
    $('#eye-frequency').addEventListener('input', () => setAnimationSettings({ eyeFrequency: $('#eye-frequency').value })); $('#mouth-frequency').addEventListener('input', () => setAnimationSettings({ mouthFrequency: $('#mouth-frequency').value })); $('#save-reward-mapping').addEventListener('click', saveRewardMapping); $('#refresh-twitch-rewards').addEventListener('click', () => void loadTwitchRewards());
  $$('.provider-action').forEach((button) => button.addEventListener('click', () => providerAction(button.dataset.provider, button.dataset.connected === 'true')));
  $$('#inspector-form [data-slot]').forEach((select) => select.addEventListener('change', () => { const p = selected(); if (!p) return; const customization = { ...p.customization, [select.dataset.slot]: select.value }; patchPumpkin({ customization }, { persist: false }); }));
   $('#save-pumpkin').addEventListener('click', async () => { const p = selected(); if (!p) return; const patch = { displayName: $('#display-name').value.trim(), twitchUsername: $('#twitch-username').value.trim() || null, customization: p.customization }; $('#save-state').textContent = 'Sending changes for server validation…'; patchPumpkin(patch, { persist: false }); try { const response = await fetch(`/api/pumpkins/${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); if (!response.ok) throw new Error('server_rejected_changes'); $('#save-state').textContent = 'Saved by server.'; } catch { $('#save-state').textContent = 'Unable to save changes.'; } });
  $$('#inspector-form [data-animation]').forEach((button) => button.addEventListener('click', () => { const p = selected(); if (!p) return; state.socket?.emit('admin:animation:test', { id: p.id, action: button.dataset.animation }); if (!state.socket) renderer.action(p.id, button.dataset.animation, {}); }));
  $('#delete-pumpkin').addEventListener('click', () => { const p = selected(); if (!p || !window.confirm(`Delete ${displayName(p)}?`)) return; renderer.characters.get(p.id)?.disappear(); state.socket?.emit('admin:pumpkin:delete', { id: p.id }); });
  $('#clear-all').addEventListener('click', () => { if (!state.pumpkins.size || !window.confirm(`Delete all ${state.pumpkins.size} pumpkins? This cannot be undone.`)) return; state.socket?.emit('admin:pumpkins:clear', { confirmation: true }); });
  $('#simulate-donation').addEventListener('click', async () => { try { const response = await fetch('/api/dev/donation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `dev-${Date.now()}`, name: $('#sim-name').value, amount: Number($('#sim-amount').value), currency: state.settings.pumpkinCurrency || 'RUB', message: '' }) }); if (!response.ok) throw new Error('simulator_unavailable'); toast('Test donation sent'); } catch (error) { toast(error.message); } });
}
async function loadStatus() { try { const response = await fetch('/api/status'); const data = await response.json(); for (const item of data.integrations || []) updateProviderCard(item); const exposed = data.devSimulator || data.features?.donationSimulator; if (exposed) $('#simulator').hidden = false; } catch { /* Socket.IO remains the source of live state. */ } }
wireUI(); connectSocket(); loadStatus(); renderZone(); renderAnimationSettings(); renderRewardMapping();

import { PumpkinRenderer } from './shared/pumpkin-renderer.js?v=hitbox-20261021';
import { PumpkinCharacter } from './shared/pumpkin-character.js?v=hitbox-20261021';
import { eventToLogical, rectToCss, clamp } from './shared/coordinate-mapper.js';
import { bindPersistentDisclosures } from './admin-disclosures.js';

const SCENE_WIDTH = 1920;
const SCENE_HEIGHT = 1080;
const REFERENCE_ARTWORK_SIZE = 1095;
const REFERENCE_DISPLAY_SIZE = 220;
const PUMPKIN_PADDING = 65;
const DEFAULT_ANIMATION = Object.freeze({ eyeFrequency: 1, mouthFrequency: 1 });
const DEFAULT_GROWTH_THRESHOLDS = Object.freeze({ stage2: 300, stage3: 1000, stage4: 3000 });
const DEFAULT_GROWTH_MULTIPLIERS = Object.freeze({ stage1: 0.58, stage2: 0.82, stage3: 1, stage4: 1.12 });
const GROWTH_MULTIPLIER_MIN = 0.25;
const GROWTH_MULTIPLIER_MAX = 3;
const PREVIEW_CUSTOMIZATION = Object.freeze({ skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'leaf', prop: 'none' });
const ANIMATION_MIN = 0.1;
const ANIMATION_MAX = 10;
const DEFAULT_TOWER_ANIMATION = Object.freeze({ swayAmplitude: 12, swayDuration: 2, rotationMultiplier: 1, bendMultiplier: 1 });
const TOWER_ANIMATION_LIMITS = Object.freeze({ swayAmplitude: { min: 0, max: 60 }, swayDuration: { min: 0.1, max: 30 }, rotationMultiplier: { min: 0, max: 5 }, bendMultiplier: { min: 0, max: 5 } });
const REWARD_ACTIONS = Object.freeze(['inflate', 'jump_on', 'morph_fly', 'bat', 'ghost', 'pumpkin_tower']);
const DEFAULT_REWARD_MAPPING = Object.freeze(Object.fromEntries(REWARD_ACTIONS.map((action) => [action, ''])));

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const canvas = $('#scene-canvas'); const previewFrame = $('#preview-frame'); const zoneElement = $('#nogo-zone');
const renderer = new PumpkinRenderer(canvas, { interactive: true, onSelect: (id, pumpkin, event) => { selectPumpkin(id); if (event) beginDrag(id, event); } });
const state = { pumpkins: new Map(), settings: { groundY: 980, noGoZone: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, animation: { ...DEFAULT_ANIMATION }, towerAnimation: { ...DEFAULT_TOWER_ANIMATION }, rewardMapping: { ...DEFAULT_REWARD_MAPPING }, growthThresholds: { ...DEFAULT_GROWTH_THRESHOLDS }, growthMultipliers: { ...DEFAULT_GROWTH_MULTIPLIERS }, pumpkinCurrency: 'RUB', minSpawnDonation: 0, spawnCommand: '!тыковка' }, customizationCatalog: [], catalogCharacters: [], growthCharacters: [], growthDirty: false, twitchRewards: [], selectedId: null, socket: null, drag: null, zoneDrag: null, settingsSaveTimer: null, previewCharacter: null };

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
function renderSpawnSettings() { $('#min-spawn-donation').value = state.settings.minSpawnDonation ?? 0; $('#spawn-command').value = state.settings.spawnCommand || '!тыковка'; $('#spawn-currency').textContent = state.settings.pumpkinCurrency || 'RUB'; }
function renderGrowthStages({ updateInputs = true } = {}) {
  const currency = state.settings.pumpkinCurrency || 'RUB';
  const thresholds = { ...DEFAULT_GROWTH_THRESHOLDS, ...(state.settings.growthThresholds || {}) };
  const multipliers = { ...DEFAULT_GROWTH_MULTIPLIERS, ...(state.settings.growthMultipliers || {}) };
  $$('[data-growth-currency]').forEach((element) => { element.textContent = currency; });
  state.growthCharacters.forEach((character) => character.destroy());
  state.growthCharacters = [];
  for (const stage of [1, 2, 3, 4]) {
    const container = $(`#growth-stage-${stage}-preview`);
    container.replaceChildren();
    const character = new PumpkinCharacter({
      id: `growth-stage-preview-${stage}`,
      displayName: `Stage ${stage}`,
      stage,
      x: 110,
      y: 220,
      customization: PREVIEW_CUSTOMIZATION,
    }, { interactive: false, positioning: 'local', previewSize: 90, animationSettings: state.settings.animation, growthMultipliers: multipliers });
    character.setPositionImmediate(110, 220, false);
    character.root.setAttribute('aria-hidden', 'true');
    container.append(character.root);
    state.growthCharacters.push(character);
  }
  if (updateInputs && !state.growthDirty) {
    for (const stage of [2, 3, 4]) $(`#growth-threshold-stage-${stage}`).value = thresholds[`stage${stage}`];
    for (const stage of [1, 2, 3, 4]) $(`#growth-multiplier-stage-${stage}`).value = multipliers[`stage${stage}`];
  }
}
function renderCustomizationCatalog(catalog = []) {
  const container = $('#customization-catalog');
  state.catalogCharacters.forEach((character) => character.destroy());
  state.catalogCharacters = [];
  container.replaceChildren();
  if (!Array.isArray(catalog)) catalog = [];
  const labels = { skin: 'Skins', eyes: 'Eyes', mouth: 'Mouths', hat: 'Hats', prop: 'Props and accessories' };
  for (const group of catalog) {
    if (typeof group?.slot !== 'string' || !Array.isArray(group.values)) continue;
    const section = document.createElement('section');
    section.className = 'catalog-group';
    const heading = document.createElement('h4');
    heading.textContent = labels[group.slot] || group.label || group.slot.replace(/[_-]+/gu, ' ');
    section.append(heading);
    const grid = document.createElement('div');
    grid.className = 'catalog-grid';
    for (const item of group.values) {
      if (typeof item?.value !== 'string' || !Array.isArray(item.keywords)) continue;
      const option = document.createElement('article');
      option.className = 'catalog-option';
      const preview = document.createElement('div');
      preview.className = 'catalog-preview';
      if (Object.hasOwn(PREVIEW_CUSTOMIZATION, group.slot)) {
        const character = new PumpkinCharacter({
          id: `catalog-${group.slot}-${item.value}`,
          stage: 2,
          x: 110,
          y: 220,
          customization: { ...PREVIEW_CUSTOMIZATION, [group.slot]: item.value },
        }, { interactive: false, positioning: 'local', previewSize: 64, animationSettings: state.settings.animation });
        character.setPositionImmediate(110, 220, false);
        character.root.setAttribute('aria-label', `${heading.textContent}: ${item.value}`);
        character.root.setAttribute('aria-hidden', 'true');
        preview.append(character.root);
        state.catalogCharacters.push(character);
      } else {
        preview.textContent = 'Preview unavailable';
        preview.setAttribute('aria-hidden', 'true');
      }
      const detail = document.createElement('div');
      const value = document.createElement('strong');
      value.textContent = item.label || item.value;
      const keywords = document.createElement('p');
      keywords.className = 'catalog-keywords';
      keywords.textContent = item.keywords.length ? item.keywords.join(' · ') : 'No donor keywords';
      detail.append(value, keywords);
      option.append(preview, detail);
      grid.append(option);
    }
    section.append(grid);
    container.append(section);
  }
  const actionSection = document.createElement('section');
  actionSection.className = 'catalog-group';
  const actionHeading = document.createElement('h4');
  actionHeading.textContent = 'Actions';
  const actionGrid = document.createElement('div');
  actionGrid.className = 'catalog-grid';
  const actionIds = [];
  for (const action of actionIds) {
    const option = document.createElement('article');
    option.className = 'catalog-option';
    option.dataset.actionChoice = action;
    const detail = document.createElement('div');
    const value = document.createElement('strong');
    value.textContent = action.replace(/[_-]+/gu, ' ');
    const keywords = document.createElement('p');
    keywords.className = 'catalog-keywords';
    keywords.textContent = 'Twitch reward action';
    detail.append(value, keywords);
    option.append(detail);
    actionGrid.append(option);
  }
  actionSection.append(actionHeading, actionGrid);
  container.append(actionSection);
}
async function loadSpawnSettings() {
  const status = $('#spawn-settings-state');
  try {
    const response = await fetch('/api/settings');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'settings_load_failed');
    state.settings = { ...state.settings, ...(body.settings || {}) };
    state.customizationCatalog = body.customizationCatalog || [];
    renderSpawnSettings();
    renderTowerAnimationSettings();
    renderGrowthStages();
    renderCustomizationCatalog(state.customizationCatalog);
    status.textContent = 'Spawn settings loaded.';
  } catch (error) {
    status.textContent = `Unable to load spawn settings: ${error.message}`;
  }
}
async function saveSpawnSettings() {
  const status = $('#spawn-settings-state');
  const rawThreshold = $('#min-spawn-donation').value;
  const threshold = Number(rawThreshold);
  if (rawThreshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0) {
    status.textContent = 'Minimum donation must be a finite number greater than or equal to zero.';
    return;
  }
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minSpawnDonation: threshold, spawnCommand: $('#spawn-command').value }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'settings_update_failed');
    state.settings = { ...state.settings, ...(body.settings || {}) };
    renderSpawnSettings();
    status.textContent = 'Spawn settings saved.';
  } catch (error) {
    status.textContent = `Unable to save spawn settings: ${error.message}`;
  }
}
function readGrowthThresholds() {
  const stages = [2, 3, 4];
  const inputs = stages.map((stage) => $(`#growth-threshold-stage-${stage}`));
  const rawValues = inputs.map((input) => input.value.trim());
  const values = rawValues.map(Number);
  const invalid = new Set();
  for (let index = 0; index < values.length; index += 1) {
    if (!rawValues[index] || !Number.isFinite(values[index]) || values[index] < 0) invalid.add(index);
  }
  for (let index = 1; index < values.length; index += 1) {
    if (Number.isFinite(values[index - 1]) && Number.isFinite(values[index]) && values[index] <= values[index - 1]) {
      invalid.add(index - 1);
      invalid.add(index);
    }
  }
  inputs.forEach((input, index) => {
    const message = invalid.has(index) ? 'Enter a non-negative threshold in strictly increasing order.' : '';
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  });
  if (invalid.size) {
    const fields = [...invalid].map((index) => `stage ${stages[index]}`).join(', ');
    $('#growth-settings-state').textContent = `Check ${fields}: amounts must be finite, non-negative, and strictly increasing.`;
    return null;
  }
  return { stage2: values[0], stage3: values[1], stage4: values[2] };
}
function readGrowthMultipliers() {
  const stages = [1, 2, 3, 4];
  const inputs = stages.map((stage) => $(`#growth-multiplier-stage-${stage}`));
  const values = inputs.map((input) => Number(input.value.trim()));
  const invalid = new Set();
  for (let index = 0; index < values.length; index += 1) {
    if (!inputs[index].value.trim() || !Number.isFinite(values[index]) || values[index] < GROWTH_MULTIPLIER_MIN || values[index] > GROWTH_MULTIPLIER_MAX) invalid.add(index);
  }
  inputs.forEach((input, index) => {
    const message = invalid.has(index) ? `Enter a multiplier from ${GROWTH_MULTIPLIER_MIN} to ${GROWTH_MULTIPLIER_MAX}.` : '';
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  });
  if (invalid.size) {
    const fields = [...invalid].map((index) => `stage ${stages[index]}`).join(', ');
    $('#growth-settings-state').textContent = `Check ${fields}: size multipliers must be between ${GROWTH_MULTIPLIER_MIN} and ${GROWTH_MULTIPLIER_MAX}.`;
    return null;
  }
  return Object.fromEntries(stages.map((stage, index) => [`stage${stage}`, values[index]]));
}
async function saveGrowthSettings() {
  const thresholds = readGrowthThresholds();
  const multipliers = readGrowthMultipliers();
  if (!thresholds || !multipliers) return;
  const button = $('#save-growth-settings');
  const status = $('#growth-settings-state');
  button.disabled = true;
  status.textContent = 'Saving growth rules…';
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ growthThresholds: thresholds, growthMultipliers: multipliers }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'growth_threshold_save_failed');
    if (!body.settings?.growthThresholds || !body.settings?.growthMultipliers) throw new Error('growth_settings_unsupported');
    state.settings = { ...state.settings, ...body.settings };
    state.growthDirty = false;
    renderGrowthStages();
    status.textContent = 'Growth rules saved.';
  } catch (error) {
    status.textContent = error.message === 'invalid_growth_thresholds'
      ? 'The server rejected these growth rules. Check that all three amounts increase.'
      : error.message === 'invalid_growth_multipliers'
        ? `The server rejected these size multipliers. Use values from ${GROWTH_MULTIPLIER_MIN} to ${GROWTH_MULTIPLIER_MAX}.`
      : error.message === 'growth_settings_unsupported'
        ? 'Restart the Cozy Pumpkins server to load the growth multiplier settings update, then try again.'
      : `Unable to save growth rules: ${error.message}`;
  } finally {
    button.disabled = false;
  }
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
function scheduleSettingsSave() { clearTimeout(state.settingsSaveTimer); state.settingsSaveTimer = setTimeout(() => { state.socket?.emit('admin:settings:update', { noGoZone: state.settings.noGoZone, animation: state.settings.animation, towerAnimation: state.settings.towerAnimation, rewardMapping: state.settings.rewardMapping }); }, 180); }
function pumpkinDimensions(pumpkin) {
  const rawStage = Number(pumpkin?.stage);
  const stage = Number.isFinite(rawStage) ? clamp(Math.round(rawStage), 1, 4) : 1;
  const multipliers = { ...DEFAULT_GROWTH_MULTIPLIERS, ...(state.settings.growthMultipliers || {}) };
  const size = REFERENCE_ARTWORK_SIZE * (REFERENCE_DISPLAY_SIZE / REFERENCE_ARTWORK_SIZE) * multipliers[`stage${stage}`];
  return { width: size, height: size };
}
function localSafePosition(p, x, y) {
  const { width, height } = pumpkinDimensions(p); const half = width / 2; const padding = PUMPKIN_PADDING;
  // Scene edges use the artwork edge; padding remains only in the No-Go Zone
  // collision test below.
  const minX = half; const maxX = SCENE_WIDTH - half;
  const minY = height + padding; const maxY = SCENE_HEIGHT;
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
  state.previewCharacter?.destroy(); state.previewCharacter = new PumpkinCharacter({ ...p, x: 110, y: 150 }, { interactive: false, positioning: 'local', previewSize: 130, animationSettings: state.settings.animation, growthMultipliers: state.settings.growthMultipliers }); state.previewCharacter.setPositionImmediate(110, 150, false); $('#character-preview').append(state.previewCharacter.root); state.previewCharacter.startIdle();
}
function renderAnimationSettings() { const animation = { ...DEFAULT_ANIMATION, ...(state.settings.animation || {}) }; $('#eye-frequency').value = animation.eyeFrequency; $('#mouth-frequency').value = animation.mouthFrequency; renderer.setSettings({ animation }); state.previewCharacter?.setAnimationSettings(animation).restartIdle(); }
function normalizeTowerAnimation(value = {}, fallback = DEFAULT_TOWER_ANIMATION) {
  return Object.fromEntries(Object.keys(DEFAULT_TOWER_ANIMATION).map((key) => {
    const limits = TOWER_ANIMATION_LIMITS[key];
    const number = Number(value[key]);
    const safe = Number.isFinite(number) ? number : Number(fallback[key]);
    return [key, clamp(Number.isFinite(safe) ? safe : DEFAULT_TOWER_ANIMATION[key], limits.min, limits.max)];
  }));
}
function renderTowerAnimationSettings({ apply = true } = {}) {
  const towerAnimation = normalizeTowerAnimation(state.settings.towerAnimation);
  state.settings.towerAnimation = towerAnimation;
  for (const key of Object.keys(DEFAULT_TOWER_ANIMATION)) $(`#tower-${key === 'swayAmplitude' ? 'sway-amplitude' : key === 'swayDuration' ? 'sway-duration' : key === 'rotationMultiplier' ? 'rotation-multiplier' : 'bend-multiplier'}`).value = towerAnimation[key];
  if (apply) renderer.setSettings({ towerAnimation });
}
function readTowerAnimationSettings() {
  const fields = {
    swayAmplitude: $('#tower-sway-amplitude'),
    swayDuration: $('#tower-sway-duration'),
    rotationMultiplier: $('#tower-rotation-multiplier'),
    bendMultiplier: $('#tower-bend-multiplier'),
  };
  const value = {};
  const invalid = [];
  for (const [key, input] of Object.entries(fields)) {
    const number = Number(input.value.trim()); const limits = TOWER_ANIMATION_LIMITS[key];
    if (!input.value.trim() || !Number.isFinite(number) || number < limits.min || number > limits.max) invalid.push(key);
    value[key] = number;
    input.setCustomValidity(invalid.includes(key) ? `Use a value from ${limits.min} to ${limits.max}.` : '');
    input.toggleAttribute('aria-invalid', invalid.includes(key));
  }
  if (invalid.length) { $('#tower-animation-state').textContent = 'Check the tower animation values.'; return null; }
  return value;
}
function setTowerAnimationSettings(next, { persist = true } = {}) {
  state.settings.towerAnimation = normalizeTowerAnimation({ ...state.settings.towerAnimation, ...next });
  renderer.setSettings({ towerAnimation: state.settings.towerAnimation });
  renderTowerAnimationSettings({ apply: false });
  $('#tower-animation-state').textContent = 'Tower animation updated live.';
  if (persist) scheduleSettingsSave();
}
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
async function testPumpkinTower() {
  const button = $('#test-pumpkin-tower'); const status = $('#test-reward-state');
  button.disabled = true; status.textContent = 'Activating test tower…';
  try {
    const response = await fetch('/api/dev/reward', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pumpkin_tower' }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'test_action_failed');
    status.textContent = body.result?.status === 'no_pumpkins' ? 'No pumpkins are available for the test.' : 'Test tower activation sent.';
  } catch (error) {
    status.textContent = error.message === 'development_simulator_disabled' ? 'Test actions are available only in development.' : `Unable to activate test tower: ${error.message}`;
  } finally {
    button.disabled = false;
  }
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
function updateProviderCard(value) { if (!value?.provider) return; const card = document.querySelector(`[data-provider="${value.provider}"]`); if (!card) return; const wasConnected = card.dataset.authenticated === 'true'; const providerNames = { twitch: 'Twitch', donationalerts: 'DonationAlerts', donatex: 'DonatEx', memealerts: 'Meme Alerts' }; const providerName = providerNames[value.provider] || value.provider; const disconnected = 'Disconnected'; $('[data-auth-status]', card).textContent = value.authStatus || disconnected; $('[data-connection-status]', card).textContent = value.connectionStatus || disconnected; $('[data-account]', card).textContent = value.account || '—'; $('[data-provider-message]', card).textContent = value.message || ''; const button = $('.provider-action', card); const connected = value.authStatus === 'Connected'; card.dataset.authenticated = connected ? 'true' : 'false'; button.textContent = `${connected ? 'Disconnect' : 'Connect'} ${providerName}`; button.dataset.connected = connected ? 'true' : 'false'; if (value.provider === 'twitch' && connected && !wasConnected) void loadTwitchRewards(); }
  function handleScene(scene = {}) { state.pumpkins.clear(); state.settings = { ...state.settings, ...(scene.settings || {}), animation: { ...DEFAULT_ANIMATION, ...(scene.settings?.animation || {}) }, towerAnimation: { ...DEFAULT_TOWER_ANIMATION, ...(scene.settings?.towerAnimation || {}) }, rewardMapping: { ...DEFAULT_REWARD_MAPPING, ...(scene.settings?.rewardMapping || {}) }, growthThresholds: { ...DEFAULT_GROWTH_THRESHOLDS, ...(scene.settings?.growthThresholds || {}) }, growthMultipliers: { ...DEFAULT_GROWTH_MULTIPLIERS, ...(scene.settings?.growthMultipliers || {}) } }; renderer.setSettings(state.settings); for (const p of scene.pumpkins || []) state.pumpkins.set(p.id, p); renderer.sync([...state.pumpkins.values()]); renderZone(); renderAnimationSettings(); renderTowerAnimationSettings(); renderRewardMapping(); renderSpawnSettings(); renderGrowthStages(); renderSearch(); renderInspector(); for (const status of scene.authStatus || []) updateProviderCard(status); }
async function providerAction(provider, connected) { const path = `/api/auth/${provider}/${connected ? 'logout' : ''}`.replace(/\/$/, ''); if (!connected) { window.location.assign(`/api/auth/${provider}`); return; } try { const response = await fetch(path, { method: 'POST', headers: { 'Accept': 'application/json' } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'logout_failed'); toast(`${provider} disconnected locally`); } catch (error) { toast(error.message); } }
function connectSocket() { if (typeof globalThis.io !== 'function') { setSocketState('Socket.IO unavailable', 'error'); return; } const socket = globalThis.io(); state.socket = socket; socket.on('connect', () => setSocketState('Live', 'live')); socket.on('disconnect', () => { setSocketState('Reconnecting…', 'warn'); if (state.drag) endDrag(); }); socket.on('connect_error', () => setSocketState('Reconnecting…', 'warn')); socket.io?.on('reconnect_attempt', () => setSocketState('Reconnecting…', 'warn'));
      socket.on('scene:init', handleScene); socket.on('integration:status', updateProviderCard); socket.on('pumpkin:spawned', ({ pumpkin }) => { upsertPumpkin(pumpkin); renderSearch(); }); socket.on('pumpkin:updated', ({ pumpkin }) => { upsertPumpkin(pumpkin); renderSearch(); }); socket.on('pumpkin:move', (payload) => { if (!state.drag || state.drag.id !== payload.id) renderer.applyMove(payload); }); socket.on('pumpkin:move-ended', (payload) => { renderer.finishMove(payload); const p = state.pumpkins.get(payload.id); if (p) state.pumpkins.set(payload.id, { ...p, x: payload.x, y: payload.y }); }); socket.on('pumpkin:evolved', ({ id, stage, totalDonated }) => { const p = state.pumpkins.get(id); if (p) { p.stage = stage; p.totalDonated = totalDonated; upsertPumpkin(p); } }); socket.on('pumpkin:action', (payload = {}) => { for (const p of payload.finalPumpkins || []) if (p?.id) state.pumpkins.set(p.id, p); renderer.action(payload.id, payload.action, payload); renderSearch(); if (state.selectedId && payload.finalPumpkins?.some((p) => p.id === state.selectedId)) renderInspector(); }); socket.on('pumpkin:deleted', ({ id }) => { removePumpkin(id); renderSearch(); toast('Pumpkin deleted'); }); socket.on('pumpkin:cleared', () => { state.pumpkins.clear(); renderer.clear(); selectPumpkin(null); renderSearch(); toast('Scene cleared'); }); socket.on('settings:updated', ({ settings } = {}) => { state.settings = { ...state.settings, ...(settings || {}), animation: { ...DEFAULT_ANIMATION, ...(settings?.animation || state.settings.animation) }, towerAnimation: { ...DEFAULT_TOWER_ANIMATION, ...(settings?.towerAnimation || state.settings.towerAnimation) }, rewardMapping: { ...DEFAULT_REWARD_MAPPING, ...(settings?.rewardMapping || state.settings.rewardMapping) }, growthThresholds: { ...DEFAULT_GROWTH_THRESHOLDS, ...(settings?.growthThresholds || state.settings.growthThresholds) }, growthMultipliers: { ...DEFAULT_GROWTH_MULTIPLIERS, ...(settings?.growthMultipliers || state.settings.growthMultipliers) } }; renderer.setSettings(state.settings); renderZone(); renderAnimationSettings(); renderTowerAnimationSettings(); renderRewardMapping(); renderSpawnSettings(); renderGrowthStages({ updateInputs: !state.growthDirty }); if (settings?.rewardMapping) $('#reward-mapping-state').textContent = 'Reward mapping saved.'; }); socket.on('settings:nogo-updated', ({ noGoZone }) => { setZone(noGoZone, { persist: false }); }); socket.on('operation:error', ({ message }) => { if (message === 'invalid_reward_mapping') { $('#reward-mapping-state').textContent = 'Invalid reward mapping.'; renderRewardMapping(); } else if (message === 'invalid_min_spawn_donation' || message === 'invalid_spawn_command') $('#spawn-settings-state').textContent = message; else if (message === 'invalid_growth_thresholds') $('#growth-settings-state').textContent = 'The server rejected these growth rules. Check that all three amounts increase.'; else if (message === 'invalid_growth_multipliers') $('#growth-settings-state').textContent = `The server rejected these size multipliers. Use values from ${GROWTH_MULTIPLIER_MIN} to ${GROWTH_MULTIPLIER_MAX}.`; else if (message === 'invalid_tower_animation') $('#tower-animation-state').textContent = 'The server rejected these tower animation values.'; toast(message || 'Operation rejected by server'); }); }
function wireUI() {
  $('#save-spawn-settings').addEventListener('click', saveSpawnSettings);
  $('#save-growth-settings').addEventListener('click', () => void saveGrowthSettings());
  $$('[id^="growth-threshold-stage-"], [id^="growth-multiplier-stage-"]').forEach((input) => input.addEventListener('input', () => {
    state.growthDirty = true;
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    $('#growth-settings-state').textContent = '';
  }));
  $('#pumpkin-search').addEventListener('input', renderSearch); $('#pumpkin-search').addEventListener('focus', renderSearch); document.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap')) $('#search-results').classList.remove('open'); });
  canvas.addEventListener('pointermove', moveDrag); canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); window.addEventListener('blur', endDrag);
  zoneElement.addEventListener('pointerdown', beginZone); $$('.resize-handle', zoneElement).forEach((handle) => handle.addEventListener('pointerdown', beginResize)); previewFrame.addEventListener('pointermove', moveZone); previewFrame.addEventListener('pointerup', endZone); previewFrame.addEventListener('pointercancel', endZone);
  $('#toggle-zone').addEventListener('click', () => setZone(zone().enabled ? { enabled: false } : { enabled: true, x: 1420, y: 150, width: 360, height: 300 }));
   $$('#zone-x, #zone-y, #zone-width, #zone-height').forEach((input) => input.addEventListener('input', () => setZone({ [input.id.replace('zone-', '')]: Number(input.value) })));
      $('#eye-frequency').addEventListener('input', () => setAnimationSettings({ eyeFrequency: $('#eye-frequency').value })); $('#mouth-frequency').addEventListener('input', () => setAnimationSettings({ mouthFrequency: $('#mouth-frequency').value }));
   $$('input[id^="tower-"]').forEach((input) => input.addEventListener('input', () => { const values = readTowerAnimationSettings(); if (values) setTowerAnimationSettings(values); }));
   $('#save-reward-mapping').addEventListener('click', saveRewardMapping); $('#refresh-twitch-rewards').addEventListener('click', () => void loadTwitchRewards()); $('#test-pumpkin-tower').addEventListener('click', () => void testPumpkinTower());
  $$('.provider-action').forEach((button) => button.addEventListener('click', () => providerAction(button.dataset.provider, button.dataset.connected === 'true')));
  $$('#inspector-form [data-slot]').forEach((select) => select.addEventListener('change', () => { const p = selected(); if (!p) return; const customization = { ...p.customization, [select.dataset.slot]: select.value }; patchPumpkin({ customization }, { persist: false }); }));
   $('#save-pumpkin').addEventListener('click', async () => { const p = selected(); if (!p) return; const patch = { displayName: $('#display-name').value.trim(), twitchUsername: $('#twitch-username').value.trim() || null, customization: p.customization }; $('#save-state').textContent = 'Sending changes for server validation…'; patchPumpkin(patch, { persist: false }); try { const response = await fetch(`/api/pumpkins/${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); if (!response.ok) throw new Error('server_rejected_changes'); $('#save-state').textContent = 'Saved by server.'; } catch { $('#save-state').textContent = 'Unable to save changes.'; } });
  $('#delete-pumpkin').addEventListener('click', () => { const p = selected(); if (!p || !window.confirm(`Delete ${displayName(p)}?`)) return; renderer.characters.get(p.id)?.disappear(); state.socket?.emit('admin:pumpkin:delete', { id: p.id }); });
  $('#clear-all').addEventListener('click', () => { if (!state.pumpkins.size || !window.confirm(`Delete all ${state.pumpkins.size} pumpkins? This cannot be undone.`)) return; state.socket?.emit('admin:pumpkins:clear', { confirmation: true }); });
  $('#simulate-donation').addEventListener('click', async () => { try { const response = await fetch('/api/dev/donation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `dev-${Date.now()}`, name: $('#sim-name').value, amount: Number($('#sim-amount').value), currency: state.settings.pumpkinCurrency || 'RUB', message: state.settings.spawnCommand || '!тыковка' }) }); if (!response.ok) throw new Error('simulator_unavailable'); toast('Test donation sent'); } catch (error) { toast(error.message); } });
}
async function loadStatus() { try { const response = await fetch('/api/status'); const data = await response.json(); for (const item of data.integrations || []) updateProviderCard(item); const exposed = data.devSimulator || data.features?.donationSimulator; if (exposed) { $('#simulator').hidden = false; $('#test-pumpkin-tower').hidden = false; } } catch { /* Socket.IO remains the source of live state. */ } }
bindPersistentDisclosures($$('details'));
wireUI(); connectSocket(); loadStatus(); loadSpawnSettings(); renderZone(); renderAnimationSettings(); renderTowerAnimationSettings(); renderRewardMapping(); renderSpawnSettings(); renderGrowthStages();

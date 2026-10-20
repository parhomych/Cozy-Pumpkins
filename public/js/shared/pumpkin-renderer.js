import { PumpkinCharacter } from './pumpkin-character.js';

export class PumpkinRenderer {
  constructor(container, { interactive = false, onSelect = null, settings = null } = {}) {
    this.container = container; this.interactive = interactive; this.onSelect = onSelect; this.settings = settings || {}; this.characters = new Map(); this.sequence = new Map();
    this.container?.classList.add('pumpkin-layer');
  }
  add(pumpkin, { immediate = true } = {}) {
    if (!pumpkin?.id) return null;
    if (this.characters.has(pumpkin.id)) return this.update(pumpkin, { immediate });
    const character = new PumpkinCharacter(pumpkin, { positioning: 'scene', interactive: this.interactive, animationSettings: this.settings.animation, onPointerDown: (data, event) => this.onSelect?.(data.id, data, event) });
    this.characters.set(pumpkin.id, character); this.sequence.set(pumpkin.id, -1); this.container?.append(character.root); character.startIdle(); return character;
  }
  update(pumpkin, { immediate = false } = {}) {
    const character = this.characters.get(pumpkin?.id); if (!character) return this.add(pumpkin, { immediate: true });
    character.data = { ...character.data, ...pumpkin, customization: pumpkin.customization || character.data.customization };
    if (pumpkin.customization) character.applyCustomization(pumpkin.customization);
    character.moveTo(pumpkin.x, pumpkin.y, { immediate, isAirborne: pumpkin.isAirborne }); return character;
  }
  setSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings, animation: { ...(this.settings.animation || {}), ...(settings.animation || {}) } };
    for (const character of this.characters.values()) { character.setAnimationSettings(this.settings.animation); character.restartIdle(); }
    return this;
  }
  setPosition(id, x, y, { immediate = false, isAirborne } = {}) { const character = this.characters.get(id); if (!character) return; character.moveTo(x, y, { immediate, isAirborne }); }
  applyMove(payload, { immediate = false } = {}) { if (!payload?.id) return; const next = Number(payload.sequence); const previous = this.sequence.get(payload.id) ?? -1; if (Number.isFinite(next) && next < previous) return; if (Number.isFinite(next)) this.sequence.set(payload.id, next); this.setPosition(payload.id, payload.x, payload.y, { immediate, isAirborne: payload.isAirborne }); }
  finishMove(payload) { if (!payload?.id) return; this.setPosition(payload.id, payload.x, payload.y, { immediate: false, isAirborne: payload.isAirborne }); this.sequence.set(payload.id, -1); }
  remove(id, { animate = true } = {}) { const character = this.characters.get(id); if (!character) return; this.characters.delete(id); this.sequence.delete(id); if (animate) character.disappear(() => character.destroy()); else character.destroy(); }
  clear() { for (const id of [...this.characters.keys()]) this.remove(id, { animate: false }); }
  action(id, action, payload = {}) {
    const character = this.characters.get(id); if (!character) return;
    if (action === 'inflate') character.inflate(payload.durationSeconds || payload.duration || 5);
    else if (action === 'jump_on') character.jump(payload.targetX ?? character.x, payload.targetY ?? character.y);
    else if (action === 'morph_fly') character.morphAndFly(payload.form || 'fly', payload.targetX ?? character.x, payload.targetY ?? Math.max(120, character.y - 150), payload.groundY);
    else if (action === 'bat') character.waveArms();
    else if (action === 'ghost') character.lookAt(-1, 0);
    for (const push of payload.pushes || []) this.setPosition(push.id, push.x, push.y, { immediate: false });
  }
  setSelected(id) { for (const [key, character] of this.characters) character.root.classList.toggle('is-selected', key === id); }
  sync(pumpkins = []) { const ids = new Set(pumpkins.map((p) => p.id)); for (const id of [...this.characters.keys()]) if (!ids.has(id)) this.remove(id, { animate: false }); pumpkins.forEach((pumpkin) => this.add(pumpkin, { immediate: true })); }
  destroy() { this.clear(); this.container?.classList.remove('pumpkin-layer'); }
}

import { PumpkinCharacter } from './pumpkin-character.js?v=hitbox-20261021';

const DEFAULT_TOWER_ANIMATION = Object.freeze({ swayAmplitude: 12, swayDuration: 2, rotationMultiplier: 1, bendMultiplier: 1 });

export class PumpkinRenderer {
  constructor(container, { interactive = false, onSelect = null, settings = null } = {}) {
    this.container = container; this.interactive = interactive; this.onSelect = onSelect; this.settings = settings || {}; this.characters = new Map(); this.sequence = new Map();
    this.container?.classList.add('pumpkin-layer'); this.towerTimers = new Set(); this.towerTweens = new Set(); this.towerMotion = null; this.towerParticipants = []; this.towerPayload = {}; this.towerSwayActive = false;
  }
  add(pumpkin, { immediate = true } = {}) {
    if (!pumpkin?.id) return null;
    if (this.characters.has(pumpkin.id)) return this.update(pumpkin, { immediate });
    const character = new PumpkinCharacter(pumpkin, { positioning: 'scene', interactive: this.interactive, animationSettings: this.settings.animation, growthMultipliers: this.settings.growthMultipliers, onPointerDown: (data, event) => this.onSelect?.(data.id, data, event) });
    this.characters.set(pumpkin.id, character); this.sequence.set(pumpkin.id, -1); this.container?.append(character.root); character.startIdle(); return character;
  }
  update(pumpkin, { immediate = false } = {}) {
    const character = this.characters.get(pumpkin?.id); if (!character) return this.add(pumpkin, { immediate: true });
    const previousStage = character.data.stage;
    character.data = { ...character.data, ...pumpkin, customization: pumpkin.customization || character.data.customization };
    if (pumpkin.customization) character.applyCustomization(pumpkin.customization);
    if (pumpkin.stage !== undefined && Number(pumpkin.stage) !== Number(previousStage)) character.evolve(pumpkin.stage);
    character.moveTo(pumpkin.x, pumpkin.y, { immediate, isAirborne: pumpkin.isAirborne }); return character;
  }
  setSettings(settings = {}) {
    const wasSwaying = this.towerSwayActive;
    const participants = this.towerParticipants;
    const payload = this.towerPayload;
    this.settings = { ...this.settings, ...settings, animation: { ...(this.settings.animation || {}), ...(settings.animation || {}) }, towerAnimation: { ...DEFAULT_TOWER_ANIMATION, ...(this.settings.towerAnimation || {}), ...(settings.towerAnimation || {}) }, growthMultipliers: { ...(this.settings.growthMultipliers || {}), ...(settings.growthMultipliers || {}) } };
    for (const character of this.characters.values()) { character.setAnimationSettings(this.settings.animation); character.setGrowthMultipliers(this.settings.growthMultipliers); character.restartIdle(); }
    if (wasSwaying) this.startTowerSway(participants, payload);
    return this;
  }
  setPosition(id, x, y, { immediate = false, isAirborne } = {}) { const character = this.characters.get(id); if (!character) return; character.moveTo(x, y, { immediate, isAirborne }); }
  applyMove(payload, { immediate = false } = {}) { if (!payload?.id) return; const next = Number(payload.sequence); const previous = this.sequence.get(payload.id) ?? -1; if (Number.isFinite(next) && next < previous) return; if (Number.isFinite(next)) this.sequence.set(payload.id, next); this.setPosition(payload.id, payload.x, payload.y, { immediate, isAirborne: payload.isAirborne }); }
  finishMove(payload) { if (!payload?.id) return; this.setPosition(payload.id, payload.x, payload.y, { immediate: false, isAirborne: payload.isAirborne }); this.sequence.set(payload.id, -1); }
  remove(id, { animate = true } = {}) { const character = this.characters.get(id); if (!character) return; this.stopActions(); this.characters.delete(id); this.sequence.delete(id); if (animate) character.disappear(() => character.destroy()); else character.destroy(); }
  clear() { this.stopActions(); for (const id of [...this.characters.keys()]) this.remove(id, { animate: false }); }
  stopTowerMotion() { for (const tween of this.towerTweens) tween.kill?.(); this.towerTweens.clear(); this.towerMotion = null; this.towerSwayActive = false; }
  stopActions() { for (const timer of this.towerTimers) clearTimeout(timer); this.towerTimers.clear(); this.stopTowerMotion(); for (const character of this.characters.values()) character.stopAction?.(); }
  startTowerSway(participants = [], payload = {}) {
    const gsap = globalThis.gsap || globalThis.window?.gsap;
    if (!gsap || !participants.length) return;
    this.stopTowerMotion();
    this.towerParticipants = participants;
    this.towerPayload = payload;
    this.towerSwayActive = true;
    const towerAnimation = { ...DEFAULT_TOWER_ANIMATION, ...(this.settings.towerAnimation || {}) };
    const amplitude = Math.max(0, Math.min(60, Number(towerAnimation.swayAmplitude) + Number(payload.sway || 0) * .4));
    const duration = Math.max(.1, Math.min(30, Number(towerAnimation.swayDuration) || DEFAULT_TOWER_ANIMATION.swayDuration));
    const rotationMultiplier = Math.max(0, Math.min(5, Number(towerAnimation.rotationMultiplier) || 0));
    const bendMultiplier = Math.max(0, Math.min(5, Number(towerAnimation.bendMultiplier) || 0));
    const motion = { angle: -amplitude };
    this.towerMotion = motion;
    const update = () => {
      let chainX = Number(participants[0]?.towerX) || 0;
      let previousAngle = 0;
      let previousCharacter = null;
      for (const item of participants) {
        const character = this.characters.get(item?.id);
        if (!character) continue;
        const level = Number.isFinite(Number(item?.level)) ? Number(item.level) : 0;
        const heightLevels = Math.max(1, participants.length - 1);
        const heightRatio = Math.max(0, Math.min(1, level / heightLevels));
        // A Disney-like squash-and-bend silhouette: the base stays planted while
        // each higher pumpkin follows a progressively wider arc.
        const bendFactor = Math.max(.08, Math.min(2.4, 0.16 + Math.pow(heightRatio, 1.28) * 0.84 * bendMultiplier));
        const localAngle = motion.angle * bendFactor;
        const visualAngle = localAngle * rotationMultiplier;
        if (previousCharacter) chainX += Math.sin(previousAngle * Math.PI / 180) * Math.max(18, (previousCharacter.stageSize || 220) * .5);
        // The next pumpkin is attached to the rotated lower pumpkin's visual
        // center, so the tower bends as a connected chain instead of sliding
        // every root independently around one global X coordinate.
        character.setTowerPose(chainX, item.towerY, localAngle, item.towerY, rotationMultiplier);
        previousAngle = visualAngle;
        previousCharacter = character;
      }
    };
    update();
    if (amplitude > 0) {
      const tween = gsap.to(motion, { angle: amplitude, duration, ease: 'sine.inOut', repeat: -1, yoyo: true, onUpdate: update });
      this.towerTweens.add(tween);
    }
  }
  stackPumpkins(participants = [], payload = {}) {
    this.stopActions();
    const count = participants.length;
    const finalById = new Map((payload.finalPumpkins || []).filter((pumpkin) => pumpkin?.id).map((pumpkin) => [pumpkin.id, pumpkin]));
    const sway = Number.isFinite(Number(payload.sway)) ? Number(payload.sway) : Math.min(22, 6 + count * 1.8);
    const direction = payload.direction === 'left' ? -1 : payload.direction === 'right' ? 1 : 0;
    for (const [index, item] of participants.entries()) {
      const character = this.characters.get(typeof item === 'string' ? item : item?.id);
      if (!character) continue;
      const final = finalById.get(character.data.id);
      const towerX = Number.isFinite(Number(item?.towerX)) ? Number(item.towerX) : Number(item?.position?.x);
      const towerY = Number.isFinite(Number(item?.towerY)) ? Number(item.towerY) : Number(item?.position?.y);
      character.data = { ...character.data, ...(final || {}), x: towerX, y: towerY, isAirborne: false, parentId: null, stackOffsetY: null };
      const delayMs = Number.isFinite(Number(item?.delayMs ?? item?.rollDelayMs)) ? Number(item?.delayMs ?? item?.rollDelayMs) : index * 180;
      character.stack?.(towerX, towerY, Number.isInteger(item?.level) ? item.level : index, count, {
          sway,
          direction,
          delay: delayMs / 1000,
          coordinated: true,
      });
    }
    const swayDelay = Math.max(1750, ...participants.map((item, index) => (Number(item?.delayMs ?? item?.rollDelayMs) || index * 180) + 1750));
    const timer = setTimeout(() => {
      this.towerTimers.delete(timer);
      this.startTowerSway(participants, payload);
    }, swayDelay);
    this.towerTimers.add(timer);
  }
  rollPumpkins(finalPumpkins = [], payload = {}) {
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    const delayFor = (item, index) => Number.isFinite(Number(item?.delayMs ?? item?.rollDelayMs)) ? Number(item?.delayMs ?? item?.rollDelayMs) : index * 180;
    const waitMs = Math.max(4400, ...participants.map((item, index) => delayFor(item, index) + 4400));
    const direction = payload.direction === 'left' ? -1 : 1;
    const participantDelays = new Map(participants.map((item, index) => [item?.id, delayFor(item, index)]));
    const timer = setTimeout(() => {
      this.towerTimers.delete(timer);
      this.stopTowerMotion();
      for (const [index, pumpkin] of finalPumpkins.entries()) {
        const delay = (participantDelays.get(pumpkin?.id) || index * 180) / 1000;
        this.characters.get(pumpkin?.id)?.rollTo?.(pumpkin.x, pumpkin.y, pumpkin, {
          direction,
          delay,
          groundY: Number.isFinite(Number(payload.groundY)) ? Number(payload.groundY) : 980,
        });
      }
    }, waitMs);
    this.towerTimers.add(timer);
  }
  action(id, action, payload = {}) {
    if (action === 'pumpkin_tower') {
      for (const pumpkin of payload.finalPumpkins || []) if (pumpkin?.id && !this.characters.has(pumpkin.id)) this.add(pumpkin, { immediate: true });
      this.stackPumpkins(payload.participants || [], payload);
      if (payload.mode === 'topple') this.rollPumpkins(payload.finalPumpkins || [], payload);
      return;
    }
    void id; void action; void payload;
  }
  setSelected(id) { for (const [key, character] of this.characters) character.root.classList.toggle('is-selected', key === id); }
  sync(pumpkins = []) { this.stopActions(); const ids = new Set(pumpkins.map((p) => p.id)); for (const id of [...this.characters.keys()]) if (!ids.has(id)) this.remove(id, { animate: false }); pumpkins.forEach((pumpkin) => this.add(pumpkin, { immediate: true })); }
  destroy() { this.clear(); this.container?.classList.remove('pumpkin-layer'); }
}

import { PumpkinCharacter } from './pumpkin-character.js?v=pumpkin-cartoon-squash-20261023';

const DEFAULT_TOWER_ANIMATION = Object.freeze({ swayAmplitude: 12, swayDuration: 2, rotationMultiplier: 1, bendMultiplier: 1, lifetimeMinSeconds: 3, lifetimeMaxSeconds: 6, stackOrder: 'random' });
const DEFAULT_PUMPKIN_NAME_FONT_SIZE = 14;
function normalizePumpkinNameFontSize(size) {
  const value = Number(size);
  return Number.isInteger(value) && value >= 8 && value <= 48 ? value : DEFAULT_PUMPKIN_NAME_FONT_SIZE;
}

export class PumpkinRenderer {
  constructor(container, { interactive = false, onSelect = null, settings = null } = {}) {
    this.container = container; this.interactive = interactive; this.onSelect = onSelect; this.settings = { showPumpkinNames: true, pumpkinNameFontSize: DEFAULT_PUMPKIN_NAME_FONT_SIZE, ...(settings || {}) }; this.settings.pumpkinNameFontSize = normalizePumpkinNameFontSize(this.settings.pumpkinNameFontSize); this.characters = new Map(); this.sequence = new Map();
    this.container?.classList.add('pumpkin-layer'); this.towerTimers = new Set(); this.towerTweens = new Set(); this.towerMotion = null; this.towerParticipants = []; this.towerPayload = {}; this.towerSwayActive = false; this.towerRoll = null; this.physicsFrame = null; this.lastPhysicsFrameTime = null;
  }
  add(pumpkin, { immediate = true } = {}) {
    if (!pumpkin?.id) return null;
    if (this.characters.has(pumpkin.id)) return this.update(pumpkin, { immediate });
    const character = new PumpkinCharacter(pumpkin, { positioning: 'scene', interactive: this.interactive, animationSettings: this.settings.animation, growthMultipliers: this.settings.growthMultipliers, showPumpkinNames: this.settings.showPumpkinNames, pumpkinNameFontSize: this.settings.pumpkinNameFontSize, onPointerDown: (data, event) => this.onSelect?.(data.id, data, event) });
    this.characters.set(pumpkin.id, character); this.sequence.set(pumpkin.id, -1); this.container?.append(character.root); character.startIdle();
    if (pumpkin.isAirborne) this.startPhysics(pumpkin.id);
    return character;
  }
  update(pumpkin, { immediate = false } = {}) {
    const character = this.characters.get(pumpkin?.id); if (!character) return this.add(pumpkin, { immediate: true });
    const previousStage = character.data.stage;
    character.data = { ...character.data, ...pumpkin, customization: pumpkin.customization || character.data.customization };
    character.setNameVisibility(this.settings.showPumpkinNames);
    if (pumpkin.customization) character.applyCustomization(pumpkin.customization);
    if (pumpkin.stage !== undefined && Number(pumpkin.stage) !== Number(previousStage)) character.evolve(pumpkin.stage);
    this.stopPhysics(pumpkin.id);
    character.moveTo(pumpkin.x, pumpkin.y, { immediate, isAirborne: pumpkin.isAirborne });
    if (pumpkin.isAirborne) this.startPhysics(pumpkin.id);
    return character;
  }
  setNameFontSize(size) {
    this.settings.pumpkinNameFontSize = normalizePumpkinNameFontSize(size);
    for (const character of this.characters.values()) character.setNameFontSize(this.settings.pumpkinNameFontSize);
    return this;
  }
  setSettings(settings = {}) {
    const wasSwaying = this.towerSwayActive;
    const participants = this.towerParticipants;
    const payload = this.towerPayload;
    this.settings = { ...this.settings, ...settings, animation: { ...(this.settings.animation || {}), ...(settings.animation || {}) }, towerAnimation: { ...DEFAULT_TOWER_ANIMATION, ...(this.settings.towerAnimation || {}), ...(settings.towerAnimation || {}) }, growthMultipliers: { ...(this.settings.growthMultipliers || {}), ...(settings.growthMultipliers || {}) }, pumpkinNameFontSize: normalizePumpkinNameFontSize(settings.pumpkinNameFontSize ?? this.settings.pumpkinNameFontSize) };
    for (const character of this.characters.values()) { character.setNameVisibility(this.settings.showPumpkinNames); character.setNameFontSize(this.settings.pumpkinNameFontSize); character.setAnimationSettings(this.settings.animation); character.setGrowthMultipliers(this.settings.growthMultipliers); character.restartIdle(); }
    if (wasSwaying) this.startTowerSway(participants, payload);
    if (this.towerRoll) this.scheduleTowerRoll();
    return this;
  }
  setPosition(id, x, y, { immediate = false, isAirborne, simulatePhysics = true, duration = 0.16, groundY } = {}) {
    const character = this.characters.get(id);
    if (!character) return;
    this.stopPhysics(id);
    const startPhysics = simulatePhysics && isAirborne;
    character.moveTo(x, y, { immediate: immediate || startPhysics, isAirborne, duration });
    if (startPhysics) this.startPhysics(id, { groundY });
  }
  applyMove(payload, { immediate = false } = {}) {
    if (!payload?.id) return;
    const next = Number(payload.sequence);
    const previous = this.sequence.get(payload.id) ?? -1;
    if (Number.isFinite(next) && next < previous) return;
    if (Number.isFinite(next)) this.sequence.set(payload.id, next);
    const durationMs = Number(payload.durationMs);
    const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0.16;
    if (!immediate && payload.isAirborne !== true && payload.movementType === 'roam') {
      const character = this.characters.get(payload.id);
      if (character?.hopTo) {
        this.stopPhysics(payload.id);
        character.hopTo(payload.x, payload.y, { speed: payload.roamingSpeed ?? this.settings.roamingSpeed });
        return;
      }
    }
    this.setPosition(payload.id, payload.x, payload.y, {
      immediate,
      isAirborne: payload.isAirborne,
      duration,
      groundY: payload.groundY,
    });
  }
  finishMove(payload) {
    if (!payload?.id) return;
    if (payload.isAirborne) {
      const character = this.characters.get(payload.id);
      const x = Number.isFinite(Number(payload.fromX)) ? Number(payload.fromX) : character?.x;
      const y = Number.isFinite(Number(payload.fromY)) ? Number(payload.fromY) : character?.y;
      this.setPosition(payload.id, x, y, { immediate: true, isAirborne: true, simulatePhysics: false });
      this.startPhysics(payload.id, { groundY: payload.groundY });
    } else {
      this.setPosition(payload.id, payload.x, payload.y, { immediate: true, isAirborne: false });
    }
    this.sequence.set(payload.id, -1);
  }
  startPhysics(id, options = {}) {
    const character = this.characters.get(id);
    if (!character?.startPhysics) return false;
    const requestedGroundY = options.groundY;
    const configuredGroundY = this.settings.groundY;
    const groundY = requestedGroundY != null && Number.isFinite(Number(requestedGroundY))
      ? Number(requestedGroundY)
      : configuredGroundY != null && Number.isFinite(Number(configuredGroundY)) ? Number(configuredGroundY) : 1080;
    const { groundY: _groundY, ...physicsOptions } = options;
    character.physicsGroundY = groundY;
    character.startPhysics({ ...physicsOptions, supportY: groundY });
    this._schedulePhysicsFrame();
    return true;
  }
  stopPhysics(id = null) {
    const characters = id === null
      ? this.characters.values()
      : [this.characters.get(id)].filter(Boolean);
    for (const character of characters) character.stopPhysics?.();
    if (![...this.characters.values()].some((character) => character.physicsActive)) this._cancelPhysicsFrame();
  }
  _schedulePhysicsFrame() {
    if (this.physicsFrame !== null) return;
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      throw new Error('requestAnimationFrame is required to run pumpkin physics');
    }
    this.physicsFrame = globalThis.requestAnimationFrame((timestamp) => this._advancePhysicsFrame(timestamp));
  }
  _advancePhysicsFrame(timestamp) {
    this.physicsFrame = null;
    const now = Number(timestamp);
    const elapsedSeconds = this.lastPhysicsFrameTime === null || !Number.isFinite(now)
      ? 0
      : Math.max(0, (now - this.lastPhysicsFrameTime) / 1000);
    this.lastPhysicsFrameTime = Number.isFinite(now) ? now : null;
    for (const character of this.characters.values()) {
      if (!character.physicsActive) continue;
      character.stepPhysics?.(elapsedSeconds, {
        groundY: character.physicsGroundY ?? character.supportY,
      });
    }
    if ([...this.characters.values()].some((character) => character.physicsActive)) this._schedulePhysicsFrame();
    else this.lastPhysicsFrameTime = null;
  }
  _cancelPhysicsFrame() {
    if (this.physicsFrame !== null) {
      globalThis.cancelAnimationFrame?.(this.physicsFrame);
      this.physicsFrame = null;
    }
    this.lastPhysicsFrameTime = null;
  }
  remove(id, { animate = true } = {}) { const character = this.characters.get(id); if (!character) return; this.stopActions(); this.characters.delete(id); this.sequence.delete(id); if (animate) character.disappear(() => character.destroy()); else character.destroy(); }
  clear() { this.stopActions(); for (const id of [...this.characters.keys()]) this.remove(id, { animate: false }); }
  stopTowerMotion() { for (const tween of this.towerTweens) tween.kill?.(); this.towerTweens.clear(); this.towerMotion = null; this.towerSwayActive = false; }
  stopActions() { for (const timer of this.towerTimers) clearTimeout(timer); this.towerTimers.clear(); this.towerRoll = null; this.stopTowerMotion(); this.stopPhysics(); for (const character of this.characters.values()) character.stopAction?.(); }
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
    const stackReadyAt = Date.now() + Math.max(0, ...participants.map((item, index) => delayFor(item, index) + 1380 + Math.min(220, index * 30)));
    this.towerRoll = { finalPumpkins, payload, participants, stackReadyAt };
    this.scheduleTowerRoll();
  }
  scheduleTowerRoll() {
    if (!this.towerRoll) return;
    const roll = this.towerRoll;
    if (roll.timer) {
      clearTimeout(roll.timer);
      this.towerTimers.delete(roll.timer);
    }
    const eventLifetime = Number(roll.payload.lifetimeSeconds);
    const minLifetime = Number(this.settings.towerAnimation?.lifetimeMinSeconds);
    const maxLifetime = Number(this.settings.towerAnimation?.lifetimeMaxSeconds);
    const lifetime = Number.isFinite(eventLifetime)
      ? eventLifetime
      : (Number.isFinite(minLifetime) && Number.isFinite(maxLifetime) ? (minLifetime + maxLifetime) / 2 : (DEFAULT_TOWER_ANIMATION.lifetimeMinSeconds + DEFAULT_TOWER_ANIMATION.lifetimeMaxSeconds) / 2);
    const deadline = roll.stackReadyAt + lifetime * 1000;
    const timer = setTimeout(() => {
      this.towerTimers.delete(timer);
      this.towerRoll = null;
      for (const pending of this.towerTimers) clearTimeout(pending);
      this.towerTimers.clear();
      this.stopTowerMotion();
      const direction = roll.payload.direction === 'left' ? -1 : 1;
      const participantDelays = new Map(roll.participants.map((item, index) => [item?.id, Number(item?.delayMs ?? item?.rollDelayMs) || index * 180]));
      for (const [index, pumpkin] of roll.finalPumpkins.entries()) {
        const delay = (participantDelays.get(pumpkin?.id) || index * 180) / 1000;
        this.characters.get(pumpkin?.id)?.rollTo?.(pumpkin.x, pumpkin.y, pumpkin, {
          direction,
          delay,
          groundY: Number.isFinite(Number(pumpkin.y)) ? Number(pumpkin.y) : Number.isFinite(Number(roll.payload.groundY)) ? Number(roll.payload.groundY) : 1080,
        });
      }
    }, Math.max(0, deadline - Date.now()));
    roll.timer = timer;
    this.towerTimers.add(timer);
  }
  action(id, action, payload = {}) {
    if (action === 'pumpkin_tower') {
      for (const pumpkin of payload.finalPumpkins || []) if (pumpkin?.id && !this.characters.has(pumpkin.id)) this.add(pumpkin, { immediate: true });
      this.stackPumpkins(payload.participants || [], payload);
      this.rollPumpkins(payload.finalPumpkins || [], payload);
      return;
    }
    void id; void action; void payload;
  }
  setSelected(id) { for (const [key, character] of this.characters) character.root.classList.toggle('is-selected', key === id); }
  sync(pumpkins = []) { this.stopActions(); const ids = new Set(pumpkins.map((p) => p.id)); for (const id of [...this.characters.keys()]) if (!ids.has(id)) this.remove(id, { animate: false }); pumpkins.forEach((pumpkin) => this.add(pumpkin, { immediate: true })); }
  destroy() { this.clear(); this.container?.classList.remove('pumpkin-layer'); }
}

import { PumpkinCharacter } from './pumpkin-character.js?v=twitch-customization-20261025';
import { WitchAssistant } from './witch-assistant.js?v=twitch-customization-20261025';
import { LeafParticleSystem, DEFAULT_LANDING_PARTICLES, sanitizeLandingParticles } from './leaf-particles.js?v=twitch-customization-20261025';

const DEFAULT_TOWER_ANIMATION = Object.freeze({ swayAmplitude: 12, swayDuration: 2, rotationMultiplier: 1, bendMultiplier: 1, lifetimeMinSeconds: 3, lifetimeMaxSeconds: 6, stackOrder: 'random' });
const DEFAULT_NEIGHBOR_STACK_ANIMATION = Object.freeze({ swayAmplitude: 12, swayDuration: 2, rotationMultiplier: 1, bendMultiplier: 1, lifetimeMinSeconds: 30, lifetimeMaxSeconds: 300 });
const DEFAULT_PUMPKIN_NAME_FONT_SIZE = 14;
const DEPTH_SORT_INTERVAL_MS = 3000;
export function joinedStackSwayAmplitude(baseAmplitude, memberCount) {
  const base = Number(baseAmplitude);
  const count = Number(memberCount);
  return Math.max(0, Math.min(60, (Number.isFinite(base) ? base : 0) * Math.max(1, (Number.isFinite(count) ? count : 1) - 1)));
}
function normalizePumpkinNameFontSize(size) {
  const value = Number(size);
  return Number.isInteger(value) && value >= 8 && value <= 48 ? value : DEFAULT_PUMPKIN_NAME_FONT_SIZE;
}

function hasVisualCustomizationChange(prev = {}, next = {}) {
  const slots = ['eyes', 'mouth', 'hat', 'prop', 'skin'];
  return slots.some((slot) => next[slot] !== undefined && next[slot] !== prev[slot]);
}

export class PumpkinRenderer {
  constructor(container, { interactive = false, onSelect = null, settings = null, enableWitch = true } = {}) {
    this.container = container; this.interactive = interactive; this.onSelect = onSelect; this.settings = { showPumpkinNames: true, pumpkinNameFontSize: DEFAULT_PUMPKIN_NAME_FONT_SIZE, landingParticles: { ...DEFAULT_LANDING_PARTICLES }, ...(settings || {}) }; this.settings.pumpkinNameFontSize = normalizePumpkinNameFontSize(this.settings.pumpkinNameFontSize); this.settings.landingParticles = sanitizeLandingParticles(this.settings.landingParticles); this.characters = new Map(); this.sequence = new Map();
    this.container?.classList.add('pumpkin-layer'); this.towerTimers = new Set(); this.towerTweens = new Set(); this.towerMotion = null; this.towerParticipants = []; this.towerPayload = {}; this.towerSwayActive = false; this.towerRoll = null; this.physicsFrame = null; this.lastPhysicsFrameTime = null; this.depthSortTimer = null; this.towerDepthLevels = new Map(); this.towerDepthBaseY = null; this.joinedStackRecords = new Map(); this.joinedStackTweens = new Map(); this.joinedStackMoveTweens = new Map(); this.joinedStackTimers = new Map(); this.joinedStackMembers = new Map(); this.movingCharacters = new Map(); this.moveOrder = 0;
    this.witchAssistant = enableWitch && typeof document !== 'undefined' && container && typeof container.append === 'function'
      ? new WitchAssistant(container, { screenWidth: 1920 })
      : null;
    this.leafParticles = typeof document !== 'undefined' && container && typeof container.append === 'function'
      ? new LeafParticleSystem(container)
      : null;
  }
  add(pumpkin, { immediate = true } = {}) {
    if (!pumpkin?.id) return null;
    if (this.characters.has(pumpkin.id)) return this.update(pumpkin, { immediate });
    const isSpawning = !immediate && Boolean(this.witchAssistant);
    const character = new PumpkinCharacter(pumpkin, {
      positioning: 'scene',
      interactive: this.interactive,
      animationSettings: this.settings.animation,
      growthMultipliers: this.settings.growthMultipliers,
      showPumpkinNames: this.settings.showPumpkinNames,
      pumpkinNameFontSize: this.settings.pumpkinNameFontSize,
      onPointerDown: (data, event) => this.onSelect?.(data.id, data, event),
      onLand: (char) => this.onPumpkinLand(char),
      isSpawning,
    });
    this.characters.set(pumpkin.id, character); this.sequence.set(pumpkin.id, -1); this.container?.append(character.root);
    this._startDepthSorting();

    if (isSpawning) {
      if (character.root?.style) {
        character.root.style.opacity = '0';
        character.root.style.visibility = 'hidden';
        character.root.style.pointerEvents = 'none';
      }
      this.witchAssistant.queueSpawnMission({
        pumpkinCharacter: character,
        targetX: pumpkin.x,
        targetY: pumpkin.y,
        groundY: this.settings.groundY || 1080,
        onSpawnLeafDrift: (x, y) => {
          this.spawnLeafDrift(x, y, {
            stageScale: character.stageScale || 1,
            stageSize: character.stageSize || (220 * (character.stageScale || 1)),
          });
        },
        onRevealPumpkin: () => {
          if (!this.characters.has(pumpkin.id)) return;
          character.isSpawning = false;
          if (character.root?.style) {
            character.root.style.visibility = 'visible';
            character.root.style.pointerEvents = '';
          }
          if (typeof character.appear === 'function') {
            character.appear(() => {
              character.startIdle();
            });
          } else {
            if (character.root?.style) character.root.style.opacity = '1';
            character.startIdle();
          }
          if (pumpkin.isAirborne) this.startPhysics(pumpkin.id);
        },
      });
    } else {
      character.isSpawning = false;
      character.startIdle();
      if (pumpkin.isAirborne) this.startPhysics(pumpkin.id);
    }
    return character;
  }
  update(pumpkin, { immediate = false } = {}) {
    const character = this.characters.get(pumpkin?.id); if (!character) return this.add(pumpkin, { immediate: true });
    const previousStage = character.data.stage;
    const previousCustomization = { ...(character.data.customization || {}) };
    const nextCustomization = pumpkin.customization ? { ...pumpkin.customization } : previousCustomization;
    character.data = { ...character.data, ...pumpkin, customization: nextCustomization };
    character.setNameVisibility(this.settings.showPumpkinNames);

    const customizationChanged = Boolean(pumpkin.customization) && hasVisualCustomizationChange(previousCustomization, nextCustomization);

    if (customizationChanged && !immediate && !character.isSpawning && this.witchAssistant) {
      this.witchAssistant.queueMission({
        pumpkinCharacter: character,
        targetCustomization: nextCustomization,
        groundY: this.settings.groundY || 1080,
        onApply: () => {
          if (this.characters.has(character.data?.id)) {
            character.applyCustomization(nextCustomization);
          }
        },
      });
    } else if (pumpkin.customization) {
      character.applyCustomization(nextCustomization);
    }

    if (pumpkin.stage !== undefined && Number(pumpkin.stage) !== Number(previousStage)) character.evolve(pumpkin.stage);
    this.stopPhysics(pumpkin.id);
    if (!immediate && !character.isSpawning) this._bringToFront(pumpkin.id);
    character.moveTo(pumpkin.x, pumpkin.y, { immediate: immediate || character.isSpawning, isAirborne: pumpkin.isAirborne });
    if (pumpkin.isAirborne && !character.isSpawning) this.startPhysics(pumpkin.id);
    return character;
  }
  setNameFontSize(size) {
    this.settings.pumpkinNameFontSize = normalizePumpkinNameFontSize(size);
    for (const character of this.characters.values()) character.setNameFontSize(this.settings.pumpkinNameFontSize);
    return this;
  }
  onPumpkinLand(character) {
    if (!character || this.settings?.landingParticles?.enabled === false) return;
    this.spawnLeafBurst(character.x, character.y, {
      stageScale: character.stageScale || 1,
    });
  }
  spawnLeafBurst(x, y, options = {}) {
    if (this.settings?.landingParticles?.enabled === false && !options.force) return;
    const config = {
      ...this.settings?.landingParticles,
      ...options,
    };
    this.leafParticles?.spawnBurst(x, y, config);
  }
  spawnLeafDrift(x, y, options = {}) {
    if (this.settings?.landingParticles?.enabled === false && !options.force) return;
    const config = {
      ...this.settings?.landingParticles,
      ...options,
    };
    this.leafParticles?.spawnDrift(x, y, config);
  }
  setSettings(settings = {}) {
    const wasSwaying = this.towerSwayActive;
    const participants = this.towerParticipants;
    const payload = this.towerPayload;
    this.settings = { ...this.settings, ...settings, animation: { ...(this.settings.animation || {}), ...(settings.animation || {}) }, towerAnimation: { ...DEFAULT_TOWER_ANIMATION, ...(this.settings.towerAnimation || {}), ...(settings.towerAnimation || {}) }, neighborStackAnimation: { ...DEFAULT_NEIGHBOR_STACK_ANIMATION, ...(this.settings.neighborStackAnimation || {}), ...(settings.neighborStackAnimation || {}) }, landingParticles: sanitizeLandingParticles(settings.landingParticles ?? this.settings.landingParticles), growthMultipliers: { ...(this.settings.growthMultipliers || {}), ...(settings.growthMultipliers || {}) }, pumpkinNameFontSize: normalizePumpkinNameFontSize(settings.pumpkinNameFontSize ?? this.settings.pumpkinNameFontSize) };
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
    if (!immediate) this._bringToFront(id, duration * 1000 + DEPTH_SORT_INTERVAL_MS);
    character.moveTo(x, y, { immediate: immediate || startPhysics, isAirborne, duration });
    if (startPhysics) this.startPhysics(id, { groundY });
  }
  applyMove(payload, { immediate = false } = {}) {
    if (!payload?.id) return;
    const character = this.characters.get(payload.id);
    if (character?.isSpawning) {
      character.x = Number.isFinite(Number(payload.x)) ? Number(payload.x) : character.x;
      character.y = Number.isFinite(Number(payload.y)) ? Number(payload.y) : character.y;
      character.setPositionImmediate(character.x, character.y, Boolean(payload.isAirborne));
      if (character.root?.style) {
        character.root.style.opacity = '0';
        character.root.style.visibility = 'hidden';
      }
      return;
    }
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
        const speed = Number(payload.roamingSpeed ?? this.settings.roamingSpeed);
        const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 140;
        const distance = Math.hypot(Number(payload.x) - character.x, Number(payload.y) - character.y);
        this._bringToFront(payload.id, distance / safeSpeed * 1000 + DEPTH_SORT_INTERVAL_MS);
        character.hopTo(payload.x, payload.y, { speed: payload.roamingSpeed ?? this.settings.roamingSpeed, height: payload.roamingJumpHeight ?? this.settings.roamingJumpHeight });
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
    this._bringToFront(id);
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
  remove(id, { animate = true } = {}) { const character = this.characters.get(id); if (!character) return; this.witchAssistant?.cancelMissionsForCharacter?.(character); this.stopActions(); const joined = this.joinedStackMembers.get(id); if (joined) this._stopNeighborStack(joined.stackId); this.characters.delete(id); this.sequence.delete(id); this.towerDepthLevels.delete(id); this.movingCharacters.delete(id); if (animate) character.disappear(() => character.destroy()); else character.destroy(); if (this.characters.size < 2) this._stopDepthSorting(); else this._sortCharactersByDepth(); }
  clear() { this.stopActions(); this._stopAllNeighborStacks(); this._stopDepthSorting(); this.movingCharacters.clear(); this.leafParticles?.clear(); for (const id of [...this.characters.keys()]) this.remove(id, { animate: false }); }
  stopTowerMotion() { for (const tween of this.towerTweens) tween.kill?.(); this.towerTweens.clear(); this.towerMotion = null; this.towerSwayActive = false; }
  stopActions() { for (const timer of this.towerTimers) clearTimeout(timer); this.towerTimers.clear(); this.towerRoll = null; this.stopTowerMotion(); this.stopPhysics(); this.leafParticles?.clear(); for (const character of this.characters.values()) character.stopAction?.(); }
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
  _trackJoinedStack(stackId, participants) {
    const baseY = Math.max(...participants.map((item) => Number(item.y) || 0));
    for (const item of participants) {
      this.joinedStackMembers.set(item.id, { stackId, level: item.level, baseY });
    }
  }
  _stopNeighborStack(stackId) {
    this.joinedStackTweens.get(stackId)?.kill?.();
    this.joinedStackTweens.delete(stackId);
    this.joinedStackMoveTweens.get(stackId)?.kill?.();
    this.joinedStackMoveTweens.delete(stackId);
    const timer = this.joinedStackTimers.get(stackId);
    if (timer) clearTimeout(timer);
    this.joinedStackTimers.delete(stackId);
    const stack = this.joinedStackRecords.get(stackId);
    for (const item of stack?.participants || []) this.joinedStackMembers.delete(item.id);
    this.joinedStackRecords.delete(stackId);
    this._sortCharactersByDepth();
  }
  _stopAllNeighborStacks() {
    for (const stackId of [...this.joinedStackRecords.keys()]) this._stopNeighborStack(stackId);
  }
  startNeighborStackSway(stackId, stack = this.joinedStackRecords.get(stackId)) {
    if (!stack?.participants?.length) return;
    const gsap = globalThis.gsap || globalThis.window?.gsap;
    this.joinedStackTweens.get(stackId)?.kill?.();
    this.joinedStackTweens.delete(stackId);
    const animation = { ...DEFAULT_NEIGHBOR_STACK_ANIMATION, ...(stack.animation || {}) };
    const amplitude = joinedStackSwayAmplitude(animation.swayAmplitude, stack.participants.length);
    const duration = Math.max(.1, Math.min(30, Number(animation.swayDuration) || DEFAULT_NEIGHBOR_STACK_ANIMATION.swayDuration));
    const rotationMultiplier = Math.max(0, Math.min(5, Number(animation.rotationMultiplier) || 0));
    const bendMultiplier = Math.max(0, Math.min(5, Number(animation.bendMultiplier) || 0));
    const motion = { angle: -amplitude };
    const update = () => {
      stack.swayAngle = motion.angle;
      this._applyNeighborStackPose(stack, motion.angle);
    };
    this._trackJoinedStack(stackId, stack.participants);
    update();
    if (gsap && amplitude > 0) {
      const tween = gsap.to(motion, { angle: amplitude, duration, ease: 'sine.inOut', repeat: -1, yoyo: true, onUpdate: update });
      this.joinedStackTweens.set(stackId, tween);
    }
  }
  _applyNeighborStackPose(stack, angle) {
    const animation = { ...DEFAULT_NEIGHBOR_STACK_ANIMATION, ...(stack.animation || {}) };
    const rotationMultiplier = Math.max(0, Math.min(5, Number(animation.rotationMultiplier) || 0));
    const bendMultiplier = Math.max(0, Math.min(5, Number(animation.bendMultiplier) || 0));
    let chainX = (Number(stack.participants[0]?.x) || 0) + (Number(stack.roamingOffsetX) || 0);
    let previousAngle = 0;
    let previousCharacter = null;
    for (const item of stack.participants) {
      const character = this.characters.get(item.id);
      if (!character) continue;
      const level = Number(item.level) || 0;
      const ratio = stack.participants.length > 1 ? level / (stack.participants.length - 1) : 0;
      const y = item.y + (Number(stack.roamingOffsetY) || 0);
      const bendFactor = Math.max(.08, Math.min(2.4, .16 + Math.pow(ratio, 1.28) * .84 * bendMultiplier));
      const localAngle = angle * bendFactor;
      const visualAngle = localAngle * rotationMultiplier;
      if (previousCharacter) chainX += Math.sin(previousAngle * Math.PI / 180) * Math.max(18, (previousCharacter.stageSize || 220) * .5);
      character.setTowerPose?.(chainX, y, localAngle, y, rotationMultiplier);
      previousAngle = visualAngle;
      previousCharacter = character;
    }
  }
  moveNeighborStack(payload = {}) {
    const stack = this.joinedStackRecords.get(payload.stackId);
    if (!stack || !Array.isArray(payload.members) || payload.members.length !== stack.participants.length) return false;
    const nextById = new Map(payload.members.map((member) => [member.id, member]));
    if (stack.participants.some((member) => !nextById.has(member.id))) return false;
    const base = stack.participants[0];
    const currentX = base.x + (Number(stack.roamingOffsetX) || 0);
    stack.participants = stack.participants.map((member) => {
      const next = nextById.get(member.id);
      const character = this.characters.get(member.id);
      if (character) character.data = { ...character.data, x: next.x, y: next.y };
      return { ...member, x: next.x, y: next.y };
    });
    const destinationX = stack.participants[0].x;
    const distance = Math.abs(destinationX - currentX);
    const speed = Number(payload.roamingSpeed);
    const duration = distance / (Number.isFinite(speed) && speed > 0 ? speed : 140);
    stack.roamingOffsetX = currentX - destinationX;
    stack.roamingOffsetY = 0;
    for (const member of stack.participants) this._bringToFront(member.id, duration * 1000 + DEPTH_SORT_INTERVAL_MS);

    this.joinedStackMoveTweens.get(stack.stackId)?.kill?.();
    this.joinedStackMoveTweens.delete(stack.stackId);
    const gsap = globalThis.gsap || globalThis.window?.gsap;
    if (!gsap || duration <= 0) {
      stack.roamingOffsetX = 0;
      stack.roamingOffsetY = 0;
      this._applyNeighborStackPose(stack, Number(stack.swayAngle) || 0);
      const baseCharacter = this.characters.get(base.id);
      if (baseCharacter) {
        if (typeof baseCharacter._triggerLanding === 'function') {
          baseCharacter._triggerLanding();
        } else {
          this.onPumpkinLand(baseCharacter);
        }
      }
      return true;
    }
    const motion = { progress: 0 };
    const jumpHeight = Math.max(36, (this.characters.get(base.id)?.stageSize || 220) * .42);
    const tween = gsap.to(motion, {
      progress: 1,
      duration,
      ease: 'none',
      onUpdate: () => {
        stack.roamingOffsetX = (currentX - destinationX) * (1 - motion.progress);
        stack.roamingOffsetY = -4 * jumpHeight * motion.progress * (1 - motion.progress);
        this._applyNeighborStackPose(stack, Number(stack.swayAngle) || 0);
      },
      onComplete: () => {
        stack.roamingOffsetX = 0;
        stack.roamingOffsetY = 0;
        this.joinedStackMoveTweens.delete(stack.stackId);
        this._applyNeighborStackPose(stack, Number(stack.swayAngle) || 0);
        const baseCharacter = this.characters.get(base.id);
        if (baseCharacter) {
          if (baseCharacter.actor && typeof gsap.fromTo === 'function') {
            gsap.fromTo(baseCharacter.actor,
              { scaleX: 1.1, scaleY: 0.9 },
              { scaleX: 1, scaleY: 1, duration: 0.2, ease: 'back.out(1.5)' }
            );
          }
          if (typeof baseCharacter._triggerLanding === 'function') {
            baseCharacter._triggerLanding();
          } else {
            this.onPumpkinLand(baseCharacter);
          }
        }
      },
    });
    this.joinedStackMoveTweens.set(stack.stackId, tween);
    return true;
  }
  formNeighborStack(payload = {}) {
    const stackId = payload.stackId;
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    if (!stackId || participants.length < 2 || participants.length > 3) return false;
    this._stopNeighborStack(stackId);
    const stack = { ...payload, participants, phase: 'active' };
    this.joinedStackRecords.set(stackId, stack);
    let completed = 0;
    const visible = participants.filter((item) => this.characters.has(item.id));
    if (visible.length !== participants.length) return false;
    const startSway = () => {
      completed += 1;
      if (completed === participants.length) this.startNeighborStackSway(stackId, stack);
    };
    for (const item of participants) {
      const character = this.characters.get(item.id);
      this._bringToFront(item.id, (Number(item.level) * 210 + 1380));
      character.stack?.(item.x, item.y, item.level, participants.length, {
        sway: 0,
        delay: Number(item.level) * .21,
        coordinated: true,
        onComplete: startSway,
      });
      if (!character.stack) {
        character.setPositionImmediate?.(item.x, item.y, false);
        if (Number(item.level) === 0) {
          if (typeof character._triggerLanding === 'function') {
            character._triggerLanding();
          } else {
            this.onPumpkinLand(character);
          }
        }
        startSway();
      }
    }
    this._trackJoinedStack(stackId, participants);
    return true;
  }
  restoreNeighborStack(snapshot = {}) {
    const stackId = snapshot.stackId;
    const participants = snapshot.participants || snapshot.members;
    if (!stackId || !Array.isArray(participants) || participants.length < 2 || participants.length > 3) return false;
    this._stopNeighborStack(stackId);
    const stack = { ...snapshot, participants };
    this.joinedStackRecords.set(stackId, stack);
    for (const item of participants) {
      const character = this.characters.get(item.id);
      if (!character) return false;
      character.data = { ...character.data, x: item.x, y: item.y, isAirborne: false };
      character.setPositionImmediate?.(item.x, item.y, false);
      this._trackJoinedStack(stackId, participants);
    }
    const remaining = Date.parse(snapshot.formedAt) - Date.now();
    if (Number.isFinite(remaining) && remaining > 0) {
      const timer = setTimeout(() => {
        this.joinedStackTimers.delete(stackId);
        this.startNeighborStackSway(stackId, stack);
      }, remaining);
      this.joinedStackTimers.set(stackId, timer);
    } else {
      this.startNeighborStackSway(stackId, stack);
    }
    return true;
  }
  restoreJoinedStacks(stacks = []) {
    for (const stack of stacks) this.restoreNeighborStack(stack);
  }
  collapseNeighborStack(payload = {}) {
    const stackId = payload.stackId;
    if (!stackId) return false;
    this._stopNeighborStack(stackId);
    const finalById = new Map((payload.finalPositions || []).filter((position) => position?.id).map((position) => [position.id, position]));
    for (const item of payload.participants || []) {
      const character = this.characters.get(item.id);
      const final = finalById.get(item.id);
      if (!character || !final) continue;
      this._bringToFront(item.id, 1800);
      const settledData = { ...character.data, ...final, isAirborne: false, parentId: null, stackOffsetY: null };
      const settleAtFinalPosition = () => {
        character.setPositionImmediate?.(final.x, final.y, false);
        character.data = { ...character.data, ...settledData };
      };
      if (typeof character.rollTo === 'function') {
        character.rollTo(final.x, final.y, settledData, {
          groundY: final.y,
          onComplete: settleAtFinalPosition,
        });
      } else {
        settleAtFinalPosition();
      }
    }
    return true;
  }
  stackPumpkins(participants = [], payload = {}) {
    this.stopActions();
    const count = participants.length;
    const finalById = new Map((payload.finalPumpkins || []).filter((pumpkin) => pumpkin?.id).map((pumpkin) => [pumpkin.id, pumpkin]));
    const sway = Number.isFinite(Number(payload.sway)) ? Number(payload.sway) : Math.min(22, 6 + count * 1.8);
    const direction = payload.direction === 'left' ? -1 : payload.direction === 'right' ? 1 : 0;
    this.towerDepthLevels.clear();
    const baseYs = participants.map((item) => Number(item?.towerY ?? item?.position?.y)).filter(Number.isFinite);
    this.towerDepthBaseY = baseYs.length ? Math.max(...baseYs) : null;
    for (const [index, item] of participants.entries()) {
      const character = this.characters.get(typeof item === 'string' ? item : item?.id);
      if (!character) continue;
      const level = Number.isInteger(item?.level) ? item.level : index;
      this.towerDepthLevels.set(character.data.id, level);
      const final = finalById.get(character.data.id);
      const towerX = Number.isFinite(Number(item?.towerX)) ? Number(item.towerX) : Number(item?.position?.x);
      const towerY = Number.isFinite(Number(item?.towerY)) ? Number(item.towerY) : Number(item?.position?.y);
      character.data = { ...character.data, ...(final || {}), x: towerX, y: towerY, isAirborne: false, parentId: null, stackOffsetY: null };
      const delayMs = Number.isFinite(Number(item?.delayMs ?? item?.rollDelayMs)) ? Number(item?.delayMs ?? item?.rollDelayMs) : index * 180;
      character.stack?.(towerX, towerY, level, count, {
          sway,
          direction,
          delay: delayMs / 1000,
          coordinated: true,
      });
    }
    this._sortCharactersByDepth();
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
      this.towerDepthLevels.clear();
      this.towerDepthBaseY = null;
      this._sortCharactersByDepth();
      const direction = roll.payload.direction === 'left' ? -1 : 1;
      const participantDelays = new Map(roll.participants.map((item, index) => [item?.id, Number(item?.delayMs ?? item?.rollDelayMs) || index * 180]));
      for (const [index, pumpkin] of roll.finalPumpkins.entries()) {
        const delay = (participantDelays.get(pumpkin?.id) || index * 180) / 1000;
        const character = this.characters.get(pumpkin?.id);
        this._bringToFront(pumpkin?.id, (delay + 2.6) * 1000);
        character?.rollTo?.(pumpkin.x, pumpkin.y, pumpkin, {
          direction,
          delay,
          groundY: Number.isFinite(Number(pumpkin.y)) ? Number(pumpkin.y) : Number.isFinite(Number(roll.payload.groundY)) ? Number(roll.payload.groundY) : 1080,
        });
      }
    }, Math.max(0, deadline - Date.now()));
    roll.timer = timer;
    this.towerTimers.add(timer);
  }
  _startDepthSorting() {
    if (this.depthSortTimer !== null || this.characters.size < 2) return;
    this.depthSortTimer = setInterval(() => this._sortCharactersByDepth(), DEPTH_SORT_INTERVAL_MS);
  }
  _stopDepthSorting() {
    if (this.depthSortTimer === null) return;
    clearInterval(this.depthSortTimer);
    this.depthSortTimer = null;
  }
  _bringToFront(id, durationMs = 0) {
    const character = this.characters.get(id);
    if (!character) return;
    const zIndices = [...this.characters.values()].map((item) => Number(item.root?.style?.zIndex) || 0);
    if (character.root?.style) character.root.style.zIndex = String(Math.max(0, ...zIndices) + 1);
    this.movingCharacters.set(id, {
      until: Date.now() + Math.max(DEPTH_SORT_INTERVAL_MS, Number(durationMs) || 0),
      order: ++this.moveOrder,
    });
  }
  _sortCharactersByDepth() {
    const entries = [];
    const tower = [];
    const joinedStacks = new Map();
    const moving = [];
    for (const [id, character] of this.characters) {
      const movement = this.movingCharacters.get(id);
      if (character.physicsActive || (movement && movement.until > Date.now())) {
        moving.push({ id, character, order: movement?.order || 0 });
        continue;
      }
      this.movingCharacters.delete(id);
      if (this.towerDepthLevels.has(id)) {
        tower.push({ id, character, level: this.towerDepthLevels.get(id) });
      } else if (this.joinedStackMembers.has(id)) {
        const member = this.joinedStackMembers.get(id);
        if (!joinedStacks.has(member.stackId)) joinedStacks.set(member.stackId, { y: member.baseY, characters: [] });
        joinedStacks.get(member.stackId).characters.push({ id, character, level: member.level });
      } else {
        entries.push({ y: Number(character.y) || 0, order: entries.length, characters: [{ id, character }] });
      }
    }
    if (tower.length) {
      entries.push({
        y: Number.isFinite(this.towerDepthBaseY) ? this.towerDepthBaseY : Math.max(...tower.map(({ character }) => Number(character.y) || 0)),
        order: entries.length,
        characters: tower.sort((a, b) => a.level - b.level),
      });
    }
    for (const group of joinedStacks.values()) {
      entries.push({
        y: group.y,
        order: entries.length,
        characters: group.characters.sort((a, b) => a.level - b.level),
      });
    }
    entries.sort((a, b) => a.y - b.y || a.order - b.order);
    let zIndex = 1;
    const orderedCharacters = entries.flatMap(({ characters }) => characters);
    orderedCharacters.push(...moving.sort((a, b) => a.order - b.order));
    for (const { character } of orderedCharacters) {
      if (character.root?.style) character.root.style.zIndex = String(zIndex);
      zIndex += 1;
    }
  }
  action(id, action, payload = {}) {
    if (action === 'pumpkin_tower') {
      for (const pumpkin of payload.finalPumpkins || []) if (pumpkin?.id && !this.characters.has(pumpkin.id)) this.add(pumpkin, { immediate: true });
      this.stackPumpkins(payload.participants || [], payload);
      this.rollPumpkins(payload.finalPumpkins || [], payload);
      return;
    }
    if (action === 'neighbor_stack') {
      if (payload.phase === 'form') this.formNeighborStack(payload);
      else if (payload.phase === 'collapse') this.collapseNeighborStack(payload);
      return;
    }
    void id; void action; void payload;
  }
  setSelected(id) { for (const [key, character] of this.characters) character.root.classList.toggle('is-selected', key === id); }
  sync(pumpkins = [], joinedStacks = []) { this.stopActions(); this._stopAllNeighborStacks(); const ids = new Set(pumpkins.map((p) => p.id)); for (const id of [...this.characters.keys()]) if (!ids.has(id)) this.remove(id, { animate: false }); pumpkins.forEach((pumpkin) => this.add(pumpkin, { immediate: true })); this.restoreJoinedStacks(joinedStacks); }
  destroy() { this.witchAssistant?.destroy(); this.leafParticles?.destroy(); this.clear(); this.container?.classList.remove('pumpkin-layer'); }
}

import { createPumpkinSvg, normalizeCustomization, normalizeGrowthMultipliers, REFERENCE_DISPLAY_SIZE, STAGE_SCALES } from './pumpkin-svg.js?v=cocoa-hands-bend-20261024';
import { COCOA_HANDS_PATHS_REST, getBentCocoaPaths } from './cocoa-hands-paths.js?v=cocoa-hands-bend-20261024';

const getGsap = () => globalThis.gsap || globalThis.window?.gsap || null;
const wait = (fn, ms) => setTimeout(fn, ms);
const randomBetween = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SCENE_WIDTH = 1920;
const SCENE_HEIGHT = 1080;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const REFERENCE_VIEWBOX = 1095;
const DEFAULT_NAME_FONT_SIZE = 14;
const REFERENCE_FACE_ORIGIN = '548 665';
const REFERENCE_BODY_ORIGIN = '548 1035';
const COCOA_HANDS_CUP_ORIGIN = '548 790';
const STAGE_ONE_SPROUT_ORIGIN = '1400 635';
const STAGE_ONE_LEFT_LEAF_ORIGIN = '1300 430';
const STAGE_ONE_RIGHT_LEAF_ORIGIN = '1535 430';
const STAGE_TWO_PLANT_ORIGIN = '548 620';
const BLINK_DELAY_MIN = 9000;
const BLINK_DELAY_MAX = 18000;
const ANIMATION_FREQUENCY_MIN = 0.1;
const ANIMATION_FREQUENCY_MAX = 10;
const PHYSICS_STEP_SECONDS = 1 / 60;
const PHYSICS_MAX_FRAME_SECONDS = 0.05;
const PHYSICS_GRAVITY = 1800;
const DEFAULT_ANIMATION = Object.freeze({ eyeFrequency: 1, mouthFrequency: 1 });

/** One independently animated pumpkin. Positioning lives on .mover; idle body motion is below the inert .floater wrapper. */
export class PumpkinCharacter {
  constructor(pumpkin, { interactive = false, onPointerDown = null, positioning = 'scene', animationSettings = null, previewSize = null, growthMultipliers = null, showPumpkinNames = true, pumpkinNameFontSize = DEFAULT_NAME_FONT_SIZE } = {}) {
    this.positioning = positioning;
    this.previewSize = Number.isFinite(Number(previewSize)) ? Number(previewSize) : null;
    this.animationSettings = { ...DEFAULT_ANIMATION, ...(animationSettings || {}) };
    this.growthMultipliers = normalizeGrowthMultipliers(growthMultipliers || {});
    this.showPumpkinNames = showPumpkinNames !== false;
    this.pumpkinNameFontSize = this._normalizeNameFontSize(pumpkinNameFontSize);
    this.data = { ...pumpkin, customization: normalizeCustomization(pumpkin.customization) };
    this.root = createPumpkinSvg(this.data);
    this.nameLabel = null;
    this.nameLabelName = null;
    this.root.classList.toggle('is-interactive', interactive);
    this.root.addEventListener('pointerdown', (event) => onPointerDown?.(this.data, event));

    this._bindLayers();
    this.root.addEventListener('stage-one-art-ready', () => {
      if (this.destroyed || !this.idleStarted) return;
      this._bindLayers();
      this._scheduleStageOneCozy();
    });
    this.root.addEventListener('stage-two-art-ready', () => {
      if (this.destroyed || !this.idleStarted) return;
      this._bindLayers();
      this._scheduleStageTwoPlantSway();
    });
    this.x = Number(this.data.x) || 0;
    this.y = Number.isFinite(Number(this.data.y)) ? Number(this.data.y) : SCENE_HEIGHT;
    this.isAirborne = Boolean(this.data.isAirborne);
    this.velocity = { x: 0, y: 0 };
    this.supportY = this.y;
    this.physicsAccumulator = 0;
    this.physicsActive = false;
    this.destroyed = false;
    this.idleStarted = false;
    this.idleTimers = new Set();
    this.tweens = new Set();
    this.idleTweens = new Set();
    this.actionTweens = new Set();
    this.lastMoveSequence = -1;

    this._applyStageGeometry(this.data.stage);
    this._refreshNameLabel();
    this.setPositionImmediate(this.x, this.y, this.isAirborne);
    this._context = getGsap()?.context?.(() => {}, this.root) || null;
  }

  _bindLayers() {
    this.mover = this.root.querySelector('.mover');
    this.floater = this.root.querySelector('.floater');
    this.actor = this.root.querySelector('.actor');
    this.leafBed = this.root.querySelector('.leaf-bed-static');
    this.bodyMotion = this.root.querySelector('.body-motion');
    this.bodyLook = this.root.querySelector('.body-look');
    this.rocker = this.root.querySelector('.rocker');
    this.body = this.root.querySelector('.body');
    this.stageOneArt = this.root.querySelector('.stage-one-art');
    this.stageTwoPlant = this.root.querySelector('.stage-two-plant');
    this.stageOneSprout = this.root.querySelector('.stage-one-sprout');
    this.stageOneLeavesLeft = this.root.querySelector('.stage-one-leaves-left');
    this.stageOneLeavesRight = this.root.querySelector('.stage-one-leaves-right');
    this.stem = this.root.querySelector('.stem');
    this.faceMask = this.root.querySelector('.face-mask');
    this.face = this.root.querySelector('.face');
    this.eyes = this.root.querySelector('.eyes');
    this.cocoaHandsArtwork = this.root.querySelector('.cocoa-hands-artwork');
    this.cocoaHandsPaths = [...this.root.querySelectorAll('.cocoa-hands-path')];
    this.cocoaHandsMovingCenter = this.root.querySelector('.cocoa-hands-moving-center') || this.cocoaHandsArtwork;
    this.cocoaHandsFixedShoulders = this.root.querySelector('.cocoa-hands-fixed-shoulders') || this.cocoaHandsArtwork;
    const mouths = [...this.root.querySelectorAll('.mouth')];
    this.mouth = mouths[0] || null;
    // A customization rebuild must leave one live mouth overlay behind. If
    // an older renderer left duplicates in the root, discard them while the
    // layer references are being rebound.
    mouths.slice(1).forEach((staleMouth) => staleMouth.remove());
    this.arms = this.root.querySelector('.arms');
    this.legs = this.root.querySelector('.legs');
    this.hat = this.root.querySelector('.hat');
    this._setFaceCoordinateSystem();
  }

  _setFaceCoordinateSystem() {
    for (const overlay of [this.face, this.eyes, this.mouth]) {
      if (!overlay) continue;
      overlay.setAttribute('data-coordinate-system', 'reference-viewbox');
      // Keep percentage origins local to each overlay's own artwork. Absolute
      // origins that need the shared viewBox use GSAP's svgOrigin below.
      if (overlay.style) overlay.style.transformBox = 'fill-box';
    }
    if (this.faceMask) this.faceMask.setAttribute('data-coordinate-system', 'reference-viewbox');
  }

  _gsap() { return getGsap(); }

  _animationFrequency(channel) {
    const value = Number(this.animationSettings?.[channel]);
    return Number.isFinite(value) ? clamp(value, ANIMATION_FREQUENCY_MIN, ANIMATION_FREQUENCY_MAX) : 1;
  }

  setAnimationSettings(settings = {}) {
    this.animationSettings = { ...DEFAULT_ANIMATION, ...settings };
    return this;
  }

  setGrowthMultipliers(multipliers = {}) {
    this.growthMultipliers = normalizeGrowthMultipliers(multipliers);
    this._applyStageGeometry(this.data.stage);
    this._setPosition(this.x, this.y);
    return this;
  }

  setNameVisibility(showPumpkinNames = this.showPumpkinNames) {
    this.showPumpkinNames = showPumpkinNames !== false;
    this._refreshNameLabel();
    return this;
  }

  setNameFontSize(size = DEFAULT_NAME_FONT_SIZE) {
    this.pumpkinNameFontSize = this._normalizeNameFontSize(size);
    this._layoutNameLabel();
    return this;
  }

  _normalizeNameFontSize(size) {
    const value = Number(size);
    return Number.isInteger(value) && value >= 8 && value <= 48 ? value : DEFAULT_NAME_FONT_SIZE;
  }

  _refreshNameLabel() {
    const name = typeof this.data.displayName === 'string' ? this.data.displayName.trim() : '';
    this.root.setAttribute('aria-label', name || 'Pumpkin');
    if (name !== this.nameLabelName) {
      this.nameLabel?.remove();
      this.nameLabel = null;
      this.nameLabelLines = null;
      this.nameLabelName = name;
      if (name) {
        this.nameLabel = document.createElementNS(SVG_NAMESPACE, 'text');
        this.nameLabel.setAttribute('class', 'donor-name-label');
        this.nameLabel.setAttribute('aria-hidden', 'true');
        this.nameLabel.setAttribute('pointer-events', 'none');
        this.nameLabel.setAttribute('font-family', 'Tahoma, sans-serif');
        this.nameLabel.setAttribute('font-weight', '700');
        this.nameLabel.setAttribute('fill', '#fff');
        this.nameLabel.setAttribute('stroke', '#000');
        this.nameLabel.setAttribute('paint-order', 'stroke');
        this.nameLabel.setAttribute('text-anchor', 'middle');
        this.nameLabel.style.display = 'none';
        this.floater?.append(this.nameLabel);
      }
    }
    if (!this.nameLabel) return;
    this.nameLabel.style.display = this.positioning === 'scene'
      && this.showPumpkinNames
      && this.data.showDisplayName !== false
      ? ''
      : 'none';
    this._layoutNameLabel();
  }

  _layoutNameLabel() {
    if (!this.nameLabel) return;
    const stageSize = this.stageSize || REFERENCE_DISPLAY_SIZE;
    const halfSize = stageSize / 2;
    const left = this.x - halfSize;
    const right = this.x + halfSize;
    let anchor = 'middle';
    let labelX = REFERENCE_VIEWBOX / 2;
    let availableWidth = Math.max(1, Math.min(this.x, SCENE_WIDTH - this.x) * 2);
    if (left < 0) {
      anchor = 'start';
      labelX = -left * REFERENCE_VIEWBOX / stageSize;
      availableWidth = SCENE_WIDTH - this.x;
    } else if (right > SCENE_WIDTH) {
      anchor = 'end';
      labelX = (SCENE_WIDTH - left) * REFERENCE_VIEWBOX / stageSize;
      availableWidth = this.x;
    }

    const fontSize = this.pumpkinNameFontSize * REFERENCE_VIEWBOX / stageSize;
    const maxCharacters = Math.max(1, Math.floor(availableWidth / (this.pumpkinNameFontSize * 0.6)));
    const words = this.nameLabelName.split(/\s+/u);
    const lines = [];
    let line = '';
    for (const word of words) {
      const characters = Array.from(word);
      for (let index = 0; index < characters.length; index += maxCharacters) {
        const chunk = characters.slice(index, index + maxCharacters).join('');
        if (line && line.length + 1 + chunk.length > maxCharacters) {
          lines.push(line);
          line = '';
        }
        line = line ? `${line} ${chunk}` : chunk;
        if (index + maxCharacters < characters.length) {
          lines.push(line);
          line = '';
        }
      }
    }
    if (line) lines.push(line);

    this.nameLabel.setAttribute('text-anchor', anchor);
    this.nameLabel.setAttribute('x', String(labelX));
    this.nameLabel.setAttribute('font-size', String(fontSize));
    this.nameLabel.setAttribute('stroke-width', String(fontSize * 0.2));
    if (lines.join('\n') !== this.nameLabelLines) {
      this.nameLabelLines = lines.join('\n');
      this.nameLabel.replaceChildren(...lines.map((text) => {
        const tspan = document.createElementNS(SVG_NAMESPACE, 'tspan');
        tspan.textContent = text;
        return tspan;
      }));
    }
    [...this.nameLabel.children].forEach((tspan, index) => {
      tspan.setAttribute('x', String(labelX));
      tspan.setAttribute('y', String(-20 - (lines.length - index - 1) * fontSize * 1.15));
    });
  }

  _track(tween) {
    if (tween) this.tweens.add(tween);
    return tween;
  }

  _trackIdle(tween) {
    if (!tween) return tween;
    this.idleTweens.add(tween);
    this._track(tween);
    return tween;
  }

  _trackAction(tween) {
    if (!tween) return tween;
    this.actionTweens.add(tween);
    this._track(tween);
    return tween;
  }

  _trackFor(tween, { idle = false } = {}) {
    return idle ? this._trackIdle(tween) : this._trackAction(tween);
  }

  _kill(targets) {
    const gsap = this._gsap();
    if (gsap && targets) gsap.killTweensOf(targets);
  }

  _applyStageGeometry(stage = this.data.stage) {
    const rawStage = Number(stage);
    const normalizedStage = Number.isFinite(rawStage) ? clamp(Math.round(rawStage), 1, STAGE_SCALES.length) : 1;
    const stageScale = this.growthMultipliers[`stage${normalizedStage}`];
    const stageSize = REFERENCE_DISPLAY_SIZE * stageScale;
    this.stage = normalizedStage;
    this.stageScale = stageScale;
    this.stageSize = stageSize;
    this.data.stage = normalizedStage;
    this.root.dataset.stage = String(normalizedStage);
    this.root.dataset.stageScale = String(stageScale);
    this.root.style.setProperty('--pumpkin-stage-size', `${stageSize}px`);
    this.root.style.setProperty('--pumpkin-stage-size-percent', `${stageSize / SCENE_WIDTH * 100}%`);
    if (this.positioning === 'local' && this.previewSize !== null) {
      this.root.style.setProperty('--pumpkin-preview-size', `${this.previewSize * stageScale}px`);
    } else {
      this.root.style.removeProperty('--pumpkin-preview-size');
    }
    this._layoutNameLabel();
    return this;
  }

  _setPosition(x, y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    const stageSize = this.stageSize || REFERENCE_DISPLAY_SIZE;
    if (this.positioning === 'scene') {
      this.root.style.left = `${(this.x - stageSize / 2) / SCENE_WIDTH * 100}%`;
      this.root.style.top = `${(this.y - stageSize) / SCENE_HEIGHT * 100}%`;
      this.mover?.setAttribute('transform', 'translate(0 0)');
    } else {
      this.mover?.setAttribute('transform', `translate(${this.x - REFERENCE_DISPLAY_SIZE / 2} ${this.y - REFERENCE_DISPLAY_SIZE})`);
    }
    this._layoutNameLabel();
  }

  setPositionImmediate(x, y, isAirborne = this.isAirborne) {
    this.isAirborne = Boolean(isAirborne);
    this._setPosition(x, y);
    this.root.classList.toggle('is-airborne', this.isAirborne);
    return this;
  }

  startPhysics({ velocityX = 0, velocityY = 0, supportY = this.supportY } = {}) {
    this.stopAction?.();
    this.velocity.x = Number.isFinite(Number(velocityX)) ? Number(velocityX) : 0;
    this.velocity.y = Number.isFinite(Number(velocityY)) ? Number(velocityY) : 0;
    this.supportY = Number.isFinite(Number(supportY)) ? Number(supportY) : this.y;
    this.physicsAccumulator = 0;
    this.physicsActive = true;
    this.isAirborne = true;
    this.root.classList.add('is-airborne');
    return this;
  }

  stepPhysics(elapsedSeconds, { groundY = this.supportY, gravity = PHYSICS_GRAVITY } = {}) {
    if (!this.physicsActive || this.destroyed) return false;
    const elapsed = Number(elapsedSeconds);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return true;
    this.physicsAccumulator += Math.min(elapsed, PHYSICS_MAX_FRAME_SECONDS);
    const floor = Number.isFinite(Number(groundY)) ? Number(groundY) : this.supportY;
    const acceleration = Number.isFinite(Number(gravity)) && Number(gravity) >= 0 ? Number(gravity) : PHYSICS_GRAVITY;
    while (this.physicsAccumulator >= PHYSICS_STEP_SECONDS) {
      const previousY = this.y;
      this.velocity.y += acceleration * PHYSICS_STEP_SECONDS;
      let nextX = this.x + this.velocity.x * PHYSICS_STEP_SECONDS;
      let nextY = this.y + this.velocity.y * PHYSICS_STEP_SECONDS;
      let landingY = nextY >= floor ? floor : null;
      this.physicsAccumulator -= PHYSICS_STEP_SECONDS;
      if (landingY !== null) {
        nextY = landingY;
        this.velocity = { x: 0, y: 0 };
        this.physicsAccumulator = 0;
        this.physicsActive = false;
        this.isAirborne = false;
        this.supportY = landingY;
        this.root.classList.remove('is-airborne');
        this.data = { ...this.data, x: nextX, y: nextY, isAirborne: false };
      }
      this._setPosition(nextX, nextY);
      if (!this.physicsActive) return false;
    }
    return true;
  }

  stopPhysics() {
    this.physicsActive = false;
    this.physicsAccumulator = 0;
    this.velocity = { x: 0, y: 0 };
    return this;
  }

  moveTo(x, y, { duration = 0.16, isAirborne = this.isAirborne, immediate = false } = {}) {
    this.stopPhysics();
    this.stopAction();
    const gsap = this._gsap();
    if (immediate || !gsap) return this.setPositionImmediate(x, y, isAirborne);

    this.isAirborne = Boolean(isAirborne);
    this.root.classList.toggle('is-airborne', this.isAirborne);
    const target = { x: this.x, y: this.y };
    this._kill(target);
    return this._track(gsap.to(target, {
      x, y, duration, ease: 'power2.out', overwrite: 'auto',
      onUpdate: () => this._setPosition(target.x, target.y),
    }));
  }

  hopTo(x, y, { duration = null, speed = 140, height = null } = {}) {
    const targetX = Number.isFinite(Number(x)) ? Number(x) : this.x;
    const targetY = Number.isFinite(Number(y)) ? Number(y) : this.y;
    const gsap = this._gsap();
    if (!gsap || !this.actor) return this.moveTo(targetX, targetY, { duration });

    this.stopPhysics();
    this.stopAction();
    const startX = this.x;
    const startY = this.y;
    const safeSpeed = Number.isFinite(Number(speed)) && Number(speed) > 0 ? Number(speed) : 140;
    const distance = Math.hypot(targetX - startX, targetY - startY);
    const totalDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : Math.max(.18, distance / safeSpeed);
    const configuredHeight = Number(height);
    const hopHeight = Number.isFinite(configuredHeight) && configuredHeight > 0
      ? configuredHeight
      : Math.max(36, this.stageSize * .42);
    const takeoffSquashDuration = Math.max(.35, Math.min(.55, totalDuration * .2));
    const takeoffReleaseDuration = Math.max(.5, Math.min(.7, totalDuration * .25));
    const landingSquashDuration = Math.max(.35, Math.min(.5, totalDuration * .18));
    const landingReleaseDuration = Math.max(.55, Math.min(.8, totalDuration * .28));
    const flightStart = takeoffSquashDuration;
    const landingStart = flightStart + totalDuration;
    const progress = { value: 0 };
    const timeline = gsap.timeline({
      onComplete: () => {
        this._setPosition(targetX, targetY);
        this.data = { ...this.data, x: targetX, y: targetY };
      },
    });
    timeline.to(this.actor, {
      scaleX: .82,
      scaleY: 1.16,
      duration: takeoffSquashDuration,
      ease: 'sine.inOut',
    });
    timeline.to(this.actor, {
      scaleX: 1,
      scaleY: 1,
      duration: takeoffReleaseDuration,
      ease: 'sine.out',
    }, flightStart);
    timeline.to(progress, {
      value: 1,
      duration: totalDuration,
      ease: 'none',
      onUpdate: () => {
        const t = progress.value;
        this._setPosition(
          startX + (targetX - startX) * t,
          startY + (targetY - startY) * t - 4 * hopHeight * t * (1 - t),
        );
      },
    }, flightStart);
    timeline.to(this.actor, {
      scaleX: 1.18,
      scaleY: .84,
      duration: landingSquashDuration,
      ease: 'sine.inOut',
    }, landingStart);
    timeline.to(this.actor, {
      scaleX: 1,
      scaleY: 1,
      duration: landingReleaseDuration,
      ease: 'sine.out',
    }, landingStart + landingSquashDuration);
    return this._trackAction(timeline);
  }

  _rebuildArtwork(nextData = this.data) {
    const wasIdle = this.idleStarted;
    this.stopIdle();
    this.stopAction();
    this.data = { ...this.data, ...nextData, customization: normalizeCustomization(nextData.customization || this.data.customization) };
    const next = createPumpkinSvg(this.data);
    next.classList.toggle('is-interactive', this.root.classList.contains('is-interactive'));
    next.classList.toggle('is-selected', this.root.classList.contains('is-selected'));
    this.root.replaceChildren(...[...next.childNodes]);
    this._bindLayers();
    this.nameLabel = null;
    this.nameLabelLines = null;
    this.nameLabelName = null;
    this._refreshNameLabel();
    this._applyStageGeometry(this.data.stage);
    this._setPosition(this.x, this.y);
    if (wasIdle) this.startIdle();
    return this;
  }

  applyCustomization(customization) {
    return this._rebuildArtwork({ customization });
  }

  startIdle() {
    if (this.destroyed || this.idleStarted) return this;
    this.idleStarted = true;
    // Each channel gets its own initial jitter as well as a fresh jitter on every repeat.
    this._scheduleFloat();
    this._scheduleBodyRock();
    this._scheduleStageOneCozy();
    this._scheduleStageTwoPlantSway();
    this._scheduleStemSway();
    this._scheduleCocoaHandsSway();
    this._scheduleBlink();
    this._scheduleLook();
    this._scheduleFaceVariant();
    this._scheduleMouth();
    this._scheduleMicro();
    return this;
  }

  restartIdle() {
    if (this.destroyed || !this.idleStarted) return this;
    this.stopIdle();
    return this.startIdle();
  }

  _later(fn, min, max, frequency = 1) {
    const timer = wait(() => {
      this.idleTimers.delete(timer);
      if (this.destroyed || !this.idleStarted) return;
      fn();
      if (!this.destroyed && this.idleStarted) this._later(fn, min, max, frequency);
    }, randomBetween(min, max) / frequency);
    this.idleTimers.add(timer);
  }

  _scheduleFloat() {
    const gsap = this._gsap();
    if (!gsap || !this.bodyMotion) return;
    // Use a fixed-amplitude from/to tween. Recomputing the target at every
    // repeat causes a visible direction snap at the seam.
    const amplitude = randomBetween(1.1, 1.8);
    this._trackIdle(gsap.fromTo(this.bodyMotion,
      { rotation: -amplitude, svgOrigin: REFERENCE_BODY_ORIGIN },
      {
        rotation: amplitude, svgOrigin: REFERENCE_BODY_ORIGIN,
        duration: randomBetween(4.8, 6.4), ease: 'sine.inOut',
        yoyo: true, repeat: -1, overwrite: 'auto', delay: randomBetween(0, 1.2),
      },
    ));
  }

  _scheduleBodyRock() {
    const gsap = this._gsap();
    if (!gsap || !this.rocker) return;
    // A restrained squash-and-stretch gives the body a soft Disney-like
    // settle without scaling the stationary leaf bed.
    const squash = randomBetween(.975, .988);
    this._trackIdle(gsap.to(this.rocker, {
      scaleX: 2 - squash, scaleY: squash, svgOrigin: REFERENCE_BODY_ORIGIN,
      duration: randomBetween(3.8, 5.4), ease: 'sine.inOut', yoyo: true,
      repeat: -1, overwrite: 'auto', delay: randomBetween(0, 1.6),
    }));
  }

  _scheduleStageOneCozy() {
    const gsap = this._gsap();
    if (this.stage !== 1 || !gsap || !this.stageOneSprout) return;
    const tilt = randomBetween(2.2, 3.8);
    this._trackIdle(gsap.fromTo(this.stageOneSprout,
      { rotation: -tilt, svgOrigin: STAGE_ONE_SPROUT_ORIGIN },
      {
        rotation: tilt, svgOrigin: STAGE_ONE_SPROUT_ORIGIN,
        duration: randomBetween(5.2, 7), ease: 'sine.inOut',
        yoyo: true, repeat: -1, overwrite: 'auto', delay: randomBetween(0, 1.5),
      },
    ));
    const leafMotion = (target, origin, amount, delay) => {
      if (!target) return;
      this._trackIdle(gsap.fromTo(target,
        { rotation: -amount, svgOrigin: origin },
        {
          rotation: amount, svgOrigin: origin,
          duration: randomBetween(2.8, 4.4), ease: 'sine.inOut',
          yoyo: true, repeat: -1, overwrite: 'auto', delay,
        },
      ));
    };
    leafMotion(this.stageOneLeavesLeft, STAGE_ONE_LEFT_LEAF_ORIGIN, randomBetween(2.2, 4), randomBetween(0, .8));
    leafMotion(this.stageOneLeavesRight, STAGE_ONE_RIGHT_LEAF_ORIGIN, randomBetween(2.2, 4), randomBetween(.3, 1.1));
  }

  _scheduleStageTwoPlantSway() {
    const gsap = this._gsap();
    if (this.stage !== 2 || !gsap || !this.stageTwoPlant) return;
    const amplitude = randomBetween(1.6, 2.4);
    this._trackIdle(gsap.fromTo(this.stageTwoPlant,
      { rotation: -amplitude, svgOrigin: STAGE_TWO_PLANT_ORIGIN },
      {
        rotation: amplitude, svgOrigin: STAGE_TWO_PLANT_ORIGIN,
        duration: randomBetween(5.2, 7.2), ease: 'sine.inOut',
        yoyo: true, repeat: -1, overwrite: 'auto', delay: randomBetween(0, 1.4),
      },
    ));
  }

  _scheduleStemSway() {
    const gsap = this._gsap();
    if (!gsap || !this.stem) return;
    const amplitude = randomBetween(1.4, 2.2);
    this._trackIdle(gsap.fromTo(this.stem,
      { rotation: -amplitude, svgOrigin: '548 360' },
      {
        rotation: amplitude, svgOrigin: '548 360',
        duration: randomBetween(4.6, 6.6), ease: 'sine.inOut',
        yoyo: true, repeat: -1, overwrite: 'auto', delay: randomBetween(0, 1.8),
      },
    ));
  }

  _scheduleCocoaHandsSway() {
    const gsap = this._gsap();
    if (!gsap) return;
    const paths = (this.cocoaHandsPaths && this.cocoaHandsPaths.length)
      ? this.cocoaHandsPaths
      : (this.root?.querySelectorAll ? [...this.root.querySelectorAll('.cocoa-hands-path')] : []);

    if (paths.length) {
      const amplitude = randomBetween(1.2, 2);
      const pathsLeft = getBentCocoaPaths(-amplitude);
      const pathsRight = getBentCocoaPaths(amplitude);
      const duration = randomBetween(3.8, 4.8);

      if (typeof gsap.timeline === 'function') {
        const timeline = gsap.timeline({
          repeat: -1,
          yoyo: true,
          overwrite: 'auto',
        });
        paths.forEach((pathEl, index) => {
          timeline.fromTo(pathEl,
            { attr: { d: pathsLeft[index] } },
            { attr: { d: pathsRight[index] }, duration, ease: 'sine.inOut' },
            0,
          );
        });
        this._trackIdle(timeline);
      } else if (typeof gsap.fromTo === 'function') {
        paths.forEach((pathEl, index) => {
          this._trackIdle(gsap.fromTo(pathEl,
            { attr: { d: pathsLeft[index] } },
            { attr: { d: pathsRight[index] }, duration, ease: 'sine.inOut', yoyo: true, repeat: -1, overwrite: 'auto' },
          ));
        });
      }
    } else if (this.cocoaHandsMovingCenter) {
      const amplitude = randomBetween(1.2, 2);
      this._trackIdle(gsap.fromTo(this.cocoaHandsMovingCenter,
        { rotation: -amplitude, svgOrigin: COCOA_HANDS_CUP_ORIGIN },
        {
          rotation: amplitude, svgOrigin: COCOA_HANDS_CUP_ORIGIN,
          duration: randomBetween(3.8, 4.8), ease: 'sine.inOut',
          yoyo: true, repeat: -1, overwrite: 'auto',
        },
      ));
    }
  }

  _scheduleBlink() {
    // Use a long, per-pumpkin randomized delay so blinks feel incidental
    // instead of landing on a shared metronome. A small minority are double
    // blinks, still handled by the same independently scheduled callback.
    this._later(() => this.blink(Math.random() < .16, { idle: true }), BLINK_DELAY_MIN, BLINK_DELAY_MAX, this._animationFrequency('eyeFrequency'));
  }

  _scheduleLook() {
    this._later(() => this.lookAt(randomBetween(-1, 1), randomBetween(-1, 1), { idle: true }), 3500, 8000, this._animationFrequency('eyeFrequency'));
  }

  _scheduleFaceVariant() {
    this._later(() => this._animateFaceVariant({ idle: true }), 2600, 6500, this._animationFrequency('eyeFrequency'));
  }

  _scheduleMouth() {
    this._later(() => this._animateMouth({ idle: true }), 2800, 7000, this._animationFrequency('mouthFrequency'));
  }

  _scheduleMicro() {
    this._later(() => {
      const roll = Math.random();
      if (roll < .42) this.waveArms({ idle: true });
      else if (roll < .72) this.adjustHat({ idle: true });
      else this._swayLegs({ idle: true });
    }, 5000, 11000);
  }

  stopIdle() {
    for (const timer of this.idleTimers) clearTimeout(timer);
    this.idleTimers.clear();
    for (const tween of this.idleTweens) tween.kill?.();
    this.idleTweens.clear();

    const gsap = this._gsap();
    if (gsap) {
      // These layers are owned exclusively by idle, so always restore their neutral pose.
      gsap.set(this.floater, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.bodyMotion, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.bodyLook, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.rocker || this.body, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.stem, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.cocoaHandsPaths?.length) {
        this.cocoaHandsPaths.forEach((pathEl, index) => {
          if (COCOA_HANDS_PATHS_REST[index]) {
            gsap.set(pathEl, { attr: { d: COCOA_HANDS_PATHS_REST[index] } });
          }
        });
      }
      if (this.cocoaHandsMovingCenter) gsap.set(this.cocoaHandsMovingCenter, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.stageTwoPlant) gsap.set(this.stageTwoPlant, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.stageOneArt) gsap.set(this.stageOneArt, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.stageOneSprout) gsap.set(this.stageOneSprout, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.stageOneLeavesLeft) gsap.set(this.stageOneLeavesLeft, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.stageOneLeavesRight) gsap.set(this.stageOneLeavesRight, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.face) gsap.set(this.face, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (this.eyes) gsap.set(this.eyes, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      const eyeParts = this.root.querySelectorAll('.eyes .eye');
      const eyeGlints = this.root.querySelectorAll('.eyes .eye-glint, .eyes .variant-eye-glint');
      const eyeLids = this.root.querySelectorAll('.eyes .eye-lid');
      if (eyeParts.length) gsap.set(eyeParts, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (eyeGlints.length) gsap.set(eyeGlints, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      if (eyeLids.length) gsap.set(eyeLids, { opacity: 0 });
      if (this.mouth) gsap.set(this.mouth, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    }
    this.idleStarted = false;
    return this;
  }

  blink(doubleBlink = false, { idle = false } = {}) {
    const gsap = this._gsap();
    // Blink eye groups, rather than every path in .face (which would squash the mouth too).
    const eyes = this.root.querySelectorAll('.eyes .eye');
    const lids = this.root.querySelectorAll('.eyes .eye-lid');
    if (!gsap || !eyes.length) return this;
    const repeats = doubleBlink ? 3 : 1;
    this._kill([...eyes, ...lids]);
    const tween = gsap.timeline({ defaults: { overwrite: 'auto' } });
    tween.to(lids, { opacity: 1, duration: .07, ease: 'power1.in' })
      .to(eyes, { scaleY: .08, duration: .09, yoyo: true, repeat: repeats, transformOrigin: '50% 50%', ease: 'power1.inOut' })
      .to(lids, { opacity: 0, duration: .08, ease: 'power1.out' });
    return this._trackFor(tween, { idle });
  }

  wink(options = {}) { return this.blink(false, options); }

  lookAt(dx = 0, dy = 0, { idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.face || !this.bodyLook) return this;
    const horizontal = clamp(Number(dx) || 0, -1, 1);
    const x = horizontal * 6;
    const y = clamp(Number(dy) || 0, -1, 1) * 3.5;
    const bodyRotation = horizontal * 1.5;
    const faceRotation = horizontal * .7;
    const tween = gsap.timeline({ defaults: { overwrite: 'auto' } });
    tween.to(this.face, { x, y, rotation: faceRotation, duration: .68, svgOrigin: REFERENCE_FACE_ORIGIN, ease: 'sine.inOut' })
      .to(this.bodyLook, { rotation: bodyRotation, duration: .68, svgOrigin: REFERENCE_BODY_ORIGIN, ease: 'sine.inOut' }, '<')
      .to(this.face, { x: 0, y: 0, rotation: 0, duration: 1.15, ease: 'sine.inOut' })
      .to(this.bodyLook, { rotation: 0, duration: 1.15, ease: 'sine.inOut' }, '<');
    return this._trackFor(tween, { idle });
  }

  _animateFaceVariant({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.eyes) return this;
    const eyeClass = [...this.eyes.classList].find((name) => name.startsWith('eyes-')) || 'eyes-cute';
    let target = this.eyes;
    let vars = { duration: .85, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: 'auto' };
    if (eyeClass === 'eyes-stars') {
      target = this.eyes.querySelectorAll('.eye-glint, .variant-eye-glint');
      vars = { scale: 1.35, transformOrigin: 'center center', ...vars };
    } else if (eyeClass === 'eyes-hypno') {
      vars = { rotation: randomBetween(-4, 4), transformOrigin: 'center center', ...vars };
    } else if (eyeClass === 'eyes-sleepy') {
      vars = { y: randomBetween(-1, 1), scaleY: .94, transformOrigin: 'center center', ...vars };
    } else if (eyeClass === 'eyes-sly') {
      target = this.face;
      vars = { rotation: randomBetween(-1.8, 1.8), svgOrigin: REFERENCE_FACE_ORIGIN, ...vars };
    } else {
      vars = { y: randomBetween(-1.5, 1.5), transformOrigin: 'center center', ...vars };
    }
    if (!target || !target.length && !target.nodeType) return this;
    const tween = gsap.to(target, vars);
    return this._trackFor(tween, { idle });
  }

  _animateMouth({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.mouth) return this;
    const mouthClass = [...this.mouth.classList].find((name) => name.startsWith('mouth-')) || 'mouth-cat';
    const isRound = mouthClass === 'mouth-o' || mouthClass === 'mouth-fangs';
    const tween = gsap.to(this.mouth, {
      // The face mask is fixed beneath this group, so keep the mouth motion
      // local to its own fill box and never introduce a root-space offset.
      scaleY: isRound ? randomBetween(1.02, 1.06) : randomBetween(.98, 1.02),
      scaleX: randomBetween(.99, 1.01),
      y: randomBetween(-1.5, 1.5), duration: randomBetween(.8, 1.15),
      transformOrigin: '50% 50%', yoyo: true, repeat: 1,
      ease: 'sine.inOut', overwrite: 'auto',
    });
    return this._trackFor(tween, { idle });
  }

  waveArms({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.arms) return this;
    const tween = gsap.to(this.arms, {
      rotation: randomBetween(6, 10), svgOrigin: '548 800',
      duration: .38, yoyo: true, repeat: 3, ease: 'sine.inOut', overwrite: 'auto',
    });
    this._trackFor(tween, { idle });
    return this;
  }

  _swayLegs({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.legs) return this;
    const tween = gsap.to(this.legs, {
      rotation: randomBetween(-3, 3), svgOrigin: '548 1030',
      duration: .55, yoyo: true, repeat: 3, ease: 'sine.inOut', overwrite: 'auto',
    });
    this._trackFor(tween, { idle });
    return this;
  }

  adjustHat({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.hat) return this;
    const tween = gsap.to(this.hat, {
      rotation: randomBetween(5, 8), svgOrigin: '548 330',
      duration: .5, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: 'auto',
    });
    this._trackFor(tween, { idle });
    return this;
  }

  evolve(newStage) {
    const rawStage = Number(newStage);
    const normalizedStage = Number.isFinite(rawStage) ? clamp(Math.round(rawStage), 1, STAGE_SCALES.length) : 1;
    if (normalizedStage !== this.stage) this._rebuildArtwork({ stage: normalizedStage });
    else this._applyStageGeometry(normalizedStage);
    this._setPosition(this.x, this.y);
    const gsap = this._gsap();
    if (gsap) this._trackAction(gsap.fromTo(this.root, { scale: .7, opacity: .4 }, { scale: 1, opacity: 1, duration: .5, ease: 'back.out(2)', overwrite: 'auto' }));
    return this;
  }

  stopAction() {
    for (const tween of this.actionTweens) tween.kill?.();
    this.actionTweens.clear();
    const gsap = this._gsap();
    if (gsap && this.actor) gsap.set(this.actor, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    return this;
  }

  setTowerPose(baseX, baseY, angle = 0, pivotY = baseY, rotationMultiplier = 1) {
    const lean = Number.isFinite(Number(angle)) ? Number(angle) : 0;
    const rotation = lean * (Number.isFinite(Number(rotationMultiplier)) ? Number(rotationMultiplier) : 1);
    const verticalOffset = Math.max(0, Number(pivotY) - Number(baseY));
    const x = Number(baseX) + Math.sin(lean * Math.PI / 180) * verticalOffset;
    this._setPosition(x, baseY);
    const gsap = this._gsap();
    if (gsap && this.actor) gsap.set(this.actor, { rotation, transformOrigin: '50% 100%' });
    return this;
  }

  stack(targetX = this.x, targetY = this.y, index = 0, count = 1, { sway = 3, direction = 0, delay = 0, towerSwayDelay = null, towerSwayDuration = 2.8, coordinated = false, onComplete } = {}) {
    const gsap = this._gsap();
    const x = Number.isFinite(Number(targetX)) ? Number(targetX) : this.x;
    const y = Number.isFinite(Number(targetY)) ? Number(targetY) : this.y;
    const finish = () => {
      this.isAirborne = false;
      this.root.classList.remove('is-airborne');
      this._setPosition(x, y);
      this.data = { ...this.data, x, y, isAirborne: false, parentId: null, stackOffsetY: null };
      onComplete?.();
    };
    this.stopAction();
    if (!gsap) {
      finish();
      return this;
    }

    const position = { x: this.x, y: this.y };
    const jumpHeight = Math.max(85, (this.stageSize || REFERENCE_DISPLAY_SIZE) * .68);
    const jumpY = Math.max(this.stageSize || REFERENCE_DISPLAY_SIZE, Math.min(this.y, y) - jumpHeight);
    const lean = direction ? direction * Math.min(10, 3 + count * .6) : 0;
    const amplitude = Math.min(24, Math.max(4, Number(sway) || 4));
    const timeline = gsap.timeline({ delay, defaults: { overwrite: 'auto' }, onComplete: finish });
    timeline.to(this.actor, { scaleX: 1.1, scaleY: .9, duration: .14, transformOrigin: '50% 100%', ease: 'power2.in' })
      .to(position, { x, y: jumpY, duration: .34, ease: 'power2.out', onUpdate: () => this._setPosition(position.x, position.y) }, '<')
      .to(this.actor, { scaleX: .86, scaleY: 1.18, duration: .16, transformOrigin: '50% 100%', ease: 'power1.out' })
      .to(position, { x, y, duration: .46 + Math.min(.22, index * .03), ease: 'power2.in', onUpdate: () => this._setPosition(position.x, position.y) })
      .to(this.actor, { scaleX: 1.06, scaleY: .94, duration: .1, transformOrigin: '50% 100%' })
      .to(this.actor, { scaleX: 1, scaleY: 1, rotation: lean, duration: .18, ease: 'back.out(1.5)' });
    if (amplitude > 0 && !coordinated) timeline.to(this.actor, { rotation: lean + amplitude * (index % 2 ? -1 : 1), duration: .32, ease: 'sine.inOut', yoyo: true, repeat: 2 });
    void towerSwayDelay; void towerSwayDuration; void coordinated;
    return this._trackAction(timeline);
  }

  rollTo(x, y, data = {}, { direction = 0, delay = 0, groundY = SCENE_HEIGHT, fallDuration = .72, rollDuration = 1.15, onComplete } = {}) {
    const gsap = this._gsap();
    const targetX = Number.isFinite(Number(x)) ? Number(x) : this.x;
    const targetY = Number.isFinite(Number(y)) ? Number(y) : this.y;
    const finish = () => {
      this.isAirborne = false;
      this.root.classList.remove('is-airborne');
      this._setPosition(targetX, targetY);
      this.data = { ...this.data, ...data, x: targetX, y: targetY, isAirborne: false, parentId: null, stackOffsetY: null };
      onComplete?.();
    };
    this.stopAction();
    this.data = { ...this.data, ...data };
    if (!gsap) {
      finish();
      return this;
    }

    const position = { x: this.x, y: this.y };
    const distance = Math.abs(targetX - this.x);
    const spin = (direction < 0 ? -1 : 1) * Math.min(2160, Math.max(540, 540 + distance / Math.max(1, this.stageSize || REFERENCE_DISPLAY_SIZE) * 260));
    const landingY = Math.max(this.y, Number.isFinite(Number(groundY)) ? Number(groundY) : targetY);
    const fallX = this.x;
    const timeline = gsap.timeline({ delay, defaults: { overwrite: 'auto' }, onComplete: finish });
    timeline.to(this.actor, { scaleX: 1.12, scaleY: .86, duration: .18, transformOrigin: '50% 100%', ease: 'power2.in' })
      .to(position, { x: fallX, y: landingY, duration: fallDuration, ease: 'power3.in', onUpdate: () => this._setPosition(position.x, position.y) }, '<')
      .to(this.actor, { scaleX: 1.2, scaleY: .78, duration: .12, ease: 'power2.out' })
      .to(this.actor, { scaleX: .96, scaleY: 1.04, duration: .28, ease: 'elastic.out(1, .55)' })
      .to(this.actor, { rotation: spin, duration: rollDuration, ease: 'none' }, '<')
      .to(position, { x: targetX, y: landingY, duration: rollDuration, ease: 'sine.inOut', onUpdate: () => this._setPosition(position.x, position.y) }, '<')
      .to(this.actor, { rotation: 0, scaleX: 1.04, scaleY: .96, duration: .16, ease: 'back.out(1.4)' })
      .to(this.actor, { scaleX: 1, scaleY: 1, duration: .32, ease: 'elastic.out(1, .5)' });
    return this._trackAction(timeline);
  }

  disappear(onComplete) {
    const gsap = this._gsap();
    if (!gsap) {
      onComplete?.();
      return this;
    }
    this.stopIdle();
    this._track(gsap.to(this.root, { opacity: 0, scale: .65, duration: .24, ease: 'power2.in', onComplete }));
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopIdle();
    this.stopAction();
    const gsap = this._gsap();
    if (gsap) {
      for (const tween of this.tweens) tween.kill?.();
      gsap.killTweensOf(this.root);
      this._context?.revert?.();
    }
    this.root.remove();
    this.tweens.clear();
  }
}

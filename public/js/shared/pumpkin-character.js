import { createPumpkinSvg, normalizeCustomization } from './pumpkin-svg.js';

const getGsap = () => globalThis.gsap || globalThis.window?.gsap || null;
const wait = (fn, ms) => setTimeout(fn, ms);
const randomBetween = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const REFERENCE_FACE_ORIGIN = '548 665';
const BLINK_DELAY_MIN = 9000;
const BLINK_DELAY_MAX = 18000;

/** One independently animated pumpkin. Positioning lives on .mover; idle lives on .floater. */
export class PumpkinCharacter {
  constructor(pumpkin, { interactive = false, onPointerDown = null, positioning = 'scene' } = {}) {
    this.positioning = positioning;
    this.data = { ...pumpkin, customization: normalizeCustomization(pumpkin.customization) };
    this.root = createPumpkinSvg(this.data);
    this.root.classList.toggle('is-interactive', interactive);
    this.root.addEventListener('pointerdown', (event) => onPointerDown?.(this.data, event));

    this._bindLayers();
    this.x = Number(this.data.x) || 0;
    this.y = Number(this.data.y) || 980;
    this.isAirborne = Boolean(this.data.isAirborne);
    this.destroyed = false;
    this.idleStarted = false;
    this.idleTimers = new Set();
    this.tweens = new Set();
    this.idleTweens = new Set();
    this.actionTweens = new Set();
    this.lastMoveSequence = -1;

    this.setPositionImmediate(this.x, this.y, this.isAirborne);
    this._context = getGsap()?.context?.(() => {}, this.root) || null;
  }

  _bindLayers() {
    this.mover = this.root.querySelector('.mover');
    this.floater = this.root.querySelector('.floater');
    this.actor = this.root.querySelector('.actor');
    this.rocker = this.root.querySelector('.rocker');
    this.shadow = this.root.querySelector('.ground-shadow');
    this.body = this.root.querySelector('.body');
    this.stem = this.root.querySelector('.stem');
    this.faceMask = this.root.querySelector('.face-mask');
    this.face = this.root.querySelector('.face');
    this.eyes = this.root.querySelector('.eyes');
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

  _setPosition(x, y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    if (this.positioning === 'scene') {
      this.root.style.left = `${(this.x - 110) / 1920 * 100}%`;
      this.root.style.top = `${(this.y - 220) / 1080 * 100}%`;
      this.mover?.setAttribute('transform', 'translate(0 0)');
    } else {
      this.mover?.setAttribute('transform', `translate(${this.x - 110} ${this.y - 220})`);
    }
  }

  setPositionImmediate(x, y, isAirborne = this.isAirborne) {
    this.isAirborne = Boolean(isAirborne);
    this._setPosition(x, y);
    this.root.classList.toggle('is-airborne', this.isAirborne);
    return this;
  }

  moveTo(x, y, { duration = 0.16, isAirborne = this.isAirborne, immediate = false } = {}) {
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

  applyCustomization(customization) {
    const wasIdle = this.idleStarted;
    this.stopIdle();
    this.stopAction();
    this._kill([this.face, ...this.root.querySelectorAll('.face *')]);
    this.data.customization = normalizeCustomization(customization);
    const next = createPumpkinSvg(this.data);
    next.classList.toggle('is-interactive', this.root.classList.contains('is-interactive'));
    next.classList.toggle('is-selected', this.root.classList.contains('is-selected'));
    this.root.replaceChildren(...[...next.childNodes]);
    this.root.setAttribute('aria-label', this.data.displayName || 'Pumpkin');
    this._bindLayers();
    this._setPosition(this.x, this.y);
    if (wasIdle) this.startIdle();
    return this;
  }

  startIdle() {
    if (this.destroyed || this.idleStarted) return this;
    this.idleStarted = true;
    // Each channel gets its own initial jitter as well as a fresh jitter on every repeat.
    this._scheduleFloat();
    this._scheduleBodyRock();
    this._scheduleStemSway();
    this._scheduleBlink();
    this._scheduleLook();
    this._scheduleFaceVariant();
    this._scheduleMouth();
    this._scheduleMicro();
    return this;
  }

  _later(fn, min, max) {
    const timer = wait(() => {
      this.idleTimers.delete(timer);
      if (this.destroyed || !this.idleStarted) return;
      fn();
      if (!this.destroyed && this.idleStarted) this._later(fn, min, max);
    }, randomBetween(min, max));
    this.idleTimers.add(timer);
  }

  _scheduleFloat() {
    const gsap = this._gsap();
    if (!gsap || !this.floater) return;
    this._trackIdle(gsap.to(this.floater, {
      y: () => -randomBetween(15, 32),
      duration: () => randomBetween(1.6, 2.4),
      ease: 'sine.inOut', yoyo: true, repeat: -1, repeatRefresh: true,
      overwrite: 'auto', delay: randomBetween(0, 1.5),
    }));
  }

  _scheduleBodyRock() {
    const gsap = this._gsap();
    if (!gsap || !this.rocker) return;
    this._trackIdle(gsap.to(this.rocker, {
      rotation: () => randomBetween(-1.2, 1.2),
      scaleX: () => randomBetween(.985, 1.015),
      duration: () => randomBetween(2.4, 3.8),
      svgOrigin: '548 1035', ease: 'sine.inOut', yoyo: true,
      repeat: -1, repeatRefresh: true, overwrite: 'auto', delay: randomBetween(0, 1.2),
    }));
  }

  _scheduleStemSway() {
    const gsap = this._gsap();
    if (!gsap || !this.stem) return;
    this._trackIdle(gsap.to(this.stem, {
      rotation: () => randomBetween(-3, 3),
      svgOrigin: '548 360', duration: () => randomBetween(2.1, 3.4),
      ease: 'sine.inOut', yoyo: true, repeat: -1, repeatRefresh: true,
      overwrite: 'auto', delay: randomBetween(0, 1.8),
    }));
  }

  _scheduleBlink() {
    // Use a long, per-pumpkin randomized delay so blinks feel incidental
    // instead of landing on a shared metronome. A small minority are double
    // blinks, still handled by the same independently scheduled callback.
    this._later(() => this.blink(Math.random() < .16, { idle: true }), BLINK_DELAY_MIN, BLINK_DELAY_MAX);
  }

  _scheduleLook() {
    this._later(() => this.lookAt(randomBetween(-1, 1), randomBetween(-1, 1), { idle: true }), 3500, 8000);
  }

  _scheduleFaceVariant() {
    this._later(() => this._animateFaceVariant({ idle: true }), 2600, 6500);
  }

  _scheduleMouth() {
    this._later(() => this._animateMouth({ idle: true }), 2800, 7000);
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
      gsap.set(this.rocker || this.body, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.stem, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.face, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.eyes, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.root.querySelectorAll('.eyes .eye'), { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.root.querySelectorAll('.eyes .eye-glint, .eyes .variant-eye-glint'), { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.root.querySelectorAll('.eyes .eye-lid'), { opacity: 0 });
      gsap.set(this.mouth, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
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
    if (!gsap || !this.face) return this;
    const x = clamp(Number(dx) || 0, -1, 1) * 8;
    const y = clamp(Number(dy) || 0, -1, 1) * 5;
    const tween = gsap.timeline({ defaults: { overwrite: 'auto' } });
    tween.to(this.face, { x, y, duration: .28, ease: 'sine.out' })
      .to(this.face, { x: 0, y: 0, duration: .5, ease: 'sine.inOut' });
    return this._trackFor(tween, { idle });
  }

  _animateFaceVariant({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.eyes) return this;
    const eyeClass = [...this.eyes.classList].find((name) => name.startsWith('eyes-')) || 'eyes-cute';
    let target = this.eyes;
    let vars = { duration: .32, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: 'auto' };
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
      y: randomBetween(-1.5, 1.5), duration: randomBetween(.28, .42),
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
      duration: .18, yoyo: true, repeat: 3, ease: 'sine.inOut', overwrite: 'auto',
    });
    this._trackFor(tween, { idle });
    return this;
  }

  _swayLegs({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.legs) return this;
    const tween = gsap.to(this.legs, {
      rotation: randomBetween(-3, 3), svgOrigin: '548 1030',
      duration: .28, yoyo: true, repeat: 3, ease: 'sine.inOut', overwrite: 'auto',
    });
    this._trackFor(tween, { idle });
    return this;
  }

  adjustHat({ idle = false } = {}) {
    const gsap = this._gsap();
    if (!gsap || !this.hat) return this;
    const tween = gsap.to(this.hat, {
      rotation: randomBetween(5, 8), svgOrigin: '548 330',
      duration: .22, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: 'auto',
    });
    this._trackFor(tween, { idle });
    return this;
  }

  jump(targetX = this.x, targetY = this.y, onComplete) {
    const gsap = this._gsap();
    if (!gsap) {
      this.setPositionImmediate(targetX, targetY, false);
      onComplete?.();
      return this;
    }
    this.stopAction();
    const position = { x: this.x, y: this.y };
    const startY = this.y;
    const tl = gsap.timeline({
      defaults: { overwrite: 'auto' },
      onComplete: () => { this._setPosition(targetX, targetY); onComplete?.(); },
    });
    tl.to(this.actor, { scaleX: 1.2, scaleY: .8, duration: .18, transformOrigin: 'center bottom', ease: 'power2.in' })
      .to(position, { x: targetX, y: Math.min(startY, targetY) - 150, duration: .45, ease: 'power2.out', onUpdate: () => this._setPosition(position.x, position.y) }, '<')
      .to(this.actor, { scaleX: .85, scaleY: 1.25, duration: .22, transformOrigin: 'center bottom' })
      .to(position, { x: targetX, y: targetY, duration: .55, ease: 'power2.in', onUpdate: () => this._setPosition(position.x, position.y) })
      .to(this.actor, { scaleX: 1.08, scaleY: .92, duration: .11, transformOrigin: 'center bottom' })
      .to(this.actor, { scaleX: 1, scaleY: 1, duration: .2, ease: 'elastic.out(1, .45)' });
    return this._trackAction(tl);
  }

  inflate(durationSeconds = 5, onPushTrigger) {
    const gsap = this._gsap();
    if (!gsap) {
      onPushTrigger?.();
      return this;
    }
    this.stopAction();
    const timeline = gsap.timeline({ defaults: { overwrite: 'auto' }, onComplete: () => onPushTrigger?.() });
    timeline.to(this.actor, { scaleX: 1.3, scaleY: 1.25, duration: .6, transformOrigin: 'center bottom', ease: 'back.out(2)' })
      .to({}, { duration: Math.max(0, Number(durationSeconds) || 5) })
      .to(this.actor, { scaleX: 1, scaleY: 1, duration: .6, transformOrigin: 'center bottom', ease: 'elastic.out(1, .5)' });
    return this._trackAction(timeline);
  }

  morphAndFly(form, targetX, targetY, groundY = 980) {
    this.root.dataset.form = form || 'fly';
    this.root.classList.add('is-flying');
    return this.jump(targetX, targetY, () => {
      this.isAirborne = targetY < groundY - 80;
      this.root.classList.toggle('is-airborne', this.isAirborne);
      this.root.classList.remove('is-flying');
    });
  }

  evolve(newStage) {
    this.data.stage = newStage;
    this.root.dataset.stage = newStage;
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

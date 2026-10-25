/**
 * WitchAssistant - Animated witch character (Neco-Arc Halloween witch)
 * who walks out from offscreen when pumpkin face/accessories change,
 * performs a hand-casting magic animation, and transforms the pumpkin.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const WITCH_PARTS_METADATA = Object.freeze({
  head: { x: 197, y: 97, width: 669, height: 559, pivotX: 504, pivotY: 591 },
  hat: { x: 496, y: 0, width: 319, height: 256, pivotX: 645, pivotY: 220 },
  torso: { x: 258, y: 573, width: 477, height: 449, pivotX: 492, pivotY: 780 },
  arm_left: { x: 27, y: 539, width: 401, height: 163, pivotX: 407, pivotY: 626 },
  arm_right: { x: 549, y: 573, width: 437, height: 175, pivotX: 573, pivotY: 643 },
  wing_left: { x: 175, y: 543, width: 283, height: 248, pivotX: 419, pivotY: 664 },
  wing_right: { x: 567, y: 545, width: 310, height: 301, pivotX: 581, pivotY: 681 },
  leg_left: { x: 297, y: 912, width: 200, height: 425, pivotX: 422, pivotY: 957 },
  leg_right: { x: 468, y: 942, width: 182, height: 417, pivotX: 560, pivotY: 962 },
  tail: { x: 645, y: 892, width: 261, height: 236, pivotX: 678, pivotY: 920 },
});

export const WITCH_BASE_VIEWBOX = Object.freeze({ width: 1013, height: 1382 });

export const SCENE_WIDTH = 1920;
export const SCENE_HEIGHT = 1080;

function node(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export class WitchAssistant {
  constructor(container, { scale = 0.20, walkSpeed = 560 } = {}) {
    this.container = container;
    this.scale = scale;
    this.walkSpeed = walkSpeed; // logical px per second
    this.x = -200;
    this.y = 1040;
    this.facing = 1; // 1 = right, -1 = left
    this.isBusy = false;
    this.missionQueue = [];
    this.activeTweens = [];
    this.activeTimers = [];

    this._buildDom();
    this.hide();
  }

  _buildDom() {
    this.element = document.createElement('div');
    this.element.className = 'witch-assistant';
    const widthPercent = (WITCH_BASE_VIEWBOX.width * this.scale / SCENE_WIDTH) * 100;
    this.element.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: ${widthPercent}%;
      height: auto;
      aspect-ratio: ${WITCH_BASE_VIEWBOX.width} / ${WITCH_BASE_VIEWBOX.height};
      pointer-events: none;
      z-index: 9999;
      will-change: left, top, transform;
      visibility: hidden;
      overflow: visible;
    `;

    this.svg = node('svg', {
      class: 'witch-svg',
      viewBox: `0 0 ${WITCH_BASE_VIEWBOX.width} ${WITCH_BASE_VIEWBOX.height}`,
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'xMidYMid meet',
      'aria-hidden': 'true',
      style: 'overflow: visible;',
    });

    this.rootGroup = node('g', { class: 'witch-root' });

    // Build joints using metadata
    this.joints = {};
    this.rotators = {};

    const createJoint = (key, imgFile, parentPivot = null) => {
      const meta = WITCH_PARTS_METADATA[key];
      const px = parentPivot ? meta.pivotX - parentPivot.pivotX : meta.pivotX;
      const py = parentPivot ? meta.pivotY - parentPivot.pivotY : meta.pivotY;
      const joint = node('g', {
        class: `joint-${key.replace('_', '-')}`,
        transform: `translate(${px} ${py})`,
      });
      const rotator = node('g', { class: 'rotator' });
      const img = node('image', {
        href: `/assets/witch/${imgFile}`,
        x: String(meta.x - meta.pivotX),
        y: String(meta.y - meta.pivotY),
        width: String(meta.width),
        height: String(meta.height),
        preserveAspectRatio: 'none',
      });
      rotator.append(img);
      joint.append(rotator);
      this.joints[key] = joint;
      this.rotators[key] = rotator;
      return joint;
    };

    const wingL = createJoint('wing_left', 'wing_left.png');
    const wingR = createJoint('wing_right', 'wing_right.png');
    const tail = createJoint('tail', 'tail.png');
    const legL = createJoint('leg_left', 'leg_left.png');
    const legR = createJoint('leg_right', 'leg_right.png');
    const torso = createJoint('torso', 'torso.png');
    const head = createJoint('head', 'head.png');
    const hat = createJoint('hat', 'hat.png', WITCH_PARTS_METADATA.head);
    this.rotators.head.append(hat);
    const armL = createJoint('arm_left', 'arm_left.png');
    const armR = createJoint('arm_right', 'arm_right.png');

    // Magic effects group for stars / sparkles
    this.fxGroup = node('g', { class: 'witch-magic-fx' });

    // Layering order from back to front:
    this.rootGroup.append(
      tail,
      wingL, wingR,
      legL, legR,
      torso,
      head,
      armL, armR,
      this.fxGroup
    );

    this.svg.append(this.rootGroup);
    this.element.append(this.svg);
    if (this.container) this.container.append(this.element);

    this._ensureOrigins();
    this._setPose('idle');
  }

  _ensureOrigins() {
    if (typeof gsap === 'undefined') return;
    for (const [key, meta] of Object.entries(WITCH_PARTS_METADATA)) {
      const rotator = this.rotators[key];
      if (rotator) {
        gsap.set(rotator, {
          transformOrigin: `${meta.pivotX - meta.x}px ${meta.pivotY - meta.y}px`,
        });
      }
    }
    if (this.rootGroup) {
      // Bottom anchor at feet for organic squash & stretch
      gsap.set(this.rootGroup, { transformOrigin: '492px 1350px' });
    }
  }

  show() {
    this.element.style.visibility = 'visible';
  }

  hide() {
    this.element.style.visibility = 'hidden';
    this._stopAnimations();
  }

  setPosition(x, y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    // Ground anchor is bottom of boots at X=50%, Y=98%
    const leftPercent = (this.x / SCENE_WIDTH) * 100;
    const topPercent = (this.y / SCENE_HEIGHT) * 100;
    this.element.style.left = `${leftPercent}%`;
    this.element.style.top = `${topPercent}%`;
    // Base sprite naturally faces left (scaleX(1) is left).
    // Facing right (this.facing = 1) flips horizontally to scaleX(-1).
    // Facing left (this.facing = -1) keeps scaleX(1).
    const scaleX = this.facing >= 0 ? -1 : 1;
    this.element.style.transform = `translate(-50%, -98%) scaleX(${scaleX})`;
  }

  setFacing(direction) {
    this.facing = direction >= 0 ? 1 : -1;
    this.setPosition(this.x, this.y);
  }

  _setPose(pose) {
    if (typeof gsap === 'undefined') return;
    this._ensureOrigins();

    if (pose === 'idle') {
      gsap.set(this.rotators.arm_left, { rotation: -35, y: 0 });
      gsap.set(this.rotators.arm_right, { rotation: 35, y: 0 });
      gsap.set(this.rotators.leg_left, { rotation: 0, y: 0 });
      gsap.set(this.rotators.leg_right, { rotation: 0, y: 0 });
      gsap.set(this.rotators.wing_left, { rotation: 0, scaleX: 1, scaleY: 1, y: 0 });
      gsap.set(this.rotators.wing_right, { rotation: 0, scaleX: 1, scaleY: 1, y: 0 });
      gsap.set(this.rotators.tail, { rotation: 0, y: 0 });
      gsap.set(this.rotators.head, { rotation: 0, y: 0 });
      gsap.set(this.rotators.hat, { rotation: 0, y: 0 });
      gsap.set(this.rotators.torso, { rotation: 0, y: 0, scaleX: 1, scaleY: 1 });
      gsap.set(this.rootGroup, { y: 0, scaleX: 1, scaleY: 1 });
    }
  }

  settleToIdle(duration = 0.25) {
    this._stopAnimations();
    this._ensureOrigins();
    if (typeof gsap === 'undefined') return Promise.resolve();

    return new Promise((resolve) => {
      const tweens = [
        gsap.to(this.rotators.leg_left, { rotation: 0, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.leg_right, { rotation: 0, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.arm_left, { rotation: -35, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.arm_right, { rotation: 35, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.torso, { rotation: 0, y: 0, scaleX: 1, scaleY: 1, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.head, { rotation: 0, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.hat, { rotation: 0, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.wing_left, { rotation: 0, scaleX: 1, scaleY: 1, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.wing_right, { rotation: 0, scaleX: 1, scaleY: 1, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rotators.tail, { rotation: 0, y: 0, duration, ease: 'power2.out' }),
        gsap.to(this.rootGroup, { y: 0, scaleX: 1, scaleY: 1, duration, ease: 'power2.out' }),
      ];
      this.activeTweens.push(...tweens);
      this._scheduleTimer(resolve, duration * 1000);
    });
  }

  _stopAnimations() {
    this.activeTweens.forEach((t) => t?.kill?.());
    this.activeTweens = [];
    this.activeTimers.forEach((timer) => clearTimeout(timer));
    this.activeTimers = [];
  }

  _scheduleTimer(fn, delayMs) {
    const timer = setTimeout(() => {
      const idx = this.activeTimers.indexOf(timer);
      if (idx !== -1) this.activeTimers.splice(idx, 1);
      fn();
    }, delayMs);
    this.activeTimers.push(timer);
    return timer;
  }

  _getEffectiveScreenWidth() {
    return this.screenWidth || this.container?.clientWidth || 1920;
  }

  startIdle() {
    this._stopAnimations();
    this._ensureOrigins();
    if (typeof gsap === 'undefined') return;

    // Organic breathing cycle: chest expands gently upward
    const torsoBreath = gsap.to(this.rotators.torso, {
      y: -3,
      scaleY: 1.015,
      scaleX: 0.992,
      duration: 1.35,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    // Head follows chest with subtle phase lag (soft inertia)
    const headTilt = gsap.to(this.rotators.head, {
      rotation: 2.2,
      y: -1.5,
      duration: 1.35,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: 0.12,
    });

    const hatFollow = gsap.to(this.rotators.hat, {
      rotation: 1.2,
      duration: 1.35,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: 0.18,
    });

    // Arms breathe very softly with chest
    const armL = gsap.to(this.rotators.arm_left, {
      rotation: -39,
      duration: 1.35,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    const armR = gsap.to(this.rotators.arm_right, {
      rotation: 39,
      duration: 1.35,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    // Wings have a gentle resting flutter with slight 3D perspective folding
    const wingL = gsap.to(this.rotators.wing_left, {
      rotation: -8,
      scaleX: 0.92,
      scaleY: 0.98,
      duration: 1.1,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    const wingR = gsap.to(this.rotators.wing_right, {
      rotation: 8,
      scaleX: 0.92,
      scaleY: 0.98,
      duration: 1.1,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: 0.08,
    });

    // Cat tail sways smoothly in a relaxed S-curve
    const tailSway = gsap.to(this.rotators.tail, {
      rotation: 14,
      duration: 1.5,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    this.activeTweens.push(torsoBreath, headTilt, hatFollow, armL, armR, wingL, wingR, tailSway);
  }

  startWalk() {
    this._stopAnimations();
    if (typeof gsap === 'undefined') return;
    this._ensureOrigins();

    const stepTime = 0.22; // Half-stride duration (one step)

    // 1. Legs: natural walk cycle with forward lift and backward push
    const legL = gsap.fromTo(this.rotators.leg_left,
      { rotation: -24, y: 0 },
      { rotation: 24, y: -10, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );
    const legR = gsap.fromTo(this.rotators.leg_right,
      { rotation: 24, y: -10 },
      { rotation: -24, y: 0, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    // 2. Body step bounce: drops at foot plant, rises at passing phase (2 bounces per full stride)
    const bodyBounce = gsap.fromTo(this.rootGroup,
      { y: 0 },
      { y: -9, duration: stepTime / 2, ease: 'power1.out', yoyo: true, repeat: -1 }
    );

    // 3. Torso: forward lean with locomotion momentum
    const torsoLean = gsap.fromTo(this.rotators.torso,
      { rotation: 2, y: 0 },
      { rotation: 5, y: -2, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    // 4. Head: secondary motion / inertia (lags body bounce with soft bobbing)
    const headInertia = gsap.fromTo(this.rotators.head,
      { rotation: -2, y: -2 },
      { rotation: 2.5, y: 2, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.04 }
    );

    const hatBob = gsap.fromTo(this.rotators.hat,
      { rotation: -3, y: -1 },
      { rotation: 3, y: 1, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.08 }
    );

    // 5. Arms: fluid counter-swing tracing natural arcs
    const armL = gsap.fromTo(this.rotators.arm_left,
      { rotation: -18, y: 0 },
      { rotation: -52, y: -4, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );
    const armR = gsap.fromTo(this.rotators.arm_right,
      { rotation: 52, y: -4 },
      { rotation: 18, y: 0, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    // 6. Wings: energetic flight flutter with 3D folding & foreshortening
    const wingL = gsap.fromTo(this.rotators.wing_left,
      { rotation: -20, scaleX: 1.08, scaleY: 1.02 },
      { rotation: 16, scaleX: 0.80, scaleY: 0.96, duration: 0.13, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );
    const wingR = gsap.fromTo(this.rotators.wing_right,
      { rotation: 20, scaleX: 1.08, scaleY: 1.02 },
      { rotation: -16, scaleX: 0.80, scaleY: 0.96, duration: 0.13, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.025 }
    );

    // 7. Tail: trailing wave motion following movement
    const tailWave = gsap.fromTo(this.rotators.tail,
      { rotation: -10, y: 0 },
      { rotation: 16, y: -3, duration: stepTime * 1.15, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    this.activeTweens.push(legL, legR, bodyBounce, torsoLean, headInertia, hatBob, armL, armR, wingL, wingR, tailWave);
  }

  performMagic(duration = 1.5, options = {}) {
    const onClimax = typeof options === 'function' ? options : options?.onClimax;
    this._stopAnimations();
    if (typeof gsap === 'undefined') {
      if (typeof onClimax === 'function') onClimax();
      return Promise.resolve();
    }
    this._ensureOrigins();

    return new Promise((resolve) => {
      let climaxFired = false;
      const fireClimax = () => {
        if (!climaxFired) {
          climaxFired = true;
          if (typeof onClimax === 'function') onClimax();
        }
      };

      // Phase 1: Wind-up & Gathering Arcane Energy (0.24s)
      gsap.to(this.rootGroup, { y: 6, scaleY: 0.95, scaleX: 1.04, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.torso, { rotation: 5, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.arm_left, { rotation: -15, y: 4, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.arm_right, { rotation: 15, y: 4, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.head, { rotation: 3, y: 2, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.hat, { rotation: 3, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.wing_left, { rotation: 14, scaleX: 0.75, scaleY: 0.94, duration: 0.24, ease: 'power2.in' });
      gsap.to(this.rotators.wing_right, { rotation: -14, scaleX: 0.75, scaleY: 0.94, duration: 0.24, ease: 'power2.in' });

      // Phase 2: Spell Release & Floating Hover (at 0.24s)
      this._scheduleTimer(() => {
        // Body lifts into a floating hover
        const bodyHover = gsap.fromTo(this.rootGroup,
          { y: -14, scaleY: 1.02, scaleX: 0.98 },
          { y: -20, scaleY: 0.99, scaleX: 1.01, duration: 0.42, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );

        // Torso straightens with focus
        const torsoFocus = gsap.to(this.rotators.torso, { rotation: -2, y: 0, duration: 0.3, ease: 'power2.out' });

        // Head tilts with magical intensity
        const headFocus = gsap.fromTo(this.rotators.head,
          { rotation: -4, y: -2 },
          { rotation: -1, y: 0, duration: 0.35, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );

        const hatMagic = gsap.fromTo(this.rotators.hat,
          { rotation: -3 },
          { rotation: 3, duration: 0.28, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );

        // Wings flutter with high excitement and 3D folding while hovering
        const wingL = gsap.fromTo(this.rotators.wing_left,
          { rotation: -26, scaleX: 1.10, scaleY: 1.03 },
          { rotation: 22, scaleX: 0.76, scaleY: 0.95, duration: 0.085, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );
        const wingR = gsap.fromTo(this.rotators.wing_right,
          { rotation: 26, scaleX: 1.10, scaleY: 1.03 },
          { rotation: -22, scaleX: 0.76, scaleY: 0.95, duration: 0.085, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.02 }
        );

        // Tail lashes with magical energy
        const tailLash = gsap.fromTo(this.rotators.tail,
          { rotation: -20 },
          { rotation: 20, duration: 0.13, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );

        // Legs dangle naturally while hovering
        const legL = gsap.to(this.rotators.leg_left, { rotation: -6, y: 2, duration: 0.3, ease: 'sine.out' });
        const legR = gsap.to(this.rotators.leg_right, { rotation: 6, y: 4, duration: 0.3, ease: 'sine.out' });

        // Hands weave spells in complementary circular arcs
        const waveL = gsap.fromTo(this.rotators.arm_left,
          { rotation: 20, y: -4 },
          { rotation: 40, y: 4, duration: 0.17, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );
        const waveR = gsap.fromTo(this.rotators.arm_right,
          { rotation: -20, y: 4 },
          { rotation: -40, y: -4, duration: 0.17, ease: 'sine.inOut', yoyo: true, repeat: -1 }
        );

        this.activeTweens.push(bodyHover, torsoFocus, headFocus, hatMagic, wingL, wingR, tailLash, legL, legR, waveL, waveR);

        // Magic sparkles radiate
        this._emitSparkles(duration - 0.24);
      }, 240);

      // Climax transformation moment (at ~60% of duration)
      this._scheduleTimer(() => {
        fireClimax();
      }, duration * 1000 * 0.60);

      // Climax completion
      this._scheduleTimer(() => {
        fireClimax();
        resolve();
      }, duration * 1000 * 0.75);
    });
  }

  _emitSparkles(duration) {
    const count = 18;
    const colors = ['#ffda44', '#ff851b', '#d65dff', '#ffffff', '#ffd000', '#ff5400'];
    const starShapes = [
      'M0,-16 Q0,0 16,0 Q0,0 0,16 Q0,0 -16,0 Q0,0 0,-16Z', // 4-point star
      'M0,-12 L3,-4 L11,-4 L5,2 L7,10 L0,5 L-7,10 L-5,2 L-11,-4 L-3,-4 Z', // 5-point star
      'M0,-10 L7,0 L0,10 L-7,0 Z', // Diamond crystal
    ];

    for (let i = 0; i < count; i++) {
      this._scheduleTimer(() => {
        const star = node('path', {
          d: starShapes[i % starShapes.length],
          fill: colors[i % colors.length],
          stroke: '#ffffff',
          'stroke-width': '1.5',
        });
        // In local SVG space (1013x1382), witch's forward-reaching hands are at X ~ 180, Y ~ 640
        const spawnX = 180 + (Math.random() * 60 - 30);
        const spawnY = 640 + (Math.random() * 60 - 30);
        star.setAttribute('transform', `translate(${spawnX} ${spawnY}) scale(0)`);
        this.fxGroup.append(star);

        if (typeof gsap !== 'undefined') {
          const targetX = spawnX - (100 + Math.random() * 110);
          const targetY = spawnY - 50 + (Math.random() * 100 - 50);
          gsap.to(star, {
            attr: { transform: `translate(${targetX} ${targetY}) scale(${0.7 + Math.random() * 0.9}) rotate(${Math.random() * 360})` },
            opacity: 0,
            duration: 0.65 + Math.random() * 0.45,
            ease: 'power2.out',
            onComplete: () => star.remove(),
          });
        } else {
          this._scheduleTimer(() => star.remove(), 700);
        }
      }, (i * (duration * 1000 * 0.65)) / count);
    }
  }

  _emitCelebrationSparkles() {
    const count = 12;
    const colors = ['#ffda44', '#ffd000', '#ffffff', '#ff9e00'];
    for (let i = 0; i < count; i++) {
      const star = node('path', {
        d: 'M0,-14 Q0,0 14,0 Q0,0 0,14 Q0,0 -14,0 Q0,0 0,-14Z',
        fill: colors[i % colors.length],
        stroke: '#ffffff',
        'stroke-width': '1.5',
      });
      // Around chest center (504, 600)
      const spawnX = 504 + (Math.random() * 240 - 120);
      const spawnY = 600 + (Math.random() * 100 - 50);
      star.setAttribute('transform', `translate(${spawnX} ${spawnY}) scale(0)`);
      this.fxGroup.append(star);

      if (typeof gsap !== 'undefined') {
        const angle = (i / count) * Math.PI * 2;
        const dist = 60 + Math.random() * 60;
        const targetX = spawnX + Math.cos(angle) * dist;
        const targetY = spawnY + Math.sin(angle) * dist - 30;
        gsap.to(star, {
          attr: { transform: `translate(${targetX} ${targetY}) scale(${0.8 + Math.random() * 0.7}) rotate(${Math.random() * 180})` },
          opacity: 0,
          duration: 0.5 + Math.random() * 0.35,
          ease: 'power2.out',
          onComplete: () => star.remove(),
        });
      } else {
        this._scheduleTimer(() => star.remove(), 600);
      }
    }
  }

  celebrate() {
    this._stopAnimations();
    this._ensureOrigins();
    if (typeof gsap === 'undefined') return Promise.resolve();

    return new Promise((resolve) => {
      // 1. Anticipation: cute crouch
      gsap.to(this.rootGroup, {
        y: 8,
        scaleY: 0.92,
        scaleX: 1.05,
        duration: 0.13,
        ease: 'power2.in',
        onComplete: () => {
          // 2. Ta-da! Explosive upward hop
          gsap.to(this.rotators.arm_left, { rotation: 35, y: -6, duration: 0.22, ease: 'back.out(2)' });
          gsap.to(this.rotators.arm_right, { rotation: -35, y: -6, duration: 0.22, ease: 'back.out(2)' });
          gsap.to(this.rotators.wing_left, { rotation: 28, scaleX: 1.15, scaleY: 1.05, duration: 0.22, ease: 'back.out(1.7)' });
          gsap.to(this.rotators.wing_right, { rotation: -28, scaleX: 1.15, scaleY: 1.05, duration: 0.22, ease: 'back.out(1.7)' });
          gsap.to(this.rotators.tail, { rotation: -22, duration: 0.22, ease: 'power2.out' });
          gsap.to(this.rotators.head, { rotation: -5, y: -3, duration: 0.22, ease: 'power2.out' });
          gsap.to(this.rotators.hat, { rotation: 8, duration: 0.20, ease: 'power2.out' });

          // Burst celebration sparks
          this._emitCelebrationSparkles();

          gsap.to(this.rootGroup, {
            y: -36,
            scaleY: 1.08,
            scaleX: 0.95,
            duration: 0.22,
            ease: 'power1.out',
            yoyo: true,
            repeat: 1,
            onComplete: () => {
              // 3. Springy landing cushion
              gsap.fromTo(this.rootGroup,
                { scaleY: 0.94, scaleX: 1.04 },
                { scaleY: 1, scaleX: 1, y: 0, duration: 0.35, ease: 'elastic.out(1.2, 0.45)' }
              );
              this.settleToIdle(0.28).then(resolve);
            },
          });
        },
      });
    });
  }

  walkTo(targetX, targetY) {
    if (typeof gsap === 'undefined') {
      this.setPosition(targetX, targetY);
      return Promise.resolve();
    }

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.hypot(dx, dy);
    const duration = Math.max(0.4, distance / this.walkSpeed);

    if (Math.abs(dx) > 1) {
      this.setFacing(dx >= 0 ? 1 : -1);
    }
    this.startWalk();

    const targetObj = { x: this.x, y: this.y };
    return new Promise((resolve) => {
      const tween = gsap.to(targetObj, {
        x: targetX,
        y: targetY,
        duration,
        ease: 'power1.inOut',
        onUpdate: () => {
          this.setPosition(targetObj.x, targetObj.y);
        },
        onComplete: async () => {
          await this.settleToIdle(0.24);
          resolve();
        },
      });
      this.activeTweens.push(tween);
    });
  }

  cancelMissionsForCharacter(pumpkinCharacter) {
    if (!pumpkinCharacter) return;
    const charId = pumpkinCharacter?.data?.id || pumpkinCharacter?.id;
    this.missionQueue = this.missionQueue.filter((mission) => {
      const missionChar = mission.pumpkinCharacter;
      const mId = missionChar?.data?.id || missionChar?.id;
      if (missionChar === pumpkinCharacter) return false;
      if (charId && mId && charId === mId) return false;
      return true;
    });
  }

  /**
   * Customization transformation mission:
   * 1. Walks to pumpkin
   * 2. Casts magic with hand animation
   * 3. Transforms pumpkin via onApply()
   * 4. Exits offscreen
   */
  queueMission({ pumpkinCharacter, targetCustomization, onApply, groundY = 1040, side = null }) {
    this.missionQueue.push({
      type: 'customization',
      pumpkinCharacter,
      targetCustomization,
      onApply,
      groundY,
      side,
    });
    if (!this.isBusy) this._processNextMission();
  }

  /**
   * Donation spawn mission:
   * 1. Witch walks in to spawn coordinates along the bottom edge of widget
   * 2. Faces the target spot
   * 3. Casts magic with hand movements
   * 4. Summons leaf drift ("сугроб листьев - частиц") in front of her
   * 5. Inside the drift, reveals the new pumpkin as leaves fall & disappear
   * 6. Celebrates with ta-da hop and exits offscreen
   */
  queueSpawnMission({
    pumpkinCharacter,
    targetX,
    targetY,
    groundY = 1040,
    side = null,
    onSpawnLeafDrift = null,
    onRevealPumpkin = null,
    onComplete = null,
  }) {
    this.missionQueue.push({
      type: 'spawn',
      pumpkinCharacter,
      targetX,
      targetY,
      groundY,
      side,
      onSpawnLeafDrift,
      onRevealPumpkin,
      onComplete,
    });
    if (!this.isBusy) this._processNextMission();
  }

  async _processNextMission() {
    if (this.missionQueue.length === 0) {
      this.isBusy = false;
      this.hide();
      return;
    }

    this.isBusy = true;
    const mission = this.missionQueue.shift();
    const type = mission.type || 'customization';

    if (type === 'spawn') {
      await this._executeSpawnMission(mission);
    } else {
      await this._executeCustomizationMission(mission);
    }

    this._processNextMission();
  }

  async _executeCustomizationMission(mission) {
    const { pumpkinCharacter, onApply, groundY, side } = mission;

    // Target pumpkin coords
    const pX = Number.isFinite(pumpkinCharacter?.x) ? pumpkinCharacter.x : 960;
    const pY = Number.isFinite(pumpkinCharacter?.y) ? pumpkinCharacter.y : groundY;

    let startFromLeft;
    if (side === 'left') {
      startFromLeft = true;
    } else if (side === 'right') {
      startFromLeft = false;
    } else {
      // Pick random side: left or right, considering pumpkin proximity to edges
      startFromLeft = pX > 400 && (pX > SCENE_WIDTH - 400 || Math.random() < 0.5);
    }

    const startX = startFromLeft ? -150 : SCENE_WIDTH + 150;
    const standOffset = startFromLeft ? -150 : 150;
    const targetStandX = Math.max(80, Math.min(SCENE_WIDTH - 80, pX + standOffset));

    this.setPosition(startX, pY);
    this.setFacing(startFromLeft ? 1 : -1);
    this.show();

    // 1. Walk to pumpkin
    await this.walkTo(targetStandX, pY);

    // Face the pumpkin directly
    this.setFacing(pX >= this.x ? 1 : -1);
    if (typeof gsap !== 'undefined') {
      await new Promise((r) => this._scheduleTimer(r, 120));
    }

    // 2. Perform magic casting with hands
    await this.performMagic(1.5);

    // 3. Transformation moment!
    if (typeof onApply === 'function') {
      onApply();
    }

    // Pop bounce on pumpkin
    if (pumpkinCharacter?.root && typeof gsap !== 'undefined') {
      gsap.fromTo(pumpkinCharacter.root,
        { scale: 1.22 },
        { scale: 1, duration: 0.5, ease: 'elastic.out(1.3, 0.35)' }
      );
    }

    // 4. Celebration
    await this.celebrate();
    if (typeof gsap !== 'undefined') {
      await new Promise((r) => this._scheduleTimer(r, 200));
    }

    // 5. Exit off-screen
    const exitX = this.x < SCENE_WIDTH / 2 ? -200 : SCENE_WIDTH + 200;
    await this.walkTo(exitX, pY);

    this.hide();
  }

  async _executeSpawnMission(mission) {
    const {
      pumpkinCharacter,
      targetX,
      targetY,
      groundY = 1040,
      side,
      onSpawnLeafDrift,
      onRevealPumpkin,
      onComplete,
    } = mission;

    // Check if pumpkin character was destroyed before witch arrived
    if (pumpkinCharacter?.destroyed) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    const pX = Number.isFinite(targetX) ? targetX : (Number.isFinite(pumpkinCharacter?.x) ? pumpkinCharacter.x : 960);
    const pY = Number.isFinite(targetY) ? targetY : (Number.isFinite(pumpkinCharacter?.y) ? pumpkinCharacter.y : groundY);

    // Ensure pumpkin is hidden while witch approaches
    if (pumpkinCharacter?.root?.style) {
      pumpkinCharacter.root.style.opacity = '0';
      pumpkinCharacter.root.style.visibility = 'hidden';
      pumpkinCharacter.root.style.pointerEvents = 'none';
    }

    let startFromLeft;
    if (side === 'left') {
      startFromLeft = true;
    } else if (side === 'right') {
      startFromLeft = false;
    } else {
      if (pX < 320) {
        startFromLeft = false; // approach from right to stand at pX + 150
      } else if (pX > SCENE_WIDTH - 320) {
        startFromLeft = true; // approach from left to stand at pX - 150
      } else {
        startFromLeft = Math.random() < 0.5;
      }
    }

    const startX = startFromLeft ? -150 : SCENE_WIDTH + 150;
    const standOffset = startFromLeft ? -150 : 150;
    const targetStandX = Math.max(80, Math.min(SCENE_WIDTH - 80, pX + standOffset));

    this.setPosition(startX, pY);
    this.setFacing(startFromLeft ? 1 : -1);
    this.show();

    // 1. Walk to pumpkin spawn location along the bottom edge
    await this.walkTo(targetStandX, pY);

    // Face the spawn point directly
    this.setFacing(pX >= this.x ? 1 : -1);
    if (typeof gsap !== 'undefined') {
      await new Promise((r) => this._scheduleTimer(r, 120));
    }

    // 2. Perform magic casting with hands
    let driftSpawned = false;
    let pumpkinRevealed = false;

    await this.performMagic(1.8, {
      onClimax: () => {
        if (!driftSpawned) {
          driftSpawned = true;
          if (typeof onSpawnLeafDrift === 'function') {
            onSpawnLeafDrift(pX, pY);
          }
        }
      },
    });

    // 3. Reveal pumpkin from the leaf drift pile (guaranteed before celebration)
    if (!pumpkinRevealed) {
      pumpkinRevealed = true;
      if (typeof onRevealPumpkin === 'function') {
        onRevealPumpkin();
      }
    }

    // 4. Ta-da! Celebration
    await this.celebrate();
    if (typeof gsap !== 'undefined') {
      await new Promise((r) => this._scheduleTimer(r, 200));
    }

    // 4. Exit off-screen
    const exitX = this.x < SCENE_WIDTH / 2 ? -200 : SCENE_WIDTH + 200;
    await this.walkTo(exitX, pY);

    this.hide();

    if (typeof onComplete === 'function') {
      onComplete();
    }
  }

  destroy() {
    this._stopAnimations();
    this.missionQueue = [];
    this.element?.remove();
  }
}

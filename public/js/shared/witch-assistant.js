/**
 * WitchAssistant - Animated witch character (Neco-Arc Halloween witch)
 * who walks out from offscreen when pumpkin face/accessories change,
 * performs a hand-casting magic animation, and transforms the pumpkin.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const WITCH_PARTS_METADATA = Object.freeze({
  head: { x: 80, y: 21, width: 544, height: 450, pivotX: 365, pivotY: 440 },
  torso: { x: 179, y: 453, width: 347, height: 298, pivotX: 365, pivotY: 580 },
  arm_left: { x: 25, y: 421, width: 262, height: 110, pivotX: 265, pivotY: 485 },
  arm_right: { x: 413, y: 449, width: 298, height: 117, pivotX: 435, pivotY: 485 },
  wing_left: { x: 120, y: 420, width: 156, height: 186, pivotX: 265, pivotY: 465 },
  wing_right: { x: 425, y: 420, width: 194, height: 191, pivotX: 435, pivotY: 465 },
  leg_left: { x: 210, y: 640, width: 136, height: 368, pivotX: 280, pivotY: 680 },
  leg_right: { x: 345, y: 640, width: 126, height: 373, pivotX: 395, pivotY: 680 },
  tail: { x: 470, y: 705, width: 177, height: 131, pivotX: 485, pivotY: 715 },
});

export const WITCH_BASE_VIEWBOX = Object.freeze({ width: 731, height: 1024 });

export const SCENE_WIDTH = 1920;
export const SCENE_HEIGHT = 1080;

function node(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export class WitchAssistant {
  constructor(container, { scale = 0.26, walkSpeed = 560 } = {}) {
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
    `;

    this.svg = node('svg', {
      class: 'witch-svg',
      viewBox: `0 0 ${WITCH_BASE_VIEWBOX.width} ${WITCH_BASE_VIEWBOX.height}`,
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'xMidYMid meet',
      'aria-hidden': 'true',
    });

    this.rootGroup = node('g', { class: 'witch-root' });

    // Build joints using metadata
    this.joints = {};
    this.rotators = {};

    const createJoint = (key, imgFile) => {
      const meta = WITCH_PARTS_METADATA[key];
      const joint = node('g', {
        class: `joint-${key.replace('_', '-')}`,
        transform: `translate(${meta.pivotX} ${meta.pivotY})`,
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
    const armL = createJoint('arm_left', 'arm_left.png');
    const armR = createJoint('arm_right', 'arm_right.png');

    // Magic effects group for stars / sparkles
    this.fxGroup = node('g', { class: 'witch-magic-fx' });

    // Layering order from back to front:
    this.rootGroup.append(
      wingL, wingR,
      tail,
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
      gsap.set(this.rotators.arm_left, { rotation: -70 });
      gsap.set(this.rotators.arm_right, { rotation: 70 });
      gsap.set(this.rotators.leg_left, { rotation: 0 });
      gsap.set(this.rotators.leg_right, { rotation: 0 });
      gsap.set(this.rotators.wing_left, { rotation: 5 });
      gsap.set(this.rotators.wing_right, { rotation: -5 });
      gsap.set(this.rotators.tail, { rotation: 0 });
      gsap.set(this.rotators.head, { rotation: 0 });
      gsap.set(this.rotators.torso, { rotation: 0 });
    }
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
    this._setPose('idle');
    if (typeof gsap === 'undefined') return;

    // Wings flutter gently
    const wingTweenL = gsap.to(this.rotators.wing_left, {
      rotation: -12,
      duration: 0.7,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    const wingTweenR = gsap.to(this.rotators.wing_right, {
      rotation: 12,
      duration: 0.7,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    // Tail sways
    const tailTween = gsap.to(this.rotators.tail, {
      rotation: 15,
      duration: 1.2,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    // Breathing bob
    const torsoTween = gsap.to(this.rotators.torso, {
      y: 3,
      duration: 0.9,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    const headTween = gsap.to(this.rotators.head, {
      rotation: 3,
      y: 2,
      duration: 1.1,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    this.activeTweens.push(wingTweenL, wingTweenR, tailTween, torsoTween, headTween);
  }

  startWalk() {
    this._stopAnimations();
    if (typeof gsap === 'undefined') return;
    this._ensureOrigins();

    const stepTime = 0.22;

    // Legs swing back and forth
    const legL = gsap.fromTo(this.rotators.leg_left,
      { rotation: -26 },
      { rotation: 26, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );
    const legR = gsap.fromTo(this.rotators.leg_right,
      { rotation: 26 },
      { rotation: -26, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    // Arms counter-swing
    const armL = gsap.fromTo(this.rotators.arm_left,
      { rotation: -45 },
      { rotation: -85, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );
    const armR = gsap.fromTo(this.rotators.arm_right,
      { rotation: 85 },
      { rotation: 45, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    // Wings active flapping during flight/walk
    const wingL = gsap.fromTo(this.rotators.wing_left,
      { rotation: -18 },
      { rotation: 18, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );
    const wingR = gsap.fromTo(this.rotators.wing_right,
      { rotation: 18 },
      { rotation: -18, duration: stepTime, ease: 'sine.inOut', yoyo: true, repeat: -1 }
    );

    // Body step bounce
    const bodyBounce = gsap.to(this.rootGroup, {
      y: -8,
      duration: stepTime / 2,
      ease: 'sine.out',
      yoyo: true,
      repeat: -1,
    });

    this.activeTweens.push(legL, legR, armL, armR, wingL, wingR, bodyBounce);
  }

  performMagic(duration = 1.6) {
    this._stopAnimations();
    if (typeof gsap === 'undefined') return Promise.resolve();
    this._ensureOrigins();

    return new Promise((resolve) => {
      // Arms raise up in front to cast magic
      gsap.to(this.rotators.arm_left, { rotation: 25, duration: 0.35, ease: 'back.out(1.5)' });
      gsap.to(this.rotators.arm_right, { rotation: -25, duration: 0.35, ease: 'back.out(1.5)' });

      // Legs stand firm
      gsap.to(this.rotators.leg_left, { rotation: 0, duration: 0.2 });
      gsap.to(this.rotators.leg_right, { rotation: 0, duration: 0.2 });

      // Wings flap fast and excited
      const wingL = gsap.fromTo(this.rotators.wing_left,
        { rotation: -22 },
        { rotation: 22, duration: 0.12, ease: 'sine.inOut', yoyo: true, repeat: -1 }
      );
      const wingR = gsap.fromTo(this.rotators.wing_right,
        { rotation: 22 },
        { rotation: -22, duration: 0.12, ease: 'sine.inOut', yoyo: true, repeat: -1 }
      );

      // Tail swishes excitedly
      const tailTween = gsap.fromTo(this.rotators.tail,
        { rotation: -18 },
        { rotation: 18, duration: 0.15, ease: 'sine.inOut', yoyo: true, repeat: -1 }
      );

      // Hands wave / circle in casting gesture
      const waveL = gsap.fromTo(this.rotators.arm_left,
        { rotation: 15 },
        { rotation: 38, duration: 0.18, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.35 }
      );
      const waveR = gsap.fromTo(this.rotators.arm_right,
        { rotation: -15 },
        { rotation: -38, duration: 0.18, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.35 }
      );

      this.activeTweens.push(wingL, wingR, tailTween, waveL, waveR);

      // Magic sparkle bursts
      this._emitSparkles(duration);

      // Climax moment
      this._scheduleTimer(() => {
        resolve();
      }, duration * 1000 * 0.7);
    });
  }

  _emitSparkles(duration) {
    const count = 14;
    for (let i = 0; i < count; i++) {
      this._scheduleTimer(() => {
        const star = node('path', {
          d: 'M0,-14 Q0,0 14,0 Q0,0 0,14 Q0,0 -14,0 Q0,0 0,-14Z',
          fill: i % 2 === 0 ? '#ffda44' : '#ff952b',
          stroke: '#ffffff',
          'stroke-width': '2',
        });
        // In local SVG space, the witch's hands are at X ~ 160, Y ~ 480 (facing forward towards -X).
        // Since this.element flips via scaleX when facing right, local -X always points forward in front of her!
        const spawnX = 160 + (Math.random() * 60 - 30);
        const spawnY = 480 + (Math.random() * 60 - 30);
        star.setAttribute('transform', `translate(${spawnX} ${spawnY}) scale(0)`);
        this.fxGroup.append(star);

        if (typeof gsap !== 'undefined') {
          const targetX = spawnX - (80 + Math.random() * 80);
          const targetY = spawnY - 40 - Math.random() * 60;
          gsap.to(star, {
            attr: { transform: `translate(${targetX} ${targetY}) scale(${0.8 + Math.random() * 0.8}) rotate(${Math.random() * 180})` },
            opacity: 0,
            duration: 0.6 + Math.random() * 0.4,
            ease: 'power2.out',
            onComplete: () => star.remove(),
          });
        } else {
          this._scheduleTimer(() => star.remove(), 600);
        }
      }, (i * (duration * 1000 * 0.6)) / count);
    }
  }

  celebrate() {
    if (typeof gsap === 'undefined') return Promise.resolve();
    this._ensureOrigins();
    return new Promise((resolve) => {
      // Victory hop and "Ta-da!" pose
      this._stopAnimations();
      gsap.to(this.rotators.arm_left, { rotation: 65, duration: 0.25, ease: 'back.out(2)' });
      gsap.to(this.rotators.arm_right, { rotation: -65, duration: 0.25, ease: 'back.out(2)' });
      gsap.to(this.rootGroup, {
        y: -25,
        duration: 0.22,
        yoyo: true,
        repeat: 1,
        ease: 'power1.out',
        onComplete: () => {
          this.startIdle();
          this._scheduleTimer(resolve, 300);
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
        onComplete: () => {
          this._stopAnimations();
          this._setPose('idle');
          resolve();
        },
      });
      this.activeTweens.push(tween);
    });
  }

  /**
   * Main mission orchestrator:
   * 1. Spawns from random side of screen (or requested side)
   * 2. Walks to pumpkin
   * 3. Casts magic with hand animation
   * 4. Transforms pumpkin via onApply()
   * 5. Exits offscreen
   */
  queueMission({ pumpkinCharacter, targetCustomization, onApply, groundY = 1040, side = null }) {
    this.missionQueue.push({ pumpkinCharacter, targetCustomization, onApply, groundY, side });
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

    // 2. Perform magic casting with hands
    await this.performMagic(1.4);

    // 3. Transformation moment!
    if (typeof onApply === 'function') {
      onApply();
    }

    // Little pop bounce on pumpkin
    if (pumpkinCharacter?.root && typeof gsap !== 'undefined') {
      gsap.fromTo(pumpkinCharacter.root,
        { scale: 1.18 },
        { scale: 1, duration: 0.4, ease: 'elastic.out(1.2, 0.4)' }
      );
    }

    // 4. Little celebration
    await this.celebrate();

    // 5. Exit off-screen
    const exitX = this.x < SCENE_WIDTH / 2 ? -200 : SCENE_WIDTH + 200;
    await this.walkTo(exitX, pY);

    this.hide();

    // Check next mission
    this._processNextMission();
  }

  destroy() {
    this._stopAnimations();
    this.missionQueue = [];
    this.element?.remove();
  }
}

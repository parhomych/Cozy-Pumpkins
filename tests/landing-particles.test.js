import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Database } from '../src/db/database.js';
import {
  DEFAULT_LANDING_PARTICLES,
  LANDING_PARTICLE_LIMITS,
  sanitizeLandingParticles,
  isValidLandingParticles,
  landingParticlesPatch,
} from '../src/engine/landing-particles.js';
import { PumpkinCharacter } from '../public/js/shared/pumpkin-character.js';
import { PumpkinRenderer } from '../public/js/shared/pumpkin-renderer.js';
import { LeafParticleSystem } from '../public/js/shared/leaf-particles.js';

test('landing particles engine validates limits, defaults and patches', () => {
  assert.deepEqual(DEFAULT_LANDING_PARTICLES, {
    enabled: true,
    count: 16,
    size: 1,
    spread: 1,
    duration: 1.5,
  });

  // Valid inputs
  assert.equal(isValidLandingParticles({ enabled: true, count: 10 }), true);
  assert.equal(isValidLandingParticles({ size: 1.2, spread: 2.0, duration: 3.0 }), true);
  assert.equal(isValidLandingParticles({ count: 999 }), false);
  assert.equal(isValidLandingParticles({ size: -1 }), false);
  assert.equal(isValidLandingParticles(null), false);
  assert.equal(isValidLandingParticles('invalid'), false);

  // Sanitization falls back to safe defaults when out of limits
  const sanitizedHigh = sanitizeLandingParticles({ count: 100, size: 5, spread: 10, duration: 20 });
  assert.equal(sanitizedHigh.count, DEFAULT_LANDING_PARTICLES.count);
  assert.equal(sanitizedHigh.size, DEFAULT_LANDING_PARTICLES.size);
  assert.equal(sanitizedHigh.spread, DEFAULT_LANDING_PARTICLES.spread);
  assert.equal(sanitizedHigh.duration, DEFAULT_LANDING_PARTICLES.duration);

  // Sanitization preserves valid values within limits
  const sanitizedValid = sanitizeLandingParticles({ count: 24, size: 1.5, spread: 0.8, duration: 2.5, enabled: false });
  assert.equal(sanitizedValid.count, 24);
  assert.equal(sanitizedValid.size, 1.5);
  assert.equal(sanitizedValid.spread, 0.8);
  assert.equal(sanitizedValid.duration, 2.5);
  assert.equal(sanitizedValid.enabled, false);

  // Patch returns sanitized partial updates
  const patch = landingParticlesPatch({ count: 25, enabled: false });
  assert.equal(patch.count, 25);
  assert.equal(patch.enabled, false);
  assert.equal(patch.size, 1);
  assert.equal(landingParticlesPatch({ count: 'invalid' }), null);
});

test('database persists landing particles settings and survives reopen', () => {
  const db = new Database(':memory:');
  const initial = db.getSettings();
  assert.deepEqual(initial.landingParticles, DEFAULT_LANDING_PARTICLES);

  const updated = db.updateSettings({
    landingParticles: { enabled: false, count: 32, size: 1.8, spread: 1.4, duration: 2.2 },
  });
  assert.equal(updated.landingParticles.enabled, false);
  assert.equal(updated.landingParticles.count, 32);
  assert.equal(updated.landingParticles.size, 1.8);
  assert.equal(updated.landingParticles.spread, 1.4);
  assert.equal(updated.landingParticles.duration, 2.2);

  // Verification from row directly
  const readBack = db.getSettings();
  assert.deepEqual(readBack.landingParticles, {
    enabled: false,
    count: 32,
    size: 1.8,
    spread: 1.4,
    duration: 2.2,
  });

  // Rejection of invalid value
  assert.throws(() => {
    db.updateSettings({ landingParticles: { count: 999 } });
  }, /invalid_landing_particles/);

  db.close();
});

test('pumpkin character landing callback fires on hop and roll squash', () => {
  let landEvents = 0;
  const landedCoords = [];

  const character = Object.create(PumpkinCharacter.prototype);
  character.x = 200;
  character.y = 1080;
  character.stageSize = 120;
  character.velocity = { x: 0, y: 0 };
  character.supportY = 1080;
  character.physicsAccumulator = 0;
  character.physicsActive = false;
  character.isAirborne = false;
  character.destroyed = false;
  character.data = {};
  character.actor = {};
  character.tweens = new Set();
  character.actionTweens = new Set();
  character.stopAction = () => {};
  character._setPosition = (x, y) => { character.x = x; character.y = y; };
  character._trackAction = (t) => t;
  character._gsap = () => globalThis.gsap;
  character.onLand = (c) => {
    landEvents += 1;
    landedCoords.push({ x: c.x, y: c.y });
  };
  character.root = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {}, removeProperty() {} },
    dispatchEvent() {},
  };

  assert.equal(typeof character._triggerLanding, 'function');
  character._triggerLanding();
  assert.equal(landEvents, 1);
  assert.equal(landedCoords[0].x, 200);

  // Verify hopTo landing squash starts the callback
  const prevGsap = globalThis.gsap;
  const mockTimeline = {
    tweens: [],
    to(target, vars, pos) {
      this.tweens.push({ target, vars, pos });
      return this;
    },
    kill() {},
  };
  globalThis.gsap = {
    timeline: () => mockTimeline,
    set: () => {},
  };

  try {
    character.hopTo(400, 1080, { speed: 100 });
    const landingSquashTween = mockTimeline.tweens.find(
      (t) => t.target === character.actor && t.vars.scaleX === 1.18,
    );
    assert.ok(landingSquashTween, 'landing squash tween exists in hopTo');
    assert.equal(typeof landingSquashTween.vars.onStart, 'function');
    landingSquashTween.vars.onStart();
    assert.equal(landEvents, 2);

    // Verify rollTo landing squash starts the callback
    mockTimeline.tweens = [];
    character.rollTo(600, 1080, {}, { direction: 1 });
    const fallLandingSquash = mockTimeline.tweens.find(
      (t) => t.target === character.actor && t.vars.scaleX === 1.2,
    );
    assert.ok(fallLandingSquash, 'landing squash tween exists in rollTo after fall');
    assert.equal(typeof fallLandingSquash.vars.onStart, 'function');
    fallLandingSquash.vars.onStart();
    assert.equal(landEvents, 3);

    // Verify stack() landing squash starts the callback for index === 0 (base pumpkin)
    mockTimeline.tweens = [];
    character.stack(500, 1080, 0, 2);
    const stackLandingSquash = mockTimeline.tweens.find(
      (t) => t.target === character.actor && t.vars.scaleX === 1.06,
    );
    assert.ok(stackLandingSquash, 'landing squash tween exists in stack for base pumpkin');
    assert.equal(typeof stackLandingSquash.vars.onStart, 'function');
    stackLandingSquash.vars.onStart();
    assert.equal(landEvents, 4);

    // Verify stack() for index > 0 does NOT trigger landing
    mockTimeline.tweens = [];
    character.stack(500, 989, 1, 2);
    const topStackSquash = mockTimeline.tweens.find(
      (t) => t.target === character.actor && t.vars.scaleX === 1.06,
    );
    assert.ok(topStackSquash, 'landing squash tween exists in stack for top pumpkin');
    assert.equal(typeof topStackSquash.vars.onStart, 'function');
    topStackSquash.vars.onStart();
    assert.equal(landEvents, 4, 'top pumpkin in stack does not trigger landing callback');
  } finally {
    globalThis.gsap = prevGsap;
  }
});

test('leaf particle system spawns SVG leaves and cleans up on clear/destroy', () => {
  const container = {
    children: [],
    append(el) { this.children.push(el); },
    querySelector(sel) { return this.children.find((c) => c.className === sel.replace('.', '')) || null; },
    clientWidth: 1920,
  };

  const leavesCreated = [];
  const fakeDoc = {
    createElement(tag) {
      const el = {
        tagName: tag,
        className: '',
        style: {},
        children: [],
        append(child) { this.children.push(child); },
        remove() {},
      };
      return el;
    },
    createElementNS(ns, tag) {
      const el = {
        ns,
        tagName: tag,
        attributes: {},
        style: {},
        innerHTML: '',
        setAttribute(k, v) { this.attributes[k] = v; },
        remove() {
          const idx = leavesCreated.indexOf(this);
          if (idx !== -1) leavesCreated.splice(idx, 1);
        },
      };
      leavesCreated.push(el);
      return el;
    },
  };

  const prevDoc = globalThis.document;
  globalThis.document = fakeDoc;

  try {
    const particles = new LeafParticleSystem(container);
    assert.ok(particles.layer, 'particle layer created');

    particles.spawnBurst(500, 1080, { count: 8 });
    assert.equal(leavesCreated.length, 8, '8 leaves created');
    assert.ok(leavesCreated[0].attributes.class.includes('autumn-leaf-particle'));
    assert.ok(leavesCreated[0].innerHTML.includes('path'), 'SVG contains leaf path data');

    particles.clear();
    assert.equal(leavesCreated.length, 0, 'all leaves removed on clear');

    // Verify spawnDrift generates autumn leaf drift particles
    particles.spawnDrift(500, 1040, { count: 16 });
    assert.ok(leavesCreated.length >= 16, 'drift creates requested number of leaves');
    assert.ok(leavesCreated[0].attributes.class.includes('autumn-leaf-drift'), 'drift leaves carry autumn-leaf-drift class');
    particles.clear();
    assert.equal(leavesCreated.length, 0, 'drift leaves cleaned up on clear');

    particles.destroy();
    assert.equal(particles.layer, null, 'layer cleaned up on destroy');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('admin HTML exposes landing particles panel with on/off and quantity controls', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-persist-key="landing-particles"/);
  assert.match(html, /id="toggle-landing-particles"/);
  assert.match(html, /id="landing-particles-count"/);
  assert.match(html, /id="landing-particles-size"/);
  assert.match(html, /id="landing-particles-spread"/);
  assert.match(html, /id="landing-particles-duration"/);
  assert.match(html, /id="test-landing-particles"/);
  assert.match(html, /id="test-spawn-particles"/);
  assert.match(html, /id="landing-particles-state"/);

  const adminApp = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(adminApp, /landingParticles/);
  assert.match(adminApp, /toggle-landing-particles/);
  assert.match(adminApp, /landing-particles-count/);
  assert.match(adminApp, /test-landing-particles/);
  assert.match(adminApp, /test-spawn-particles/);
  assert.match(adminApp, /renderLandingParticlesSettings/);
  assert.match(adminApp, /saveLandingParticlesSettings/);
});

test('neighbor stack base pumpkin triggers landing leaves when moving or forming stack', () => {
  const bursts = [];
  const renderer = Object.create(PumpkinRenderer.prototype);
  renderer.settings = { landingParticles: { enabled: true } };
  renderer.spawnLeafBurst = (x, y, options) => {
    bursts.push({ x, y, options });
  };
  let baseLandTriggered = 0;
  let topLandTriggered = 0;

  const baseChar = {
    id: 'base',
    x: 500,
    y: 1080,
    stageSize: 120,
    stageScale: 1,
    data: { id: 'base', x: 500, y: 1080 },
    _triggerLanding() {
      baseLandTriggered += 1;
      renderer.onPumpkinLand(this);
    },
    setTowerPose(x, y) { this.x = x; this.y = y; },
  };
  const topChar = {
    id: 'top',
    x: 500,
    y: 989,
    stageSize: 120,
    stageScale: 1,
    data: { id: 'top', x: 500, y: 989 },
    _triggerLanding() {
      topLandTriggered += 1;
      renderer.onPumpkinLand(this);
    },
    setTowerPose(x, y) { this.x = x; this.y = y; },
  };

  renderer.characters = new Map([['base', baseChar], ['top', topChar]]);
  renderer.joinedStackRecords = new Map([['test-stack', {
    stackId: 'test-stack',
    animation: {},
    participants: [
      { id: 'base', level: 0, x: 500, y: 1080 },
      { id: 'top', level: 1, x: 500, y: 989 },
    ],
  }]]);
  renderer.joinedStackMoveTweens = new Map();
  renderer._bringToFront = () => {};

  // Test with GSAP animation onComplete
  let moveTween = null;
  const prevGsap = globalThis.gsap;
  globalThis.gsap = {
    to(target, options) {
      moveTween = { target, options };
      return { kill() {} };
    },
    fromTo() {},
  };

  try {
    renderer.moveNeighborStack({
      stackId: 'test-stack',
      roamingSpeed: 140,
      members: [
        { id: 'base', level: 0, x: 650, y: 1080 },
        { id: 'top', level: 1, x: 650, y: 989 },
      ],
    });
    assert.ok(moveTween, 'motion tween started');
    assert.equal(baseLandTriggered, 0, 'no landing yet during movement');

    moveTween.target.progress = 1;
    moveTween.options.onComplete();

    assert.equal(baseLandTriggered, 1, 'base pumpkin landed after stack movement');
    assert.equal(topLandTriggered, 0, 'top pumpkin did not trigger landing');
    assert.equal(bursts.length, 1, 'leaf burst triggered for base pumpkin');
    assert.equal(bursts[0].x, 650);
    assert.equal(bursts[0].y, 1080);

    // Test fallback when no gsap is available
    delete globalThis.gsap;
    renderer.moveNeighborStack({
      stackId: 'test-stack',
      roamingSpeed: 140,
      members: [
        { id: 'base', level: 0, x: 750, y: 1080 },
        { id: 'top', level: 1, x: 750, y: 989 },
      ],
    });
    assert.equal(baseLandTriggered, 2, 'base pumpkin landed in immediate/no-gsap move');
    assert.equal(bursts.length, 2);
    assert.equal(bursts[1].x, 750);
  } finally {
    globalThis.gsap = prevGsap;
  }
});

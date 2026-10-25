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

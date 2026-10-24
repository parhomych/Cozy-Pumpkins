import assert from 'node:assert/strict';
import test from 'node:test';
import { PumpkinCharacter } from '../public/js/shared/pumpkin-character.js';
import {
  COCOA_HANDS_PATHS_REST,
  COCOA_SHOULDER_ANCHORS,
  getBentCocoaPaths,
} from '../public/js/shared/cocoa-hands-paths.js';

class FakePathElement {
  constructor(index, d) {
    this.index = index;
    this.attrs = { d };
  }
  setAttribute(name, val) {
    this.attrs[name] = String(val);
  }
  getAttribute(name) {
    return this.attrs[name];
  }
}

test('cocoa sway bends arm paths smoothly via gsap while keeping shoulder anchors fixed at the pumpkin', () => {
  const mockPaths = COCOA_HANDS_PATHS_REST.map((d, i) => new FakePathElement(i, d));
  let timelineVars = null;
  const fromToCalls = [];
  const tween = { killed: false, kill() { this.killed = true; } };

  const character = Object.create(PumpkinCharacter.prototype);
  character.cocoaHandsPaths = mockPaths;
  character.idleTweens = new Set();
  character.tweens = new Set();
  character._gsap = () => ({
    timeline(vars) {
      timelineVars = vars;
      const tl = {
        fromTo(target, from, to, pos) {
          fromToCalls.push({ target, from, to, pos });
          return tl;
        },
        kill() { tween.kill(); },
      };
      return tl;
    },
  });

  character._scheduleCocoaHandsSway();

  assert.ok(timelineVars, 'should create a GSAP timeline');
  assert.equal(timelineVars.repeat, -1);
  assert.equal(timelineVars.yoyo, true);
  assert.equal(fromToCalls.length, 12, 'should animate all 12 cocoa paths');
  assert.equal(fromToCalls[0].target, mockPaths[0]);
  assert.equal(fromToCalls[0].to.ease, 'sine.inOut');
  assert.ok(fromToCalls[0].to.duration >= 3.5 && fromToCalls[0].to.duration <= 5);

  // Verify shoulder coordinates are strictly anchored and do not move
  fromToCalls.forEach(({ from, to }, idx) => {
    const restD = COCOA_HANDS_PATHS_REST[idx];
    const fromD = from.attr.d;
    const toD = to.attr.d;

    const restPoints = [...restD.matchAll(/([0-9.-]+)\s+([0-9.-]+)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2]), m[1], m[2]]);
    const fromPoints = [...fromD.matchAll(/([0-9.-]+)\s+([0-9.-]+)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2]), m[1], m[2]]);
    const toPoints = [...toD.matchAll(/([0-9.-]+)\s+([0-9.-]+)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2]), m[1], m[2]]);

    let armBendingDetected = false;
    for (let i = 0; i < restPoints.length; i++) {
      const [rx, ry, rsx, rsy] = restPoints[i];
      if (rx <= COCOA_SHOULDER_ANCHORS.left || rx >= COCOA_SHOULDER_ANCHORS.right) {
        assert.equal(fromPoints[i][2], rsx, `path ${idx} shoulder x must remain anchored in from pose`);
        assert.equal(fromPoints[i][3], rsy, `path ${idx} shoulder y must remain anchored in from pose`);
        assert.equal(toPoints[i][2], rsx, `path ${idx} shoulder x must remain anchored in to pose`);
        assert.equal(toPoints[i][3], rsy, `path ${idx} shoulder y must remain anchored in to pose`);
      } else {
        if (fromPoints[i][2] !== toPoints[i][2] || fromPoints[i][3] !== toPoints[i][3]) {
          armBendingDetected = true;
        }
      }
    }
    assert.ok(armBendingDetected, `path ${idx} should bend along inner arm / cup`);
  });

  assert.equal(character.idleTweens.size, 1);
  assert.equal(character.tweens.size, 1);
});

test('stopping idle kills and resets the cocoa sway without moving shoulder anchors', () => {
  const mockPaths = COCOA_HANDS_PATHS_REST.map((d, i) => new FakePathElement(i, d));
  const tween = { killed: false, kill() { this.killed = true; } };
  const setCalls = [];

  const character = Object.create(PumpkinCharacter.prototype);
  Object.assign(character, {
    idleTimers: new Set(),
    idleTweens: new Set([tween]),
    idleStarted: true,
    cocoaHandsPaths: mockPaths,
    cocoaHandsMovingCenter: null,
    root: { querySelectorAll: () => [] },
    _gsap: () => ({
      set: (target, values) => setCalls.push({ target, values }),
    }),
  });

  character.stopIdle();

  assert.equal(tween.killed, true);
  assert.equal(character.idleTweens.size, 0);
  assert.equal(character.idleStarted, false);

  mockPaths.forEach((pathEl, idx) => {
    const call = setCalls.find((c) => c.target === pathEl);
    assert.ok(call, `path ${idx} should be reset in stopIdle`);
    assert.equal(call.values.attr.d, COCOA_HANDS_PATHS_REST[idx]);
  });
});

test('removing a pumpkin stops its cocoa idle animation', () => {
  const mockPaths = COCOA_HANDS_PATHS_REST.map((d, i) => new FakePathElement(i, d));
  const tween = { killed: false, kill() { this.killed = true; } };
  let removed = false;
  const character = Object.create(PumpkinCharacter.prototype);
  Object.assign(character, {
    destroyed: false,
    idleTimers: new Set(),
    idleTweens: new Set([tween]),
    tweens: new Set([tween]),
    actionTweens: new Set(),
    idleStarted: true,
    cocoaHandsPaths: mockPaths,
    root: {
      querySelectorAll: () => [],
      remove: () => { removed = true; },
    },
    stopAction() {},
    _gsap: () => ({
      set() {},
      killTweensOf() {},
    }),
  });

  character.destroy();

  assert.equal(tween.killed, true);
  assert.equal(character.idleStarted, false);
  assert.equal(removed, true);
});

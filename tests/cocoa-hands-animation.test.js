import assert from 'node:assert/strict';
import test from 'node:test';
import { PumpkinCharacter } from '../public/js/shared/pumpkin-character.js';

test('cocoa sway animates only the movable artwork smoothly and repeats without a jump', () => {
  const movingCenter = { id: 'moving-center' };
  const fixedShoulders = { id: 'fixed-shoulders' };
  let call;
  const tween = { killed: false, kill() { this.killed = true; } };
  const character = Object.create(PumpkinCharacter.prototype);
  character.cocoaHandsMovingCenter = movingCenter;
  character.cocoaHandsFixedShoulders = fixedShoulders;
  character._gsap = () => ({
    fromTo(target, from, to) {
      call = { target, from, to };
      return tween;
    },
  });
  character.idleTweens = new Set();
  character.tweens = new Set();

  character._scheduleCocoaHandsSway();

  assert.equal(call.target, movingCenter);
  assert.notEqual(call.target, fixedShoulders);
  assert.equal(call.from.rotation, -call.to.rotation);
  assert.ok(call.to.rotation >= 1 && call.to.rotation <= 2.5);
  assert.ok(call.to.duration >= 3 && call.to.duration <= 5);
  assert.equal(call.to.ease, 'sine.inOut');
  assert.equal(call.to.yoyo, true);
  assert.equal(call.to.repeat, -1);
  assert.equal(character.idleTweens.has(tween), true);
  assert.equal(character.tweens.has(tween), true);
});

test('stopping idle kills and resets the cocoa sway without moving shoulder anchors', () => {
  const movingCenter = { id: 'moving-center' };
  const fixedShoulders = { id: 'fixed-shoulders' };
  const calls = [];
  const tween = { killed: false, kill() { this.killed = true; } };
  const character = Object.create(PumpkinCharacter.prototype);
  Object.assign(character, {
    idleTimers: new Set(),
    idleTweens: new Set([tween]),
    idleStarted: true,
    cocoaHandsMovingCenter: movingCenter,
    cocoaHandsFixedShoulders: fixedShoulders,
    root: { querySelectorAll: () => [] },
    _gsap: () => ({ set: (target, values) => calls.push({ target, values }) }),
  });

  character.stopIdle();

  assert.equal(tween.killed, true);
  assert.equal(character.idleTweens.size, 0);
  assert.equal(character.idleStarted, false);
  assert.ok(calls.some(({ target, values }) => target === movingCenter && values.rotation === 0));
  assert.equal(calls.some(({ target }) => target === fixedShoulders), false);
});

test('removing a pumpkin stops its cocoa idle animation', () => {
  const movingCenter = { id: 'moving-center' };
  const tween = { killed: false, kill() { this.killed = true; } };
  let removed = false;
  const calls = [];
  const character = Object.create(PumpkinCharacter.prototype);
  Object.assign(character, {
    destroyed: false,
    idleTimers: new Set(),
    idleTweens: new Set([tween]),
    tweens: new Set([tween]),
    actionTweens: new Set(),
    idleStarted: true,
    cocoaHandsMovingCenter: movingCenter,
    root: {
      querySelectorAll: () => [],
      remove: () => { removed = true; },
    },
    stopAction() {},
    _gsap: () => ({
      set: (target, values) => calls.push({ target, values }),
      killTweensOf() {},
    }),
  });

  character.destroy();

  assert.equal(tween.killed, true);
  assert.equal(character.idleStarted, false);
  assert.ok(calls.some(({ target, values }) => target === movingCenter && values.rotation === 0));
  assert.equal(removed, true);
});

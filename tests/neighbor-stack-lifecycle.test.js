import test from 'node:test';
import assert from 'node:assert/strict';
import { JoinedStackService } from '../src/engine/joined-stack-service.js';
import { createPumpkinMovementScheduler, findJoinedStackRoamingTarget } from '../src/engine/pumpkin-movement.js';
import { PumpkinRenderer, joinedStackSwayAmplitude } from '../public/js/shared/pumpkin-renderer.js';
import { testConfig, testDatabase } from './helpers.js';

function addPumpkin(db, config, id, x) {
  const now = new Date().toISOString();
  return db.insertPumpkin({
    id,
    ownerKey: id,
    ownerNormalized: id,
    displayName: id,
    totalDonated: 0,
    currency: 'RUB',
    stage: 1,
    x,
    y: config.scene.groundY,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: {},
    createdAt: now,
    updatedAt: now,
  });
}

function activeStack(db, config, ids, expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  const now = new Date().toISOString();
  return db.saveJoinedStack({
    stackId: 'saved-stack',
    state: 'active',
    createdAt: now,
    formedAt: now,
    expiresAt,
    lifetimeSeconds: 60,
    animation: db.getSettings(config).neighborStackAnimation,
    members: ids.map((id, level) => ({ id, level, x: 500, y: 1080 - level * 91 })),
  });
}

test('formation starts a single shared lifetime after saving its ordered participants', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const service = new JoinedStackService({ db, config, random: () => 0.5 });
  try {
    addPumpkin(db, config, 'base', 500);
    addPumpkin(db, config, 'top', 600);
    const stack = service.form({
      members: [
        { id: 'base', level: 0, x: 500, y: 1080 },
        { id: 'top', level: 1, x: 500, y: 989 },
      ],
      animation: db.getSettings(config).neighborStackAnimation,
    });
    assert.equal(stack.lifetimeSeconds, 165);
    assert.equal(Date.parse(stack.formedAt) - Date.parse(stack.createdAt), 1480);
    assert.equal(Date.parse(stack.expiresAt) - Date.parse(stack.formedAt), 165_000);
    assert.deepEqual(db.listJoinedStacks(), [stack]);
  } finally {
    service.stop();
    db.close();
  }
});

test('startup restores an active deadline and expiration atomically settles and removes its members', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const timers = [];
  const events = [];
  try {
    addPumpkin(db, config, 'base', 500);
    addPumpkin(db, config, 'top', 600);
    activeStack(db, config, ['base', 'top']);
    const service = new JoinedStackService({
      db,
      config,
      random: () => 0,
      broadcast: (event, payload) => events.push([event, payload]),
      setTimeoutImpl: (callback, delay) => {
        const timer = { callback, delay, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimeoutImpl: () => {},
    });
    service.start();
    assert.equal(timers.length, 1);
    assert.ok(timers[0].delay > 0);

    timers[0].callback();
    assert.deepEqual(db.listJoinedStacks(), []);
    assert.equal(db.getPumpkin('base').y, config.scene.groundY);
    assert.equal(db.getPumpkin('top').y, config.scene.groundY);
    assert.equal(events.at(-1)[1].phase, 'collapse');
    assert.equal(events.at(-1)[1].finalPositions.length, 2);
    service.stop();
  } finally {
    db.close();
  }
});

test('expired persisted stacks collapse immediately during startup recovery', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const events = [];
  try {
    addPumpkin(db, config, 'base', 500);
    addPumpkin(db, config, 'top', 600);
    activeStack(db, config, ['base', 'top'], new Date(Date.now() - 1000).toISOString());
    const service = new JoinedStackService({ db, config, broadcast: (event, payload) => events.push([event, payload]) });
    service.start();
    assert.deepEqual(db.listJoinedStacks(), []);
    assert.equal(events.at(-1)[1].phase, 'collapse');
    service.stop();
  } finally {
    db.close();
  }
});

test('three-member stacks sway more strongly, and snapshots restore without replaying the leap', () => {
  assert.equal(joinedStackSwayAmplitude(12, 2), 12);
  assert.equal(joinedStackSwayAmplitude(12, 3), 24);

  const renderer = Object.create(PumpkinRenderer.prototype);
  const posed = [];
  renderer.characters = new Map(['base', 'top'].map((id) => [id, {
    data: { id },
    stageSize: 127,
    setPositionImmediate: (...position) => posed.push([id, 'position', ...position]),
    setTowerPose: (...pose) => posed.push([id, 'sway', ...pose]),
    root: { style: {} },
  }]));
  renderer.joinedStackRecords = new Map();
  renderer.joinedStackTweens = new Map();
  renderer.joinedStackMoveTweens = new Map();
  renderer.joinedStackTimers = new Map();
  renderer.joinedStackMembers = new Map();
  renderer.towerDepthLevels = new Map();
  renderer.settings = {};
  renderer._sortCharactersByDepth = () => {};
  renderer.startNeighborStackSway = () => { renderer.swayStarted = true; };

  renderer.restoreJoinedStacks([{
    stackId: 'restored',
    participants: [
      { id: 'base', level: 0, x: 500, y: 1080 },
      { id: 'top', level: 1, x: 500, y: 989 },
    ],
    formedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    lifetimeSeconds: 30,
    animation: { swayAmplitude: 12 },
    finalPositions: [{ id: 'base', x: 500, y: 1080 }, { id: 'top', x: 600, y: 1080 }],
  }]);
  assert.equal(posed.length, 2);
  assert.equal(renderer.swayStarted, true);
});

test('joined stacks roam together, persist their new positions, and avoid external pumpkins', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const events = [];
  const service = new JoinedStackService({ db, config });
  const scheduler = createPumpkinMovementScheduler({
    db,
    config,
    joinedStackService: service,
    broadcast: (event, payload) => events.push([event, payload]),
    random: () => 0.9,
  });
  try {
    addPumpkin(db, config, 'base', 500);
    addPumpkin(db, config, 'top', 600);
    addPumpkin(db, config, 'blocker', 820);
    const stack = activeStack(db, config, ['base', 'top']);
    const target = findJoinedStackRoamingTarget(stack, db.listPumpkins(), {
      scene: { ...config.scene, groundY: db.getSettings(config).groundY },
      noGoZone: { enabled: false },
    }, { random: () => 0.9 });
    assert.ok(target);
    assert.ok(Math.abs(target.x - 820) >= 30);

    const movement = scheduler.tick();
    assert.ok(movement);
    assert.equal(movement.stackId, stack.stackId);
    const updated = db.getJoinedStack(stack.stackId);
    assert.equal(updated.members[0].x, movement.members[0].x);
    assert.equal(updated.members[1].x, movement.members[1].x);
    assert.equal(updated.members[1].y - updated.members[0].y, -91);
    assert.deepEqual(
      updated.members.map(({ id, x, y }) => ({ id, x, y })),
      ['base', 'top'].map((id) => {
        const pumpkin = db.getPumpkin(id);
        return { id, x: pumpkin.x, y: pumpkin.y };
      }),
    );
    assert.equal(events.at(-1)[0], 'pumpkin:stack-move');
    assert.deepEqual(events.at(-1)[1].members, updated.members);
  } finally {
    service.stop();
    scheduler.stop();
    db.close();
  }
});

test('joined-stack roaming refuses destinations blocked by the No-Go Zone', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const service = new JoinedStackService({ db, config });
  try {
    addPumpkin(db, config, 'base', 500);
    addPumpkin(db, config, 'top', 600);
    const stack = activeStack(db, config, ['base', 'top']);
    db.updateSettings({
      noGoZone: { enabled: true, x: 50, y: 0, width: 1500, height: 1080 },
    }, config);
    const settings = db.getSettings(config);
    const target = findJoinedStackRoamingTarget(stack, db.listPumpkins(), {
      scene: { ...config.scene, groundY: settings.groundY },
      noGoZone: settings.noGoZone,
      growthMultipliers: settings.growthMultipliers,
    }, { random: () => 0.9 });
    assert.equal(target, null);
    assert.equal(service.move(stack.stackId, 820), null);
    assert.equal(db.getPumpkin('base').x, 500);
    assert.equal(db.getJoinedStack(stack.stackId).members[0].x, 500);
  } finally {
    service.stop();
    db.close();
  }
});

test('renderer moves a joined stack as one unit while preserving its vertical offsets', () => {
  const renderer = Object.create(PumpkinRenderer.prototype);
  const posed = [];
  const movementTweens = [];
  renderer.characters = new Map(['base', 'top'].map((id) => [id, {
    data: { id },
    stageSize: 127,
    setTowerPose: (...pose) => posed.push([id, ...pose]),
  }]));
  renderer.joinedStackRecords = new Map([['moving', {
    stackId: 'moving',
    animation: { swayAmplitude: 0, bendMultiplier: 0, rotationMultiplier: 0 },
    participants: [
      { id: 'base', level: 0, x: 500, y: 1080 },
      { id: 'top', level: 1, x: 500, y: 989 },
    ],
  }]]);
  renderer.joinedStackMoveTweens = new Map();
  renderer._bringToFront = () => {};

  const previousGsap = globalThis.gsap;
  globalThis.gsap = {
    to: (target, options) => {
      movementTweens.push({ target, options });
      return { kill() {} };
    },
  };
  try {
    assert.equal(renderer.moveNeighborStack({
      stackId: 'moving',
      roamingSpeed: 140,
      members: [
        { id: 'base', level: 0, x: 620, y: 1080 },
        { id: 'top', level: 1, x: 620, y: 989 },
      ],
    }), true);
    assert.equal(movementTweens.length, 1);
    movementTweens[0].target.progress = 0.5;
    movementTweens[0].options.onUpdate();
    assert.deepEqual(posed.slice(-2).map(([, x, y]) => ({ x, y })), [
      { x: 560, y: 1026.66 },
      { x: 560, y: 935.66 },
    ]);

    movementTweens[0].target.progress = 1;
    movementTweens[0].options.onComplete();
    assert.deepEqual(renderer.joinedStackRecords.get('moving').participants.map(({ x, y }) => ({ x, y })), [
      { x: 620, y: 1080 },
      { x: 620, y: 989 },
    ]);
    assert.deepEqual(posed.slice(-2).map(([, x, y]) => ({ x, y })), [
      { x: 620, y: 1080 },
      { x: 620, y: 989 },
    ]);
  } finally {
    if (previousGsap === undefined) delete globalThis.gsap;
    else globalThis.gsap = previousGsap;
  }
});

test('stack collapse cancels group movement and settles each member at the final floor position', () => {
  const renderer = Object.create(PumpkinRenderer.prototype);
  const rollCalls = [];
  const movementTween = { killed: false, kill() { this.killed = true; } };
  const characters = new Map(['base', 'top'].map((id) => [id, {
    data: { id, x: 500, y: id === 'base' ? 1080 : 989, isAirborne: false },
    x: 500,
    y: id === 'base' ? 1080 : 989,
    setPositionImmediate(x, y, isAirborne) {
      this.x = x;
      this.y = y;
      this.data = { ...this.data, x, y, isAirborne };
    },
    rollTo(x, y, data, options) {
      rollCalls.push({ character: this, x, y, data, options });
    },
    root: { style: {} },
  }]));
  renderer.characters = characters;
  renderer.joinedStackRecords = new Map([['collapsing', {
    participants: [
      { id: 'base', level: 0, x: 500, y: 1080 },
      { id: 'top', level: 1, x: 500, y: 989 },
    ],
  }]]);
  renderer.joinedStackTweens = new Map();
  renderer.joinedStackMoveTweens = new Map([['collapsing', movementTween]]);
  renderer.joinedStackTimers = new Map();
  renderer.joinedStackMembers = new Map();
  renderer._sortCharactersByDepth = () => {};
  renderer._bringToFront = () => {};

  assert.equal(renderer.collapseNeighborStack({
    stackId: 'collapsing',
    participants: [{ id: 'base' }, { id: 'top' }],
    finalPositions: [
      { id: 'base', x: 450, y: 1080 },
      { id: 'top', x: 650, y: 1080 },
    ],
  }), true);
  assert.equal(movementTween.killed, true);
  assert.equal(rollCalls.length, 2);
  assert.deepEqual(rollCalls.map(({ options }) => options.groundY), [1080, 1080]);

  for (const call of rollCalls) call.options.onComplete();
  assert.deepEqual([...characters.values()].map(({ x, y, data }) => ({
    x,
    y,
    dataX: data.x,
    dataY: data.y,
    isAirborne: data.isAirborne,
    parentId: data.parentId,
    stackOffsetY: data.stackOffsetY,
  })), [
    { x: 450, y: 1080, dataX: 450, dataY: 1080, isAirborne: false, parentId: null, stackOffsetY: null },
    { x: 650, y: 1080, dataX: 650, dataY: 1080, isAirborne: false, parentId: null, stackOffsetY: null },
  ]);
});

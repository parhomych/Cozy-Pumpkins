import test from 'node:test';
import assert from 'node:assert/strict';
import { REWARD_ACTIONS, RewardService } from '../src/engine/rewards.js';
import { JoinedStackService } from '../src/engine/joined-stack-service.js';
import { testConfig, testDatabase } from './helpers.js';

function addPumpkin(db, config, id, userId, x) {
  const now = new Date().toISOString();
  const pumpkin = db.insertPumpkin({
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
  return db.updatePumpkin(pumpkin.id, { twitchUserId: userId });
}

function harness() {
  const config = testConfig();
  const db = testDatabase(config);
  const events = [];
  const joinedStackService = new JoinedStackService({
    db,
    config,
    random: () => 0,
    broadcast: (event, payload) => events.push([event, payload]),
  });
  db.updateSettings({ rewardMapping: { neighbor_stack: 'neighbor-reward' } }, config);
  const rewards = new RewardService({
    db,
    config,
    random: () => 0,
    emit: (event, payload) => events.push([event, payload]),
    joinedStackService,
  });
  return { config, db, events, joinedStackService, rewards };
}

function redeem(id, userId) {
  return { id, rewardId: 'neighbor-reward', userId, userLogin: userId, input: '' };
}

test('neighbor-stack reward is mapped once and joins the redeemer to a nearby pumpkin', () => {
  const { config, db, events, joinedStackService, rewards } = harness();
  try {
    const base = addPumpkin(db, config, 'base', 'base-viewer', 500);
    const visitor = addPumpkin(db, config, 'visitor', 'visitor-viewer', 600);
    assert.ok(REWARD_ACTIONS.includes('neighbor_stack'));

    const result = rewards.handle(redeem('join-once', 'visitor-viewer'));
    assert.equal(result.status, 'neighbor_stack_formed');
    assert.equal(result.action, 'neighbor_stack');
    assert.equal(db.listJoinedStacks().length, 1);
    assert.deepEqual(db.listJoinedStacks()[0].members.map(({ id, level }) => ({ id, level })), [
      { id: base.id, level: 0 },
      { id: visitor.id, level: 1 },
    ]);
    assert.equal(events.filter(([event, payload]) => event === 'pumpkin:action' && payload.phase === 'form').length, 1);

    const duplicate = rewards.handle(redeem('join-once', 'visitor-viewer'));
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.listJoinedStacks().length, 1);
    assert.equal(events.filter(([event, payload]) => event === 'pumpkin:action' && payload.phase === 'form').length, 1);
  } finally {
    joinedStackService.stop();
    db.close();
  }
});

test('neighbor-stack reward allows a third pumpkin to join an existing two-member stack', () => {
  const { config, db, events, joinedStackService, rewards } = harness();
  try {
    const base = addPumpkin(db, config, 'base', 'base-viewer', 500);
    const middle = addPumpkin(db, config, 'middle', 'middle-viewer', 600);
    const top = addPumpkin(db, config, 'top', 'top-viewer', 550);
    const first = rewards.handle(redeem('first-join', 'middle-viewer'));
    assert.equal(first.status, 'neighbor_stack_formed');
    const original = db.listJoinedStacks()[0];

    const third = rewards.handle(redeem('third-join', 'top-viewer'));

    assert.equal(third.status, 'neighbor_stack_formed');
    assert.equal(db.listJoinedStacks().length, 1);
    const expanded = db.listJoinedStacks()[0];
    assert.equal(expanded.stackId, original.stackId);
    assert.deepEqual(expanded.members.map(({ id, level }) => ({ id, level })), [
      { id: base.id, level: 0 },
      { id: middle.id, level: 1 },
      { id: top.id, level: 2 },
    ]);
    assert.deepEqual(db.sqlite.prepare('SELECT pumpkin_id FROM joined_stack_members WHERE stack_id = ? ORDER BY member_order')
      .all(expanded.stackId).map(({ pumpkin_id }) => pumpkin_id), [base.id, middle.id, top.id]);
    assert.equal(events.filter(([event, payload]) => event === 'pumpkin:action' && payload.phase === 'form').length, 2);
    assert.deepEqual(events.at(-1)[1].participants.map(({ id }) => id), [base.id, middle.id, top.id]);
  } finally {
    joinedStackService.stop();
    db.close();
  }
});

test('unresolved redeemer leaves the scene unchanged', () => {
  const { config, db, events, joinedStackService, rewards } = harness();
  try {
    addPumpkin(db, config, 'base', 'base-viewer', 500);
    const before = db.listPumpkins();
    const result = rewards.handle(redeem('missing-viewer', 'unknown-viewer'));
    assert.equal(result.status, 'no_pumpkin_for_user');
    assert.deepEqual(db.listPumpkins(), before);
    assert.deepEqual(db.listJoinedStacks(), []);
    assert.equal(events.some(([event]) => event === 'pumpkin:action'), false);
  } finally {
    joinedStackService.stop();
    db.close();
  }
});

test('redeemer cannot join its own stack and a full nearby stack is not eligible', () => {
  const { config, db, events, joinedStackService, rewards } = harness();
  try {
    const base = addPumpkin(db, config, 'base', 'base-viewer', 500);
    const visitor = addPumpkin(db, config, 'visitor', 'visitor-viewer', 600);
    const third = addPumpkin(db, config, 'third', 'third-viewer', 700);
    const now = new Date().toISOString();
    db.saveJoinedStack({
      stackId: 'already-joined',
      state: 'active',
      createdAt: now,
      formedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lifetimeSeconds: 60,
      animation: db.getSettings(config).neighborStackAnimation,
      members: [
        { id: base.id, level: 0, x: 500, y: 1080 },
        { id: visitor.id, level: 1, x: 500, y: 989 },
      ],
    });
    const result = rewards.handle(redeem('already-stacked', 'visitor-viewer'));
    assert.equal(result.status, 'no_eligible_neighbor');
    assert.deepEqual(db.listJoinedStacks()[0].members.map(({ id }) => id), [base.id, visitor.id]);
    assert.equal(events.some(([event, payload]) => event === 'pumpkin:action' && payload.phase === 'form'), false);

    db.deletePumpkin(visitor.id);
    db.deletePumpkin(base.id);
    db.deletePumpkin(third.id);
    const isolated = addPumpkin(db, config, 'isolated-visitor', 'isolated-viewer', 900);
    const lonely = rewards.handle(redeem('no-neighbor', 'isolated-viewer'));
    assert.equal(lonely.status, 'no_eligible_neighbor');
    assert.equal(db.getPumpkin(isolated.id).x, 900);
    assert.deepEqual(db.listJoinedStacks(), []);
  } finally {
    joinedStackService.stop();
    db.close();
  }
});

test('full stacks and layouts crossing a No-Go Zone leave the redemption scene unchanged', () => {
  const { config, db, events, joinedStackService, rewards } = harness();
  try {
    const base = addPumpkin(db, config, 'full-base', 'full-base-viewer', 500);
    const middle = addPumpkin(db, config, 'full-middle', 'full-middle-viewer', 600);
    const top = addPumpkin(db, config, 'full-top', 'full-top-viewer', 700);
    addPumpkin(db, config, 'full-redeemer', 'full-redeemer-viewer', 520);
    const now = new Date().toISOString();
    db.saveJoinedStack({
      stackId: 'full-stack',
      state: 'active',
      createdAt: now,
      formedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lifetimeSeconds: 60,
      animation: db.getSettings(config).neighborStackAnimation,
      members: [base, middle, top].map((pumpkin, level) => ({
        id: pumpkin.id,
        level,
        x: 500,
        y: 1080 - level * 91,
      })),
    });
    const full = rewards.handle(redeem('full-target', 'full-redeemer-viewer'));
    assert.equal(full.status, 'no_eligible_neighbor');
    assert.equal(db.listJoinedStacks().length, 1);

    db.deletePumpkin(base.id);
    const target = addPumpkin(db, config, 'zone-target', 'zone-target-viewer', 500);
    const visitor = addPumpkin(db, config, 'zone-redeemer', 'zone-redeemer-viewer', 600);
    db.updateSettings({ noGoZone: { enabled: true, x: 400, y: 750, width: 300, height: 180 } }, config);
    const before = db.listPumpkins();
    const unsafe = rewards.handle(redeem('unsafe-layout', 'zone-redeemer-viewer'));
    assert.equal(unsafe.status, 'no_safe_stack_layout');
    assert.deepEqual(db.listPumpkins(), before);
    assert.equal(db.getPumpkin(target.id).x, 500);
    assert.equal(db.getPumpkin(visitor.id).x, 600);
    assert.equal(events.some(([event, payload]) => event === 'pumpkin:action' && payload.phase === 'form'), false);
  } finally {
    joinedStackService.stop();
    db.close();
  }
});

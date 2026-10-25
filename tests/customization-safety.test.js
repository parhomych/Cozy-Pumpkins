import test from 'node:test';
import assert from 'node:assert/strict';
import { RewardService } from '../src/engine/rewards.js';
import { testConfig, testDatabase } from './helpers.js';

function addPumpkin(db, config, id, twitchUserId) {
  const timestamp = new Date().toISOString();
  const pumpkin = db.insertPumpkin({
    id,
    ownerKey: id,
    ownerNormalized: id,
    displayName: id,
    totalDonated: 0,
    currency: 'RUB',
    stage: 1,
    x: 500,
    y: config.scene.groundY,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'none' },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return db.updatePumpkin(pumpkin.id, { twitchUserId });
}

function configureReward(db, config, mode = 'single') {
  db.updateSettings({
    rewardMapping: { pumpkin_customization: 'appearance-reward' },
    customizationRewardMode: mode,
  }, config);
}

test('empty and unsupported appearance inputs do not mutate the viewer pumpkin', () => {
  const config = testConfig();
  const db = testDatabase(config);
  try {
    const pumpkin = addPumpkin(db, config, 'empty-input', 'viewer-empty');
    configureReward(db, config);
    const rewards = new RewardService({ db, config });

    for (const [id, input] of [['empty', ''], ['unsupported', 'make it sparkle please']]) {
      const result = rewards.handle({ id, rewardId: 'appearance-reward', userId: 'viewer-empty', userLogin: 'viewer-empty', input });
      assert.equal(result.status, 'ignored_unrecognized_customization');
    }
    assert.deepEqual(db.getPumpkin(pumpkin.id).customization, pumpkin.customization);
  } finally {
    db.close();
  }
});

test('mixed plain text applies supported aliases without interpreting unsupported markup', () => {
  const config = testConfig();
  const db = testDatabase(config);
  try {
    const pumpkin = addPumpkin(db, config, 'mixed-input', 'viewer-mixed');
    configureReward(db, config);
    const rewards = new RewardService({ db, config });

    const result = rewards.handle({
      id: 'mixed',
      rewardId: 'appearance-reward',
      userId: 'viewer-mixed',
      userLogin: 'viewer-mixed',
      input: '<script>alert(1)</script> stars eyes',
    });

    assert.equal(result.status, 'customization_applied');
    assert.deepEqual(result.pumpkin.customization, { ...pumpkin.customization, eyes: 'stars' });
  } finally {
    db.close();
  }
});

test('oversized input is ignored instead of truncated and later valid input still applies', () => {
  const config = testConfig();
  const db = testDatabase(config);
  try {
    const pumpkin = addPumpkin(db, config, 'long-input', 'viewer-long');
    configureReward(db, config);
    const rewards = new RewardService({ db, config });

    const oversized = rewards.handle({
      id: 'oversized',
      rewardId: 'appearance-reward',
      userId: 'viewer-long',
      userLogin: 'viewer-long',
      input: `${'x'.repeat(257)} ghost`,
    });
    assert.equal(oversized.status, 'ignored_input_too_long');
    assert.deepEqual(db.getPumpkin(pumpkin.id).customization, pumpkin.customization);
    assert.equal(rewards.handle({
      id: 'padded-oversized',
      rewardId: 'appearance-reward',
      userId: 'viewer-long',
      userLogin: 'viewer-long',
      input: `ghost${' '.repeat(252)}`,
    }).status, 'ignored_input_too_long');

    const valid = rewards.handle({
      id: 'after-oversized',
      rewardId: 'appearance-reward',
      userId: 'viewer-long',
      userLogin: 'viewer-long',
      input: 'sleepy eyes',
    });
    assert.equal(valid.status, 'customization_applied');
    assert.equal(valid.pumpkin.customization.eyes, 'sleepy');
  } finally {
    db.close();
  }
});

test('ambiguous Twitch ownership and duplicate redemption delivery never repeat a mutation', () => {
  const config = testConfig();
  const db = testDatabase(config);
  try {
    const first = addPumpkin(db, config, 'ambiguous-first', 'shared-viewer');
    const second = addPumpkin(db, config, 'ambiguous-second', 'shared-viewer');
    configureReward(db, config);
    const events = [];
    const rewards = new RewardService({ db, config, emit: (event, payload) => events.push([event, payload]) });

    const ambiguous = rewards.handle({
      id: 'ambiguous-redemption',
      rewardId: 'appearance-reward',
      userId: 'shared-viewer',
      userLogin: 'shared-viewer',
      input: 'sleepy eyes',
    });
    assert.equal(ambiguous.status, 'no_pumpkin_for_user');
    assert.deepEqual(db.getPumpkin(first.id).customization, first.customization);
    assert.deepEqual(db.getPumpkin(second.id).customization, second.customization);

    db.updatePumpkin(second.id, { twitchUserId: 'other-viewer' });
    const event = {
      id: 'unique-redemption',
      rewardId: 'appearance-reward',
      userId: 'shared-viewer',
      userLogin: 'shared-viewer',
      input: 'sleepy eyes',
    };
    const applied = rewards.handle(event);
    assert.equal(applied.status, 'customization_applied');
    const eventCount = events.length;
    const duplicate = rewards.handle(event);
    assert.equal(duplicate.duplicate, true);
    assert.equal(events.length, eventCount);
    assert.equal(db.getPumpkin(first.id).customization.eyes, 'sleepy');
  } finally {
    db.close();
  }
});

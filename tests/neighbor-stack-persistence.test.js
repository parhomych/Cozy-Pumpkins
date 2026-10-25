import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/db/database.js';
import { testConfig } from './helpers.js';

function pumpkin(id, owner) {
  return {
    id,
    ownerKey: `name:${owner}`,
    ownerNormalized: owner,
    displayName: owner,
    twitchUserId: null,
    twitchUsername: null,
    totalDonated: 0,
    currency: 'RUB',
    stage: 1,
    x: 300,
    y: 1080,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test('neighbor stack animation defaults and settings persist across database restart', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cozy-neighbor-stack-'));
  const file = path.join(directory, 'scene.sqlite');
  const config = testConfig();
  let db = null;
  try {
    db = new Database(file);
    assert.deepEqual(db.getSettings(config).neighborStackAnimation, {
      swayAmplitude: 12,
      swayDuration: 2,
      rotationMultiplier: 1,
      bendMultiplier: 1,
      lifetimeMinSeconds: 30,
      lifetimeMaxSeconds: 300,
    });
    db.updateSettings({
      neighborStackAnimation: {
        swayAmplitude: 18,
        lifetimeMinSeconds: 45,
        lifetimeMaxSeconds: 180,
      },
    }, config);
    db.close();

    db = new Database(file);
    assert.deepEqual(db.getSettings(config).neighborStackAnimation, {
      swayAmplitude: 18,
      swayDuration: 2,
      rotationMultiplier: 1,
      bendMultiplier: 1,
      lifetimeMinSeconds: 45,
      lifetimeMaxSeconds: 180,
    });
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('neighbor stack reward mapping is stored in SQLite and survives database restart', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cozy-neighbor-reward-'));
  const file = path.join(directory, 'scene.sqlite');
  const config = testConfig();
  let db = null;
  try {
    db = new Database(file);
    db.getSettings(config);
    db.updateSettings({ rewardMapping: { neighbor_stack: 'neighbor-stack-reward' } }, config);

    const stored = db.sqlite.prepare('SELECT reward_mapping_json FROM settings WHERE id = 1').get();
    assert.equal(JSON.parse(stored.reward_mapping_json).neighbor_stack, 'neighbor-stack-reward');
    db.close();

    db = new Database(file);
    assert.equal(db.getSettings(config).rewardMapping.neighbor_stack, 'neighbor-stack-reward');
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('joined stack snapshots round-trip and are removed when a member pumpkin is deleted', () => {
  const config = testConfig();
  const db = new Database(':memory:');
  db.getSettings(config);
  const now = new Date().toISOString();
  db.insertPumpkin(pumpkin('stack-base', 'base'));
  db.insertPumpkin(pumpkin('stack-visitor', 'visitor'));
  const stack = {
    stackId: 'joined-stack-1',
    state: 'active',
    createdAt: now,
    formedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lifetimeSeconds: 60,
    animation: { swayAmplitude: 12 },
    members: [
      { id: 'stack-base', level: 0, x: 300, y: 1080 },
      { id: 'stack-visitor', level: 1, x: 300, y: 900 },
    ],
  };

  db.saveJoinedStack(stack);
  assert.deepEqual(db.listJoinedStacks(), [stack]);
  db.deletePumpkin('stack-base');
  assert.deepEqual(db.listJoinedStacks(), []);
  db.close();
});

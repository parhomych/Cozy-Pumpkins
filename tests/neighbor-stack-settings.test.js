import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Database } from '../src/db/database.js';
import { attachSocketHandlers } from '../src/socket/handlers.js';
import { testConfig } from './helpers.js';

const adminPath = new URL('../public/admin.html', import.meta.url);
const adminScriptPath = new URL('../public/js/admin-app.js', import.meta.url);

test('admin exposes a dedicated reward and collapsed sway and lifetime controls', async () => {
  const html = await readFile(adminPath, 'utf8');
  const script = await readFile(adminScriptPath, 'utf8');
  assert.match(html, /data-reward-action="neighbor_stack"/);
  const disclosure = html.match(/<details[^>]*data-persist-key="neighbor-stack-animation"[^>]*>([\s\S]*?)<\/details>/);
  assert.ok(disclosure, 'neighbor-stack settings are contained in a details disclosure');
  assert.doesNotMatch(disclosure[0].split('>')[0], /\sopen(?:\s|=|>)/);
  assert.match(disclosure[1], /id="neighbor-stack-sway-amplitude"/);
  assert.match(disclosure[1], /id="neighbor-stack-sway-duration"/);
  assert.match(disclosure[1], /id="neighbor-stack-rotation-multiplier"/);
  assert.match(disclosure[1], /id="neighbor-stack-bend-multiplier"/);
  assert.match(disclosure[1], /id="neighbor-stack-lifetime-min-seconds"[^>]*min="30"[^>]*max="300"[^>]*value="30"/);
  assert.match(disclosure[1], /id="neighbor-stack-lifetime-max-seconds"[^>]*min="30"[^>]*max="300"[^>]*value="300"/);
  assert.match(script, /neighborStackAnimation/);
  assert.match(script, /invalid_neighbor_stack_animation/);
});

test('neighbor-stack animation settings persist and invalid ranges preserve the previous values', () => {
  const config = testConfig();
  const db = new Database(':memory:');
  try {
    assert.deepEqual(db.getSettings(config).neighborStackAnimation, {
      swayAmplitude: 12,
      swayDuration: 2,
      rotationMultiplier: 1,
      bendMultiplier: 1,
      lifetimeMinSeconds: 30,
      lifetimeMaxSeconds: 300,
    });
    const saved = db.updateSettings({
      neighborStackAnimation: { lifetimeMinSeconds: 45, lifetimeMaxSeconds: 180 },
    }, config);
    assert.equal(saved.neighborStackAnimation.lifetimeMinSeconds, 45);
    assert.equal(saved.neighborStackAnimation.lifetimeMaxSeconds, 180);
    assert.throws(() => db.updateSettings({
      neighborStackAnimation: { lifetimeMinSeconds: 200, lifetimeMaxSeconds: 100 },
    }, config), /invalid_neighbor_stack_animation/);
    assert.deepEqual(db.getSettings(config).neighborStackAnimation, saved.neighborStackAnimation);
  } finally {
    db.close();
  }
});

test('socket validates animation settings and includes active snapshots in scene initialization', () => {
  const config = testConfig();
  const db = new Database(':memory:');
  const activeStack = { stackId: 'active', members: [], expiresAt: new Date(Date.now() + 30_000).toISOString() };
  const handlers = new Map();
  const ioEvents = [];
  const io = {
    use() {},
    on(event, handler) {
      if (event === 'connection') this.connect = handler;
    },
    emit(...args) {
      ioEvents.push(args);
    },
  };
  const socket = {
    data: { admin: true },
    handshake: { headers: { cookie: '' } },
    emitted: [],
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(...args) {
      this.emitted.push(args);
    },
  };
  try {
    db.getSettings(config);
    attachSocketHandlers(io, {
      config,
      db,
      statuses: { all: () => [] },
      joinedStackService: { activeSnapshots: () => [activeStack] },
    });
    io.connect(socket);
    const scene = socket.emitted.find(([event]) => event === 'scene:init')?.[1];
    assert.deepEqual(scene.joinedStacks, [activeStack]);
    assert.deepEqual(scene.settings.neighborStackAnimation, db.getSettings(config).neighborStackAnimation);

    let mappingResponse;
    handlers.get('admin:settings:update')({
      rewardMapping: { pumpkin_tower: 'reassignable-reward' },
    }, (result) => { mappingResponse = result; });
    assert.equal(mappingResponse.ok, true);
    handlers.get('admin:settings:update')({
      rewardMapping: { pumpkin_tower: '', neighbor_stack: 'reassignable-reward' },
    }, (result) => { mappingResponse = result; });
    assert.equal(mappingResponse.ok, true);
    assert.equal(mappingResponse.settings.rewardMapping.pumpkin_tower, '');
    assert.equal(mappingResponse.settings.rewardMapping.neighbor_stack, 'reassignable-reward');
    const storedMapping = db.sqlite.prepare('SELECT reward_mapping_json FROM settings WHERE id = 1').get();
    assert.equal(JSON.parse(storedMapping.reward_mapping_json).neighbor_stack, 'reassignable-reward');

    let response;
    handlers.get('admin:settings:update')({
      neighborStackAnimation: { lifetimeMinSeconds: 60, lifetimeMaxSeconds: 120 },
    }, (result) => { response = result; });
    assert.equal(response.ok, true);
    assert.deepEqual(response.settings.neighborStackAnimation, {
      swayAmplitude: 12,
      swayDuration: 2,
      rotationMultiplier: 1,
      bendMultiplier: 1,
      lifetimeMinSeconds: 60,
      lifetimeMaxSeconds: 120,
    });

    handlers.get('admin:settings:update')({
      neighborStackAnimation: { lifetimeMinSeconds: 200, lifetimeMaxSeconds: 100 },
    }, (result) => { response = result; });
    assert.equal(response.ok, false);
    assert.equal(response.error, 'invalid_neighbor_stack_animation');
    assert.equal(db.getSettings(config).neighborStackAnimation.lifetimeMinSeconds, 60);
    assert.ok(socket.emitted.some(([event, payload]) => event === 'operation:error' && payload.message === 'invalid_neighbor_stack_animation'));
  } finally {
    db.close();
  }
});

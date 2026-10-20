import test from 'node:test';
import assert from 'node:assert/strict';
import { DonationService } from '../src/engine/donations.js';
import { RewardService } from '../src/engine/rewards.js';
import { parseCustomization } from '../src/engine/customization-parser.js';
import { clampPosition, dimensionsFor, isPositionValid } from '../src/engine/spatial-rules.js';
import { testConfig, testDatabase } from './helpers.js';
import { DEFAULT_ANIMATION, ANIMATION_LIMITS, animationPatch, sanitizeAnimation } from '../src/engine/animation.js';
import { attachSocketHandlers } from '../src/socket/handlers.js';
import { OAuthAdapters } from '../src/auth/oauth-adapters.js';
import { rewardMappingPatch, sanitizeRewardMapping } from '../src/engine/rewards.js';

test('customization parser accepts the documented command and ignores unknown words', () => {
  const parsed = parseCustomization('  !ТЫКОВКА ведьма рожки хитрые клыки метла неизвестно');
  assert.equal(parsed.commandDetected, true);
  assert.deepEqual(parsed.customization, { skin: 'witch', eyes: 'sly', mouth: 'fangs', hat: 'horns', prop: 'broom' });
});

test('OAuth authorization URLs use the server API callback routes', () => {
  const config = testConfig({ TWITCH_CLIENT_ID: 'twitch-client', DA_CLIENT_ID: 'donationalerts-client' });
  const oauth = new OAuthAdapters({ config, tokenStore: {}, statuses: {} });
  for (const provider of ['twitch', 'donationalerts']) {
    const url = new URL(oauth.authorizationUrl(provider));
    assert.equal(url.searchParams.get('redirect_uri'), config[provider].redirectUri);
    assert.equal(new URL(config[provider].redirectUri).pathname, `/api/auth/${provider}/callback`);
  }
});

test('donation processing creates, evolves, and deduplicates a pumpkin', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const events = [];
  const service = new DonationService({ db, config, emit: (event, payload) => events.push([event, payload]), idFactory: () => 'pumpkin-1' });
  const first = service.handle({ id: 'donation-1', name: 'Spooky Viewer', amount: 300, currency: 'RUB', message: '!тыковка ведьма рожки хитрые клыки метла' });
  assert.equal(first.spawned, true);
  assert.equal('animation' in first.pumpkin, false);
  assert.equal(first.pumpkin.stage, 2);
  assert.equal(first.pumpkin.customization.skin, 'witch');
  assert.equal(service.handle({ id: 'donation-1', name: 'Spooky Viewer', amount: 300, currency: 'RUB' }).duplicate, true);
  const second = service.handle({ id: 'donation-2', name: 'Spooky Viewer', amount: 700, currency: 'RUB' });
  assert.equal(second.pumpkin.stage, 3);
  assert.equal(db.listPumpkins().length, 1);
  assert.deepEqual(events.map(([event]) => event), ['pumpkin:spawned', 'pumpkin:evolved', 'pumpkin:updated', 'pumpkin:evolved']);
  db.close();
});

test('animation settings sanitize partial updates and reject non-finite or out-of-range values', () => {
  assert.deepEqual(sanitizeAnimation({ eyeFrequency: '2.5', mouthFrequency: Infinity }), { eyeFrequency: 2.5, mouthFrequency: 1 });
  assert.deepEqual(animationPatch({ eyeFrequency: 0.1 }, { eyeFrequency: 2, mouthFrequency: 3 }), { eyeFrequency: ANIMATION_LIMITS.min, mouthFrequency: 3 });
  assert.equal(animationPatch({ mouthFrequency: 10.01 }), null);
  assert.equal(animationPatch({ eyeFrequency: 'not-a-number' }), null);
  assert.equal(animationPatch({}), null);
});

test('reward mapping sanitizer accepts supported actions and merges partial updates', () => {
  assert.deepEqual(sanitizeRewardMapping({ inflate: ' reward-1 ', ghost: 'reward-2', unknown: 'ignored' }), { inflate: 'reward-1', ghost: 'reward-2' });
  assert.deepEqual(rewardMappingPatch({ bat: 'reward-3' }, { inflate: 'reward-1' }), { inflate: 'reward-1', bat: 'reward-3' });
  assert.equal(rewardMappingPatch({ jump_on: 42 }, {}), null);
  assert.deepEqual(rewardMappingPatch({ morph_fly: '' }, {}), { morph_fly: '' });
});

test('animation settings persist globally and are broadcast through Socket.IO settings updates', () => {
  const config = testConfig();
  const db = testDatabase(config);
  assert.deepEqual(db.getSettings(config).animation, DEFAULT_ANIMATION);
  db.updateSettings({ animation: { eyeFrequency: 2, mouthFrequency: 3 } }, config);
  assert.deepEqual(db.getSettings(config).animation, { eyeFrequency: 2, mouthFrequency: 3 });
  const ioEvents = [];
  const socketEvents = new Map();
  let connection;
  const io = { use() {}, on(event, handler) { if (event === 'connection') connection = handler; }, emit(...args) { ioEvents.push(args); } };
  attachSocketHandlers(io, { config, db, statuses: { all: () => [] } });
  const socket = { data: { admin: true }, handshake: { headers: {} }, on(event, handler) { socketEvents.set(event, handler); }, emit(...args) { ioEvents.push(['socket', ...args]); } };
  connection(socket);
  socketEvents.get('admin:settings:update')({ animation: { eyeFrequency: 2.5 } });
  assert.equal(ioEvents.at(-1)[0], 'settings:updated');
  assert.deepEqual(ioEvents.at(-1)[1].settings.animation, { eyeFrequency: 2.5, mouthFrequency: 3 });
  socketEvents.get('admin:settings:update')({ animation: { eyeFrequency: 0 } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_animation' }]);
  socketEvents.get('admin:settings:update')({ rewardMapping: { inflate: 'reward-inflate' } });
  assert.equal(ioEvents.at(-1)[0], 'settings:updated');
  assert.equal(ioEvents.at(-1)[1].settings.rewardMapping.inflate, 'reward-inflate');
  assert.equal(db.getSettings(config).rewardMapping.inflate, 'reward-inflate');
  socketEvents.get('admin:settings:update')({ rewardMapping: { ghost: 7 } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_reward_mapping' }]);
  db.close();
});

test('spatial bounds follow the square reference artwork stage scale at scene edges', () => {
  const config = testConfig();
  const pumpkin = { stage: 3 };
  const dimensions = dimensionsFor(pumpkin);
  assert.ok(Math.abs(dimensions.width - 220) < 0.000001);
  assert.equal(dimensions.width, dimensions.height);
  const context = { scene: config.scene, noGoZone: { enabled: false } };
  const edgeX = dimensions.width / 2;
  assert.equal(isPositionValid(pumpkin, edgeX, config.scene.groundY, context), true);
  assert.equal(isPositionValid(pumpkin, edgeX - 0.01, config.scene.groundY, context), false);
  assert.equal(isPositionValid(pumpkin, config.scene.width - edgeX, config.scene.groundY, context), true);
  assert.equal(isPositionValid(pumpkin, config.scene.width - edgeX + 0.01, config.scene.groundY, context), false);
});

test('No-Go Zone validation rejects overlap and clamp chooses a safe position', () => {
  const config = testConfig();
  const pumpkin = { stage: 2, x: 300, y: 980 };
  const noGoZone = { enabled: true, x: 200, y: 700, width: 500, height: 300 };
  assert.equal(isPositionValid(pumpkin, 350, 980, { scene: config.scene, noGoZone }), false);
  const edgeNoGoZone = { enabled: true, x: 0, y: 800, width: 40, height: 200 };
  assert.equal(isPositionValid(pumpkin, dimensionsFor(pumpkin).width / 2, 980, { scene: config.scene, noGoZone: edgeNoGoZone }), false);
  const safe = clampPosition(pumpkin, 350, 980, { scene: config.scene, noGoZone });
  assert.equal(isPositionValid(pumpkin, safe.x, safe.y, { scene: config.scene, noGoZone }), true);
});

test('reward IDs are required and repeat redemptions are ignored', () => {
  const config = testConfig({ TWITCH_REWARD_INFLATE_ID: 'reward-inflate' });
  const db = testDatabase(config);
  const donation = new DonationService({ db, config, idFactory: () => 'pumpkin-1' });
  donation.handle({ id: 'donation-1', userId: 'twitch-1', username: 'viewer', name: 'Viewer', amount: 100, currency: 'RUB' });
  const actions = [];
  const rewards = new RewardService({ db, config, emit: (event, payload) => actions.push([event, payload]) });
  const result = rewards.handle({ id: 'redemption-1', rewardId: 'reward-inflate', userId: 'twitch-1', userLogin: 'viewer' });
  assert.equal(result.action, 'inflate');
  assert.equal(rewards.handle({ id: 'redemption-1', rewardId: 'reward-inflate', userId: 'twitch-1', userLogin: 'viewer' }).duplicate, true);
  assert.equal(actions.some(([event]) => event === 'pumpkin:action'), true);
  assert.equal(rewards.handle({ id: 'redemption-2', rewardId: 'wrong-id', userId: 'twitch-1', userLogin: 'viewer' }).status, 'ignored_reward');
  db.close();
});

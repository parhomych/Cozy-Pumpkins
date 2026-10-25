import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DonationService } from '../src/engine/donations.js';
import { RewardService } from '../src/engine/rewards.js';
import { customizationCatalog, customizationValues, parseCustomization, parseCustomizationRequest, sanitizeCustomization } from '../src/engine/customization-parser.js';
import { clampPosition, dimensionsFor, isPositionValid } from '../src/engine/spatial-rules.js';
import { testConfig, testDatabase } from './helpers.js';
import { Database } from '../src/db/database.js';
import { DEFAULT_ANIMATION, ANIMATION_LIMITS, animationPatch, sanitizeAnimation } from '../src/engine/animation.js';
import { DEFAULT_TOWER_ANIMATION, towerAnimationPatch } from '../src/engine/tower-animation.js';
import { attachSocketHandlers } from '../src/socket/handlers.js';
import { OAuthAdapters } from '../src/auth/oauth-adapters.js';
import { rewardMappingPatch, sanitizeRewardMapping } from '../src/engine/rewards.js';
import { buildTowerPlan } from '../src/engine/pumpkin-tower.js';
import { createPumpkinMovementScheduler, findRoamingTarget } from '../src/engine/pumpkin-movement.js';
import { loadConfig } from '../src/config.js';
import { DEFAULT_ROAMING_SETTINGS, roamingSettingsPatch } from '../src/engine/roaming-settings.js';

test('ground defaults to the scene bottom and stays within scene bounds', () => {
  const config = loadConfig({ loadDotenv: false, env: { NODE_ENV: 'test' } });
  assert.equal(config.scene.groundY, config.scene.height);
  assert.throws(
    () => loadConfig({ loadDotenv: false, env: { NODE_ENV: 'test', SCENE_HEIGHT: '500', GROUND_Y: '501' } }),
    /GROUND_Y must be a valid number/,
  );
});

test('saved ground follows config until explicitly overridden', () => {
  const oldConfig = testConfig({ GROUND_Y: '980' });
  const newConfig = testConfig();
  const db = testDatabase(oldConfig);
  assert.equal(db.getSettings(oldConfig).groundY, 980);
  assert.equal(db.getSettings(newConfig).groundY, newConfig.scene.height);
  assert.equal(db.sqlite.prepare('SELECT ground_y_overridden FROM settings WHERE id = 1').get().ground_y_overridden, 0);
  db.updateSettings({ groundY: 980 }, newConfig);
  assert.equal(db.getSettings(newConfig).groundY, 980);
  assert.equal(db.sqlite.prepare('SELECT ground_y_overridden FROM settings WHERE id = 1').get().ground_y_overridden, 1);
  db.close();
});

function insertMovementTestPumpkin(db, id, x, y, stage = 1) {
  return db.insertPumpkin({
    id, ownerKey: id, ownerNormalized: id, displayName: id, showDisplayName: true,
    totalDonated: 0, currency: 'RUB', stage, x, y, isAirborne: false,
    parentId: null, stackOffsetY: null, customization: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
}

test('customization parser accepts the documented command and ignores unknown words', () => {
  const parsed = parseCustomization('  !ТЫКОВКА ведьма рожки хитрые клыки метла неизвестно');
  assert.equal(parsed.commandDetected, true);
  assert.deepEqual(parsed.customization, { skin: 'classic', eyes: 'cute', mouth: 'fangs', hat: 'none', prop: 'none' });
});

test('customization parser recognizes the configured command prefix only', () => {
  const parsed = parseCustomization('  !Pumpkin witch stars метла extra', undefined, '!pumpkin');
  assert.equal(parsed.commandDetected, true);
  assert.deepEqual(parsed.customization, { skin: 'classic', eyes: 'stars', mouth: 'cat', hat: 'none', prop: 'none' });
  assert.equal(parseCustomization('!pumpkinExtra witch', undefined, '!pumpkin').commandDetected, false);
  assert.equal(parseCustomization('!тыковка witch', undefined, '!pumpkin').commandDetected, false);
});

test('customization catalog exposes canonical values and aliases for supported slots', () => {
  const catalog = customizationCatalog();
  assert.deepEqual(catalog.map(({ slot }) => slot), ['skin', 'eyes', 'mouth', 'hat', 'prop']);
  for (const group of catalog) {
    assert.deepEqual(group.values.map(({ value }) => value), customizationValues()[group.slot]);
    assert.ok(group.values.every(({ value, keywords }) => keywords.includes(value) || (group.slot === 'hat' && value === 'witch' && keywords.includes('witch hat'))));
  }
  assert.deepEqual(catalog.find(({ slot }) => slot === 'hat').values, [
    { value: 'none', keywords: ['none', 'нет', 'ничего', 'без шляпы'] },
    { value: 'witch', keywords: ['witch hat', 'witch_hat', 'шляпа ведьмы', 'ведьминская шляпа'] },
  ]);
  assert.deepEqual(catalog.find(({ slot }) => slot === 'prop').values, [
    {
      value: 'none',
      keywords: ['none', 'нет', 'ничего', 'без аксессуара'],
    },
    {
      value: 'cocoa_hands',
      keywords: ['cocoa_hands', 'cocoa hands', 'cocoa', 'какао', 'руки с какао'],
    },
    {
      value: 'blanket',
      keywords: ['blanket', 'plaid', 'плед', 'пледик', 'одеяло', 'одеялко'],
    },
  ]);
});

test('plain customization requests preserve text order, prefer long aliases, and reject oversized input', () => {
  assert.deepEqual(parseCustomizationRequest('please use witch hat, sleepy eyes, fangs, then stars'), [
    { slot: 'hat', value: 'witch' },
    { slot: 'eyes', value: 'sleepy' },
    { slot: 'mouth', value: 'fangs' },
    { slot: 'eyes', value: 'stars' },
  ]);
  assert.deepEqual(parseCustomizationRequest('classic'), [{ slot: 'skin', value: 'classic' }]);
  assert.deepEqual(parseCustomizationRequest(`${'x'.repeat(257)} classic`), []);
  assert.deepEqual(parseCustomizationRequest(`classic${' '.repeat(252)}`), []);
});

test('donation customization recognizes cocoa-hands aliases and sanitation preserves supported choices', () => {
  for (const alias of ['cocoa_hands', 'cocoa hands', 'cocoa', 'какао', 'руки с какао']) {
    const parsed = parseCustomization(`!тыковка ${alias}`);
    assert.equal(parsed.recognized, true, `${alias} should be recognized`);
    assert.equal(parsed.customization.prop, 'cocoa_hands');
  }
  assert.deepEqual(
    sanitizeCustomization({ prop: 'cocoa_hands' }, { skin: 'ghost', eyes: 'stars', mouth: 'o', hat: 'witch', prop: 'none' }),
    { skin: 'ghost', eyes: 'stars', mouth: 'o', hat: 'witch', prop: 'cocoa_hands' },
  );
  assert.equal(sanitizeCustomization({ prop: 'unknown' }).prop, 'none');
});

test('donation customization recognizes blanket aliases and sanitation preserves supported choices', () => {
  for (const alias of ['blanket', 'plaid', 'плед', 'пледик', 'одеяло', 'одеялко']) {
    const parsed = parseCustomization(`!тыковка ${alias}`);
    assert.equal(parsed.recognized, true, `${alias} should be recognized`);
    assert.equal(parsed.customization.prop, 'blanket');
  }
  assert.deepEqual(
    sanitizeCustomization({ prop: 'blanket' }, { skin: 'ghost', eyes: 'stars', mouth: 'o', hat: 'witch', prop: 'none' }),
    { skin: 'ghost', eyes: 'stars', mouth: 'o', hat: 'witch', prop: 'blanket' },
  );
});

test('donation customization recognizes none prop aliases and sanitation resets supported choices', () => {
  for (const alias of ['none', 'нет', 'ничего', 'без аксессуара']) {
    const parsed = parseCustomization(`!тыковка ${alias}`);
    assert.equal(parsed.recognized, true, `${alias} should be recognized`);
    assert.equal(parsed.customization.prop, 'none');
  }
  assert.deepEqual(
    sanitizeCustomization({ prop: 'none' }, { skin: 'ghost', eyes: 'stars', mouth: 'o', hat: 'witch', prop: 'cocoa_hands' }),
    { skin: 'ghost', eyes: 'stars', mouth: 'o', hat: 'witch', prop: 'none' },
  );
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

test('Twitch OAuth validates broadcaster identity before saving the encrypted-token input', async () => {
  const config = testConfig({ TWITCH_CLIENT_ID: 'twitch-client', TWITCH_CLIENT_SECRET: 'twitch-secret' });
  let saved;
  let providerStatus;
  const oauth = new OAuthAdapters({
    config,
    tokenStore: { save: (provider, token) => { saved = { provider, token }; } },
    statuses: { set: (provider, status) => { providerStatus = { provider, status }; } },
    twitchApi: { getAuthenticatedUser: async (token) => {
      assert.equal(token, 'private-access-token');
      return { id: 'broadcaster-1', login: 'cozypumpkins', displayName: 'Cozy Pumpkins' };
    } },
    fetchImpl: async () => new Response(JSON.stringify({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, scope: ['channel:read:redemptions'] }), { status: 200 }),
  });
  const state = new URL(oauth.authorizationUrl('twitch')).searchParams.get('state');
  const result = await oauth.callback('twitch', 'oauth-code', state);
  assert.deepEqual(result, { connected: true, account: 'Cozy Pumpkins' });
  assert.equal(saved.provider, 'twitch');
  assert.equal(saved.token.providerUserId, 'broadcaster-1');
  assert.equal(saved.token.providerLogin, 'cozypumpkins');
  assert.equal(providerStatus.status.account, 'Cozy Pumpkins');
  assert.equal(providerStatus.status.connectionStatus, 'Disconnected');

  const failed = new OAuthAdapters({
    config,
    tokenStore: { save() { assert.fail('must not save an unvalidated Twitch identity'); } },
    statuses: { set() { assert.fail('must not mark an unvalidated account connected'); } },
    twitchApi: { getAuthenticatedUser: async () => { throw new Error('twitch_user_unavailable'); } },
    fetchImpl: async () => new Response(JSON.stringify({ access_token: 'private-access-token' }), { status: 200 }),
  });
  const failedState = new URL(failed.authorizationUrl('twitch')).searchParams.get('state');
  await assert.rejects(failed.callback('twitch', 'oauth-code', failedState), { message: 'twitch_user_unavailable' });
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
  assert.equal(first.pumpkin.customization.skin, 'classic');
  assert.equal(service.handle({ id: 'donation-1', name: 'Spooky Viewer', amount: 300, currency: 'RUB' }).duplicate, true);
  const second = service.handle({ id: 'donation-2', name: 'Spooky Viewer', amount: 2700, currency: 'RUB' });
  assert.equal(second.pumpkin.stage, 4);
  assert.equal(db.listPumpkins().length, 1);
  assert.deepEqual(events.map(([event]) => event), ['pumpkin:spawned', 'pumpkin:evolved', 'pumpkin:updated', 'pumpkin:evolved']);
  db.close();
});

test('a bare spawn command creates a pumpkin with randomized eyes and mouth', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const randomValues = [0.4, 0.8, 0.25];
  const service = new DonationService({
    db,
    config,
    idFactory: () => 'bare-command-pumpkin',
    random: () => randomValues.shift(),
  });

  const result = service.handle({
    provider: 'donationalerts',
    id: 'bare-command-donation',
    name: 'Bare Command Viewer',
    amount: 10,
    currency: 'RUB',
    message: '!тыковка',
  });

  assert.equal(result.spawned, true);
  assert.equal(result.pumpkin.customization.eyes, 'stars');
  assert.equal(result.pumpkin.customization.mouth, 'neca_mouth');
  const spawnWidth = dimensionsFor({ stage: 1 }, db.getSettings(config).growthMultipliers).width;
  assert.equal(result.pumpkin.x, spawnWidth / 2 + (config.scene.width - spawnWidth) * 0.25);
  assert.equal(result.pumpkin.y, config.scene.groundY);
  db.close();
});

test('donation logs identify ignored reasons without logging donor names or messages', () => {
  const config = testConfig();
  const db = testDatabase(config);
  db.updateSettings({ minSpawnDonation: 100 }, config);
  const logs = [];
  const service = new DonationService({
    db,
    config,
    logger: {
      info: (message, metadata) => logs.push({ level: 'info', message, metadata }),
      warn: (message, metadata) => logs.push({ level: 'warn', message, metadata }),
    },
  });

  const result = service.handle({
    provider: 'donationalerts',
    id: 'ignored-logged-donation',
    name: 'Private Donor Name',
    amount: 50,
    currency: 'RUB',
    message: '!тыковка private message',
  });

  assert.equal(result.reason, 'spawn_threshold_not_met');
  assert.deepEqual(logs.map(({ message }) => message), ['Donation event received', 'Donation event ignored']);
  assert.equal(logs[1].metadata.reason, 'spawn_threshold_not_met');
  assert.equal(logs[1].metadata.minimumAmount, 100);
  assert.equal(JSON.stringify(logs).includes('Private Donor Name'), false);
  assert.equal(JSON.stringify(logs).includes('private message'), false);
  db.close();
});

test('donation processing applies persisted cumulative growth thresholds', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const service = new DonationService({ db, config, idFactory: () => 'threshold-pumpkin' });
  db.updateSettings({ growthThresholds: { stage2: 100, stage3: 250, stage4: 500 } }, config);
  const donate = (id, amount, message = '') => service.handle({
    id, name: 'Threshold Viewer', amount, currency: 'RUB', message,
  });

  assert.equal(donate('threshold-1', 50, '!тыковка').pumpkin.stage, 1);
  assert.equal(donate('threshold-2', 49).pumpkin.stage, 1);
  assert.equal(donate('threshold-3', 1).pumpkin.stage, 2);
  assert.equal(donate('threshold-4', 149).pumpkin.stage, 2);
  assert.equal(donate('threshold-5', 1).pumpkin.stage, 2);
  assert.equal(donate('threshold-6', 249).pumpkin.stage, 2);
  assert.equal(donate('threshold-7', 1).pumpkin.stage, 4);
  db.close();
});

test('donation growth skips disabled stages without shifting the remaining thresholds', () => {
  const config = testConfig();
  const db = testDatabase(config);
  db.updateSettings({
    growthThresholds: { stage2: 100, stage3: 250, stage4: 500 },
    growthStages: { stage2: false, stage3: true, stage4: true },
  }, config);
  const service = new DonationService({ db, config, idFactory: () => 'disabled-stage-pumpkin' });
  const pumpkin = service.handle({ id: 'disabled-stage-donation', name: 'Stage Viewer', amount: 250, currency: 'RUB', message: '!тыковка' }).pumpkin;
  assert.equal(pumpkin.stage, 3);
  db.close();
});

test('donation event IDs and donor ownership are scoped to their provider', () => {
  const config = testConfig();
  const db = testDatabase(config);
  let id = 0;
  const service = new DonationService({ db, config, idFactory: () => `provider-pumpkin-${++id}` });
  const first = service.handle({
    provider: 'donatex', id: 'collision', ownerId: 'shared-id', name: 'Cross Platform',
    amount: 20, currency: 'RUB', message: '!тыковка',
  });
  const second = service.handle({
    provider: 'memealerts', id: 'collision', ownerId: 'shared-id', name: 'Cross Platform',
    amount: 20, currency: 'RUB', message: '!тыковка',
  });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.notEqual(first.pumpkin.id, second.pumpkin.id);
  assert.deepEqual(db.listPumpkins().map(({ ownerKey }) => ownerKey).sort(), ['donatex:shared-id', 'memealerts:shared-id']);
  const anonymousDonatEx = service.handle({
    provider: 'donatex', id: 'anonymous-dx', name: 'Name Only Viewer', amount: 20, currency: 'RUB', message: '!тыковка',
  });
  const anonymousMemeAlerts = service.handle({
    provider: 'memealerts', id: 'anonymous-ma', name: 'Name Only Viewer', amount: 20, currency: 'RUB', message: '!тыковка',
  });
  assert.notEqual(anonymousDonatEx.pumpkin.id, anonymousMemeAlerts.pumpkin.id);
  assert.deepEqual(
    db.listPumpkins().filter(({ ownerNormalized }) => ownerNormalized === 'name only viewer').map(({ ownerKey }) => ownerKey).sort(),
    ['name:donatex:name only viewer', 'name:memealerts:name only viewer'],
  );
  assert.throws(
    () => service.handle({ provider: 'unknown', id: 'invalid-provider', name: 'Viewer', amount: 5, currency: 'RUB' }),
    { message: 'invalid_donation_event' },
  );
  db.close();
});

test('donation spawn gates and provider identities preserve legacy owners and deduplicate by provider', () => {
  const config = testConfig();
  const db = testDatabase(config);
  let id = 0;
  const events = [];
  const service = new DonationService({ db, config, idFactory: () => `pumpkin-${++id}`, emit: (event) => events.push(event) });

  const legacy = service.handle({
    id: 'legacy-create', provider: 'donationalerts', ownerId: 'legacy-user', name: 'Legacy Viewer',
    amount: 10, currency: 'RUB', message: '!тыковка',
  });
  assert.equal(legacy.spawned, true);
  const nameOnlyLegacy = service.handle({
    id: 'legacy-name-create', provider: 'donationalerts', name: 'Legacy Name',
    amount: 10, currency: 'RUB', message: '!тыковка',
  });
  assert.equal(nameOnlyLegacy.spawned, true);
  db.updateSettings({ minSpawnDonation: 100, spawnCommand: '!spawn' }, config);

  const donor = { provider: 'donatex', ownerId: 'shared-provider-id', name: 'Same Name', currency: 'RUB' };
  assert.equal(service.handle({ ...donor, id: 'below', amount: 99, message: '!spawn' }).spawned, false);
  assert.equal(db.listPumpkins().length, 2);
  assert.equal(service.handle({ ...donor, id: 'missing-command', amount: 100, message: 'hello !spawn' }).spawned, false);
  assert.equal(db.listPumpkins().length, 2);
  const created = service.handle({ ...donor, id: 'shared-event-id', amount: 100, message: '  !SPAWN witch рожки' });
  assert.equal(created.spawned, true);
  assert.equal(created.pumpkin.customization.skin, 'classic');
  assert.equal(created.pumpkin.customization.hat, 'none');
  assert.equal(service.handle({ ...donor, id: 'shared-event-id', amount: 100, message: '!spawn ghost' }).duplicate, true);
  const existingOwner = service.handle({ ...donor, id: 'existing-owner', amount: 25, message: '' });
  assert.equal(existingOwner.spawned, false);
  assert.equal(existingOwner.pumpkin.totalDonated, 125);

  const otherProvider = service.handle({
    ...donor, provider: 'memealerts', id: 'shared-event-id', amount: 100, message: '!spawn ghost',
  });
  assert.equal(otherProvider.spawned, true);
  assert.equal(otherProvider.pumpkin.customization.skin, 'classic');
  assert.equal(db.listPumpkins().length, 4);
  const legacyUpdate = service.handle({
    id: 'legacy-update', provider: 'donationalerts', ownerId: 'legacy-user', name: 'Legacy Viewer',
    amount: 5, currency: 'RUB', message: '',
  });
  assert.equal(legacyUpdate.spawned, false);
  assert.equal(legacyUpdate.pumpkin.id, legacy.pumpkin.id);
  const linkedNameLegacy = service.handle({
    id: 'legacy-name-linked', provider: 'donationalerts', ownerId: 'legacy-name-user', name: 'Legacy Name',
    amount: 5, currency: 'RUB', message: '',
  });
  assert.equal(linkedNameLegacy.spawned, false);
  assert.equal(linkedNameLegacy.pumpkin.id, nameOnlyLegacy.pumpkin.id);
  assert.throws(
    () => service.handle({ ...donor, provider: 'unknown', id: 'bad-provider', amount: 100, message: '!spawn' }),
    { message: 'invalid_donation_event' },
  );
});

test('new pumpkin spawn is refused when no safe scene position exists and mismatched currency does not accrue', () => {
  const config = testConfig();
  const db = testDatabase(config);
  db.updateSettings({
    minSpawnDonation: 0,
    spawnCommand: '!spawn',
    noGoZone: { enabled: true, x: 0, y: 0, width: config.scene.width, height: config.scene.height },
  }, config);
  const events = [];
  const service = new DonationService({ db, config, emit: (event) => events.push(event), idFactory: () => 'no-position' });
  const noPosition = service.handle({
    provider: 'donatex', id: 'no-position-event', ownerId: 'viewer-id', name: 'Viewer',
    amount: 50, currency: 'RUB', message: '!spawn',
  });
  assert.equal(noPosition.spawned, false);
  assert.equal(db.listPumpkins().length, 0);
  db.updateSettings({ noGoZone: { enabled: false, x: 0, y: 0, width: 0, height: 0 } }, config);
  const wrongCurrency = service.handle({
    provider: 'memealerts', id: 'wrong-currency', ownerId: 'other-id', name: 'Other Viewer',
    amount: 500, currency: 'MEMECOIN', message: '!spawn',
  });
  assert.equal(wrongCurrency.spawned, false);
  assert.equal(wrongCurrency.currencyApplied, false);
  assert.equal(wrongCurrency.pumpkin, null);
  assert.equal(events.length, 0);
  db.close();
});

test('donation spawn randomly overlaps existing pumpkins instead of requiring a free zone', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const growthMultipliers = { stage1: 0.9, stage2: 0.95, stage3: 1.09, stage4: 1.1 };
  db.updateSettings({ minSpawnDonation: 100, growthMultipliers }, config);
  const occupiedPositions = [
    { stage: 4, x: 291.8297161936561, y: 1054.3239227340268 },
    { stage: 4, x: 543.7362270450751, y: 1080 },
    { stage: 4, x: 846.9282136894825, y: 1080 },
    { stage: 2, x: 1141.8522537562606, y: 1046.3001485884101 },
    { stage: 1, x: 1434.2404006677796, y: 1080 },
    { stage: 1, x: 1615.7762938230383, y: 1080 },
  ];
  occupiedPositions.forEach((position, index) => db.insertPumpkin({
    id: `occupied-${index}`,
    ownerKey: `occupied-${index}`,
    ownerNormalized: `occupied ${index}`,
    displayName: `Occupied ${index}`,
    totalDonated: 0,
    currency: 'RUB',
    ...position,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'none' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  const service = new DonationService({ db, config, idFactory: () => 'gap-spawned-pumpkin', random: () => 0.25 });

  const result = service.handle({
    provider: 'donationalerts',
    id: 'gap-spawn-donation',
    name: 'Gap Viewer',
    amount: 250,
    currency: 'RUB',
    message: '!тыковка',
  });

  assert.equal(result.spawned, true);
  const spawnWidth = dimensionsFor(result.pumpkin, { growthMultipliers }).width;
  const randomSpawnX = spawnWidth / 2 + (config.scene.width - spawnWidth) * 0.25;
  assert.ok(Math.abs(result.pumpkin.x - randomSpawnX) <= 30, 'the full-coverage safeguard may shift the random spawn by 30 pixels');
  assert.equal(result.pumpkin.y, config.scene.groundY);
  assert.equal(db.listPumpkins().length, 7);
  assert.ok(occupiedPositions.some((other) => {
    const centerDifference = Math.abs(result.pumpkin.x - other.x);
    return centerDifference < (spawnWidth + dimensionsFor(other, { growthMultipliers }).width) / 2;
  }));
  db.close();
});

test('random donation spawn shifts 30 pixels when it would fully cover a pumpkin', () => {
  const config = testConfig();
  const db = testDatabase(config);
  db.insertPumpkin({
    id: 'centered-pumpkin',
    ownerKey: 'centered-pumpkin',
    ownerNormalized: 'centered pumpkin',
    displayName: 'Centered Pumpkin',
    totalDonated: 0,
    currency: 'RUB',
    stage: 1,
    x: config.scene.width / 2,
    y: config.scene.groundY,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'none' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const service = new DonationService({ db, config, idFactory: () => 'shifted-pumpkin', random: () => 0.5 });

  const result = service.handle({
    provider: 'donationalerts',
    id: 'shifted-spawn-donation',
    name: 'Shifted Viewer',
    amount: 100,
    currency: 'RUB',
    message: '!тыковка',
  });

  assert.equal(result.spawned, true);
  assert.equal(result.pumpkin.x, config.scene.width / 2 + 30);
  assert.equal(result.pumpkin.y, config.scene.groundY);
  db.close();
});

test('donation validation rejects malformed normalized events before recording them', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const service = new DonationService({ db, config });
  const valid = { id: 'valid-event', provider: 'donatex', name: 'Viewer', amount: 10, currency: 'RUB', message: '' };
  const invalidEvents = [
    { ...valid, id: '' },
    { ...valid, name: '' },
    { ...valid, amount: Number.POSITIVE_INFINITY },
    { ...valid, amount: 0 },
    { ...valid, amount: 1e12 + 1 },
    { ...valid, currency: '' },
    { ...valid, currency: {} },
    { ...valid, message: { private: true } },
  ];
  for (const event of invalidEvents) assert.throws(() => service.handle(event), { message: 'invalid_donation_event' });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM donations').get().count, 0);
  assert.equal(db.listPumpkins().length, 0);
  db.close();
});

test('animation settings sanitize partial updates and reject non-finite or out-of-range values', () => {
  assert.deepEqual(sanitizeAnimation({ eyeFrequency: '2.5', mouthFrequency: Infinity }), { eyeFrequency: 2.5, mouthFrequency: 1 });
  assert.deepEqual(animationPatch({ eyeFrequency: 0.1 }, { eyeFrequency: 2, mouthFrequency: 3 }), { eyeFrequency: ANIMATION_LIMITS.min, mouthFrequency: 3 });
  assert.equal(animationPatch({ mouthFrequency: 10.01 }), null);
  assert.equal(animationPatch({ eyeFrequency: 'not-a-number' }), null);
  assert.equal(animationPatch({}), null);
});

test('tower animation settings persist, merge partial updates, and reject unsafe values', () => {
  const config = testConfig();
  const db = testDatabase(config);
  assert.deepEqual(db.getSettings(config).towerAnimation, DEFAULT_TOWER_ANIMATION);
  assert.deepEqual(towerAnimationPatch({ swayAmplitude: 24 }, DEFAULT_TOWER_ANIMATION), { ...DEFAULT_TOWER_ANIMATION, swayAmplitude: 24 });
  assert.equal(towerAnimationPatch({ swayDuration: Infinity }), null);
  assert.equal(towerAnimationPatch({ rotationMultiplier: -1 }), null);
  assert.equal(towerAnimationPatch({ stackOrder: 'smallest-first' }), null);
  assert.equal(towerAnimationPatch({ lifetimeMinSeconds: 10 }, { ...DEFAULT_TOWER_ANIMATION, lifetimeMaxSeconds: 8 }), null);
  db.updateSettings({ towerAnimation: { swayAmplitude: 24, swayDuration: 3, rotationMultiplier: 1.5, bendMultiplier: 0.8 } }, config);
  assert.deepEqual(db.getSettings(config).towerAnimation, { ...DEFAULT_TOWER_ANIMATION, swayAmplitude: 24, swayDuration: 3, rotationMultiplier: 1.5, bendMultiplier: 0.8 });
  assert.equal(towerAnimationPatch({ lifetimeMaxSeconds: 301 }), null);
  assert.deepEqual(towerAnimationPatch({ lifetimeMinSeconds: 4, lifetimeMaxSeconds: 10 }, DEFAULT_TOWER_ANIMATION), { ...DEFAULT_TOWER_ANIMATION, lifetimeMinSeconds: 4, lifetimeMaxSeconds: 10 });
  assert.equal(towerAnimationPatch({ stackOrder: 'largest-first' }, DEFAULT_TOWER_ANIMATION).stackOrder, 'largest-first');
  db.close();
});

test('roaming settings have safe defaults, persist, and validate their ranges', () => {
  const config = testConfig();
  const db = testDatabase(config);
  assert.deepEqual({
    roamingIntervalSeconds: db.getSettings(config).roamingIntervalSeconds,
    roamingSpeed: db.getSettings(config).roamingSpeed,
    roamingJumpHeight: db.getSettings(config).roamingJumpHeight,
    roamingMinDistance: db.getSettings(config).roamingMinDistance,
    roamingMaxDistance: db.getSettings(config).roamingMaxDistance,
  }, DEFAULT_ROAMING_SETTINGS);
  assert.deepEqual(roamingSettingsPatch({ roamingIntervalSeconds: '8', roamingSpeed: '220', roamingJumpHeight: '100', roamingMinDistance: '60', roamingMaxDistance: '450' }), {
    roamingIntervalSeconds: 8,
    roamingSpeed: 220,
    roamingJumpHeight: 100,
    roamingMinDistance: 60,
    roamingMaxDistance: 450,
  });
  assert.throws(() => roamingSettingsPatch({ roamingIntervalSeconds: 0 }), { message: 'invalid_roamingIntervalSeconds' });
  assert.throws(() => roamingSettingsPatch({ roamingIntervalSeconds: 2.5 }), { message: 'invalid_roamingIntervalSeconds' });
  assert.throws(() => roamingSettingsPatch({ roamingSpeed: 401 }), { message: 'invalid_roamingSpeed' });
  assert.throws(() => roamingSettingsPatch({ roamingJumpHeight: 19 }), { message: 'invalid_roamingJumpHeight' });
  assert.throws(() => roamingSettingsPatch({ roamingJumpHeight: 100.5 }), { message: 'invalid_roamingJumpHeight' });
  assert.throws(() => roamingSettingsPatch({ roamingMinDistance: 29 }), { message: 'invalid_roamingMinDistance' });
  assert.throws(() => roamingSettingsPatch({ roamingMaxDistance: 1801 }), { message: 'invalid_roamingMaxDistance' });
  assert.throws(() => roamingSettingsPatch({ roamingMinDistance: 250, roamingMaxDistance: 200 }), { message: 'invalid_roaming_distance_range' });
  db.updateSettings(roamingSettingsPatch({ roamingIntervalSeconds: 8, roamingSpeed: 220, roamingJumpHeight: 100, roamingMinDistance: 60, roamingMaxDistance: 450 }), config);
  assert.equal(db.getSettings(config).roamingIntervalSeconds, 8);
  assert.equal(db.getSettings(config).roamingSpeed, 220);
  assert.equal(db.getSettings(config).roamingJumpHeight, 100);
  assert.equal(db.getSettings(config).roamingMinDistance, 60);
  assert.equal(db.getSettings(config).roamingMaxDistance, 450);
  db.close();
});

test('reward mapping sanitizer accepts supported actions and merges partial updates', () => {
  assert.deepEqual(sanitizeRewardMapping({ inflate: ' reward-1 ', ghost: 'reward-2', unknown: 'ignored' }), { inflate: 'reward-1', ghost: 'reward-2' });
  assert.deepEqual(rewardMappingPatch({ bat: 'reward-3' }, { inflate: 'reward-1' }), { inflate: 'reward-1', bat: 'reward-3' });
  assert.equal(rewardMappingPatch({ jump_on: 42 }, {}), null);
  assert.deepEqual(rewardMappingPatch({ morph_fly: '' }, {}), { morph_fly: '' });
  assert.equal(rewardMappingPatch({ jump_on: 'reward-1' }, { inflate: 'reward-1' }), null);
  assert.equal(rewardMappingPatch({ inflate: 'same', jump_on: 'same' }, {}), null);
  assert.deepEqual(rewardMappingPatch({ jump_on: '' }, { inflate: 'reward-1' }), { inflate: 'reward-1', jump_on: '' });
});

test('animation and growth settings persist and are broadcast through Socket.IO updates', () => {
  const config = testConfig();
  const db = testDatabase(config);
  assert.deepEqual(db.getSettings(config).animation, DEFAULT_ANIMATION);
  db.updateSettings({ animation: { eyeFrequency: 2, mouthFrequency: 3 } }, config);
  assert.deepEqual(db.getSettings(config).animation, { eyeFrequency: 2, mouthFrequency: 3 });
  const ioEvents = [];
  const socketEvents = new Map();
  const schedulerCalls = [];
  let connection;
  const io = { use() {}, on(event, handler) { if (event === 'connection') connection = handler; }, emit(...args) { ioEvents.push(args); } };
  attachSocketHandlers(io, { config, db, statuses: { all: () => [] }, movementScheduler: { settingsUpdated: () => schedulerCalls.push('updated') } });
  const socket = { data: { admin: true }, handshake: { headers: {} }, on(event, handler) { socketEvents.set(event, handler); }, emit(...args) { ioEvents.push(['socket', ...args]); } };
  connection(socket);
  const acknowledgements = [];
   socketEvents.get('admin:settings:update')({ animation: { eyeFrequency: 2.5 } });
  assert.equal(ioEvents.at(-1)[0], 'settings:updated');
   assert.deepEqual(ioEvents.at(-1)[1].settings.animation, { eyeFrequency: 2.5, mouthFrequency: 3 });
   socketEvents.get('admin:settings:update')({ towerAnimation: { rotationMultiplier: 1.5 } });
   assert.deepEqual(ioEvents.at(-1)[1].settings.towerAnimation, { ...DEFAULT_TOWER_ANIMATION, rotationMultiplier: 1.5 });
   assert.equal(db.getSettings(config).towerAnimation.rotationMultiplier, 1.5);
   socketEvents.get('admin:settings:update')({ towerAnimation: { lifetimeMinSeconds: 4, lifetimeMaxSeconds: 10 } });
   assert.equal(ioEvents.at(-1)[1].settings.towerAnimation.lifetimeMinSeconds, 4);
   assert.equal(ioEvents.at(-1)[1].settings.towerAnimation.lifetimeMaxSeconds, 10);
   assert.equal(db.getSettings(config).towerAnimation.lifetimeMaxSeconds, 10);
   socketEvents.get('admin:settings:update')({ towerAnimation: { stackOrder: 'largest-first' } });
   assert.equal(ioEvents.at(-1)[1].settings.towerAnimation.stackOrder, 'largest-first');
   assert.equal(db.getSettings(config).towerAnimation.stackOrder, 'largest-first');
    socketEvents.get('admin:settings:update')({ towerAnimation: { bendMultiplier: 99 } });
   assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_tower_animation' }]);
   socketEvents.get('admin:settings:update')({ roamingIntervalSeconds: 7, roamingSpeed: 180 });
   assert.equal(ioEvents.at(-1)[0], 'settings:updated');
   assert.equal(ioEvents.at(-1)[1].settings.roamingIntervalSeconds, 7);
   assert.equal(ioEvents.at(-1)[1].settings.roamingSpeed, 180);
   socketEvents.get('admin:settings:update')({ roamingJumpHeight: 120 });
   assert.equal(ioEvents.at(-1)[1].settings.roamingJumpHeight, 120);
   socketEvents.get('admin:settings:update')({ roamingMinDistance: 70, roamingMaxDistance: 350 });
   assert.equal(ioEvents.at(-1)[1].settings.roamingMinDistance, 70);
   assert.equal(ioEvents.at(-1)[1].settings.roamingMaxDistance, 350);
   socketEvents.get('admin:settings:update')({ roamingMinDistance: 351 });
   assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_roaming_distance_range' }]);
   assert.deepEqual(schedulerCalls, ['updated']);
   socketEvents.get('admin:settings:update')({ roamingSpeed: 500 });
   assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_roamingSpeed' }]);
   socketEvents.get('admin:settings:update')({ roamingJumpHeight: 301 });
   assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_roamingJumpHeight' }]);
  socketEvents.get('admin:settings:update')({ animation: { eyeFrequency: 0 } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_animation' }]);
  socketEvents.get('admin:settings:update')({ rewardMapping: { inflate: 'reward-inflate' } });
  assert.equal(ioEvents.at(-1)[0], 'settings:updated');
  assert.equal(ioEvents.at(-1)[1].settings.rewardMapping.inflate, 'reward-inflate');
  assert.equal(db.getSettings(config).rewardMapping.inflate, 'reward-inflate');
  socketEvents.get('admin:settings:update')({ rewardMapping: { pumpkin_customization: 'appearance-reward' }, customizationRewardMode: 'all' }, (result) => acknowledgements.push(result));
  assert.equal(ioEvents.at(-1)[1].settings.rewardMapping.pumpkin_customization, 'appearance-reward');
  assert.equal(ioEvents.at(-1)[1].settings.customizationRewardMode, 'all');
  assert.equal(db.getSettings(config).customizationRewardMode, 'all');
  assert.equal(acknowledgements.at(-1).ok, true);
  assert.equal(acknowledgements.at(-1).settings.rewardMapping.pumpkin_customization, 'appearance-reward');
  socketEvents.get('admin:settings:update')({ customizationRewardMode: 'multiple' }, (result) => acknowledgements.push(result));
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_customization_reward_mode' }]);
  assert.deepEqual(acknowledgements.at(-1), { ok: false, error: 'invalid_customization_reward_mode' });
  const reconnectedEvents = [];
  const reconnectedSocket = { data: { admin: true }, handshake: { headers: {} }, on() {}, emit(...args) { reconnectedEvents.push(args); } };
  connection(reconnectedSocket);
  const scene = reconnectedEvents.find(([event]) => event === 'scene:init')?.[1];
  assert.equal(scene.settings.rewardMapping.pumpkin_customization, 'appearance-reward');
  assert.equal(scene.settings.customizationRewardMode, 'all');
  const growthThresholds = { stage2: 400, stage3: 1300, stage4: 3500 };
  socketEvents.get('admin:settings:update')({ growthThresholds });
  assert.equal(ioEvents.at(-1)[0], 'settings:updated');
  assert.deepEqual(ioEvents.at(-1)[1].settings.growthThresholds, growthThresholds);
  assert.deepEqual(db.getSettings(config).growthThresholds, growthThresholds);
  assert.deepEqual(db.getSettings(config).growthStages, { stage2: true, stage3: false, stage4: true });
  const stageService = new DonationService({ db, config, idFactory: () => 'socket-stage-pumpkin' });
  stageService.handle({ id: 'socket-stage-donation', name: 'Socket Stage Viewer', amount: 1300, currency: 'RUB', message: '!тыковка' });
  socketEvents.get('admin:settings:update')({ growthStages: { stage2: false, stage3: false, stage4: true } });
  assert.deepEqual(db.getSettings(config).growthStages, { stage2: false, stage3: false, stage4: true });
  assert.equal(db.getPumpkin('socket-stage-pumpkin').stage, 1);
  assert.ok(ioEvents.some(([event, payload]) => event === 'pumpkin:updated' && payload.pumpkin.id === 'socket-stage-pumpkin' && payload.pumpkin.stage === 1));
  socketEvents.get('admin:settings:update')({ growthStages: { stage2: true, stage3: 0, stage4: true } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_growth_stages' }]);
  assert.deepEqual(db.getSettings(config).growthStages, { stage2: false, stage3: false, stage4: true });
  const growthMultipliers = { stage1: 0.5, stage2: 0.8, stage3: 1.15, stage4: 1.4 };
  socketEvents.get('admin:settings:update')({ growthMultipliers });
  assert.equal(ioEvents.at(-1)[0], 'settings:updated');
  assert.deepEqual(ioEvents.at(-1)[1].settings.growthMultipliers, growthMultipliers);
  assert.deepEqual(db.getSettings(config).growthMultipliers, growthMultipliers);
  socketEvents.get('admin:settings:update')({ growthMultipliers: { stage1: 0, stage2: 0.8, stage3: 1.15, stage4: 1.4 } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_growth_multipliers' }]);
  socketEvents.get('admin:settings:update')({ growthThresholds: { stage2: 500, stage3: 500, stage4: 3000 } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_growth_thresholds' }]);
  assert.deepEqual(db.getSettings(config).growthThresholds, growthThresholds);
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

test('spatial dimensions use configured per-stage multipliers', () => {
  const multipliers = { stage1: 0.5, stage2: 0.8, stage3: 1.15, stage4: 1.4 };
  const stage1 = dimensionsFor({ stage: 1 }, multipliers);
  const stage3 = dimensionsFor({ stage: 3 }, multipliers);
  assert.equal(stage1.width, 110);
  assert.equal(stage1.height, 110);
  assert.equal(stage3.width, 253);
  assert.equal(stage3.height, 253);
});

test('all growth stages can rest on the lower scene boundary', () => {
  const config = testConfig();
  const context = { scene: config.scene, noGoZone: { enabled: false } };

  for (const stage of [1, 2, 3, 4]) {
    const pumpkin = { stage };
    const position = clampPosition(pumpkin, 900, config.scene.height, context);
    assert.equal(position.y, config.scene.height);
    assert.equal(isPositionValid(pumpkin, position.x, position.y, context), true);
  }
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
  donation.handle({ id: 'donation-1', userId: 'twitch-1', username: 'viewer', name: 'Viewer', amount: 100, currency: 'RUB', message: '!тыковка' });
  db.updatePumpkin('pumpkin-1', { twitchUserId: 'twitch-1', twitchUsername: 'viewer' });
  const actions = [];
  const rewards = new RewardService({ db, config, emit: (event, payload) => actions.push([event, payload]) });
  const result = rewards.handle({ id: 'redemption-1', rewardId: 'reward-inflate', userId: 'twitch-1', userLogin: 'viewer' });
  assert.equal(result.action, 'inflate');
  assert.equal(rewards.handle({ id: 'redemption-1', rewardId: 'reward-inflate', userId: 'twitch-1', userLogin: 'viewer' }).duplicate, true);
  assert.equal(actions.some(([event]) => event === 'pumpkin:action'), true);
  assert.equal(rewards.handle({ id: 'redemption-2', rewardId: 'wrong-id', userId: 'twitch-1', userLogin: 'viewer' }).status, 'ignored_reward');
  db.close();
});

test('redemptions prefer Twitch user IDs, use username-only links, and reject conflicting user IDs', () => {
  const config = testConfig({ TWITCH_REWARD_INFLATE_ID: 'reward-inflate' });
  const db = testDatabase(config);
  const donations = new DonationService({ db, config, idFactory: (() => { let id = 0; return () => `pumpkin-${++id}`; })() });
  donations.handle({ id: 'donation-1', userId: 'twitch-1', username: 'viewer-one', name: 'Viewer One', amount: 100, currency: 'RUB', message: '!тыковка' });
  donations.handle({ id: 'donation-2', userId: 'twitch-2', username: 'viewer-two', name: 'Viewer Two', amount: 100, currency: 'RUB', message: '!тыковка' });
  donations.handle({ id: 'donation-3', userId: 'twitch-3', username: 'viewer-three', name: 'Viewer Three', amount: 100, currency: 'RUB', message: '!тыковка' });
  db.updatePumpkin('pumpkin-1', { twitchUserId: 'twitch-1', twitchUsername: 'viewer-one' });
  db.updatePumpkin('pumpkin-2', { twitchUserId: 'twitch-2', twitchUsername: 'viewer-two' });
  db.updatePumpkin('pumpkin-3', { twitchUsername: 'viewer-three' });
  const events = [];
  const service = new RewardService({ db, config, emit: (event, payload) => events.push([event, payload]) });

  const result = service.handle({ id: 'redemption-priority', rewardId: 'reward-inflate', userId: 'twitch-1', userLogin: 'viewer-two' });
  assert.equal(result.pumpkin.id, 'pumpkin-1');
  assert.equal(service.handle({ id: 'redemption-priority', rewardId: 'reward-inflate', userId: 'twitch-1', userLogin: 'viewer-two' }).duplicate, true);
  assert.equal(events.filter(([name]) => name === 'pumpkin:action').length, 1);

  const positions = db.listPumpkins().map(({ id, x, y }) => ({ id, x, y }));
  assert.equal(service.handle({ id: 'redemption-unlinked', rewardId: 'reward-inflate', userId: 'unknown-user', userLogin: 'unknown-user' }).status, 'no_pumpkin_for_user');
  assert.equal(service.handle({ id: 'redemption-username-only', rewardId: 'reward-inflate', userId: 'twitch-3', userLogin: 'viewer-three' }).pumpkin.id, 'pumpkin-3');
  assert.equal(db.getPumpkin('pumpkin-3').twitchUserId, 'twitch-3');
  assert.equal(service.handle({ id: 'redemption-id-mismatch', rewardId: 'reward-inflate', userId: 'unmapped-id', userLogin: 'viewer-one' }).status, 'no_pumpkin_for_user');
  assert.deepEqual(db.listPumpkins().map(({ id, x, y }) => ({ id, x, y })), positions);
  assert.equal(service.handle({ id: 'redemption-wrong-id', rewardId: 'same-title-different-id', userId: 'twitch-1', userLogin: 'viewer-one' }).status, 'ignored_reward');
  assert.deepEqual(db.listPumpkins().map(({ id, x, y }) => ({ id, x, y })), positions);
  db.close();
});

test('redemptions do not auto-link when multiple pumpkins have the same display name', () => {
  const config = testConfig({ TWITCH_REWARD_INFLATE_ID: 'reward-inflate' });
  const db = testDatabase(config);
  const first = insertMovementTestPumpkin(db, 'ambiguous-name-first', 400, config.scene.groundY);
  const second = insertMovementTestPumpkin(db, 'ambiguous-name-second', 700, config.scene.groundY);
  db.updatePumpkin(first.id, { displayName: 'dark_neri' });
  db.updatePumpkin(second.id, { displayName: 'DARK_NERI' });
  db.updateSettings({ rewardMapping: { inflate: 'reward-inflate' } }, config);
  const service = new RewardService({ db, config });

  const result = service.handle({
    id: 'ambiguous-display-name-redemption',
    rewardId: 'reward-inflate',
    userId: 'twitch-dark-neri',
    userLogin: 'dark_neri',
  });

  assert.equal(result.status, 'no_pumpkin_for_user');
  assert.equal(db.getPumpkin(first.id).twitchUserId, null);
  assert.equal(db.getPumpkin(first.id).twitchUsername, null);
  assert.equal(db.getPumpkin(second.id).twitchUserId, null);
  assert.equal(db.getPumpkin(second.id).twitchUsername, null);
  db.close();
});

test('pumpkin_tower maps by reward ID, affects every pumpkin without a linked redeemer, and deduplicates', () => {
  const config = testConfig({ TWITCH_REWARD_PUMPKIN_TOWER_ID: 'tower-reward' });
  const db = testDatabase(config);
  const donations = new DonationService({ db, config, idFactory: (() => { let id = 0; return () => `tower-pumpkin-${++id}`; })() });
  for (let index = 0; index < 3; index += 1) donations.handle({ id: `tower-donation-${index}`, name: `Viewer ${index}`, amount: 100, currency: 'RUB', message: '!тыковка' });
  db.updatePumpkin('tower-pumpkin-1', { stage: 1 });
  db.updatePumpkin('tower-pumpkin-2', { stage: 3 });
  db.updatePumpkin('tower-pumpkin-3', { stage: 2 });
  db.updateSettings({ rewardMapping: { pumpkin_tower: 'tower-reward' }, towerAnimation: { stackOrder: 'largest-first' }, noGoZone: { enabled: false, x: 0, y: 0, width: 0, height: 0 } }, config);
  const events = [];
  const rewards = new RewardService({ db, config, random: () => 1, emit: (event, payload) => events.push([event, payload]) });
  const result = rewards.handle({ id: 'tower-redemption', rewardId: 'tower-reward', userId: 'unlinked', userLogin: 'unlinked' });
  assert.equal(result.action, 'pumpkin_tower');
  assert.equal(result.payload.mode, 'topple');
  assert.deepEqual(result.payload.participants.map(({ id }) => id), ['tower-pumpkin-2', 'tower-pumpkin-3', 'tower-pumpkin-1']);
  assert.equal(result.updatedPumpkins.length, 3);
  assert.equal(result.payload.finalPumpkins.length, 3);
  assert.ok(result.payload.lifetimeSeconds >= DEFAULT_TOWER_ANIMATION.lifetimeMinSeconds);
  assert.ok(result.payload.lifetimeSeconds <= DEFAULT_TOWER_ANIMATION.lifetimeMaxSeconds);
  assert.equal(rewards.handle({ id: 'tower-redemption', rewardId: 'tower-reward', userId: 'unlinked', userLogin: 'unlinked' }).duplicate, true);
  assert.equal(events.filter(([event]) => event === 'pumpkin:updated').length, 0);
  assert.equal(events.filter(([event]) => event === 'pumpkin:action').length, 1);
  const repeated = rewards.handle({ id: 'tower-redemption-second', rewardId: 'tower-reward', userId: 'unlinked', userLogin: 'unlinked' });
  assert.equal(repeated.action, 'pumpkin_tower');
  assert.equal(events.filter(([event]) => event === 'pumpkin:action').length, 2);
  for (const pumpkin of db.listPumpkins()) assert.equal(isPositionValid(pumpkin, pumpkin.x, pumpkin.y, { scene: config.scene, noGoZone: { enabled: false } }), true);
  db.close();
});

test('pumpkin tower chooses and broadcasts its lifetime from the configured range', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const donations = new DonationService({ db, config });
  donations.handle({ id: 'tower-lifetime-donation', name: 'Lifetime Viewer', amount: 100, currency: 'RUB', message: '!тыковка' });
  db.updateSettings({ towerAnimation: { lifetimeMinSeconds: 5, lifetimeMaxSeconds: 9 } }, config);
  const events = [];
  const rewards = new RewardService({ db, config, random: () => 0.75, emit: (event, payload) => events.push([event, payload]) });
  const result = rewards.testAction('pumpkin_tower');
  assert.equal(result.payload.lifetimeSeconds, 8);
  assert.equal(events.at(-1)[1].lifetimeSeconds, 8);
  db.close();
});

test('pumpkin_tower forced topple emits safe unique bottom targets and clears parent links', () => {
  const config = testConfig({ TWITCH_REWARD_PUMPKIN_TOWER_ID: 'tower-reward' });
  const db = testDatabase(config);
  const donations = new DonationService({ db, config, idFactory: (() => { let id = 0; return () => `topple-pumpkin-${++id}`; })() });
  for (let index = 0; index < 3; index += 1) donations.handle({ id: `topple-donation-${index}`, name: `Topple ${index}`, amount: 100, currency: 'RUB', message: '!тыковка' });
  db.updatePumpkin('topple-pumpkin-2', { parentId: 'topple-pumpkin-1', stackOffsetY: -220 });
  db.updateSettings({ rewardMapping: { pumpkin_tower: 'tower-reward' } }, config);
  const rewards = new RewardService({ db, config, random: () => 0 });
  const result = rewards.handle({ id: 'forced-topple', rewardId: 'tower-reward', userId: 'nobody', userLogin: 'nobody' });
  assert.equal(result.payload.mode, 'topple');
  assert.equal(result.payload.groundY, config.scene.height);
  assert.equal(new Set(result.payload.finalPositions.map(({ x }) => x)).size, 3);
  for (const target of result.payload.finalPositions) {
    assert.equal(target.y, config.scene.height);
    const pumpkin = db.getPumpkin(target.id);
    assert.deepEqual({ x: pumpkin.x, y: pumpkin.y }, { x: target.x, y: target.y });
    assert.equal(pumpkin.parentId, null);
    assert.equal(isPositionValid(pumpkin, pumpkin.x, pumpkin.y, { scene: config.scene, noGoZone: { enabled: false } }), true);
  }
  db.close();
});

test('pumpkin_tower always plans a fall for any number of pumpkins', () => {
  const config = testConfig();
  const context = { scene: config.scene, noGoZone: { enabled: false } };
  for (const count of [1, 2, 3, 5]) {
    const pumpkins = Array.from({ length: count }, (_, index) => ({
      id: `always-topple-${count}-${index}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`,
      stage: 1,
      x: 200 + index * 200,
      y: config.scene.groundY,
    }));
    const plan = buildTowerPlan(pumpkins, context, () => 1);
    assert.equal(plan.mode, 'topple');
    assert.equal(plan.finalPositions.length, count);
  }
});

test('tower target planning falls back to a safe packing when random targets block later pumpkins', () => {
  const config = testConfig();
  const context = { scene: config.scene, noGoZone: { enabled: false } };
  let randomState = 0x1a2b3c4d;
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pumpkins = Array.from({ length: 7 }, (_, index) => ({
      id: `random-pack-${attempt}-${index}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`,
      stage: 1 + Math.floor(random() * 4),
      x: 100 + index * 150,
      y: config.scene.groundY,
    }));
    const plan = buildTowerPlan(pumpkins, context, random);
    assert.ok(plan, `tower layout failed on attempt ${attempt}`);
    assert.equal(new Set(plan.finalPositions.map(({ x }) => x)).size, pumpkins.length);
    const pumpkinsById = new Map(pumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
    assert.ok(plan.finalPositions.every(({ id, x, y }) => isPositionValid(pumpkinsById.get(id), x, y, context)));
  }
});

test('tower stack order defaults to random and can place the largest pumpkins first', () => {
  const config = testConfig();
  const context = { scene: config.scene, noGoZone: { enabled: false } };
  const pumpkins = [1, 2, 3].map((stage) => ({
    id: `stack-order-${stage}`,
    createdAt: `2026-01-0${stage}`,
    stage,
    x: stage * 200,
    y: config.scene.groundY,
  }));
  const randomized = buildTowerPlan(pumpkins, context, () => 0);
  const largestFirst = buildTowerPlan(pumpkins, context, () => 0, 'largest-first');

  assert.deepEqual(randomized.participants.map(({ id }) => id), ['stack-order-2', 'stack-order-3', 'stack-order-1']);
  assert.deepEqual(largestFirst.participants.map(({ id }) => id), ['stack-order-3', 'stack-order-2', 'stack-order-1']);
});

test('tower planning chooses the freer side and refuses an impossible No-Go Zone without partial targets', () => {
  const config = testConfig();
  const pumpkins = [1, 2, 3].map((index) => ({ id: `plan-${index}`, createdAt: `2026-01-0${index}`, stage: 1, x: index * 200, y: config.scene.groundY }));
  const context = { scene: config.scene, noGoZone: { enabled: true, x: 1200, y: 0, width: 720, height: 1080 } };
  const plan = buildTowerPlan(pumpkins, context, () => 0);
  assert.equal(plan.direction, 'left');
  assert.ok(plan.finalPositions.every(({ y }) => y === config.scene.height));
  assert.ok(plan.finalPositions.every(({ x, y }, index) => {
    const pumpkin = pumpkins.find(({ id }) => id === plan.finalPositions[index].id);
    return isPositionValid(pumpkin, x, y, context);
  }));
  assert.equal(buildTowerPlan(pumpkins, { scene: config.scene, noGoZone: { enabled: true, x: 0, y: 0, width: config.scene.width, height: config.scene.height } }, () => 0), null);
});

test('development pumpkin_tower test action triggers the real global animation without Twitch mapping', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const donations = new DonationService({ db, config, idFactory: (() => { let id = 0; return () => `dev-tower-pumpkin-${++id}`; })() });
  donations.handle({ id: 'dev-tower-donation-1', name: 'Dev Viewer 1', amount: 100, currency: 'RUB', message: '!тыковка' });
  donations.handle({ id: 'dev-tower-donation-2', name: 'Dev Viewer 2', amount: 100, currency: 'RUB', message: '!тыковка' });
  const events = [];
  const rewards = new RewardService({ db, config, random: () => 1, emit: (event, payload) => events.push([event, payload]) });
  const result = rewards.testAction('pumpkin_tower');
  assert.equal(result.test, true);
  assert.equal(result.global, true);
  assert.equal(result.payload.test, true);
  assert.equal(result.finalPumpkins, undefined);
  assert.equal(events.filter(([event]) => event === 'pumpkin:action').length, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM redemptions').get().count, 0);
  db.close();
});

test('reward mappings persist after reopening the SQLite database', () => {
  const config = testConfig();
  const directory = mkdtempSync(path.join(tmpdir(), 'cozy-pumpkins-rewards-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  try {
    const db = new Database(databasePath);
    db.updateSettings({ rewardMapping: { inflate: 'renamed-later-reward', jump_on: '' } }, config);
    db.close();
    const reopened = new Database(databasePath);
    assert.deepEqual(reopened.getSettings(config).rewardMapping, { inflate: 'renamed-later-reward', jump_on: '' });
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('customization reward applies the first recognized change and preserves other slots', () => {
  const config = testConfig();
  const db = testDatabase(config);
  db.insertPumpkin({
    id: 'customization-single',
    ownerKey: 'single',
    ownerNormalized: 'single',
    displayName: 'Single Viewer',
    totalDonated: 0,
    currency: 'RUB',
    stage: 1,
    x: 500,
    y: config.scene.groundY,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'cocoa_hands' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  db.updatePumpkin('customization-single', { twitchUserId: 'viewer-single' });
  db.updateSettings({ customizationRewardMode: 'single', rewardMapping: { pumpkin_customization: 'appearance' } }, config);
  const events = [];
  const rewards = new RewardService({ db, config, emit: (event, payload) => events.push([event, payload]) });

  const result = rewards.handle({
    id: 'single-change',
    rewardId: 'appearance',
    userId: 'viewer-single',
    userLogin: 'viewer-single',
    input: 'stars eyes, witch hat',
  });

  assert.equal(result.status, 'customization_applied');
  assert.deepEqual(result.pumpkin.customization, { skin: 'classic', eyes: 'stars', mouth: 'cat', hat: 'none', prop: 'cocoa_hands' });
  assert.equal(events.filter(([event]) => event === 'pumpkin:updated').length, 1);
  db.close();
});

test('customization reward all mode applies every recognized change and keeps the last value per slot', () => {
  const config = testConfig();
  const db = testDatabase(config);
  db.insertPumpkin({
    id: 'customization-all',
    ownerKey: 'all',
    ownerNormalized: 'all',
    displayName: 'All Viewer',
    totalDonated: 0,
    currency: 'RUB',
    stage: 1,
    x: 500,
    y: config.scene.groundY,
    isAirborne: false,
    parentId: null,
    stackOffsetY: null,
    customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'cocoa_hands' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  db.updatePumpkin('customization-all', { twitchUserId: 'viewer-all' });
  db.updateSettings({ customizationRewardMode: 'all', rewardMapping: { pumpkin_customization: 'appearance' } }, config);
  const rewards = new RewardService({ db, config });

  const result = rewards.handle({
    id: 'all-changes',
    rewardId: 'appearance',
    userId: 'viewer-all',
    userLogin: 'viewer-all',
    input: 'stars eyes, sleepy eyes, classic skin, witch hat, fangs',
  });

  assert.equal(result.status, 'customization_applied');
  assert.deepEqual(result.pumpkin.customization, { skin: 'classic', eyes: 'sleepy', mouth: 'fangs', hat: 'witch', prop: 'cocoa_hands' });
  db.close();
});

test('spawn rule settings persist and broadcast through Socket.IO without accepting invalid values', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const ioEvents = [];
  const socketEvents = new Map();
  let connection;
  const io = {
    use() {},
    on(event, handler) { if (event === 'connection') connection = handler; },
    emit(...args) { ioEvents.push(args); },
  };
  attachSocketHandlers(io, { config, db, statuses: { all: () => [] } });
  const socket = {
    data: { admin: true },
    handshake: { headers: {} },
    on(event, handler) { socketEvents.set(event, handler); },
    emit(...args) { ioEvents.push(['socket', ...args]); },
  };
  db.updateSettings({ minSpawnDonation: 125, spawnCommand: '!gourd' }, config);
  connection(socket);
  const initialScene = ioEvents.find(([target, event]) => target === 'socket' && event === 'scene:init')?.[2];
  assert.equal(initialScene.settings.minSpawnDonation, 125);
  assert.equal(initialScene.settings.spawnCommand, '!gourd');

  socketEvents.get('admin:settings:update')({ minSpawnDonation: 250, spawnCommand: '!pumpkin' });
  const update = ioEvents.findLast(([event]) => event === 'settings:updated')?.[1]?.settings;
  assert.equal(update.minSpawnDonation, 250);
  assert.equal(update.spawnCommand, '!pumpkin');
  socketEvents.get('admin:settings:update')({ minSpawnDonation: -1, spawnCommand: '' });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_min_spawn_donation' }]);
  assert.equal(db.getSettings(config).minSpawnDonation, 250);
  assert.equal(db.getSettings(config).spawnCommand, '!pumpkin');
  db.close();
});

test('pumpkin name visibility defaults on, persists, and is included in the initial scene', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const donation = new DonationService({ db, config, idFactory: () => 'name-visibility-pumpkin' });
  const result = donation.handle({ id: 'name-visibility-donation', name: 'Name Viewer', amount: 10, currency: 'RUB', message: '!тыковка' });
  assert.equal(db.getPumpkin(result.pumpkin.id).showDisplayName, true);
  assert.equal(db.getSettings(config).showPumpkinNames, true);
  assert.equal(db.getSettings(config).pumpkinNameFontSize, 14);

  db.updatePumpkin(result.pumpkin.id, { showDisplayName: false });
  db.updateSettings({ showPumpkinNames: false, pumpkinNameFontSize: 20 }, config);
  assert.equal(db.getPumpkin(result.pumpkin.id).showDisplayName, false);
  assert.equal(db.getSettings(config).showPumpkinNames, false);
  assert.equal(db.getSettings(config).pumpkinNameFontSize, 20);

  const ioEvents = [];
  const socketEvents = new Map();
  let connection;
  const io = {
    use() {},
    on(event, handler) { if (event === 'connection') connection = handler; },
    emit(...args) { ioEvents.push(args); },
  };
  attachSocketHandlers(io, { config, db, statuses: { all: () => [] } });
  const socket = {
    data: { admin: true },
    handshake: { headers: {} },
    on(event, handler) { socketEvents.set(event, handler); },
    emit(...args) { ioEvents.push(['socket', ...args]); },
  };
  connection(socket);
  const scene = ioEvents.find(([target, event]) => target === 'socket' && event === 'scene:init')?.[2];
  assert.equal(scene.settings.showPumpkinNames, false);
  assert.equal(scene.settings.pumpkinNameFontSize, 20);
  assert.equal(scene.pumpkins[0].showDisplayName, false);

  socketEvents.get('admin:settings:update')({ showPumpkinNames: true, pumpkinNameFontSize: 24 });
  assert.equal(ioEvents.findLast(([event]) => event === 'settings:updated')?.[1]?.settings.showPumpkinNames, true);
  assert.equal(ioEvents.findLast(([event]) => event === 'settings:updated')?.[1]?.settings.pumpkinNameFontSize, 24);
  assert.equal(db.getSettings(config).pumpkinNameFontSize, 24);
  socketEvents.get('admin:settings:update')({ pumpkinNameFontSize: 49 });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'settings-update', message: 'invalid_pumpkin_name_font_size' }]);
  socketEvents.get('admin:pumpkin:update')({ id: result.pumpkin.id, patch: { showDisplayName: true } });
  assert.equal(ioEvents.findLast(([event]) => event === 'pumpkin:updated')?.[1]?.pumpkin.showDisplayName, true);
  socketEvents.get('admin:pumpkin:update')({ id: result.pumpkin.id, patch: { showDisplayName: 'false' } });
  assert.deepEqual(ioEvents.at(-1), ['socket', 'operation:error', { operation: 'pumpkin-update', message: 'invalid_show_display_name' }]);
  db.close();
});

test('existing databases migrate name visibility fields with enabled defaults', () => {
  const config = testConfig();
  const directory = mkdtempSync(path.join(tmpdir(), 'cozy-pumpkin-name-visibility-'));
  const databasePath = path.join(directory, 'scene.sqlite');
  try {
    const db = new Database(databasePath);
    db.getSettings(config);
    const donation = new DonationService({ db, config, idFactory: () => 'legacy-name-pumpkin' });
    const result = donation.handle({ id: 'legacy-name-donation', name: 'Legacy Viewer', amount: 100, currency: 'RUB', message: '!тыковка' });
    assert.equal(result.pumpkin.displayName, 'Legacy Viewer');
    db.sqlite.exec('ALTER TABLE settings DROP COLUMN show_pumpkin_names; ALTER TABLE settings DROP COLUMN pumpkin_name_font_size; ALTER TABLE settings DROP COLUMN roaming_interval_seconds; ALTER TABLE settings DROP COLUMN roaming_speed; ALTER TABLE settings DROP COLUMN roaming_jump_height; ALTER TABLE settings DROP COLUMN roaming_min_distance; ALTER TABLE settings DROP COLUMN roaming_max_distance; ALTER TABLE pumpkins DROP COLUMN show_display_name;');
    db.close();

    const legacy = new Database(databasePath);
    assert.equal(legacy.getSettings(config).showPumpkinNames, true);
    assert.equal(legacy.getSettings(config).pumpkinNameFontSize, 14);
    assert.equal(legacy.getSettings(config).roamingIntervalSeconds, DEFAULT_ROAMING_SETTINGS.roamingIntervalSeconds);
    assert.equal(legacy.getSettings(config).roamingSpeed, DEFAULT_ROAMING_SETTINGS.roamingSpeed);
    assert.equal(legacy.getSettings(config).roamingJumpHeight, DEFAULT_ROAMING_SETTINGS.roamingJumpHeight);
    assert.equal(legacy.getSettings(config).roamingMinDistance, DEFAULT_ROAMING_SETTINGS.roamingMinDistance);
    assert.equal(legacy.getSettings(config).roamingMaxDistance, DEFAULT_ROAMING_SETTINGS.roamingMaxDistance);
    assert.equal(legacy.getPumpkin(result.pumpkin.id).showDisplayName, true);
    assert.equal(legacy.getPumpkin(result.pumpkin.id).displayName, 'Legacy Viewer');
    legacy.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('roaming targets stay on the ground and avoid scene edges and No-Go Zones', () => {
  const config = testConfig();
  const pumpkin = { id: 'roamer', stage: 1, x: config.scene.width - 64, y: config.scene.groundY };
  const context = {
    scene: config.scene,
    growthMultipliers: { stage1: 0.58, stage2: 0.82, stage3: 1, stage4: 1.12 },
    noGoZone: { enabled: true, x: 1300, y: 850, width: 200, height: 120 },
  };
  const samples = [0.99, 0.25];
  const target = findRoamingTarget(pumpkin, [pumpkin], context, { random: () => samples.shift() });

  assert.ok(target);
  assert.equal(target.y, config.scene.groundY);
  assert.notEqual(target.x, pumpkin.x);
  assert.ok(target.x >= 64 && target.x <= config.scene.width - 64);
  assert.ok(isPositionValid(pumpkin, target.x, target.y, context));
});

test('roaming pumpkins choose destinations with a minimum offset and avoid No-Go Zones', () => {
  const config = testConfig();
  const context = {
    scene: config.scene,
    growthMultipliers: { stage1: 0.58, stage2: 0.82, stage3: 1, stage4: 1.12 },
    noGoZone: { enabled: false },
  };
  const first = { id: 'first-roamer', stage: 1, x: 250, y: config.scene.groundY };
  const second = { id: 'second-roamer', stage: 1, x: 800, y: config.scene.groundY };
  const firstTarget = findRoamingTarget(first, [first, second], context, { random: () => 0.9 });
  const movedFirst = { ...first, ...firstTarget };
  const secondTarget = findRoamingTarget(second, [movedFirst, second], context, { random: () => 0.9 });

  assert.ok(firstTarget);
  assert.ok(secondTarget);
  assert.notEqual(firstTarget.x, secondTarget.x);
  assert.ok(Math.abs(firstTarget.x - secondTarget.x) >= 128);
  assert.ok(isPositionValid(first, firstTarget.x, firstTarget.y, context));
  assert.ok(isPositionValid(second, secondTarget.x, secondTarget.y, context));
});

test('roaming target respects the configured minimum and maximum jump distances', () => {
  const config = testConfig();
  const context = { scene: config.scene, growthMultipliers: { stage1: 0.58 }, noGoZone: { enabled: false } };
  const pumpkin = { id: 'distance-roamer', stage: 1, x: 500, y: config.scene.groundY };
  const target = findRoamingTarget(pumpkin, [pumpkin], context, {
    minDistance: 200,
    maxDistance: 300,
    random: () => 0.9,
  });
  assert.ok(target);
  const distance = Math.abs(target.x - pumpkin.x);
  assert.ok(distance >= 200 && distance <= 300, `expected 200–300 px, got ${distance}`);
});

test('roaming can escape an overlapping spawn by hopping over blockers', () => {
  const config = testConfig();
  const context = {
    scene: config.scene,
    growthMultipliers: { stage1: 0.58 },
    noGoZone: { enabled: false },
  };
  const pumpkin = { id: 'overlapping-roamer', stage: 1, x: 500, y: config.scene.groundY };
  const blocker = { id: 'spawn-overlap', stage: 1, x: 500, y: config.scene.groundY };
  const target = findRoamingTarget(pumpkin, [pumpkin, blocker], context, { random: () => 0.9 });

  assert.ok(target);
  assert.ok(target.x > pumpkin.x);
  assert.ok(Math.abs(target.x - blocker.x) >= 30);
  assert.ok(isPositionValid(pumpkin, target.x, target.y, context));
});

test('roaming finds a fallback destination when nearby pumpkins block random targets', () => {
  const config = testConfig();
  const context = {
    scene: config.scene,
    growthMultipliers: { stage1: 0.58 },
    noGoZone: { enabled: false },
  };
  const pumpkin = { id: 'blocked-roamer', stage: 1, x: 500, y: config.scene.groundY };
  const blockers = [
    { id: 'left-blocker', stage: 1, x: 500, y: config.scene.groundY },
    { id: 'right-blocker', stage: 1, x: 500, y: config.scene.groundY },
  ];

  const target = findRoamingTarget(pumpkin, [pumpkin, ...blockers], context, { random: () => 0.5 });

  assert.ok(target);
  assert.ok(Math.abs(target.x - pumpkin.x) >= 30);
  for (const blocker of blockers) assert.ok(Math.abs(target.x - blocker.x) >= 30);
  assert.ok(isPositionValid(pumpkin, target.x, target.y, context));
});

test('movement scheduler persists and broadcasts the validated final position', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const pumpkin = insertMovementTestPumpkin(db, 'persisted-roamer', 500, config.scene.groundY);
  const events = [];
  const scheduler = createPumpkinMovementScheduler({
    db,
    config,
    broadcast: (event, payload) => events.push([event, payload]),
    random: () => 0.9,
  });

  test('movement scheduler keeps moving pumpkins through a crowded scene', () => {
    const config = testConfig();
    const db = testDatabase(config);
    insertMovementTestPumpkin(db, 'roamer-a', 500, config.scene.groundY);
    insertMovementTestPumpkin(db, 'roamer-b', 500, config.scene.groundY);
    insertMovementTestPumpkin(db, 'roamer-c', 500, config.scene.groundY);
    const events = [];
    const scheduler = createPumpkinMovementScheduler({
      db,
      config,
      broadcast: (event, payload) => events.push([event, payload]),
      random: () => 0.5,
    });
    try {
      for (let tick = 0; tick < 8; tick += 1) scheduler.tick();
      assert.equal(events.filter(([event]) => event === 'pumpkin:move').length, 8);
      const pumpkins = db.listPumpkins();
      for (let index = 0; index < pumpkins.length; index += 1) {
        for (const other of pumpkins.slice(index + 1)) {
          assert.ok(Math.abs(pumpkins[index].x - other.x) >= 30);
        }
      }
    } finally {
      scheduler.stop();
      db.close();
    }
  });

  try {
    const target = scheduler.tick();
    assert.ok(target);
    assert.deepEqual(
      { x: db.getPumpkin(pumpkin.id).x, y: db.getPumpkin(pumpkin.id).y },
      { x: target.x, y: target.y },
    );
    assert.deepEqual(events.at(-1), ['pumpkin:move', {
      id: pumpkin.id, x: target.x, y: target.y, isAirborne: false, sequence: -1, movementType: 'roam', roamingSpeed: DEFAULT_ROAMING_SETTINGS.roamingSpeed, roamingJumpHeight: DEFAULT_ROAMING_SETTINGS.roamingJumpHeight,
    }]);
  } finally {
    scheduler.stop();
    db.close();
  }
});

test('movement scheduler applies a changed interval without restarting the server', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const intervals = [];
  const cleared = [];
  const scheduler = createPumpkinMovementScheduler({
    db,
    config,
    setIntervalFn: (callback, delay) => {
      const timer = { callback, delay };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn: (timer) => cleared.push(timer),
  });
  try {
    scheduler.start();
    assert.equal(intervals[0].delay, 5000);
    db.updateSettings({ roamingIntervalSeconds: 9 }, config);
    assert.equal(scheduler.settingsUpdated(), true);
    assert.deepEqual(cleared, [intervals[0]]);
    assert.equal(intervals[1].delay, 9000);
    assert.equal(scheduler.stop(), true);
    assert.deepEqual(cleared, [intervals[0], intervals[1]]);
  } finally {
    scheduler.stop();
    db.close();
  }
});

test('manual drags, deletion, and scene clear pause or release roaming state', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const pumpkin = insertMovementTestPumpkin(db, 'socket-roamer', 500, config.scene.groundY);
  const schedulerCalls = [];
  const movementScheduler = {
    pause: (...args) => schedulerCalls.push(['pause', ...args]),
    resume: (...args) => schedulerCalls.push(['resume', ...args]),
    remove: (...args) => schedulerCalls.push(['remove', ...args]),
    reset: () => schedulerCalls.push(['reset']),
  };
  const socketEvents = new Map();
  const ioEvents = [];
  let connection;
  const io = {
    use() {},
    on(event, handler) { if (event === 'connection') connection = handler; },
    emit(...args) { ioEvents.push(args); },
  };
  attachSocketHandlers(io, { config, db, statuses: { all: () => [] }, movementScheduler });
  const socket = {
    id: 'admin-drag-session',
    data: { admin: true },
    handshake: { headers: {} },
    on(event, handler) { socketEvents.set(event, handler); },
    emit() {},
  };
  connection(socket);

  socketEvents.get('admin:pumpkin:move-start')({ id: pumpkin.id, x: 560, y: pumpkin.y });
  socketEvents.get('admin:pumpkin:move')({ id: pumpkin.id, x: 600, y: pumpkin.y, sequence: 0 });
  socketEvents.get('admin:pumpkin:move-end')({ id: pumpkin.id, x: 620, y: 600 });
  assert.deepEqual(schedulerCalls.slice(0, 2), [
    ['pause', pumpkin.id, socket.id],
    ['resume', pumpkin.id, socket.id],
  ]);
  assert.deepEqual(
    { x: db.getPumpkin(pumpkin.id).x, y: db.getPumpkin(pumpkin.id).y, isAirborne: db.getPumpkin(pumpkin.id).isAirborne },
    { x: 620, y: config.scene.groundY, isAirborne: false },
  );
  assert.deepEqual(ioEvents.findLast(([event]) => event === 'pumpkin:move-ended')?.[1], {
    id: pumpkin.id, x: 620, y: config.scene.groundY, fromX: 620, fromY: 600, groundY: config.scene.groundY, isAirborne: true,
  });
  assert.deepEqual(
    ioEvents.filter(([event]) => ['pumpkin:move-ended', 'pumpkin:updated'].includes(event)).map(([event]) => event),
    ['pumpkin:move-ended'],
    'the persisted-position sync must not overwrite the active fall',
  );

  socketEvents.get('admin:pumpkin:move-start')({ id: pumpkin.id, x: 640, y: pumpkin.y });
  socketEvents.get('disconnect')();
  assert.deepEqual(schedulerCalls[2], ['pause', pumpkin.id, socket.id]);
  assert.deepEqual(schedulerCalls[3], ['resume', pumpkin.id, socket.id]);
  assert.equal(db.getPumpkin(pumpkin.id).x, 640);

  socketEvents.get('admin:pumpkin:delete')({ id: pumpkin.id });
  assert.deepEqual(schedulerCalls[4], ['remove', pumpkin.id]);
  insertMovementTestPumpkin(db, 'cleared-roamer', 700, config.scene.groundY);
  socketEvents.get('admin:pumpkins:clear')({ confirmation: true });
  assert.deepEqual(schedulerCalls[5], ['reset']);
  assert.equal(db.listPumpkins().length, 0);
  db.close();
});

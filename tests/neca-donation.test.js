import assert from 'node:assert/strict';
import test from 'node:test';
import { DonationService } from '../src/engine/donations.js';
import { testConfig, testDatabase } from './helpers.js';

function createService(random = () => 0.25) {
  const config = testConfig();
  const db = testDatabase(config);
  let nextId = 1;
  const service = new DonationService({
    db,
    config,
    random,
    idFactory: () => `neca-donation-${nextId++}`,
  });
  return { db, service };
}

function donation(id, name, message) {
  return { id, name, amount: 10, currency: 'RUB', message };
}

test('donation spawn applies both Neca face choices independently', () => {
  const { db, service } = createService();

  try {
    const result = service.handle(donation('both-neca', 'Both Neca', '!тыковка neca_eyes neca_mouth unknown'));
    assert.equal(result.spawned, true);
    assert.equal(result.pumpkin.customization.eyes, 'neca_eyes');
    assert.equal(result.pumpkin.customization.mouth, 'neca_mouth');
  } finally {
    db.close();
  }
});

test('donation spawn accepts either Neca face choice without replacing the other slot', () => {
  const { db, service } = createService();

  try {
    const eyesOnly = service.handle(donation('neca-eyes-only', 'Eyes Only', '!тыковка neca_eyes'));
    const mouthOnly = service.handle(donation('neca-mouth-only', 'Mouth Only', '!тыковка neca_mouth'));

    assert.equal(eyesOnly.pumpkin.customization.eyes, 'neca_eyes');
    assert.equal(eyesOnly.pumpkin.customization.mouth, 'cat');
    assert.equal(mouthOnly.pumpkin.customization.eyes, 'cute');
    assert.equal(mouthOnly.pumpkin.customization.mouth, 'neca_mouth');
  } finally {
    db.close();
  }
});

test('unknown donation keywords do not block spawning or override a recognized face choice', () => {
  const { db, service } = createService();

  try {
    const result = service.handle(donation('neca-with-unknown', 'Unknown Keyword', '!тыковка neca_eyes unknown'));
    assert.equal(result.spawned, true);
    assert.equal(result.pumpkin.customization.eyes, 'neca_eyes');
    assert.equal(result.pumpkin.customization.mouth, 'cat');
  } finally {
    db.close();
  }
});

test('donation commands without recognized face choices keep randomized selection', () => {
  const { db, service } = createService();

  try {
    const result = service.handle(donation('unknown-only', 'Unknown Only', '!тыковка unknown'));
    assert.equal(result.spawned, true);
    assert.equal(result.pumpkin.customization.eyes, 'sly');
    assert.equal(result.pumpkin.customization.mouth, 'fangs');
  } finally {
    db.close();
  }
});

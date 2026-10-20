import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPersistentDisclosures } from '../public/js/admin-disclosures.js';

const STORAGE_KEY = 'cozy-pumpkins.admin-disclosures';

class Disclosure {
  constructor(persistKey, open = false) {
    this.dataset = { persistKey };
    this.open = open;
    this.listeners = new Map();
  }

  addEventListener(name, listener) { this.listeners.set(name, listener); }
  toggle(open) { this.open = open; this.listeners.get('toggle')?.(); }
}

test('admin disclosure states persist independently across page reloads', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const firstLoad = [new Disclosure('integrations'), new Disclosure('appearance', true)];
  bindPersistentDisclosures(firstLoad, storage);

  firstLoad[0].toggle(true);
  firstLoad[1].toggle(false);

  const reloaded = [new Disclosure('integrations'), new Disclosure('appearance')];
  bindPersistentDisclosures(reloaded, storage);
  assert.deepEqual(reloaded.map(({ open }) => open), [true, false]);
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)), { integrations: true, appearance: false });
});

test('unknown disclosure preferences do not override markup defaults', () => {
  const storage = {
    getItem() { return JSON.stringify({ other: true, integrations: 'open' }); },
    setItem() {},
  };
  const disclosures = [new Disclosure('integrations'), new Disclosure('appearance', true)];
  bindPersistentDisclosures(disclosures, storage);

  assert.deepEqual(disclosures.map(({ open }) => open), [false, true]);
});

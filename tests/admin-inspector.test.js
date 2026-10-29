import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin inspector and integrations preserve clear empty, selected, and provider states', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(html, /id="inspector-empty"/);
  assert.match(html, /id="inspector-form" hidden/);
  assert.match(html, /id="selected-stage"/);
  assert.match(html, /id="owner-name"/);
  assert.match(html, /id="total-donated"/);
  assert.match(html, /id="save-pumpkin"/);
  assert.match(html, /class="danger-zone"[\s\S]*id="delete-pumpkin"/);
  assert.match(html, /Authorization:\s*<strong data-auth-status/);
  assert.match(html, /Live connection:\s*<strong data-connection-status/);
  assert.match(source, /\$\('\[data-auth-status\]', card\)\.textContent/);
  assert.match(source, /\$\('\[data-connection-status\]', card\)\.textContent/);
  assert.match(source, /function updateProviderCard\(/);
});

test('inspector applies customization and field changes immediately via socket instead of deferring to Save changes', async () => {
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');

  // Verify inspector slot changes call patchPumpkin without { persist: false }
  const slotListenerMatch = source.match(/\$\$\('#inspector-form \[data-slot\]'\)\.forEach\(\(select\) => select\.addEventListener\('change',[\s\S]*?\n  \}\)\);/);
  assert.ok(slotListenerMatch, 'Slot change listener exists');
  assert.match(slotListenerMatch[0], /patchPumpkin\(\{\s*customization\s*\}\)/);
  assert.doesNotMatch(slotListenerMatch[0], /persist:\s*false/);

  // Verify customization catalog applies immediately
  const catalogListenerMatch = source.match(/const applyCatalogItem = \(\) => \{[\s\S]*?\n      \};/);
  assert.ok(catalogListenerMatch, 'Catalog item listener exists');
  assert.match(catalogListenerMatch[0], /patchPumpkin\(\{\s*customization\s*\}\)/);
  assert.doesNotMatch(catalogListenerMatch[0], /persist:\s*false/);

  // Verify patchPumpkin emits admin:pumpkin:update
  assert.match(source, /if \(persist\) \{[\s\S]*?state\.socket\.emit\('admin:pumpkin:update', \{ id: p\.id, patch \}\)/);

  // Verify display-name and twitch-username change listeners exist
  assert.match(source, /\$\('#display-name'\)\.addEventListener\('change'/);
  assert.match(source, /\$\('#twitch-username'\)\.addEventListener\('change'/);
});

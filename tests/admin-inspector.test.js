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

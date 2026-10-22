import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('inspector exposes an accessible independent visibility control for the selected pumpkin', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  const inspectorStart = html.indexOf('id="inspector-form"');
  const controlPosition = html.indexOf('id="show-display-name"');
  assert.notEqual(inspectorStart, -1);
  assert.ok(controlPosition > inspectorStart, 'visibility control belongs to the selected-pumpkin inspector');
  assert.match(html, /<input id="show-display-name" type="checkbox">/);
  assert.match(html, /<label for="show-display-name">Show donor name<\/label>/);
  assert.match(source, /\$\('#show-display-name'\)\.checked = p\.showDisplayName !== false/);
  const updateStart = source.indexOf("$('#show-display-name').addEventListener");
  const updateEnd = source.indexOf('\n  });', updateStart);
  assert.notEqual(updateStart, -1);
  assert.notEqual(updateEnd, -1);
  const updateHandler = source.slice(updateStart, updateEnd);
  assert.match(updateHandler, /admin:pumpkin:update/);
  assert.match(updateHandler, /showDisplayName: checkbox\.checked/);
  assert.doesNotMatch(updateHandler, /showPumpkinNames/);
  assert.match(updateHandler, /if \(!p\) return/);
});

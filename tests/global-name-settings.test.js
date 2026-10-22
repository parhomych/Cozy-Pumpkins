import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin global name control is accessible and saves only the scene setting', async () => {
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /function ensureNameSettingsControl/);
  assert.match(source, /id = 'show-pumpkin-names'/);
  assert.match(source, /htmlFor = 'show-pumpkin-names'/);
  assert.match(source, /function renderNameSettings/);
  assert.match(source, /state\.settings\.showPumpkinNames !== false/);
  assert.match(source, /admin:settings:update/);
  assert.match(source, /showPumpkinNames: checkbox\.checked/);
  assert.match(source, /pumpkinNameFontSize: Number\(nameFontSize\.value\)/);
  assert.match(source, /renderer\.setNameFontSize\(Number\(nameFontSize\.value\)\)/);
  const changeStart = source.indexOf("checkbox.addEventListener('change'");
  const changeEnd = source.indexOf('\n  });', changeStart);
  assert.notEqual(changeStart, -1);
  assert.notEqual(changeEnd, -1);
  const changeHandler = source.slice(changeStart, changeEnd);
  assert.doesNotMatch(changeHandler, /showDisplayName/);
  assert.match(changeHandler, /admin:settings:update/);
  assert.match(source, /renderNameSettings\(\)/);
});

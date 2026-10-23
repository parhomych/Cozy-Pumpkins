import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Appearance face controls are populated from the customization catalog without losing current values', async () => {
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');

  assert.match(source, /function populateFaceChoices\(catalog = \[\]\)/u);
  assert.match(source, /for \(const group of catalog\)[\s\S]*?group\?\.slot !== 'eyes'[\s\S]*?group\?\.slot !== 'mouth'/u);
  assert.match(source, /\$\(`\[data-slot="\$\{group\.slot\}"\]`\)/u);
  assert.match(source, /const currentValue = select\.value;/u);
  assert.match(source, /option\.value = item\.value;/u);
  assert.match(source, /select\.append\(option\);/u);
  assert.match(source, /select\.value = currentValue;/u);
  assert.match(source, /populateFaceChoices\(state\.customizationCatalog\);/u);
});

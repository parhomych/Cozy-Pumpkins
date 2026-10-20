import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('growth settings render four isolated previews and save only valid cumulative thresholds', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  for (const stage of [1, 2, 3, 4]) {
    assert.match(html, new RegExp(`id="growth-stage-${stage}-preview"`));
    assert.match(html, new RegExp(`data-growth-preview-stage="${stage}"`));
  }
  for (const stage of [2, 3, 4]) assert.match(html, new RegExp(`id="growth-threshold-stage-${stage}"`));
  assert.match(html, /id="save-growth-settings"/);
  assert.match(html, /id="growth-settings-state"[^>]*aria-live="polite"/);
  assert.match(source, /function renderGrowthStages\(/);
  assert.match(source, /function saveGrowthSettings\(/);
  assert.match(source, /growthThresholds/);
  assert.match(source, /invalid_growth_thresholds/);
  const start = source.indexOf('function renderGrowthStages(');
  const end = source.indexOf('\nfunction ', start + 1);
  const renderer = source.slice(start, end);
  assert.match(renderer, /new PumpkinCharacter/);
  assert.match(renderer, /destroy\(\)/);
  assert.doesNotMatch(renderer, /state\.socket|renderer\.sync|renderer\.update/);
});

test('customization and action catalogs are rendered from available choices', async () => {
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function renderCustomizationCatalog(');
  const end = source.indexOf('\nfunction ', start + 1);
  const renderer = source.slice(start, end);
  assert.match(renderer, /group\.values/);
  assert.match(renderer, /item\.keywords/);
  assert.match(renderer, /REWARD_ACTIONS/);
  assert.match(renderer, /catalog-group/);
  assert.doesNotMatch(renderer, /state\.socket|renderer\.sync|renderer\.update/);
});

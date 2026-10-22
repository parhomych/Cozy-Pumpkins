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
  for (const stage of [2, 3, 4]) assert.match(html, new RegExp(`id="growth-stage-enabled-${stage}"`));
  for (const stage of [2, 3, 4]) assert.match(html, new RegExp(`id="growth-threshold-stage-${stage}"`));
  for (const stage of [1, 2, 3, 4]) assert.match(html, new RegExp(`id="growth-multiplier-stage-${stage}"`));
  assert.match(html, /id="save-growth-settings"/);
  assert.match(html, /id="growth-settings-state"[^>]*aria-live="polite"/);
  assert.match(source, /function renderGrowthStages\(/);
  assert.match(source, /function saveGrowthSettings\(/);
  assert.match(source, /growthThresholds/);
  assert.match(source, /growthStages/);
  assert.match(source, /growth-stage-enabled-/);
  assert.match(source, /growthMultipliers/);
  assert.match(source, /growth-multiplier-stage-/);
  assert.match(source, /invalid_growth_multipliers/);
  assert.match(source, /invalid_growth_thresholds/);
  const start = source.indexOf('function renderGrowthStages(');
  const end = source.indexOf('\nfunction ', start + 1);
  const renderer = source.slice(start, end);
  assert.match(renderer, /new PumpkinCharacter/);
  assert.match(renderer, /for \(const stage of \[1, 2, 3, 4\]\)/);
  assert.match(renderer, /destroy\(\)/);
  assert.doesNotMatch(renderer, /state\.socket|renderer\.sync|renderer\.update/);
});

test('customization catalog keeps empty replacement slots and no action entries', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(html, /<select data-slot="hat"><\/select>/);
  assert.match(html, /<select data-slot="prop"><\/select>/);
  assert.doesNotMatch(html, /data-slot="hat"><option/);
  assert.doesNotMatch(html, /data-slot="prop"><option/);
  assert.doesNotMatch(html, /Test actions|data-animation=/);
  assert.doesNotMatch(source, /admin:animation:test/);
  const start = source.indexOf('function renderCustomizationCatalog(');
  const end = source.indexOf('\nfunction ', start + 1);
  const renderer = source.slice(start, end);
  assert.match(renderer, /group\.values/);
  assert.match(renderer, /item\.keywords/);
  assert.match(renderer, /const actionIds = \[\]/);
  assert.doesNotMatch(renderer, /data-animation/);
  assert.match(renderer, /catalog-group/);
  assert.doesNotMatch(renderer, /state\.socket|renderer\.sync|renderer\.update/);
});

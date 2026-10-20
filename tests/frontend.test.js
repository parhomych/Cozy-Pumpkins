import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shared pumpkin artwork exposes independent reference layers and face parts', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  for (const fragment of ["group('mover')", "group('floater')", "group('actor')", "group('leaf-bed-static')", "group('body-motion idle-body-motion')", "group('body-look')", "group('stem')", 'group(`body pumpkin-body', "group('leaves leaf-bed')", "group('highlights highlight-group')", 'group(`eyes eyes-', "group('eye eye-left')", "group('eye eye-right')", 'group(`mouth mouth-', 'hat hat-accessory', 'prop-accessory', "class: 'ground-shadow'"]) {
    assert.ok(source.includes(fragment), `missing SVG layer fragment ${fragment}`);
  }
  const asset = await readFile(new URL('../public/assets/pumpkin-reference.svg', import.meta.url), 'utf8');
  assert.match(asset, /viewBox="0 0 1095 1095"/);
  assert.equal((asset.match(/<path\b/g) || []).length, 9);
});

test('shared character includes smooth idle, face, stem, and cleanup animation hooks', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-character.js', import.meta.url), 'utf8');
  for (const method of ['_scheduleFloat', '_scheduleBodyRock', '_scheduleStemSway', 'blink', '_animateMouth', 'jump', 'inflate', 'morphAndFly', 'stopIdle', 'destroy']) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`), `missing animation method ${method}`);
  }
  assert.doesNotMatch(source, /repeatRefresh:/);
  assert.match(source, /this\.idleTimers\.clear\(\)/);

  const floatBlock = source.slice(source.indexOf('  _scheduleFloat('), source.indexOf('  _scheduleBodyRock('));
  assert.match(floatBlock, /rotation:/);
  assert.doesNotMatch(floatBlock, /\by:/);
  assert.match(floatBlock, /this\.bodyMotion/);
  assert.match(floatBlock, /duration: randomBetween\(4\.8, 6\.4\)/);

  const svgSource = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  const rockerBlock = svgSource.slice(svgSource.indexOf('rocker.append('), svgSource.indexOf('hydrateReferencePaths('));
  assert.doesNotMatch(rockerBlock, /layers\.leaves/);

  const lookBlock = source.slice(source.indexOf('  lookAt('), source.indexOf('  _animateFaceVariant('));
  assert.match(lookBlock, /this\.bodyLook/);
  assert.match(lookBlock, /bodyRotation/);

  const mouthBlock = source.slice(source.indexOf('  _animateMouth('), source.indexOf('  waveArms('));
  assert.match(mouthBlock, /scaleX:/);
  assert.match(mouthBlock, /scaleY:/);
  assert.match(mouthBlock, /y:/);
  assert.match(mouthBlock, /transformOrigin:\s*'50% 50%'/);
  assert.doesNotMatch(mouthBlock, /svgOrigin/);
  assert.doesNotMatch(mouthBlock, /\bx:/);
});

test('renderer applies global animation settings without replacing characters', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-renderer.js', import.meta.url), 'utf8');
  assert.match(source, /setSettings/);
  assert.match(source, /setAnimationSettings/);
  assert.match(source, /character\.restartIdle\(\)/);
});

test('admin scene settings expose and save global animation frequencies', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="eye-frequency"/);
  assert.match(html, /id="mouth-frequency"/);
  assert.match(html, /data-reward-action="inflate"/);
  assert.match(html, /data-reward-action="jump_on"/);
  assert.match(html, /id="save-reward-mapping"/);
  assert.match(html, /id="refresh-twitch-rewards"/);
  assert.match(html, /data-reward-action="inflate"[^>]*>/);
  assert.doesNotMatch(html, /data-reward-action="inflate"[^>]*type="text"/);
  assert.match(html, /data-auth-status/);
  assert.match(html, /data-connection-status/);
  assert.match(html, /data-account/);
  assert.match(html, /data-provider-message/);
  for (const provider of ['donationalerts', 'donatex', 'memealerts']) {
    assert.match(html, new RegExp(`data-provider="${provider}"`));
  }
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /eyeFrequency/);
  assert.match(source, /mouthFrequency/);
  assert.match(source, /admin:settings:update/);
  assert.match(source, /rewardMapping/);
  assert.match(source, /saveRewardMapping/);
  assert.match(source, /loadTwitchRewards/);
  assert.match(source, /twitch\/rewards/);
  assert.match(source, /Duplicate reward assignment/);
  assert.match(source, /isEnabled/);
  assert.match(source, /value\.authStatus/);
  assert.match(source, /value\.connectionStatus/);
  assert.match(source, /value\.account \|\| '—'/);
  assert.match(source, /value\.message \|\| ''/);
  assert.match(source, /donatex: 'DonatEx'/);
  assert.match(source, /memealerts: 'Meme Alerts'/);
  assert.doesNotMatch(source, /Reconnect by disconnecting and connecting again/);
  assert.doesNotMatch(source, /providerLogin/);
  assert.doesNotMatch(source, /animation: \{ eyeFrequency: Number\(\$\('#eye-frequency'\)/);
  const overlay = await readFile(new URL('../public/js/overlay-app.js', import.meta.url), 'utf8');
  assert.match(overlay, /renderer\.sync\(Array\.isArray\(scene\.pumpkins\)/);
  assert.match(overlay, /settings:updated/);
  assert.match(overlay, /renderer\.update\(pumpkin\)/);
});

test('spawn rule controls and read-only keyword previews stay isolated from the live scene', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="min-spawn-donation"/);
  assert.match(html, /id="spawn-command"/);
  assert.match(html, /id="save-spawn-settings"/);
  assert.match(html, /id="customization-catalog"/);
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /loadSpawnSettings/);
  assert.match(source, /customizationCatalog/);
  assert.match(source, /message: state\.settings\.spawnCommand/);
  const start = source.indexOf('function renderCustomizationCatalog(');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const renderer = source.slice(start, end);
  assert.match(renderer, /new PumpkinCharacter/);
  assert.match(renderer, /keywords/);
  assert.match(renderer, /destroy\(\)/);
  assert.doesNotMatch(renderer, /state\.socket|renderer\.sync|renderer\.update/);
});

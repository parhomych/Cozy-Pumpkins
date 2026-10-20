import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shared pumpkin artwork exposes independent reference layers and face parts', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  for (const fragment of ["group('mover')", "group('floater')", "group('actor')", "group('leaf-bed-static')", "group('body-motion idle-body-motion')", "group('body-look')", "group('stem')", 'group(`body pumpkin-body', "group('leaves leaf-bed')", "group('highlights highlight-group')", 'group(`eyes eyes-', "group('eye eye-left')", "group('eye eye-right')", 'group(`mouth mouth-', 'hat hat-accessory', 'prop-accessory']) {
    assert.ok(source.includes(fragment), `missing SVG layer fragment ${fragment}`);
  }
  assert.doesNotMatch(source, /ground-shadow|air-planter/);
  const asset = await readFile(new URL('../public/assets/pumpkin-reference.svg', import.meta.url), 'utf8');
  assert.match(asset, /viewBox="0 0 1095 1095"/);
  assert.equal((asset.match(/<path\b/g) || []).length, 9);
});

test('shared pumpkin artwork anchors every growth stage to its bottom edge', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  assert.match(source, /const REFERENCE_ARTWORK_BOTTOM = 1041;/);
  assert.match(source, /const REFERENCE_INTERACTION_BOX = Object\.freeze\(\{ x: 0, y: -54, width: REFERENCE_VIEWBOX, height: REFERENCE_VIEWBOX \}\);/);
  assert.match(source, /translate\(\$\{548 \* \(1 - stageScale\)\} \$\{REFERENCE_VIEWBOX - REFERENCE_ARTWORK_BOTTOM \* stageScale\}\) scale\(\$\{stageScale\}\)/);
  assert.doesNotMatch(source, /translate\(\$\{548 \* \(1 - stageScale\)\} \$\{REFERENCE_VIEWBOX \* \(1 - stageScale\)\}\) scale\(\$\{stageScale\}\)/);
});

test('admin interaction uses the transformed artwork hitbox instead of the shifted root square', async () => {
  const svgSource = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../public/css/admin.css', import.meta.url), 'utf8');
  const adminHtml = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const overlayHtml = await readFile(new URL('../public/overlay.html', import.meta.url), 'utf8');
  assert.match(svgSource, /class: 'interaction-hitbox'/);
  assert.match(svgSource, /interactionHitbox\.setAttribute\('transform', stageTransform\)/);
  assert.match(svgSource, /mover\.append\(floater, interactionHitbox\)/);
  assert.match(cssSource, /\.scene-canvas \.pumpkin-character \{[\s\S]*pointer-events: none;/);
  assert.match(cssSource, /\.scene-canvas \.pumpkin-character \.interaction-hitbox \{[\s\S]*pointer-events: all;/);
  assert.match(adminHtml, /src="\/js\/admin-app\.js\?v=hitbox-20261021"/);
  assert.match(overlayHtml, /src="\/js\/overlay-app\.js\?v=hitbox-20261021"/);
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

test('admin workspace groups existing workflows with accessible disclosures and a square 16:9 preview', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/css/admin.css', import.meta.url), 'utf8');
  assert.match(html, /<details\b/);
  assert.match(html, /<summary\b/);
  for (const selector of [
    'preview-frame', 'scene-canvas', 'clear-all', 'toggle-zone', 'zone-x', 'eye-frequency',
    'mouth-frequency', 'refresh-twitch-rewards', 'save-reward-mapping', 'min-spawn-donation',
    'spawn-command', 'customization-catalog', 'pumpkin-search', 'inspector-form',
    'inspector-empty', 'display-name', 'twitch-username',
  ]) assert.match(html, new RegExp(`id="${selector}"`), `missing existing workflow selector #${selector}`);
  for (const group of ['Integrations', 'Scene settings', 'Donation spawn and growth rules', 'Customization', 'Pumpkin inspector']) {
    assert.match(html, new RegExp(group, 'i'), `missing admin group ${group}`);
  }
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/u);
  assert.doesNotMatch(css, /\.preview-frame\s*\{[^}]*min-height\s*:/su);
  const cornerRadii = [...css.matchAll(/border-radius:\s*([^;]+);/gu)].map((match) => match[1].trim());
  assert.ok(cornerRadii.every((radius) => /^0(?:px)?$/u.test(radius)));
  assert.doesNotMatch(css, /#c878ff|#302044|#ef7089/iu);
  assert.match(css, /--bg:\s*#f0eee5/u);
  assert.match(css, /--accent:\s*#8d4f24/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.match(css, /@media\s*\(max-width:\s*620px\)/u);
  assert.match(css, /details:not\(\[open\]\)\s*>\s*:not\(summary\)\s*\{\s*display:\s*none;/u);
});

test('admin drag bounds allow the artwork to reach the bottom of the widget', async () => {
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /const minY = height \+ padding; const maxY = SCENE_HEIGHT;/);
});

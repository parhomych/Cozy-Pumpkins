import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Appearance exposes independent Neca eye and mouth choices', async () => {
  const html = await read('../public/admin.html');
  assert.match(html, /<select data-slot="eyes">[\s\S]*?<option value="neca_eyes">Neca eyes<\/option>/u);
  assert.match(html, /<select data-slot="mouth">[\s\S]*?<option value="neca_mouth">Neca mouth<\/option>/u);
});

test('shared renderer keeps Neca artwork in the existing animated face slots', async () => {
  const renderer = await read('../public/js/shared/pumpkin-svg.js');
  const character = await read('../public/js/shared/pumpkin-character.js');

  assert.match(renderer, /const stageTwo = face\.dataset\.stage === '2';[\s\S]*?eye\('eye-neca-left', stageTwo \? '358' : '321', '0', stageTwo \? 420 : 386\)[\s\S]*?eye\('eye-neca-right', stageTwo \? '575' : '589', '506', stageTwo \? 640 : 654\)/u);
  assert.match(renderer, /href: '\/assets\/neca_eyes\.svg'/u);
  assert.match(renderer, /const mouth = group\(`mouth mouth-\$\{customization\.mouth\}`\);[\s\S]*?customization\.mouth === 'neca_mouth'/u);
  assert.match(renderer, /href: '\/assets\/neca_mouth\.svg'/u);
  assert.match(renderer, /face\.dataset\.stage === '1' \|\| face\.dataset\.stage === '3' \|\| face\.dataset\.stage === '4' \? 1\.45 : 1/u);
  assert.match(renderer, /x: '450', y: '639', width: '160', height: '82'/u);
  assert.match(renderer, /const necaMouthOffset = customization\.mouth === 'neca_mouth' \? 60 : 0;[\s\S]*?centerY - 665 \* scaleY \+ necaMouthOffset/u);
  assert.match(character, /querySelectorAll\('\.eyes \.eye'\)/u);
  assert.match(character, /gsap\.to\(this\.mouth/u);
});

test('all four growth stages use the shared face overlay', async () => {
  const renderer = await read('../public/js/shared/pumpkin-svg.js');

  assert.match(renderer, /const stage = Math\.max\(1, Math\.min\(4, Number\(pumpkin\.stage\)/u);
  assert.match(renderer, /face\.dataset\.stage = String\(stage\);\s*addFaceOverlay\(face, customization\);/u);
});

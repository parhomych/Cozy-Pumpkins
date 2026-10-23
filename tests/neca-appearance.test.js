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

  assert.match(renderer, /customization\.eyes === 'neca_eyes'[\s\S]*?group\('eye eye-neca-pair'/u);
  assert.match(renderer, /href: '\/assets\/neca_eyes\.svg'/u);
  assert.match(renderer, /const mouth = group\(`mouth mouth-\$\{customization\.mouth\}`\);[\s\S]*?customization\.mouth === 'neca_mouth'/u);
  assert.match(renderer, /href: '\/assets\/neca_mouth\.svg'/u);
  assert.match(character, /querySelectorAll\('\.eyes \.eye'\)/u);
  assert.match(character, /gsap\.to\(this\.mouth/u);
});

test('all four growth stages use the shared face overlay', async () => {
  const renderer = await read('../public/js/shared/pumpkin-svg.js');

  assert.match(renderer, /const stage = Math\.max\(1, Math\.min\(4, Number\(pumpkin\.stage\)/u);
  assert.match(renderer, /face\.dataset\.stage = String\(stage\);\s*addFaceOverlay\(face, customization\);/u);
});

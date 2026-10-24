import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class SvgElement {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  append(...children) {
    this.children.push(...children);
  }
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

test('cocoa-hands artwork renders at every stage with stage-relative dimensions', async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = { createElementNS: (_namespace, name) => new SvgElement(name) };
  delete globalThis.fetch;

  try {
    const { createPumpkinSvg } = await import('../public/js/shared/pumpkin-svg.js');
    for (const stage of [1, 2, 3, 4]) {
      const svg = createPumpkinSvg({ id: `cocoa-${stage}`, stage, customization: { prop: 'cocoa_hands' } });
      const nodes = descendants(svg);
      const fixed = nodes.find((element) => element.attributes.get('class') === 'cocoa-hands-fixed-shoulders');
      const moving = nodes.find((element) => element.attributes.get('class') === 'cocoa-hands-moving-center');

      assert.ok(fixed, `stage ${stage} should render fixed shoulder artwork`);
      assert.ok(moving, `stage ${stage} should render moving center artwork`);
      assert.ok(nodes.some((element) => element.attributes.get('href') === '/assets/cocoa-hands.svg#cocoa-shoulders-fixed'));
      assert.ok(nodes.some((element) => element.attributes.get('href') === '/assets/cocoa-hands.svg#cocoa-center-moving'));
      const artwork = nodes.find((element) => element.attributes.get('class') === 'cocoa-hands-artwork');
      assert.equal(Number(artwork.attributes.get('width')), [100, 120, 145, 145][stage - 1]);
      assert.equal(artwork.attributes.get('height'), String(Number(artwork.attributes.get('width')) * 534 / 991));
    }

    const defaultAppearance = createPumpkinSvg({ id: 'plain-3', stage: 3 });
    assert.equal(descendants(defaultAppearance).some((element) => String(element.attributes.get('class') || '').includes('cocoa-hands-')), false);

    const source = await readFile(new URL('../public/assets/cocoa-hands.svg', import.meta.url), 'utf8');
    assert.match(source, /id="cocoa-artwork-source"/u);
    assert.match(source, /id="cocoa-shoulder-left"[^>]+mask="url\(#cocoa-left-shoulder-mask\)"/u);
    assert.match(source, /id="cocoa-shoulder-right"[^>]+mask="url\(#cocoa-right-shoulder-mask\)"/u);
    assert.match(source, /id="cocoa-center-moving"[^>]+mask="url\(#cocoa-center-mask\)"/u);
    assert.match(source, /id="cocoa-center-transition"[\s\S]*?stop-color="#000000"[\s\S]*?stop-color="#ffffff"/u);
    assert.equal((source.match(/href="#cocoa-artwork-source"/gu) || []).length, 3);

    const admin = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
    const overlay = await readFile(new URL('../public/js/overlay-app.js', import.meta.url), 'utf8');
    assert.match(admin, /import \{ PumpkinRenderer \} from '\.\/shared\/pumpkin-renderer\.js/u);
    assert.match(overlay, /import \{ PumpkinRenderer \} from '\.\/shared\/pumpkin-renderer\.js/u);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

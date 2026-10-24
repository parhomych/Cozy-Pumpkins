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
    const { createPumpkinSvg, COCOA_HANDS_WIDTHS, COCOA_HANDS_STAGE_CONFIG } = await import('../public/js/shared/pumpkin-svg.js');
    const expectedWidths = [96, 120, 145, 162];
    assert.deepEqual(COCOA_HANDS_WIDTHS, expectedWidths);

    for (const stage of [1, 2, 3, 4]) {
      const svg = createPumpkinSvg({ id: `cocoa-${stage}`, stage, customization: { prop: 'cocoa_hands' } });
      const nodes = descendants(svg);
      const artwork = nodes.find((element) => element.attributes.get('class')?.includes('cocoa-hands-artwork'));
      assert.ok(artwork, `stage ${stage} should render cocoa-hands artwork`);

      const expectedWidth = expectedWidths[stage - 1];
      const expectedHeight = Math.round(expectedWidth * 534 / 991 * 100) / 100;
      assert.equal(Number(artwork.attributes.get('width')), expectedWidth);
      assert.equal(Number(artwork.attributes.get('height')), expectedHeight);

      const y = Number(artwork.attributes.get('y'));
      const expectedConfig = COCOA_HANDS_STAGE_CONFIG[stage];
      assert.equal(y, expectedConfig.y, `stage ${stage} should match config y`);
      if (stage === 2) {
        assert.ok(y > 150, `stage 2 artwork y (${y}) should place cocoa hands on lower pumpkin body`);
      } else if (stage === 1) {
        assert.ok(y < 120, `stage 1 artwork y (${y}) should fit baby pumpkin body`);
      }

      const paths = nodes.filter((element) => element.attributes.get('class')?.includes('cocoa-hands-path'));
      assert.equal(paths.length, 12, `stage ${stage} should render all 12 cocoa-hands paths`);
      assert.equal(artwork.attributes.get('data-shoulder-left'), '140');
      assert.equal(artwork.attributes.get('data-shoulder-right'), '850');
    }

    const defaultAppearance = createPumpkinSvg({ id: 'plain-3', stage: 3 });
    assert.equal(descendants(defaultAppearance).some((element) => String(element.attributes.get('class') || '').includes('cocoa-hands-')), false);

    const source = await readFile(new URL('../public/assets/cocoa-hands.svg', import.meta.url), 'utf8');
    assert.match(source, /id="cocoa-hands-artwork"/u);
    assert.match(source, /class="cocoa-hands-path/u);

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

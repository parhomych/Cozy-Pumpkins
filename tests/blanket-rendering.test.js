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

test('blanket static SVG assets exist and contain valid XML with viewBox', async () => {
  const back = await readFile('public/assets/blanket-back.svg', 'utf8');
  const front = await readFile('public/assets/blanket-front.svg', 'utf8');

  assert.ok(back.includes('viewBox="0 0 933 818"'), 'blanket-back.svg should have 933x818 viewBox');
  assert.ok(front.includes('viewBox="0 0 933 818"'), 'blanket-front.svg should have 933x818 viewBox');
  assert.ok(back.includes('clipPath id="back-clip"'), 'blanket-back.svg should define back-clip');
  assert.ok(front.includes('clipPath id="front-clip"'), 'blanket-front.svg should define front-clip');
});

test('blanket artwork renders at every stage with stage-relative dimensions', async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = { createElementNS: (_namespace, name) => new SvgElement(name) };
  delete globalThis.fetch;

  try {
    const { createPumpkinSvg, BLANKET_WIDTHS, BLANKET_STAGE_CONFIG } = await import(
      '../public/js/shared/pumpkin-svg.js'
    );
    const expectedWidths = [116, 136, 196, 236];
    assert.deepEqual(BLANKET_WIDTHS, expectedWidths);

    for (const stage of [1, 2, 3, 4]) {
      const svg = createPumpkinSvg({ id: `blanket-${stage}`, stage, customization: { prop: 'blanket' } });
      const nodes = descendants(svg);

      const backArtwork = nodes.find((el) => el.attributes.get('class')?.includes('blanket-back-artwork'));
      const frontArtwork = nodes.find((el) => el.attributes.get('class')?.includes('blanket-front-artwork'));

      assert.ok(backArtwork, `stage ${stage} should render blanket-back-artwork`);
      assert.ok(frontArtwork, `stage ${stage} should render blanket-front-artwork`);

      assert.equal(backArtwork.attributes.get('href'), '/assets/blanket-back.svg');
      assert.equal(frontArtwork.attributes.get('href'), '/assets/blanket-front.svg');
      assert.equal(backArtwork.attributes.get('preserveAspectRatio'), 'none');
      assert.equal(frontArtwork.attributes.get('preserveAspectRatio'), 'none');

      const expectedConfig = BLANKET_STAGE_CONFIG[stage];
      assert.equal(Number(backArtwork.attributes.get('width')), expectedConfig.width);
      assert.equal(Number(backArtwork.attributes.get('height')), expectedConfig.height);
      assert.equal(Number(backArtwork.attributes.get('x')), expectedConfig.x);
      assert.equal(Number(backArtwork.attributes.get('y')), expectedConfig.y);

      assert.equal(Number(frontArtwork.attributes.get('width')), expectedConfig.width);
      assert.equal(Number(frontArtwork.attributes.get('height')), expectedConfig.height);
      assert.equal(Number(frontArtwork.attributes.get('x')), expectedConfig.x);
      assert.equal(Number(frontArtwork.attributes.get('y')), expectedConfig.y);

      if (stage === 1) {
        assert.ok(expectedConfig.width < 140, 'stage 1 blanket should be compact for baby pumpkin');
        assert.ok(expectedConfig.y >= 75, 'stage 1 blanket y should sit lower around the pot rim');
      } else if (stage === 2) {
        assert.ok(expectedConfig.width >= 130 && expectedConfig.width <= 145, 'stage 2 blanket width should envelop the sprout pumpkin body compactly');
        assert.ok(expectedConfig.y >= 150, 'stage 2 blanket y should place blanket naturally below the mouth');
      } else if (stage === 4) {
        assert.ok(expectedConfig.width >= 230, 'stage 4 blanket should wrap giant pumpkin body with extra width');
        assert.ok(expectedConfig.y >= 70, 'stage 4 blanket y should sit lower so it does not cover the mouth');
      }
    }
  } finally {
    globalThis.document = previousDocument;
    if (previousFetch) globalThis.fetch = previousFetch;
  }
});

test('volumetric blanket layering: pumpkin body sinks into the center of the blanket', async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = { createElementNS: (_namespace, name) => new SvgElement(name) };
  delete globalThis.fetch;

  try {
    const { createPumpkinSvg } = await import('../public/js/shared/pumpkin-svg.js');

    for (const stage of [1, 2, 3, 4]) {
      const svg = createPumpkinSvg({ id: `depth-${stage}`, stage, customization: { prop: 'blanket' } });
      const nodes = descendants(svg);

      const backIdx = nodes.findIndex((el) => el.attributes.get('class')?.includes('blanket-back-artwork'));
      const bodyIdx = nodes.findIndex((el) => el.attributes.get('class')?.includes('pumpkin-body'));
      const frontIdx = nodes.findIndex((el) => el.attributes.get('class')?.includes('blanket-front-artwork'));

      assert.ok(backIdx !== -1, `stage ${stage} must contain blanket-back-artwork`);
      assert.ok(bodyIdx !== -1, `stage ${stage} must contain pumpkin-body`);
      assert.ok(frontIdx !== -1, `stage ${stage} must contain blanket-front-artwork`);

      // Back of the blanket must precede the pumpkin body (behind the body)
      assert.ok(
        backIdx < bodyIdx,
        `stage ${stage}: blanket-back-artwork (index ${backIdx}) must be behind pumpkin-body (index ${bodyIdx})`
      );

      // Front of the blanket must succeed the pumpkin body (in front of the body)
      assert.ok(
        bodyIdx < frontIdx,
        `stage ${stage}: pumpkin-body (index ${bodyIdx}) must be behind blanket-front-artwork (index ${frontIdx})`
      );
    }
  } finally {
    globalThis.document = previousDocument;
    if (previousFetch) globalThis.fetch = previousFetch;
  }
});

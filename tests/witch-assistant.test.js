import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WitchAssistant,
  WITCH_PARTS_METADATA,
  WITCH_BASE_VIEWBOX,
} from '../public/js/shared/witch-assistant.js';
import { PumpkinRenderer } from '../public/js/shared/pumpkin-renderer.js';

class MockElement {
  constructor(name, namespace = null) {
    this.name = name;
    this.namespace = namespace;
    this.attributes = new Map();
    this.children = [];
    this.style = {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
    };
    this.dataset = {};
    this.classList = {
      add: (c) => this.attributes.set('class', c),
      remove: () => {},
      toggle: () => {},
      contains: (c) => this.attributes.get('class') === c,
    };
  }

  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  append(...items) {
    for (const item of items) {
      if (item) this.children.push(item);
    }
  }

  appendChild(item) {
    this.append(item);
    return item;
  }

  remove() {
    this.children = [];
  }
}

test('witch assistant sprite assets exist with non-zero sizes', () => {
  const parts = Object.keys(WITCH_PARTS_METADATA);
  assert.equal(parts.length, 10);

  for (const part of parts) {
    const filename = `${part}.png`;
    const fullPath = resolve('public/assets/witch', filename);
    assert.ok(existsSync(fullPath), `Asset file ${filename} must exist`);
    const stat = statSync(fullPath);
    assert.ok(stat.size > 500, `Asset file ${filename} must have content, size: ${stat.size}`);
  }

  assert.equal(WITCH_BASE_VIEWBOX.width, 1013);
  assert.equal(WITCH_BASE_VIEWBOX.height, 1382);
});

test('witch assistant builds expected DOM joint hierarchy', () => {
  const previousDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    createElementNS: (ns, tag) => new MockElement(tag, ns),
  };

  try {
    const container = new MockElement('div');
    const witch = new WitchAssistant(container, { scale: 0.20, walkSpeed: 400 });

    assert.ok(witch.element, 'witch element exists');
    assert.ok(witch.svg, 'witch svg exists');
    assert.equal(witch.svg.getAttribute('viewBox'), '0 0 1013 1382');

    const expectedJoints = [
      'wing_left', 'wing_right', 'tail', 'leg_left',
      'leg_right', 'torso', 'head', 'hat', 'arm_left', 'arm_right'
    ];
    for (const jointKey of expectedJoints) {
      assert.ok(witch.joints[jointKey], `joint-${jointKey} exists`);
      assert.ok(witch.rotators[jointKey], `rotator for ${jointKey} exists`);
    }

    // Verify positioning and facing:
    // Natural sprite faces left (scaleX(1)), so facing right (facing = 1) uses scaleX(-1),
    // and facing left (facing = -1) uses scaleX(1).
    witch.setPosition(400, 500);
    assert.equal(witch.x, 400);
    assert.equal(witch.y, 500);
    assert.equal(witch.element.style.left, `${(400 / 1920) * 100}%`);
    assert.equal(witch.element.style.top, `${(500 / 1080) * 100}%`);
    assert.equal(witch.element.style.transform, 'translate(-50%, -98%) scaleX(-1)');

    witch.setFacing(-1);
    assert.equal(witch.facing, -1);
    assert.equal(witch.element.style.transform, 'translate(-50%, -98%) scaleX(1)');

    witch.setFacing(1);
    assert.equal(witch.facing, 1);
    assert.equal(witch.element.style.transform, 'translate(-50%, -98%) scaleX(-1)');

    witch.destroy();
  } finally {
    globalThis.document = previousDoc;
  }
});

test('witch assistant queues mission and delays customization apply until magic moment', async () => {
  const previousDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    createElementNS: (ns, tag) => new MockElement(tag, ns),
  };

  try {
    const container = new MockElement('div');
    const witch = new WitchAssistant(container);

    let applied = false;
    const pumpkin = {
      id: 'p1',
      x: 600,
      y: 520,
      customization: { skin: 'classic', hat: 'leaf', prop: 'none' },
      applyCustomization(cust) {
        applied = true;
        this.customization = cust;
      },
    };

    witch.queueMission({
      pumpkinCharacter: pumpkin,
      targetCustomization: { hat: 'witch', prop: 'cocoa_hands' },
      groundY: 520,
      side: 'left',
      onApply: () => {
        pumpkin.applyCustomization({ hat: 'witch', prop: 'cocoa_hands' });
      },
    });

    // In environment without gsap, mission steps resolve immediately
    // Wait for the async processNextMission to finish
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(applied, true, 'onApply should have been called');
    assert.equal(pumpkin.customization.hat, 'witch');
    assert.equal(pumpkin.customization.prop, 'cocoa_hands');

    witch.destroy();
  } finally {
    globalThis.document = previousDoc;
  }
});

test('pumpkin renderer intercepts customization changes when witch assistant is enabled', () => {
  const previousDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    createElementNS: (ns, tag) => new MockElement(tag, ns),
  };

  try {
    const container = new MockElement('div');
    const renderer = new PumpkinRenderer(container, { enableWitch: true });

    assert.ok(renderer.witchAssistant, 'renderer should have witch assistant');

    let missionQueued = false;
    let queuedCustomization = null;
    renderer.witchAssistant.queueMission = ({ targetCustomization }) => {
      missionQueued = true;
      queuedCustomization = targetCustomization;
    };

    // Add pumpkin with initial customization (immediate: true)
    const initialPumpkin = {
      id: 'p-witch-test',
      stage: 2,
      x: 500,
      y: 600,
      customization: { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'leaf', prop: 'none' },
    };
    renderer.add(initialPumpkin, { immediate: true });
    assert.equal(missionQueued, false, 'Initial add should not trigger witch');

    // Update position only (immediate: false)
    renderer.update({
      id: 'p-witch-test',
      x: 550,
      y: 600,
    }, { immediate: false });
    assert.equal(missionQueued, false, 'Position-only update should not trigger witch');

    // Update with changed face / accessory (immediate: false)
    renderer.update({
      id: 'p-witch-test',
      customization: { skin: 'classic', eyes: 'stars', mouth: 'vampire', hat: 'witch', prop: 'cocoa_hands' },
    }, { immediate: false });

    assert.equal(missionQueued, true, 'Customization update must trigger witch mission');
    assert.equal(queuedCustomization.hat, 'witch');
    assert.equal(queuedCustomization.eyes, 'stars');

    renderer.destroy();
  } finally {
    globalThis.document = previousDoc;
  }
});

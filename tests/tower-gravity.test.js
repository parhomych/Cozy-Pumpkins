import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTowerPlan } from '../src/engine/pumpkin-tower.js';
import { isPositionValid } from '../src/engine/spatial-rules.js';
import { testConfig } from './helpers.js';

test('tower members expose ordered support levels and validated bottom-edge landing positions', () => {
  const config = testConfig();
  const context = { scene: config.scene, noGoZone: { enabled: false } };
  const pumpkins = [1, 2, 3].map((stage) => ({
    id: `gravity-tower-${stage}`,
    createdAt: `2026-01-0${stage}`,
    stage,
    x: stage * 200,
    y: config.scene.groundY,
  }));
  const plan = buildTowerPlan(pumpkins, context, () => 0, 'largest-first');

  assert.deepEqual(plan.participants.map(({ id }) => id), [
    'gravity-tower-3',
    'gravity-tower-2',
    'gravity-tower-1',
  ]);
  assert.equal(plan.participants[0].supportY, config.scene.groundY);
  assert.equal(plan.participants[0].supportingPumpkinId, null);
  for (let index = 1; index < plan.participants.length; index += 1) {
    assert.equal(plan.participants[index].supportY, plan.participants[index].towerY);
    assert.equal(plan.participants[index].supportingPumpkinId, plan.participants[index - 1].id);
  }

  assert.equal(plan.finalPositions.length, pumpkins.length);
  assert.equal(new Set(plan.finalPositions.map(({ x }) => x)).size, pumpkins.length);
  for (const target of plan.finalPositions) {
    assert.equal(target.y, config.scene.height);
    const pumpkin = pumpkins.find(({ id }) => id === target.id);
    assert.equal(isPositionValid(pumpkin, target.x, target.y, context), true);
  }
});

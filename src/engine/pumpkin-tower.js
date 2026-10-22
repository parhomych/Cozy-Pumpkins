import { dimensionsFor, isPositionValid } from './spatial-rules.js';

export const MIN_TOPPLE_COUNT = 3;
export const TOWER_STEP_RATIO = 0.72;

function unitRandom(random) {
  const value = Number(random?.());
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
}

function sceneGroundY(context) {
  return Math.min(context.scene.height, Number.isFinite(context.scene.groundY) ? context.scene.groundY : context.scene.height);
}

function orderedPumpkins(pumpkins) {
  return [...pumpkins].sort((a, b) => {
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    return created || String(a.id).localeCompare(String(b.id));
  });
}

function layoutAtX(ordered, x, context) {
  const groundY = sceneGroundY(context);
  const heights = ordered.map((pumpkin) => dimensionsFor(pumpkin, context).height);
  const maxHeight = Math.max(...heights);
  const availableHeight = groundY - maxHeight;
  if (availableHeight < 0) return null;

  const desiredSteps = heights.slice(0, -1).reduce((total, height) => total + height * TOWER_STEP_RATIO, 0);
  const compression = desiredSteps > 0 ? Math.min(1, availableHeight / desiredSteps) : 1;
  const participants = [];
  let y = groundY;

  for (let index = 0; index < ordered.length; index += 1) {
    const pumpkin = ordered[index];
    if (!isPositionValid(pumpkin, x, y, context)) return null;
    participants.push({
      id: pumpkin.id,
      level: index,
      fromX: pumpkin.x,
      fromY: pumpkin.y,
      towerX: x,
      towerY: y,
    });
    if (index < ordered.length - 1) y -= heights[index] * TOWER_STEP_RATIO * compression;
  }

  return { participants, groundY, maxWidth: Math.max(...ordered.map((pumpkin) => dimensionsFor(pumpkin, context).width)) };
}

function candidateXs(ordered, context) {
  const maxWidth = Math.max(...ordered.map((pumpkin) => dimensionsFor(pumpkin, context).width));
  const minX = maxWidth / 2;
  const maxX = context.scene.width - minX;
  const step = Math.max(12, maxWidth / 3);
  const candidates = new Set([minX, maxX, context.scene.width / 2]);
  for (let x = minX; x <= maxX; x += step) candidates.add(Math.round(x * 100) / 100);

  const zone = context.noGoZone;
  if (zone?.enabled) {
    candidates.add(Math.max(minX, zone.x - maxWidth / 2 - context.scene.padding));
    candidates.add(Math.min(maxX, zone.x + zone.width + maxWidth / 2 + context.scene.padding));
  }
  return [...candidates].filter((x) => x >= minX && x <= maxX);
}

function chooseTowerLayout(ordered, context) {
  const layouts = candidateXs(ordered, context)
    .map((x) => ({ x, layout: layoutAtX(ordered, x, context) }))
    .filter(({ layout }) => layout);
  if (!layouts.length) return null;

  const maxWidth = Math.max(...ordered.map((pumpkin) => dimensionsFor(pumpkin, context).width));
  const minX = maxWidth / 2;
  const maxX = context.scene.width - minX;
  return layouts.sort((a, b) => {
    const aClearance = Math.min(a.x - minX, maxX - a.x);
    const bClearance = Math.min(b.x - minX, maxX - b.x);
    return bClearance - aClearance || Math.abs(a.x - context.scene.width / 2) - Math.abs(b.x - context.scene.width / 2);
  })[0].layout;
}

function layoutIsValidAtX(ordered, x, context) {
  return Boolean(layoutAtX(ordered, x, context));
}

function horizontalClearance(ordered, x, direction, context, maxWidth) {
  const minX = maxWidth / 2;
  const maxX = context.scene.width - minX;
  const step = Math.max(4, maxWidth / 10);
  let cursor = x;
  let distance = 0;
  while (true) {
    const next = cursor + direction * step;
    if (next < minX || next > maxX || !layoutIsValidAtX(ordered, next, context)) break;
    cursor = next;
    distance += step;
  }
  return distance;
}

function targetsOverlap(candidate, pumpkin, occupied, context) {
  const candidateWidth = dimensionsFor(pumpkin, context).width;
  return occupied.some(({ x, pumpkin: other }) => Math.abs(x - candidate) < (candidateWidth + dimensionsFor(other, context).width) / 2);
}

function safeTarget(pumpkin, x, groundY, context, occupied) {
  if (!isPositionValid(pumpkin, x, groundY, context) || targetsOverlap(x, pumpkin, occupied, context)) return null;
  return { id: pumpkin.id, x, y: groundY };
}

function randomTargetFor(pumpkin, range, groundY, context, occupied, random) {
  const [minX, maxX] = range;
  if (maxX < minX) return null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = minX + (maxX - minX) * unitRandom(random);
    const target = safeTarget(pumpkin, x, groundY, context, occupied);
    if (target) return target;
  }

  const step = Math.max(8, dimensionsFor(pumpkin, context).width / 3);
  for (let x = minX; x <= maxX; x += step) {
    const target = safeTarget(pumpkin, x, groundY, context, occupied);
    if (target) return target;
  }
  return null;
}

function rollTargets(ordered, anchorX, direction, context, random, groundY, maxWidth) {
  const minX = maxWidth / 2;
  const maxX = context.scene.width - minX;
  const preferred = direction < 0 ? [minX, Math.max(minX, anchorX)] : [Math.min(maxX, anchorX), maxX];
  const occupied = [];
  const finalPositions = [];

  for (const pumpkin of ordered) {
    const target = randomTargetFor(pumpkin, preferred, groundY, context, occupied, random)
      || randomTargetFor(pumpkin, [minX, maxX], groundY, context, occupied, random);
    if (!target) return null;
    occupied.push({ x: target.x, pumpkin });
    finalPositions.push(target);
  }
  return finalPositions;
}

export function topplingProbability(count) {
  if (count < MIN_TOPPLE_COUNT) return 0;
  return Math.min(0.85, 0.18 + (count - MIN_TOPPLE_COUNT) * 0.1);
}

export function buildTowerPlan(pumpkins, context, random = Math.random) {
  const ordered = orderedPumpkins(pumpkins);
  if (!ordered.length) return { mode: 'empty', participants: [], finalPositions: [] };

  const layout = chooseTowerLayout(ordered, context);
  if (!layout) return null;

  const anchorX = layout.participants[0].towerX;
  const maxWidth = layout.maxWidth;
  const count = ordered.length;
  const sway = Math.min(12, 2 + count * 1.2);
  const toppling = unitRandom(random) < topplingProbability(count);
  if (!toppling) {
    return {
      mode: 'tower',
      direction: null,
      sway,
      groundY: layout.groundY,
      participants: layout.participants,
      finalPositions: layout.participants.map(({ id, towerX, towerY }) => ({ id, x: towerX, y: towerY })),
    };
  }

  const leftSpace = horizontalClearance(ordered, anchorX, -1, context, maxWidth);
  const rightSpace = horizontalClearance(ordered, anchorX, 1, context, maxWidth);
  const direction = leftSpace === rightSpace ? (unitRandom(random) < 0.5 ? -1 : 1) : (leftSpace > rightSpace ? -1 : 1);
  const finalPositions = rollTargets(ordered, anchorX, direction, context, random, layout.groundY, maxWidth);
  if (!finalPositions) return null;

  const finalById = new Map(finalPositions.map((position) => [position.id, position]));
  return {
    mode: 'topple',
    direction: direction < 0 ? 'left' : 'right',
    sway,
    groundY: layout.groundY,
    participants: layout.participants.map((participant, index) => ({
      ...participant,
      finalX: finalById.get(participant.id).x,
      finalY: finalById.get(participant.id).y,
      rollDelayMs: (ordered.length - index - 1) * 100,
    })),
    finalPositions,
  };
}

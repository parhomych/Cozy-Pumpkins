import { finiteNumber } from '../utils/normalize.js';

// The shared SVG uses the supplied 1095 x 1095 artwork in a 220 logical-pixel
// square. Keep the server-side geometry in lockstep with the stage transforms
// in pumpkin-svg.js without making the artwork's viewBox part of the scene
// coordinate system.
export const REFERENCE_ARTWORK_SIZE = 1095;
export const REFERENCE_DISPLAY_SIZE = 220;
export const STAGE_SCALES = Object.freeze([0.58, 0.82, 1, 1.12]);

export function dimensionsFor(pumpkin = {}) {
  const rawStage = Number(pumpkin.stage);
  const stage = Number.isFinite(rawStage) ? Math.max(1, Math.min(4, Math.round(rawStage))) : 1;
  const stageScale = STAGE_SCALES[stage - 1];
  const size = REFERENCE_ARTWORK_SIZE * (REFERENCE_DISPLAY_SIZE / REFERENCE_ARTWORK_SIZE) * stageScale;
  return { width: size, height: size };
}

function artworkBounds(pumpkin, x = pumpkin.x, y = pumpkin.y) {
  const size = dimensionsFor(pumpkin);
  return { left: x - size.width / 2, right: x + size.width / 2, top: y - size.height, bottom: y };
}
export function normalizeZone(zone, scene) {
  if (!zone || zone.enabled === false) return { enabled: false, x: 0, y: 0, width: 0, height: 0 };
  const x = finiteNumber(zone.x, { min: 0, max: scene.width }); const y = finiteNumber(zone.y, { min: 0, max: scene.height });
  const width = finiteNumber(zone.width, { min: 0, max: scene.width }); const height = finiteNumber(zone.height, { min: 0, max: scene.height });
  if ([x, y, width, height].some((value) => value === null)) throw new Error('No-Go Zone has invalid geometry');
  if (x + width > scene.width || y + height > scene.height) throw new Error('No-Go Zone must fit inside the scene');
  return { enabled: true, x, y, width, height };
}
export function pumpkinBounds(pumpkin, x = pumpkin.x, y = pumpkin.y, scene) {
  const size = dimensionsFor(pumpkin); const padding = scene.padding;
  return { left: x - size.width / 2 - padding, right: x + size.width / 2 + padding, top: y - size.height - padding, bottom: y + padding };
}
export function rectanglesOverlap(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
export function isPositionValid(pumpkin, x, y, { scene, noGoZone }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const artwork = artworkBounds(pumpkin, x, y);
  const bounds = pumpkinBounds(pumpkin, x, y, scene);
  // The artwork itself may meet the horizontal scene edges. Keep the vertical
  // ground/padding limits and the padded bounds used for No-Go Zone protection.
  if (artwork.left < 0 || artwork.right > scene.width || bounds.top < 0 || bounds.bottom > scene.height) return false;
  if (noGoZone?.enabled) {
    const zone = { left: noGoZone.x, right: noGoZone.x + noGoZone.width, top: noGoZone.y, bottom: noGoZone.y + noGoZone.height };
    if (rectanglesOverlap(bounds, zone)) return false;
  }
  return true;
}
export function clampPosition(pumpkin, x, y, context) {
  const { scene } = context; const size = dimensionsFor(pumpkin); const padding = scene.padding;
  const minX = size.width / 2; const maxX = scene.width - minX;
  const minY = size.height + padding; const maxY = scene.height - padding;
  let candidate = { x: Math.max(minX, Math.min(maxX, Number(x) || minX)), y: Math.max(minY, Math.min(maxY, Number(y) || maxY)) };
  if (isPositionValid(pumpkin, candidate.x, candidate.y, context)) return candidate;
  const z = context.noGoZone;
  if (z?.enabled) {
    const options = [
      { x: z.x - size.width / 2 - padding, y: candidate.y }, { x: z.x + z.width + size.width / 2 + padding, y: candidate.y },
      { x: candidate.x, y: z.y - padding }, { x: candidate.x, y: z.y + z.height + size.height + padding },
    ].map((p) => ({ x: Math.max(minX, Math.min(maxX, p.x)), y: Math.max(minY, Math.min(maxY, p.y)) })).filter((p) => isPositionValid(pumpkin, p.x, p.y, context));
    if (options.length) return options.sort((a, b) => ((a.x - x) ** 2 + (a.y - y) ** 2) - ((b.x - x) ** 2 + (b.y - y) ** 2))[0];
  }
  return { x: Math.max(minX, Math.min(maxX, candidate.x)), y: maxY };
}
export function findSpawnPosition(pumpkin, pumpkins, context) {
  const size = dimensionsFor(pumpkin); const y = context.scene.groundY ?? context.scene.height - context.scene.padding; const step = size.width + context.scene.padding;
  for (let x = size.width / 2; x <= context.scene.width - size.width / 2; x += step) {
    if (isPositionValid(pumpkin, x, y, context) && !pumpkins.some((other) => rectanglesOverlap(artworkBounds(pumpkin, x, y), artworkBounds(other)))) return { x, y };
  }
  return clampPosition(pumpkin, context.scene.width / 2, y, context);
}
export function validateParentLink(id, parentId, pumpkins, maxHeight = 3) {
  if (parentId == null) return { valid: true, height: 1 };
  if (id === parentId) return { valid: false, reason: 'cannot_stack_on_self' };
  const byId = new Map(pumpkins.map((p) => [p.id, p])); let current = parentId; let height = 1; const seen = new Set([id]);
  while (current) { if (seen.has(current)) return { valid: false, reason: 'stack_cycle' }; seen.add(current); const parent = byId.get(current); if (!parent) return { valid: false, reason: 'parent_not_found' }; height += 1; if (height > maxHeight) return { valid: false, reason: 'stack_too_high' }; current = parent.parentId; }
  return { valid: true, height };
}
export function relocateInvalidPumpkins(pumpkins, context) { return pumpkins.map((p) => isPositionValid(p, p.x, p.y, context) ? null : { id: p.id, ...clampPosition(p, p.x, p.y, context) }).filter(Boolean); }

import { finiteNumber } from '../utils/normalize.js';

export const TOWER_ANIMATION_LIMITS = Object.freeze({
  swayAmplitude: { min: 0, max: 60 },
  swayDuration: { min: 0.1, max: 30 },
  rotationMultiplier: { min: 0, max: 5 },
  bendMultiplier: { min: 0, max: 5 },
});
export const DEFAULT_TOWER_ANIMATION = Object.freeze({
  swayAmplitude: 12,
  swayDuration: 2,
  rotationMultiplier: 1,
  bendMultiplier: 1,
});
const KEYS = Object.freeze(Object.keys(DEFAULT_TOWER_ANIMATION));

export function sanitizeTowerAnimation(value, fallback = DEFAULT_TOWER_ANIMATION) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(KEYS.map((key) => [key, finiteNumber(source[key], TOWER_ANIMATION_LIMITS[key]) ?? finiteNumber(fallback?.[key], TOWER_ANIMATION_LIMITS[key]) ?? DEFAULT_TOWER_ANIMATION[key]]));
}

export function towerAnimationPatch(value, current = DEFAULT_TOWER_ANIMATION) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !KEYS.some((key) => value[key] !== undefined)) return null;
  if (KEYS.some((key) => value[key] !== undefined && finiteNumber(value[key], TOWER_ANIMATION_LIMITS[key]) === null)) return null;
  return sanitizeTowerAnimation(value, current);
}

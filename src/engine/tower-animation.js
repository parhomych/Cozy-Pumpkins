import { finiteNumber } from '../utils/normalize.js';

export const TOWER_ANIMATION_LIMITS = Object.freeze({
  swayAmplitude: { min: 0, max: 60 },
  swayDuration: { min: 0.1, max: 30 },
  rotationMultiplier: { min: 0, max: 5 },
  bendMultiplier: { min: 0, max: 5 },
  lifetimeMinSeconds: { min: 1, max: 300 },
  lifetimeMaxSeconds: { min: 1, max: 300 },
});
export const TOWER_STACK_ORDERS = Object.freeze(['random', 'largest-first']);
export const DEFAULT_TOWER_ANIMATION = Object.freeze({
  swayAmplitude: 12,
  swayDuration: 2,
  rotationMultiplier: 1,
  bendMultiplier: 1,
  lifetimeMinSeconds: 3,
  lifetimeMaxSeconds: 6,
  stackOrder: 'random',
});
const KEYS = Object.freeze(Object.keys(DEFAULT_TOWER_ANIMATION));
const NUMERIC_KEYS = Object.freeze(KEYS.filter((key) => key !== 'stackOrder'));

export function sanitizeTowerAnimation(value, fallback = DEFAULT_TOWER_ANIMATION) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sanitized = Object.fromEntries(NUMERIC_KEYS.map((key) => [key, finiteNumber(source[key], TOWER_ANIMATION_LIMITS[key]) ?? finiteNumber(fallback?.[key], TOWER_ANIMATION_LIMITS[key]) ?? DEFAULT_TOWER_ANIMATION[key]]));
  sanitized.stackOrder = TOWER_STACK_ORDERS.includes(source.stackOrder)
    ? source.stackOrder
    : TOWER_STACK_ORDERS.includes(fallback?.stackOrder) ? fallback.stackOrder : DEFAULT_TOWER_ANIMATION.stackOrder;
  if (sanitized.lifetimeMinSeconds > sanitized.lifetimeMaxSeconds) sanitized.lifetimeMaxSeconds = sanitized.lifetimeMinSeconds;
  return sanitized;
}

export function towerAnimationPatch(value, current = DEFAULT_TOWER_ANIMATION) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !KEYS.some((key) => value[key] !== undefined)) return null;
  if (NUMERIC_KEYS.some((key) => value[key] !== undefined && finiteNumber(value[key], TOWER_ANIMATION_LIMITS[key]) === null)) return null;
  if (value.stackOrder !== undefined && !TOWER_STACK_ORDERS.includes(value.stackOrder)) return null;
  const candidate = { ...current, ...value };
  if (candidate.lifetimeMinSeconds > candidate.lifetimeMaxSeconds) return null;
  return sanitizeTowerAnimation(candidate, current);
}

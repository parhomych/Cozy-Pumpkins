import { finiteNumber } from '../utils/normalize.js';

export const NEIGHBOR_STACK_ANIMATION_LIMITS = Object.freeze({
  swayAmplitude: { min: 0, max: 60 },
  swayDuration: { min: 0.1, max: 30 },
  rotationMultiplier: { min: 0, max: 5 },
  bendMultiplier: { min: 0, max: 5 },
  lifetimeMinSeconds: { min: 30, max: 300 },
  lifetimeMaxSeconds: { min: 30, max: 300 },
});

export const DEFAULT_NEIGHBOR_STACK_ANIMATION = Object.freeze({
  swayAmplitude: 12,
  swayDuration: 2,
  rotationMultiplier: 1,
  bendMultiplier: 1,
  lifetimeMinSeconds: 30,
  lifetimeMaxSeconds: 300,
});

const KEYS = Object.freeze(Object.keys(DEFAULT_NEIGHBOR_STACK_ANIMATION));

export function sanitizeNeighborStackAnimation(value, fallback = DEFAULT_NEIGHBOR_STACK_ANIMATION) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sanitized = Object.fromEntries(KEYS.map((key) => [
    key,
    finiteNumber(source[key], NEIGHBOR_STACK_ANIMATION_LIMITS[key])
      ?? finiteNumber(fallback?.[key], NEIGHBOR_STACK_ANIMATION_LIMITS[key])
      ?? DEFAULT_NEIGHBOR_STACK_ANIMATION[key],
  ]));
  if (sanitized.lifetimeMinSeconds > sanitized.lifetimeMaxSeconds) {
    sanitized.lifetimeMaxSeconds = sanitized.lifetimeMinSeconds;
  }
  return sanitized;
}

export function neighborStackAnimationPatch(value, current = DEFAULT_NEIGHBOR_STACK_ANIMATION) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !KEYS.some((key) => value[key] !== undefined)) return null;
  if (KEYS.some((key) => value[key] !== undefined && finiteNumber(value[key], NEIGHBOR_STACK_ANIMATION_LIMITS[key]) === null)) return null;
  const candidate = { ...current, ...value };
  if (candidate.lifetimeMinSeconds > candidate.lifetimeMaxSeconds) return null;
  return sanitizeNeighborStackAnimation(candidate, current);
}

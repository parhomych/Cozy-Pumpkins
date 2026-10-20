import { finiteNumber } from '../utils/normalize.js';

export const ANIMATION_LIMITS = Object.freeze({ min: 0.1, max: 10 });
export const DEFAULT_ANIMATION = Object.freeze({ eyeFrequency: 1, mouthFrequency: 1 });
const ANIMATION_KEYS = Object.freeze(['eyeFrequency', 'mouthFrequency']);

export function sanitizeAnimation(value, fallback = DEFAULT_ANIMATION) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const safeFallback = {
    eyeFrequency: finiteNumber(fallback?.eyeFrequency, ANIMATION_LIMITS) ?? DEFAULT_ANIMATION.eyeFrequency,
    mouthFrequency: finiteNumber(fallback?.mouthFrequency, ANIMATION_LIMITS) ?? DEFAULT_ANIMATION.mouthFrequency,
  };
  return Object.fromEntries(ANIMATION_KEYS.map((key) => [
    key,
    finiteNumber(source[key], ANIMATION_LIMITS) ?? safeFallback[key],
  ]));
}

export function isValidAnimation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ANIMATION_KEYS.every((key) => finiteNumber(value[key], ANIMATION_LIMITS) !== null);
}

export function animationPatch(value, current = DEFAULT_ANIMATION) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!ANIMATION_KEYS.some((key) => value[key] !== undefined)) return null;
  for (const key of ANIMATION_KEYS) {
    if (value[key] !== undefined && finiteNumber(value[key], ANIMATION_LIMITS) === null) return null;
  }
  return sanitizeAnimation(value, current);
}

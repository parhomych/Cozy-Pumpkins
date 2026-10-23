import { finiteNumber } from '../utils/normalize.js';

export const ROAMING_LIMITS = Object.freeze({
  roamingIntervalSeconds: { min: 1, max: 60 },
  roamingSpeed: { min: 40, max: 400 },
  roamingJumpHeight: { min: 20, max: 300 },
  roamingMinDistance: { min: 30, max: 1800 },
  roamingMaxDistance: { min: 30, max: 1800 },
});

export const DEFAULT_ROAMING_SETTINGS = Object.freeze({
  roamingIntervalSeconds: 5,
  roamingSpeed: 140,
  roamingJumpHeight: 60,
  roamingMinDistance: 30,
  roamingMaxDistance: 240,
});

export function roamingSettingsPatch(value = {}, current = DEFAULT_ROAMING_SETTINGS) {
  const patch = {};
  for (const [key, limits] of Object.entries(ROAMING_LIMITS)) {
    if (value[key] === undefined) continue;
    const number = finiteNumber(value[key], limits);
    if (number === null || (key !== 'roamingSpeed' && !Number.isInteger(number))) {
      throw new Error(`invalid_${key}`);
    }
    patch[key] = number;
  }
  const next = { ...current, ...patch };
  if (next.roamingMinDistance > next.roamingMaxDistance) {
    throw new Error('invalid_roaming_distance_range');
  }
  return patch;
}

import { finiteNumber } from '../utils/normalize.js';

export const ROAMING_LIMITS = Object.freeze({
  roamingIntervalSeconds: { min: 1, max: 60 },
  roamingSpeed: { min: 40, max: 400 },
});

export const DEFAULT_ROAMING_SETTINGS = Object.freeze({
  roamingIntervalSeconds: 5,
  roamingSpeed: 140,
});

export function roamingSettingsPatch(value = {}) {
  const patch = {};
  for (const [key, limits] of Object.entries(ROAMING_LIMITS)) {
    if (value[key] === undefined) continue;
    const number = finiteNumber(value[key], limits);
    if (number === null || (key === 'roamingIntervalSeconds' && !Number.isInteger(number))) {
      throw new Error(`invalid_${key}`);
    }
    patch[key] = number;
  }
  return patch;
}

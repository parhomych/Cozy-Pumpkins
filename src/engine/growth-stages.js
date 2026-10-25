export const DEFAULT_GROWTH_STAGES = Object.freeze({ stage2: true, stage3: false, stage4: true });

export function validateGrowthStages(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_growth_stages');
  const keys = Object.keys(input);
  const expected = Object.keys(DEFAULT_GROWTH_STAGES);
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))
    || !expected.every((key) => typeof input[key] === 'boolean')) {
    throw new Error('invalid_growth_stages');
  }
  return Object.fromEntries(expected.map((key) => [key, input[key]]));
}

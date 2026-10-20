export const MAX_SPAWN_COMMAND_LENGTH = 64;

export function validateGrowthThresholds(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_growth_thresholds');
  const keys = Object.keys(input);
  if (keys.length !== 3 || !['stage2', 'stage3', 'stage4'].every((key) => keys.includes(key))) {
    throw new Error('invalid_growth_thresholds');
  }
  const { stage2, stage3, stage4 } = input;
  if (![stage2, stage3, stage4].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || !(stage2 < stage3 && stage3 < stage4)) {
    throw new Error('invalid_growth_thresholds');
  }
  return { stage2, stage3, stage4 };
}

export function validateSpawnSettings(input = {}) {
  const patch = {};
  if (input.minSpawnDonation !== undefined) {
    if (typeof input.minSpawnDonation !== 'number' || !Number.isFinite(input.minSpawnDonation) || input.minSpawnDonation < 0) {
      throw new Error('invalid_min_spawn_donation');
    }
    patch.minSpawnDonation = input.minSpawnDonation;
  }
  if (input.spawnCommand !== undefined) {
    if (typeof input.spawnCommand !== 'string') throw new Error('invalid_spawn_command');
    const command = input.spawnCommand.normalize('NFKC').trim();
    if (!command || command.length > MAX_SPAWN_COMMAND_LENGTH || /[\r\n\0]/u.test(command)) {
      throw new Error('invalid_spawn_command');
    }
    patch.spawnCommand = command;
  }
  return patch;
}

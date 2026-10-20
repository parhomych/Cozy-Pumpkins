export const MAX_SPAWN_COMMAND_LENGTH = 64;

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

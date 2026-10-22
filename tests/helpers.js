import crypto from 'node:crypto';
import { Database } from '../src/db/database.js';
import { loadConfig } from '../src/config.js';

export function testConfig(overrides = {}) {
  return loadConfig({ loadDotenv: false, env: {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3001',
    SESSION_SECRET: 'test-session-secret', TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    PUMPKIN_CURRENCY: 'RUB', SCENE_WIDTH: '1920', SCENE_HEIGHT: '1080', GROUND_Y: '1080', PUMPKIN_PADDING: '65',
    ...overrides,
  } });
}

export function testDatabase(config = testConfig()) {
  const db = new Database(':memory:');
  db.getSettings(config);
  return db;
}

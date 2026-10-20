import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function numberFromEnv(env, name, fallback, { integer = false, min = -Infinity } = {}) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a valid ${integer ? 'integer' : 'number'} >= ${min}`);
  }
  return value;
}

export function loadConfig({ env = process.env, loadDotenv = true } = {}) {
  if (loadDotenv) dotenv.config();
  const sceneWidth = numberFromEnv(env, 'SCENE_WIDTH', 1920, { integer: true, min: 1 });
  const sceneHeight = numberFromEnv(env, 'SCENE_HEIGHT', 1080, { integer: true, min: 1 });
  const databasePath = path.resolve(PROJECT_ROOT, env.DATABASE_PATH || './data/cozy-pumpkins.sqlite');
  const nodeEnv = env.NODE_ENV || 'development';
  const sessionSecret = env.SESSION_SECRET || (nodeEnv === 'production' ? (() => { throw new Error('SESSION_SECRET is required in production'); })() : crypto.randomBytes(32).toString('hex'));
  const tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY || (nodeEnv === 'production' ? (() => { throw new Error('TOKEN_ENCRYPTION_KEY is required in production'); })() : crypto.randomBytes(32).toString('hex'));
  return {
    nodeEnv,
    host: env.HOST || '127.0.0.1',
    port: numberFromEnv(env, 'PORT', 3000, { integer: true, min: 1 }),
    sessionSecret,
    tokenEncryptionKey,
    databasePath,
    scene: {
      width: sceneWidth,
      height: sceneHeight,
      groundY: numberFromEnv(env, 'GROUND_Y', 980, { min: 0 }),
      padding: numberFromEnv(env, 'PUMPKIN_PADDING', 65, { min: 0 }),
    },
    pumpkinCurrency: (env.PUMPKIN_CURRENCY || 'RUB').trim().toUpperCase(),
    thresholds: {
      stage2: numberFromEnv(env, 'STAGE_2_THRESHOLD', 300, { min: 0 }),
      stage3: numberFromEnv(env, 'STAGE_3_THRESHOLD', 1000, { min: 0 }),
      stage4: numberFromEnv(env, 'STAGE_4_THRESHOLD', 3000, { min: 0 }),
    },
    twitch: {
      clientId: env.TWITCH_CLIENT_ID || '',
      clientSecret: env.TWITCH_CLIENT_SECRET || '',
      redirectUri: env.TWITCH_REDIRECT_URI || 'http://localhost:3000/api/auth/twitch/callback',
      rewardIds: {
        inflate: env.TWITCH_REWARD_INFLATE_ID || '',
        jump_on: env.TWITCH_REWARD_JUMP_ON_ID || '',
        morph_fly: env.TWITCH_REWARD_MORPH_FLY_ID || '',
        bat: env.TWITCH_REWARD_BAT_ID || '',
        ghost: env.TWITCH_REWARD_GHOST_ID || '',
      },
    },
    donationalerts: {
      clientId: env.DA_CLIENT_ID || '',
      clientSecret: env.DA_CLIENT_SECRET || '',
      redirectUri: env.DA_REDIRECT_URI || 'http://localhost:3000/api/auth/donationalerts/callback',
    },
    donatex: {
      clientId: env.DONATEX_CLIENT_ID || '',
      clientSecret: env.DONATEX_CLIENT_SECRET || '',
      redirectUri: env.DONATEX_REDIRECT_URI || 'http://localhost:3000/api/auth/donatex/callback',
    },
    memealerts: {
      clientId: env.MEMEALERTS_CLIENT_ID || '',
      clientSecret: env.MEMEALERTS_CLIENT_SECRET || '',
      redirectUri: env.MEMEALERTS_REDIRECT_URI || 'http://localhost:3000/api/auth/memealerts/callback',
    },
  };
}

export function publicConfig(config) {
  return { scene: config.scene, pumpkinCurrency: config.pumpkinCurrency, thresholds: config.thresholds };
}

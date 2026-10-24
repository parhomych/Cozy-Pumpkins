import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { DEFAULT_ANIMATION, sanitizeAnimation } from '../engine/animation.js';
import { validateSpawnSettings, validateGrowthThresholds, validateGrowthMultipliers, DEFAULT_GROWTH_MULTIPLIERS } from '../engine/donation-settings.js';
import { DEFAULT_TOWER_ANIMATION, sanitizeTowerAnimation } from '../engine/tower-animation.js';
import { DEFAULT_PUMPKIN_NAME_FONT_SIZE, pumpkinNameFontSize } from '../engine/pumpkin-name-settings.js';
import { DEFAULT_GROWTH_STAGES, validateGrowthStages } from '../engine/growth-stages.js';
import { DEFAULT_ROAMING_SETTINGS } from '../engine/roaming-settings.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const DEFAULT_ZONE = { enabled: false, x: 0, y: 0, width: 0, height: 0 };
const DEFAULT_GROWTH_THRESHOLDS = Object.freeze({ stage2: 300, stage3: 1000, stage4: 3000 });
function rowToPumpkin(row) {
  if (!row) return null;
  let customization = {};
  try { customization = JSON.parse(row.customization_json); } catch { /* old/corrupt row */ }
  return {
    id: row.id, ownerKey: row.owner_key, ownerNormalized: row.owner_normalized, displayName: row.display_name,
    showDisplayName: row.show_display_name === undefined ? true : Boolean(row.show_display_name),
    twitchUserId: row.twitch_user_id || null, twitchUsername: row.twitch_username || null,
    totalDonated: row.total_donated, currency: row.currency, stage: row.stage, x: row.x, y: row.y,
    isAirborne: Boolean(row.is_airborne), parentId: row.parent_id || null,
    stackOffsetY: row.stack_offset_y == null ? null : row.stack_offset_y, customization,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function parsed(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

export class Database {
  constructor(databasePath = ':memory:', { sqlite = BetterSqlite3 } = {}) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.sqlite = new sqlite(databasePath);
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.exec(fs.readFileSync(schemaPath, 'utf8'));
    this.legacyAnimation = DEFAULT_ANIMATION;
    this.migrateSchema();
  }
  migrateSchema() {
    this.sqlite.transaction(() => {
      let settingsColumns = new Set(this.sqlite.prepare('PRAGMA table_info(settings)').all().map((column) => column.name));
      const addedSettingsAnimation = !settingsColumns.has('animation_json');
      if (!settingsColumns.has('customization_reward_mode')) this.sqlite.exec("ALTER TABLE settings ADD COLUMN customization_reward_mode TEXT NOT NULL DEFAULT 'single' CHECK(customization_reward_mode IN ('single', 'all'))");
      if (!settingsColumns.has('ground_y_overridden')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN ground_y_overridden INTEGER NOT NULL DEFAULT 0 CHECK(ground_y_overridden IN (0, 1))');
      if (addedSettingsAnimation) this.sqlite.exec(`ALTER TABLE settings ADD COLUMN animation_json TEXT NOT NULL DEFAULT '{"eyeFrequency":1,"mouthFrequency":1}'`);
      if (!settingsColumns.has('tower_animation_json')) this.sqlite.exec(`ALTER TABLE settings ADD COLUMN tower_animation_json TEXT NOT NULL DEFAULT '{"swayAmplitude":12,"swayDuration":2,"rotationMultiplier":1,"bendMultiplier":1,"lifetimeMinSeconds":3,"lifetimeMaxSeconds":6,"stackOrder":"random"}'`);
      if (!settingsColumns.has('min_spawn_donation')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN min_spawn_donation REAL NOT NULL DEFAULT 0 CHECK(min_spawn_donation >= 0)');
      if (!settingsColumns.has('spawn_command')) this.sqlite.exec("ALTER TABLE settings ADD COLUMN spawn_command TEXT NOT NULL DEFAULT '!тыковка'");
      if (!settingsColumns.has('growth_thresholds_json')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN growth_thresholds_json TEXT');
      if (!settingsColumns.has('growth_stages_json')) this.sqlite.exec(`ALTER TABLE settings ADD COLUMN growth_stages_json TEXT NOT NULL DEFAULT '{"stage2":true,"stage3":true,"stage4":true}'`);
      if (!settingsColumns.has('growth_multipliers_json')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN growth_multipliers_json TEXT');
      if (!settingsColumns.has('roaming_interval_seconds')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN roaming_interval_seconds REAL NOT NULL DEFAULT 5');
      if (!settingsColumns.has('roaming_speed')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN roaming_speed REAL NOT NULL DEFAULT 140');
      if (!settingsColumns.has('roaming_jump_height')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN roaming_jump_height REAL NOT NULL DEFAULT 60');
      if (!settingsColumns.has('roaming_min_distance')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN roaming_min_distance REAL NOT NULL DEFAULT 30');
      if (!settingsColumns.has('roaming_max_distance')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN roaming_max_distance REAL NOT NULL DEFAULT 240');
      if (!settingsColumns.has('show_pumpkin_names')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN show_pumpkin_names INTEGER NOT NULL DEFAULT 1 CHECK(show_pumpkin_names IN (0, 1))');
      if (!settingsColumns.has('pumpkin_name_font_size')) this.sqlite.exec('ALTER TABLE settings ADD COLUMN pumpkin_name_font_size INTEGER NOT NULL DEFAULT 14 CHECK(pumpkin_name_font_size BETWEEN 8 AND 48)');

      // Older uncommitted builds stored animation on each pumpkin. Preserve the
      // first valid value as the initial scene setting, then remove that column.
      const pumpkinColumns = new Set(this.sqlite.prepare('PRAGMA table_info(pumpkins)').all().map((column) => column.name));
      if (!pumpkinColumns.has('show_display_name')) this.sqlite.exec('ALTER TABLE pumpkins ADD COLUMN show_display_name INTEGER NOT NULL DEFAULT 1 CHECK(show_display_name IN (0, 1))');
      if (pumpkinColumns.has('animation_json')) {
        const legacy = this.sqlite.prepare('SELECT animation_json FROM pumpkins WHERE animation_json IS NOT NULL ORDER BY created_at, id LIMIT 1').get();
        if (legacy?.animation_json) this.legacyAnimation = sanitizeAnimation(parsed(legacy.animation_json, DEFAULT_ANIMATION));
        if (addedSettingsAnimation) this.sqlite.prepare('UPDATE settings SET animation_json = ? WHERE id = 1').run(JSON.stringify(this.legacyAnimation));
        this.sqlite.exec('ALTER TABLE pumpkins DROP COLUMN animation_json');
      }

      const tokenSchema = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_tokens'").get()?.sql || '';
      if (!tokenSchema.includes("'donatex'") || !tokenSchema.includes("'memealerts'")) {
        this.sqlite.exec(`ALTER TABLE auth_tokens RENAME TO auth_tokens_legacy;
          CREATE TABLE auth_tokens (
            provider TEXT PRIMARY KEY CHECK(provider IN ('twitch', 'donationalerts', 'donatex', 'memealerts')),
            access_token_enc TEXT NOT NULL, refresh_token_enc TEXT, expires_at INTEGER,
            scopes TEXT NOT NULL DEFAULT '', provider_user_id TEXT, provider_login TEXT, updated_at TEXT NOT NULL
          );
          INSERT INTO auth_tokens (provider, access_token_enc, refresh_token_enc, expires_at, scopes, provider_user_id, provider_login, updated_at)
          SELECT provider, access_token_enc, refresh_token_enc, expires_at, scopes, provider_user_id, provider_login, updated_at FROM auth_tokens_legacy;
          DROP TABLE auth_tokens_legacy;`);
      }

      const donationColumns = new Set(this.sqlite.prepare('PRAGMA table_info(donations)').all().map((column) => column.name));
      const donationSchema = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'donations'").get()?.sql || '';
      if (!donationColumns.has('provider') || !donationSchema.includes('PRIMARY KEY (provider, event_id)')) {
        this.sqlite.exec(`ALTER TABLE donations RENAME TO donations_legacy;
          CREATE TABLE donations (
            provider TEXT NOT NULL DEFAULT 'donationalerts' CHECK(provider IN ('donationalerts', 'donatex', 'memealerts')),
            event_id TEXT NOT NULL, owner_key TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL, processed_at TEXT NOT NULL,
            PRIMARY KEY (provider, event_id)
          );
          INSERT OR IGNORE INTO donations (provider, event_id, owner_key, amount, currency, message, received_at, processed_at)
          SELECT 'donationalerts', event_id, owner_key, amount, currency, message, received_at, processed_at FROM donations_legacy;
          DROP TABLE donations_legacy;`);
      }
    })();
  }
  close() { this.sqlite.close(); }
  transaction(fn) { return this.sqlite.transaction(fn)(); }

  getSettings(defaults = { scene: { groundY: 1080 }, pumpkinCurrency: 'RUB', twitch: { rewardIds: {} }, thresholds: DEFAULT_GROWTH_THRESHOLDS, growthMultipliers: DEFAULT_GROWTH_MULTIPLIERS }) {
    const row = this.sqlite.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (!row) {
       const value = { groundY: defaults.scene.groundY, noGoZone: { ...DEFAULT_ZONE }, showPumpkinNames: true, pumpkinNameFontSize: DEFAULT_PUMPKIN_NAME_FONT_SIZE, pumpkinCurrency: defaults.pumpkinCurrency, rewardMapping: { ...defaults.twitch.rewardIds }, customizationRewardMode: 'single', minSpawnDonation: 0, spawnCommand: '!тыковка', ...DEFAULT_ROAMING_SETTINGS, growthThresholds: validateGrowthThresholds(defaults.thresholds || DEFAULT_GROWTH_THRESHOLDS), growthStages: { ...DEFAULT_GROWTH_STAGES }, growthMultipliers: validateGrowthMultipliers(defaults.growthMultipliers || DEFAULT_GROWTH_MULTIPLIERS), animation: sanitizeAnimation(this.legacyAnimation, defaults.animation || DEFAULT_ANIMATION), towerAnimation: sanitizeTowerAnimation(defaults.towerAnimation || DEFAULT_TOWER_ANIMATION) };
       this.sqlite.prepare(`INSERT INTO settings (id, ground_y, ground_y_overridden, no_go_zone_json, show_pumpkin_names, pumpkin_name_font_size, pumpkin_currency, reward_mapping_json, min_spawn_donation, spawn_command, roaming_interval_seconds, roaming_speed, roaming_jump_height, roaming_min_distance, roaming_max_distance, growth_thresholds_json, growth_stages_json, growth_multipliers_json, animation_json, tower_animation_json, updated_at) VALUES (1, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.groundY, JSON.stringify(value.noGoZone), Number(value.showPumpkinNames), value.pumpkinNameFontSize, value.pumpkinCurrency, JSON.stringify(value.rewardMapping), value.minSpawnDonation, value.spawnCommand, value.roamingIntervalSeconds, value.roamingSpeed, value.roamingJumpHeight, value.roamingMinDistance, value.roamingMaxDistance, JSON.stringify(value.growthThresholds), JSON.stringify(value.growthStages), JSON.stringify(value.growthMultipliers), JSON.stringify(value.animation), JSON.stringify(value.towerAnimation), new Date().toISOString());
      return value;
    }
    const configuredGroundY = Number.isFinite(Number(defaults.scene?.groundY)) ? Number(defaults.scene.groundY) : row.ground_y;
    const groundY = row.ground_y_overridden ? row.ground_y : configuredGroundY;
    let updatedAt = row.updated_at;
    if (row.ground_y !== groundY) {
      updatedAt = new Date().toISOString();
      this.sqlite.prepare('UPDATE settings SET ground_y = ?, updated_at = ? WHERE id = 1').run(groundY, updatedAt);
    }
    const storedGrowthThresholds = parsed(row.growth_thresholds_json, null);
    const growthThresholds = storedGrowthThresholds === null
      ? validateGrowthThresholds(defaults.thresholds || DEFAULT_GROWTH_THRESHOLDS)
      : validateGrowthThresholds(storedGrowthThresholds);
    const storedGrowthMultipliers = parsed(row.growth_multipliers_json, null);
    const growthMultipliers = storedGrowthMultipliers === null
      ? validateGrowthMultipliers(defaults.growthMultipliers || DEFAULT_GROWTH_MULTIPLIERS)
      : validateGrowthMultipliers(storedGrowthMultipliers);
    return { groundY, noGoZone: parsed(row.no_go_zone_json, DEFAULT_ZONE), showPumpkinNames: Boolean(row.show_pumpkin_names), pumpkinNameFontSize: pumpkinNameFontSize(row.pumpkin_name_font_size) ?? DEFAULT_PUMPKIN_NAME_FONT_SIZE, pumpkinCurrency: row.pumpkin_currency, rewardMapping: parsed(row.reward_mapping_json, {}), customizationRewardMode: row.customization_reward_mode === 'all' ? 'all' : 'single', minSpawnDonation: row.min_spawn_donation, spawnCommand: row.spawn_command, roamingIntervalSeconds: row.roaming_interval_seconds, roamingSpeed: row.roaming_speed, roamingJumpHeight: row.roaming_jump_height, roamingMinDistance: row.roaming_min_distance, roamingMaxDistance: row.roaming_max_distance, growthThresholds, growthStages: validateGrowthStages(parsed(row.growth_stages_json, DEFAULT_GROWTH_STAGES)), growthMultipliers, animation: sanitizeAnimation(parsed(row.animation_json, DEFAULT_ANIMATION), defaults.animation || DEFAULT_ANIMATION), towerAnimation: sanitizeTowerAnimation(parsed(row.tower_animation_json, DEFAULT_TOWER_ANIMATION), defaults.towerAnimation || DEFAULT_TOWER_ANIMATION), updatedAt };
  }
  updateSettings(patch, defaults = { scene: { groundY: 1080 }, pumpkinCurrency: 'RUB', twitch: { rewardIds: {} }, thresholds: DEFAULT_GROWTH_THRESHOLDS, growthMultipliers: DEFAULT_GROWTH_MULTIPLIERS }) {
    const current = this.getSettings(defaults);
    const growthPatch = patch.growthThresholds === undefined ? {} : { growthThresholds: validateGrowthThresholds(patch.growthThresholds) };
    const stagesPatch = patch.growthStages === undefined ? {} : { growthStages: validateGrowthStages(patch.growthStages) };
    const multiplierPatch = patch.growthMultipliers === undefined ? {} : { growthMultipliers: validateGrowthMultipliers(patch.growthMultipliers) };
    if (patch.showPumpkinNames !== undefined && typeof patch.showPumpkinNames !== 'boolean') throw new Error('invalid_show_pumpkin_names');
    if (patch.customizationRewardMode !== undefined && !['single', 'all'].includes(patch.customizationRewardMode)) throw new Error('invalid_customization_reward_mode');
    const next = { ...current, ...patch, ...growthPatch, ...stagesPatch, ...multiplierPatch, ...validateSpawnSettings(patch) };
    if (patch.pumpkinNameFontSize !== undefined) {
      next.pumpkinNameFontSize = pumpkinNameFontSize(patch.pumpkinNameFontSize);
      if (next.pumpkinNameFontSize === null) throw new Error('invalid_pumpkin_name_font_size');
    }
    next.animation = sanitizeAnimation(next.animation, defaults.animation || DEFAULT_ANIMATION);
    next.towerAnimation = sanitizeTowerAnimation(next.towerAnimation, defaults.towerAnimation || DEFAULT_TOWER_ANIMATION);
    const storedGrowthThresholds = patch.growthThresholds === undefined
      ? this.sqlite.prepare('SELECT growth_thresholds_json FROM settings WHERE id = 1').get()?.growth_thresholds_json ?? null
      : JSON.stringify(next.growthThresholds);
    const storedGrowthStages = patch.growthStages === undefined
      ? this.sqlite.prepare('SELECT growth_stages_json FROM settings WHERE id = 1').get()?.growth_stages_json ?? null
      : JSON.stringify(next.growthStages);
    const storedGrowthMultipliers = patch.growthMultipliers === undefined
      ? this.sqlite.prepare('SELECT growth_multipliers_json FROM settings WHERE id = 1').get()?.growth_multipliers_json ?? null
      : JSON.stringify(next.growthMultipliers);
    const groundYOverridden = patch.groundY === undefined
      ? this.sqlite.prepare('SELECT ground_y_overridden FROM settings WHERE id = 1').get()?.ground_y_overridden ?? 0
      : 1;
    this.sqlite.prepare('UPDATE settings SET ground_y = ?, ground_y_overridden = ?, no_go_zone_json = ?, show_pumpkin_names = ?, pumpkin_name_font_size = ?, pumpkin_currency = ?, reward_mapping_json = ?, customization_reward_mode = ?, min_spawn_donation = ?, spawn_command = ?, roaming_interval_seconds = ?, roaming_speed = ?, roaming_jump_height = ?, roaming_min_distance = ?, roaming_max_distance = ?, growth_thresholds_json = ?, growth_stages_json = ?, growth_multipliers_json = ?, animation_json = ?, tower_animation_json = ?, updated_at = ? WHERE id = 1').run(next.groundY, groundYOverridden, JSON.stringify(next.noGoZone), Number(next.showPumpkinNames), next.pumpkinNameFontSize, next.pumpkinCurrency, JSON.stringify(next.rewardMapping), next.customizationRewardMode, next.minSpawnDonation, next.spawnCommand, next.roamingIntervalSeconds, next.roamingSpeed, next.roamingJumpHeight, next.roamingMinDistance, next.roamingMaxDistance, storedGrowthThresholds, storedGrowthStages, storedGrowthMultipliers, JSON.stringify(next.animation), JSON.stringify(next.towerAnimation), new Date().toISOString());
    return this.getSettings(defaults);
  }

  listPumpkins() { return this.sqlite.prepare('SELECT * FROM pumpkins ORDER BY created_at, id').all().map(rowToPumpkin); }
  getPumpkin(id) { return rowToPumpkin(this.sqlite.prepare('SELECT * FROM pumpkins WHERE id = ?').get(id)); }
  findPumpkinByOwner(ownerKey) { return rowToPumpkin(this.sqlite.prepare('SELECT * FROM pumpkins WHERE owner_key = ?').get(ownerKey)); }
  findPumpkinByTwitch(userId, login) {
    const matches = userId
      ? this.sqlite.prepare('SELECT * FROM pumpkins WHERE twitch_user_id = ?').all(userId)
      : login
        ? this.sqlite.prepare('SELECT * FROM pumpkins WHERE twitch_username = ? COLLATE NOCASE').all(login)
        : [];
    return matches.length === 1 ? rowToPumpkin(matches[0]) : null;
  }
  insertPumpkin(pumpkin) {
    this.sqlite.prepare(`INSERT INTO pumpkins (id, owner_key, owner_normalized, display_name, show_display_name, twitch_user_id, twitch_username, total_donated, currency, stage, x, y, is_airborne, parent_id, stack_offset_y, customization_json, created_at, updated_at) VALUES (@id, @ownerKey, @ownerNormalized, @displayName, @showDisplayName, @twitchUserId, @twitchUsername, @totalDonated, @currency, @stage, @x, @y, @isAirborne, @parentId, @stackOffsetY, @customization, @createdAt, @updatedAt)`).run({ ...pumpkin, showDisplayName: pumpkin.showDisplayName === false ? 0 : 1, twitchUserId: pumpkin.twitchUserId || null, twitchUsername: pumpkin.twitchUsername || null, isAirborne: pumpkin.isAirborne ? 1 : 0, customization: JSON.stringify(pumpkin.customization) });
    return this.getPumpkin(pumpkin.id);
  }
  updatePumpkin(id, patch) {
    const fields = []; const values = {}; const map = { ownerKey: 'owner_key', ownerNormalized: 'owner_normalized', displayName: 'display_name', showDisplayName: 'show_display_name', twitchUserId: 'twitch_user_id', twitchUsername: 'twitch_username', totalDonated: 'total_donated', currency: 'currency', stage: 'stage', x: 'x', y: 'y', isAirborne: 'is_airborne', parentId: 'parent_id', stackOffsetY: 'stack_offset_y' };
    for (const [key, column] of Object.entries(map)) if (patch[key] !== undefined) { fields.push(`${column} = @${key}`); values[key] = patch[key]; }
    if (patch.customization !== undefined) { fields.push('customization_json = @customization'); values.customization = JSON.stringify(patch.customization); }
    if (!fields.length) return this.getPumpkin(id);
    fields.push('updated_at = @updatedAt'); values.updatedAt = new Date().toISOString(); values.id = id;
    if (patch.isAirborne !== undefined) values.isAirborne = patch.isAirborne ? 1 : 0;
    if (patch.showDisplayName !== undefined) {
      if (typeof patch.showDisplayName !== 'boolean') throw new Error('invalid_show_display_name');
      values.showDisplayName = Number(patch.showDisplayName);
    }
    this.sqlite.prepare(`UPDATE pumpkins SET ${fields.join(', ')} WHERE id = @id`).run(values);
    return this.getPumpkin(id);
  }
  deletePumpkin(id) { return this.sqlite.prepare('DELETE FROM pumpkins WHERE id = ?').run(id).changes > 0; }
  clearPumpkins() { return this.sqlite.prepare('DELETE FROM pumpkins').run().changes; }
  insertDonation(event) {
    const provider = event.provider || 'donationalerts';
    if (!['donationalerts', 'donatex', 'memealerts'].includes(provider)) throw new Error('unsupported_donation_provider');
    return this.sqlite.prepare(`INSERT OR IGNORE INTO donations (provider, event_id, owner_key, amount, currency, message, received_at, processed_at) VALUES (@provider, @eventId, @ownerKey, @amount, @currency, @message, @receivedAt, @processedAt)`).run({ ...event, provider }).changes === 1;
  }
  insertRedemption(event) { return this.sqlite.prepare(`INSERT OR IGNORE INTO redemptions (redemption_id, reward_id, user_id, user_login, input, status, received_at, processed_at) VALUES (@redemptionId, @rewardId, @userId, @userLogin, @input, @status, @receivedAt, @processedAt)`).run(event).changes === 1; }
  saveToken(provider, token) { this.sqlite.prepare(`INSERT INTO auth_tokens (provider, access_token_enc, refresh_token_enc, expires_at, scopes, provider_user_id, provider_login, updated_at) VALUES (@provider, @accessTokenEnc, @refreshTokenEnc, @expiresAt, @scopes, @providerUserId, @providerLogin, @updatedAt) ON CONFLICT(provider) DO UPDATE SET access_token_enc=@accessTokenEnc, refresh_token_enc=@refreshTokenEnc, expires_at=@expiresAt, scopes=@scopes, provider_user_id=@providerUserId, provider_login=@providerLogin, updated_at=@updatedAt`).run({ provider, ...token, refreshTokenEnc: token.refreshTokenEnc || null, expiresAt: token.expiresAt || null, scopes: token.scopes || '', providerUserId: token.providerUserId || null, providerLogin: token.providerLogin || null, updatedAt: new Date().toISOString() }); }
  getToken(provider) { return this.sqlite.prepare('SELECT * FROM auth_tokens WHERE provider = ?').get(provider) || null; }
  deleteToken(provider) { this.sqlite.prepare('DELETE FROM auth_tokens WHERE provider = ?').run(provider); }
}
export { rowToPumpkin, DEFAULT_ZONE };

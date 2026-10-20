import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { DEFAULT_ANIMATION, sanitizeAnimation } from '../engine/animation.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const DEFAULT_ZONE = { enabled: false, x: 0, y: 0, width: 0, height: 0 };
function rowToPumpkin(row) {
  if (!row) return null;
  let customization = {};
  try { customization = JSON.parse(row.customization_json); } catch { /* old/corrupt row */ }
  return {
    id: row.id, ownerKey: row.owner_key, ownerNormalized: row.owner_normalized, displayName: row.display_name,
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
    const settingsColumns = new Set(this.sqlite.prepare('PRAGMA table_info(settings)').all().map((column) => column.name));
    const addedSettingsAnimation = !settingsColumns.has('animation_json');
    if (addedSettingsAnimation) this.sqlite.exec(`ALTER TABLE settings ADD COLUMN animation_json TEXT NOT NULL DEFAULT '{"eyeFrequency":1,"mouthFrequency":1}'`);

    // Older uncommitted builds stored animation on each pumpkin. Preserve the
    // first valid value as the initial scene setting, then remove that column.
    const pumpkinColumns = new Set(this.sqlite.prepare('PRAGMA table_info(pumpkins)').all().map((column) => column.name));
    if (pumpkinColumns.has('animation_json')) {
      const legacy = this.sqlite.prepare('SELECT animation_json FROM pumpkins WHERE animation_json IS NOT NULL ORDER BY created_at, id LIMIT 1').get();
      if (legacy?.animation_json) this.legacyAnimation = sanitizeAnimation(parsed(legacy.animation_json, DEFAULT_ANIMATION));
      if (addedSettingsAnimation) this.sqlite.prepare('UPDATE settings SET animation_json = ? WHERE id = 1').run(JSON.stringify(this.legacyAnimation));
      this.sqlite.exec('ALTER TABLE pumpkins DROP COLUMN animation_json');
    }
  }
  close() { this.sqlite.close(); }
  transaction(fn) { return this.sqlite.transaction(fn)(); }

  getSettings(defaults = { scene: { groundY: 980 }, pumpkinCurrency: 'RUB', twitch: { rewardIds: {} } }) {
    const row = this.sqlite.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (!row) {
      const value = { groundY: defaults.scene.groundY, noGoZone: { ...DEFAULT_ZONE }, pumpkinCurrency: defaults.pumpkinCurrency, rewardMapping: { ...defaults.twitch.rewardIds }, animation: sanitizeAnimation(this.legacyAnimation, defaults.animation || DEFAULT_ANIMATION) };
      this.sqlite.prepare(`INSERT INTO settings (id, ground_y, no_go_zone_json, pumpkin_currency, reward_mapping_json, animation_json, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)`).run(value.groundY, JSON.stringify(value.noGoZone), value.pumpkinCurrency, JSON.stringify(value.rewardMapping), JSON.stringify(value.animation), new Date().toISOString());
      return value;
    }
    return { groundY: row.ground_y, noGoZone: parsed(row.no_go_zone_json, DEFAULT_ZONE), pumpkinCurrency: row.pumpkin_currency, rewardMapping: parsed(row.reward_mapping_json, {}), animation: sanitizeAnimation(parsed(row.animation_json, DEFAULT_ANIMATION), defaults.animation || DEFAULT_ANIMATION), updatedAt: row.updated_at };
  }
  updateSettings(patch, defaults = { scene: { groundY: 980 }, pumpkinCurrency: 'RUB', twitch: { rewardIds: {} } }) {
    const current = this.getSettings(defaults); const next = { ...current, ...patch };
    next.animation = sanitizeAnimation(next.animation, defaults.animation || DEFAULT_ANIMATION);
    this.sqlite.prepare('UPDATE settings SET ground_y = ?, no_go_zone_json = ?, pumpkin_currency = ?, reward_mapping_json = ?, animation_json = ?, updated_at = ? WHERE id = 1').run(next.groundY, JSON.stringify(next.noGoZone), next.pumpkinCurrency, JSON.stringify(next.rewardMapping), JSON.stringify(next.animation), new Date().toISOString());
    return this.getSettings(defaults);
  }

  listPumpkins() { return this.sqlite.prepare('SELECT * FROM pumpkins ORDER BY created_at, id').all().map(rowToPumpkin); }
  getPumpkin(id) { return rowToPumpkin(this.sqlite.prepare('SELECT * FROM pumpkins WHERE id = ?').get(id)); }
  findPumpkinByOwner(ownerKey) { return rowToPumpkin(this.sqlite.prepare('SELECT * FROM pumpkins WHERE owner_key = ?').get(ownerKey)); }
  findPumpkinByTwitch(userId, login) {
    if (userId) { const row = this.sqlite.prepare('SELECT * FROM pumpkins WHERE twitch_user_id = ?').get(userId); if (row) return rowToPumpkin(row); }
    return login ? rowToPumpkin(this.sqlite.prepare('SELECT * FROM pumpkins WHERE twitch_username = ? COLLATE NOCASE').get(login)) : null;
  }
  insertPumpkin(pumpkin) {
    this.sqlite.prepare(`INSERT INTO pumpkins (id, owner_key, owner_normalized, display_name, twitch_user_id, twitch_username, total_donated, currency, stage, x, y, is_airborne, parent_id, stack_offset_y, customization_json, created_at, updated_at) VALUES (@id, @ownerKey, @ownerNormalized, @displayName, @twitchUserId, @twitchUsername, @totalDonated, @currency, @stage, @x, @y, @isAirborne, @parentId, @stackOffsetY, @customization, @createdAt, @updatedAt)`).run({ ...pumpkin, twitchUserId: pumpkin.twitchUserId || null, twitchUsername: pumpkin.twitchUsername || null, isAirborne: pumpkin.isAirborne ? 1 : 0, customization: JSON.stringify(pumpkin.customization) });
    return this.getPumpkin(pumpkin.id);
  }
  updatePumpkin(id, patch) {
    const fields = []; const values = {}; const map = { ownerKey: 'owner_key', ownerNormalized: 'owner_normalized', displayName: 'display_name', twitchUserId: 'twitch_user_id', twitchUsername: 'twitch_username', totalDonated: 'total_donated', currency: 'currency', stage: 'stage', x: 'x', y: 'y', isAirborne: 'is_airborne', parentId: 'parent_id', stackOffsetY: 'stack_offset_y' };
    for (const [key, column] of Object.entries(map)) if (patch[key] !== undefined) { fields.push(`${column} = @${key}`); values[key] = patch[key]; }
    if (patch.customization !== undefined) { fields.push('customization_json = @customization'); values.customization = JSON.stringify(patch.customization); }
    if (!fields.length) return this.getPumpkin(id);
    fields.push('updated_at = @updatedAt'); values.updatedAt = new Date().toISOString(); values.id = id;
    if (patch.isAirborne !== undefined) values.isAirborne = patch.isAirborne ? 1 : 0;
    this.sqlite.prepare(`UPDATE pumpkins SET ${fields.join(', ')} WHERE id = @id`).run(values);
    return this.getPumpkin(id);
  }
  deletePumpkin(id) { return this.sqlite.prepare('DELETE FROM pumpkins WHERE id = ?').run(id).changes > 0; }
  clearPumpkins() { return this.sqlite.prepare('DELETE FROM pumpkins').run().changes; }
  insertDonation(event) { return this.sqlite.prepare(`INSERT OR IGNORE INTO donations (event_id, owner_key, amount, currency, message, received_at, processed_at) VALUES (@eventId, @ownerKey, @amount, @currency, @message, @receivedAt, @processedAt)`).run(event).changes === 1; }
  insertRedemption(event) { return this.sqlite.prepare(`INSERT OR IGNORE INTO redemptions (redemption_id, reward_id, user_id, user_login, input, status, received_at, processed_at) VALUES (@redemptionId, @rewardId, @userId, @userLogin, @input, @status, @receivedAt, @processedAt)`).run(event).changes === 1; }
  saveToken(provider, token) { this.sqlite.prepare(`INSERT INTO auth_tokens (provider, access_token_enc, refresh_token_enc, expires_at, scopes, provider_user_id, provider_login, updated_at) VALUES (@provider, @accessTokenEnc, @refreshTokenEnc, @expiresAt, @scopes, @providerUserId, @providerLogin, @updatedAt) ON CONFLICT(provider) DO UPDATE SET access_token_enc=@accessTokenEnc, refresh_token_enc=@refreshTokenEnc, expires_at=@expiresAt, scopes=@scopes, provider_user_id=@providerUserId, provider_login=@providerLogin, updated_at=@updatedAt`).run({ provider, ...token, refreshTokenEnc: token.refreshTokenEnc || null, expiresAt: token.expiresAt || null, scopes: token.scopes || '', providerUserId: token.providerUserId || null, providerLogin: token.providerLogin || null, updatedAt: new Date().toISOString() }); }
  getToken(provider) { return this.sqlite.prepare('SELECT * FROM auth_tokens WHERE provider = ?').get(provider) || null; }
  deleteToken(provider) { this.sqlite.prepare('DELETE FROM auth_tokens WHERE provider = ?').run(provider); }
}
export { rowToPumpkin, DEFAULT_ZONE };

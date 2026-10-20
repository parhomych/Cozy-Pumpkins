PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS pumpkins (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL UNIQUE, owner_normalized TEXT NOT NULL, display_name TEXT NOT NULL,
  twitch_user_id TEXT, twitch_username TEXT, total_donated REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 1 CHECK(stage BETWEEN 1 AND 4), x REAL NOT NULL, y REAL NOT NULL,
  is_airborne INTEGER NOT NULL DEFAULT 0, parent_id TEXT REFERENCES pumpkins(id) ON DELETE SET NULL,
  stack_offset_y REAL, customization_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pumpkins_owner_name_idx ON pumpkins(owner_normalized);
CREATE INDEX IF NOT EXISTS pumpkins_twitch_id_idx ON pumpkins(twitch_user_id);
CREATE INDEX IF NOT EXISTS pumpkins_twitch_name_idx ON pumpkins(twitch_username);
CREATE TABLE IF NOT EXISTS donations (
  provider TEXT NOT NULL DEFAULT 'donationalerts' CHECK(provider IN ('donationalerts', 'donatex', 'memealerts')),
  event_id TEXT NOT NULL, owner_key TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL, processed_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);
CREATE TABLE IF NOT EXISTS redemptions (
  redemption_id TEXT PRIMARY KEY, reward_id TEXT NOT NULL, user_id TEXT, user_login TEXT,
  input TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), ground_y REAL NOT NULL, no_go_zone_json TEXT NOT NULL,
  pumpkin_currency TEXT NOT NULL, reward_mapping_json TEXT NOT NULL,
  min_spawn_donation REAL NOT NULL DEFAULT 0 CHECK(min_spawn_donation >= 0),
  spawn_command TEXT NOT NULL DEFAULT '!тыковка',
  growth_thresholds_json TEXT,
  animation_json TEXT NOT NULL DEFAULT '{"eyeFrequency":1,"mouthFrequency":1}', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  provider TEXT PRIMARY KEY CHECK(provider IN ('twitch', 'donationalerts', 'donatex', 'memealerts')), access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT, expires_at INTEGER, scopes TEXT NOT NULL DEFAULT '', provider_user_id TEXT,
  provider_login TEXT, updated_at TEXT NOT NULL
);

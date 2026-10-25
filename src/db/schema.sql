PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS pumpkins (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL UNIQUE, owner_normalized TEXT NOT NULL, display_name TEXT NOT NULL,
  show_display_name INTEGER NOT NULL DEFAULT 1 CHECK(show_display_name IN (0, 1)),
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
CREATE TABLE IF NOT EXISTS joined_stacks (
  stack_id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS joined_stack_members (
  stack_id TEXT NOT NULL REFERENCES joined_stacks(stack_id) ON DELETE CASCADE,
  pumpkin_id TEXT NOT NULL REFERENCES pumpkins(id) ON DELETE CASCADE,
  member_order INTEGER NOT NULL CHECK(member_order >= 0),
  PRIMARY KEY(stack_id, pumpkin_id),
  UNIQUE(stack_id, member_order)
);
CREATE TRIGGER IF NOT EXISTS joined_stack_member_deleted
AFTER DELETE ON joined_stack_members
BEGIN
  DELETE FROM joined_stacks WHERE stack_id = OLD.stack_id;
END;
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), ground_y REAL NOT NULL, ground_y_overridden INTEGER NOT NULL DEFAULT 0 CHECK(ground_y_overridden IN (0, 1)), no_go_zone_json TEXT NOT NULL,
  show_pumpkin_names INTEGER NOT NULL DEFAULT 1 CHECK(show_pumpkin_names IN (0, 1)),
  pumpkin_name_font_size INTEGER NOT NULL DEFAULT 14 CHECK(pumpkin_name_font_size BETWEEN 8 AND 48),
  pumpkin_currency TEXT NOT NULL, reward_mapping_json TEXT NOT NULL,
  customization_reward_mode TEXT NOT NULL DEFAULT 'single' CHECK(customization_reward_mode IN ('single', 'all')),
  min_spawn_donation REAL NOT NULL DEFAULT 0 CHECK(min_spawn_donation >= 0),
  spawn_command TEXT NOT NULL DEFAULT '!тыковка',
  growth_thresholds_json TEXT,
  growth_stages_json TEXT NOT NULL DEFAULT '{"stage2":true,"stage3":false,"stage4":true}',
  growth_multipliers_json TEXT,
  animation_json TEXT NOT NULL DEFAULT '{"eyeFrequency":1,"mouthFrequency":1}',
  tower_animation_json TEXT NOT NULL DEFAULT '{"swayAmplitude":12,"swayDuration":2,"rotationMultiplier":1,"bendMultiplier":1,"lifetimeMinSeconds":3,"lifetimeMaxSeconds":6,"stackOrder":"random"}',
  neighbor_stack_animation_json TEXT NOT NULL DEFAULT '{"swayAmplitude":12,"swayDuration":2,"rotationMultiplier":1,"bendMultiplier":1,"lifetimeMinSeconds":30,"lifetimeMaxSeconds":300}',
  roaming_interval_seconds REAL NOT NULL DEFAULT 5,
  roaming_speed REAL NOT NULL DEFAULT 140,
  roaming_jump_height REAL NOT NULL DEFAULT 60,
  roaming_min_distance REAL NOT NULL DEFAULT 30,
  roaming_max_distance REAL NOT NULL DEFAULT 240,
  landing_particles_json TEXT NOT NULL DEFAULT '{"enabled":true,"count":16,"size":1,"spread":1,"duration":1.5}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  provider TEXT PRIMARY KEY CHECK(provider IN ('twitch', 'donationalerts', 'donatex', 'memealerts')), access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT, expires_at INTEGER, scopes TEXT NOT NULL DEFAULT '', provider_user_id TEXT,
  provider_login TEXT, updated_at TEXT NOT NULL
);

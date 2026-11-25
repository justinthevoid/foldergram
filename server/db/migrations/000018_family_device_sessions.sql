-- migrate:up
CREATE TABLE IF NOT EXISTS family_device_sessions (
  session_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  device_label TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_device_sessions_member ON family_device_sessions(member_id, generation, expires_at);
CREATE INDEX IF NOT EXISTS idx_family_device_sessions_expiry ON family_device_sessions(expires_at);

-- migrate:down
DROP TABLE family_device_sessions;

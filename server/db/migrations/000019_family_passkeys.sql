-- migrate:up
CREATE TABLE IF NOT EXISTS family_passkeys (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  origin TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  device_label TEXT NOT NULL,
  credential_device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_family_passkeys_member ON family_passkeys(member_id, generation, origin);

-- migrate:down
DROP TABLE family_passkeys;

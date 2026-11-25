-- migrate:up
CREATE TABLE IF NOT EXISTS family_push_subscriptions (
  device_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  generation TEXT NOT NULL,
  origin TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  subscribed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_push_member ON family_push_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_family_push_session ON family_push_subscriptions(session_key);
CREATE TABLE IF NOT EXISTS family_push_ended_sessions (
  session_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_push_ended_expiry ON family_push_ended_sessions(expires_at);
CREATE TABLE IF NOT EXISTS family_release_seen (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  noticed_at INTEGER NOT NULL
);
-- Do not notify about the existing library when this feature is installed.
INSERT INTO family_release_seen(post_id,noticed_at)
SELECT p.id,CAST(strftime('%s','now') AS INTEGER)*1000+999
FROM posts p LEFT JOIN post_publications r ON r.post_id=p.id
WHERE r.post_id IS NULL OR r.published_at<=CAST(strftime('%s','now') AS INTEGER)*1000;

-- migrate:down
DROP TABLE family_release_seen;
DROP TABLE family_push_subscriptions;
DROP TABLE family_push_ended_sessions;

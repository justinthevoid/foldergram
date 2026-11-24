-- migrate:up
CREATE TABLE IF NOT EXISTS family_reactions (
  post_id INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, member_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_family_reactions_member ON family_reactions(member_id, created_at DESC, post_id DESC);

-- migrate:down
DROP TABLE family_reactions;

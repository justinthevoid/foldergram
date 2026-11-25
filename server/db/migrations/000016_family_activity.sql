-- migrate:up
CREATE TABLE IF NOT EXISTS family_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('like','comment')),
  member_id TEXT NOT NULL,
  comment_id INTEGER REFERENCES family_comments(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  CHECK((kind='like' AND comment_id IS NULL) OR (kind='comment' AND comment_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_activity_like ON family_activity(post_id,member_id) WHERE kind='like';
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_activity_comment ON family_activity(comment_id) WHERE kind='comment';
CREATE INDEX IF NOT EXISTS idx_family_activity_unread ON family_activity(id DESC) WHERE read_at IS NULL;

CREATE TRIGGER IF NOT EXISTS family_activity_new_like AFTER INSERT ON family_reactions
BEGIN
  INSERT INTO family_activity(post_id,kind,member_id,created_at)
  VALUES(NEW.post_id,'like',NEW.member_id,CAST(strftime('%s',NEW.created_at) AS INTEGER)*1000);
END;
CREATE TRIGGER IF NOT EXISTS family_activity_remove_like AFTER DELETE ON family_reactions
BEGIN
  DELETE FROM family_activity WHERE kind='like' AND post_id=OLD.post_id AND member_id=OLD.member_id;
END;
CREATE TRIGGER IF NOT EXISTS family_activity_new_comment AFTER INSERT ON family_comments
WHEN NEW.author_key <> 'admin'
BEGIN
  INSERT INTO family_activity(post_id,kind,member_id,comment_id,created_at)
  VALUES(NEW.post_id,'comment',NEW.author_key,NEW.id,NEW.created_at);
END;
INSERT INTO family_activity(post_id,kind,member_id,comment_id,created_at)
SELECT post_id,kind,member_id,comment_id,created_at FROM (
 SELECT post_id,'like' AS kind,member_id,NULL AS comment_id,CAST(strftime('%s',created_at) AS INTEGER)*1000 AS created_at FROM family_reactions
 UNION ALL
 SELECT post_id,'comment',author_key,id,created_at FROM family_comments WHERE author_key <> 'admin'
) ORDER BY created_at,kind,post_id,member_id,comment_id;

-- migrate:down
DROP TRIGGER IF EXISTS family_activity_new_comment;
DROP TRIGGER IF EXISTS family_activity_remove_like;
DROP TRIGGER IF EXISTS family_activity_new_like;
DROP TABLE family_activity;

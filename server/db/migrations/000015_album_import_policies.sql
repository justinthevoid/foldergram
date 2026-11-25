-- migrate:up
CREATE TABLE IF NOT EXISTS album_import_policies (
  source_id INTEGER NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL,
  PRIMARY KEY(source_id, folder_path)
);

-- Only newly inserted posts inherit the primary album's draft default.
-- An ordinary upsert of an existing post never overwrites release state.
CREATE TRIGGER IF NOT EXISTS draft_new_post_in_selected_album
AFTER INSERT ON posts
WHEN EXISTS (
  SELECT 1 FROM folders f JOIN album_import_policies p
    ON p.source_id=f.source_id AND p.folder_path=f.folder_path
  WHERE f.id=NEW.folder_id AND f.role='normal'
)
BEGIN
  INSERT INTO post_publications(post_id,published_at,featured,updated_at)
  VALUES(NEW.id,NULL,0,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(post_id) DO NOTHING;
END;

-- migrate:down
DROP TRIGGER IF EXISTS draft_new_post_in_selected_album;
DROP TABLE album_import_policies;

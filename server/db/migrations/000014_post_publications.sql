-- migrate:up
CREATE TABLE IF NOT EXISTS post_publications (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  published_at INTEGER CHECK (published_at IS NULL OR published_at > 0),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_publications_time ON post_publications(published_at);

-- migrate:down
DROP TABLE post_publications;

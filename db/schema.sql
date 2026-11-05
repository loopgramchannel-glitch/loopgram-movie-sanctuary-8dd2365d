-- Cloudflare D1 schema (permanent store). Idempotent: safe to run again.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, created_at DESC);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_stats (
  post_id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, viewer)
);
CREATE INDEX IF NOT EXISTS idx_post_views_exp ON post_views(expires_at);
CREATE TABLE IF NOT EXISTS post_votes (
  post_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  vote INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, viewer)
);
CREATE TABLE IF NOT EXISTS stat_jobs_done (
  bid TEXT PRIMARY KEY,
  done_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(kind, run_after, locked_until);

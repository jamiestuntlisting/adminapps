-- Admin Apps — D1 schema.
-- Apply with:  npx wrangler d1 execute adminapps --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  prefs      TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  descr      TEXT NOT NULL DEFAULT '',
  icon       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS links_project_idx ON links(project_id);

-- Analytics metrics, synced from the Notion "Profiles Analytics" database.
-- Notion stays the source of truth; this is a cache so the app can render
-- fast and keep working when Notion is unreachable.
CREATE TABLE IF NOT EXISTS metrics (
  id          TEXT PRIMARY KEY,           -- Notion page id
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  value       REAL,
  query       TEXT NOT NULL DEFAULT '',   -- the SQL Notion stores for this metric
  notes       TEXT NOT NULL DEFAULT '',
  notion_url  TEXT NOT NULL DEFAULT '',
  history     TEXT NOT NULL DEFAULT '[]', -- JSON [{t,v}] parsed from Historical Record
  measured_at INTEGER,                    -- newest dated reading, ms
  sort_order  INTEGER NOT NULL DEFAULT 0,
  synced_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS metrics_category_idx ON metrics(category);

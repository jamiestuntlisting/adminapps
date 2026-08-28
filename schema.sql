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

-- Collection triggers: the Zapier catch hooks that go off and refresh the
-- numbers. Admin-entered in the UI, never committed to the repo.
CREATE TABLE IF NOT EXISTS collectors (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  auto       INTEGER NOT NULL DEFAULT 0,  -- include in the scheduled run
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

-- Who collected what, when, and whether they clicked it or the schedule did.
CREATE TABLE IF NOT EXISTS collection_runs (
  id             TEXT PRIMARY KEY,
  collector_id   TEXT,
  collector_name TEXT NOT NULL,
  trigger_kind   TEXT NOT NULL,           -- 'manual' | 'scheduled'
  actor          TEXT NOT NULL,           -- user name, or 'Schedule'
  status         TEXT NOT NULL,           -- 'ok' | 'error'
  detail         TEXT NOT NULL DEFAULT '',
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER
);

CREATE INDEX IF NOT EXISTS runs_started_idx ON collection_runs(started_at DESC);

-- Saved views over the metrics. Shared with the team, attributed to whoever
-- made them, like the link catalog.
CREATE TABLE IF NOT EXISTS views (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',  -- JSON: {display, categories, metricIds, sort}
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jornadas_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jornadas_invoices (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  size INTEGER NOT NULL CHECK (size >= 0),
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jornadas_invoices_event ON jornadas_invoices(event_id, uploaded_at);

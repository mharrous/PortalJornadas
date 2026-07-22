PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')) DEFAULT 'user',
  modules TEXT NOT NULL DEFAULT 'jornadas',
  email TEXT COLLATE NOCASE,
  entra_oid TEXT,
  entra_tenant_id TEXT,
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'entra')) DEFAULT 'local',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  last_login_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  external_session_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_entra_identity ON users(entra_tenant_id, entra_oid) WHERE entra_tenant_id IS NOT NULL AND entra_oid IS NOT NULL;

CREATE TABLE IF NOT EXISTS oidc_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oidc_states_expires_at ON oidc_states(expires_at);

CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY,
  episode_label TEXT NOT NULL,
  topic TEXT NOT NULL,
  guest TEXT NOT NULL DEFAULT '',
  recording_date TEXT,
  recording_status TEXT NOT NULL DEFAULT 'Pendiente',
  editing_status TEXT NOT NULL DEFAULT 'Pendiente',
  publication_status TEXT NOT NULL DEFAULT 'Pendiente',
  social_status TEXT NOT NULL DEFAULT 'Pendiente',
  press_status TEXT NOT NULL DEFAULT 'Pendiente',
  logos TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  cancelled INTEGER NOT NULL CHECK (cancelled IN (0, 1)) DEFAULT 0,
  cancel_reason TEXT NOT NULL DEFAULT '',
  source_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS podcast_schedule (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL DEFAULT '',
  episode_number TEXT NOT NULL DEFAULT '',
  week_label TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pendiente',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_podcast_episodes_cancelled ON podcast_episodes(cancelled);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_date ON podcast_episodes(recording_date);
CREATE INDEX IF NOT EXISTS idx_podcast_schedule_order ON podcast_schedule(sort_order);

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

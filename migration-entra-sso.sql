ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
ALTER TABLE users ADD COLUMN entra_oid TEXT;
ALTER TABLE users ADD COLUMN entra_tenant_id TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'entra')) DEFAULT 'local';
ALTER TABLE sessions ADD COLUMN external_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_entra_identity ON users(entra_tenant_id, entra_oid) WHERE entra_tenant_id IS NOT NULL AND entra_oid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id);

CREATE TABLE IF NOT EXISTS oidc_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oidc_states_expires_at ON oidc_states(expires_at);

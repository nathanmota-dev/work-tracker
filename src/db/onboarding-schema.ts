/**
 * Get started preferences and the integration diagnostics that passed. Both
 * live in the workspace database, so they survive restarts and backups.
 */
export const ONBOARDING_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS onboarding_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  hidden       INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  skipped_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_verifications (
  target      TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  checked_at  TEXT NOT NULL
);
`;

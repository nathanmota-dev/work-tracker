/**
 * Persistent preparation batches and their ordered items. An item keeps its
 * phase when the batch pauses or the item stops; see src/preparation/batch-state.ts.
 */
export const BATCH_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS preparation_batches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
  pause_reason TEXT CHECK (pause_reason IN ('user', 'restart')),
  provider TEXT NOT NULL,
  model TEXT,
  extra TEXT NOT NULL DEFAULT '',
  source_version TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preparation_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES preparation_batches(id),
  position INTEGER NOT NULL CHECK (position >= 1),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  application_id INTEGER REFERENCES applications(id),
  run_id TEXT REFERENCES application_runs(id),
  phase TEXT NOT NULL CHECK (phase IN ('queued', 'preparing', 'tailoring', 'compiling', 'ready_for_review', 'waiting_for_fill', 'filling', 'in_review', 'submitted')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_for_decision', 'waiting_for_sign_in', 'waiting_for_user', 'failed', 'interrupted', 'cancelled', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  holds_portal INTEGER NOT NULL DEFAULT 0 CHECK (holds_portal IN (0, 1)),
  options_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, position)
);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON preparation_batch_items(status, batch_id, position);
CREATE INDEX IF NOT EXISTS idx_batch_items_run ON preparation_batch_items(run_id);
CREATE TABLE IF NOT EXISTS preparation_batch_requests (
  request_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES preparation_batches(id),
  fingerprint TEXT NOT NULL
);
`;

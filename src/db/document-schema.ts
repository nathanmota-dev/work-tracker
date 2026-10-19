/** Immutable document inputs, explicit approvals and the PDF used by each application. */
export const DOCUMENT_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY REFERENCES pdf_artifacts(id),
  run_id TEXT NOT NULL UNIQUE REFERENCES application_runs(id),
  application_id INTEGER NOT NULL REFERENCES applications(id),
  pdf_hash TEXT NOT NULL,
  source_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT
);
CREATE TABLE IF NOT EXISTS application_documents (
  application_id INTEGER PRIMARY KEY REFERENCES applications(id),
  version_id TEXT NOT NULL REFERENCES document_versions(id),
  pdf_hash TEXT NOT NULL,
  used_at TEXT NOT NULL,
  submitted_at TEXT
);
`;

/**
 * Resume variants (schema v20): resumes generated once per role and stack, or
 * imported as ready PDFs, and reused across applications. A document version
 * made from a variant records it in `document_versions.variant_id`. Kept apart
 * so `schema.ts` stays within the file-size limit; see src/variants/.
 */
export const VARIANT_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS resume_variants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  role            TEXT NOT NULL CHECK (role IN ('frontend', 'backend', 'fullstack', 'other')),
  stacks_json     TEXT NOT NULL DEFAULT '[]',
  focus           TEXT CHECK (focus IS NULL OR length(focus) <= 1000),
  language        TEXT NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'pt', 'en')),
  origin          TEXT NOT NULL CHECK (origin IN ('generated', 'imported')),
  status          TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed', 'cancelled', 'interrupted', 'waiting_for_sign_in')),
  phase           TEXT,
  provider        TEXT,
  model           TEXT,
  error           TEXT,
  report          TEXT,
  source_version  TEXT,
  events_json     TEXT NOT NULL DEFAULT '[]',
  manifest_json   TEXT NOT NULL DEFAULT '{}',
  pdf_artifact_id TEXT REFERENCES pdf_artifacts(id),
  archived_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resume_variants_role ON resume_variants(archived_at, role);
`;

/** The saved resume a document version came from; null for a tailored version. */
export const VARIANT_COLUMNS: Record<string, Record<string, string>> = {
  document_versions: { variant_id: "TEXT REFERENCES resume_variants(id)" },
};

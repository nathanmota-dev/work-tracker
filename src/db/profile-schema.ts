/**
 * Profile sources (schema v19): the cached extraction of each PDF in the
 * profile folder, by content hash, and the user's decision for each conflict
 * between the data file and the LinkedIn export. Kept apart so `schema.ts`
 * stays within the file-size limit; see src/profile/.
 */
export const PROFILE_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS profile_imports (
  pdf_hash       TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('linkedin', 'reference')),
  file_name      TEXT NOT NULL,
  parser_version INTEGER NOT NULL,
  extracted_json TEXT,
  text           TEXT NOT NULL DEFAULT '',
  warnings_json  TEXT NOT NULL DEFAULT '[]',
  imported_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_choices (
  conflict_key  TEXT PRIMARY KEY,
  field         TEXT NOT NULL,
  chosen_source TEXT NOT NULL CHECK (chosen_source IN ('data', 'linkedin')),
  chosen_value  TEXT NOT NULL,
  decided_at    TEXT NOT NULL
);
`;

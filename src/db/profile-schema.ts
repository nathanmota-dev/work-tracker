/**
 * Profile sources (schema v19): the cached extraction of each PDF in the
 * profile folder, by content hash. `profile_choices` held decisions between
 * the data file and the LinkedIn export; the profile now has one structured
 * source, so nothing reads or writes it, and it stays only because removing a
 * table is an incompatible migration. Kept apart so `schema.ts` stays within
 * the file-size limit; see src/profile/.
 *
 * Answer autofill (schema v22): the last value each source filled into an empty
 * answer, so the catalog shows its origin and a value the user cleared is not
 * filled again until the source changes it.
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
CREATE TABLE IF NOT EXISTS answer_autofill (
  key        TEXT PRIMARY KEY,
  source     TEXT NOT NULL CHECK (source IN ('data', 'linkedin', 'resume')),
  value      TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

/**
 * Requirement gates (schema v17): the languages the user works in, their work
 * eligibility, and the stored check of each job (`jobs.gate_json`). Kept apart
 * so `schema.ts` stays within the file-size limit; see src/gates/.
 */
export const GATE_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS candidate_languages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  language     TEXT NOT NULL,
  language_key TEXT NOT NULL UNIQUE,
  level        TEXT NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gate_profile (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  eligibility TEXT CHECK (eligibility IN ('citizen_or_resident', 'needs_permission')),
  updated_at  TEXT NOT NULL
);
`;

/** Stored gate check of a job; null means "Not checked". */
export const GATE_COLUMNS: Record<string, Record<string, string>> = {
  jobs: { gate_json: "TEXT" },
};

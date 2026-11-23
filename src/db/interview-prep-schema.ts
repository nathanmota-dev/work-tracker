/**
 * Interview preparation packs written by the interview-prep skill. Each pack
 * belongs to one application and one stage, so earlier stages stay as history.
 */
export const INTERVIEW_PREP_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS interview_preps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  stage          TEXT NOT NULL,
  scheduled_at   TEXT,
  format         TEXT,
  interviewers   TEXT,
  body_md        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interview_preps_application ON interview_preps(application_id, created_at);
`;

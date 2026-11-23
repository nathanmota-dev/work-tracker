/**
 * Batch triage of saved roles: one row per job with its latest ranking result.
 * Scores are triage scores from the posting text only; Apply re-evaluates.
 */
export const RANKING_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS job_rankings (
  job_id               INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  status               TEXT NOT NULL CHECK (status IN ('scored', 'expired', 'unreachable', 'gave_up')),
  technical            INTEGER CHECK (technical BETWEEN 0 AND 100),
  experience           INTEGER CHECK (experience BETWEEN 0 AND 100),
  career               INTEGER CHECK (career BETWEEN 0 AND 100),
  overall              INTEGER CHECK (overall BETWEEN 0 AND 100),
  verdict              TEXT CHECK (verdict IN ('Strong Fit', 'Good Fit', 'Moderate Fit', 'Weak Fit', 'Poor Fit')),
  strengths_json       TEXT NOT NULL DEFAULT '[]',
  gaps_json            TEXT NOT NULL DEFAULT '[]',
  fetch_attempts       INTEGER NOT NULL DEFAULT 0 CHECK (fetch_attempts >= 0),
  first_unreachable_at TEXT,
  last_error           TEXT CHECK (last_error IS NULL OR length(last_error) <= 200),
  ranked_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_rankings_status ON job_rankings(status);
`;

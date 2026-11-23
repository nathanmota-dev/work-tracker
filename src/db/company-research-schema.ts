/**
 * Company research cache (schema v15). One row per normalized company name,
 * written by the interview-prep skill so later runs reuse the discovery work.
 * Kept apart from `companies`, which belongs to the recruiter flow and never expires.
 */
export const COMPANY_RESEARCH_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS company_research (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_key  TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  network_note TEXT,
  summary_md   TEXT
);
`;

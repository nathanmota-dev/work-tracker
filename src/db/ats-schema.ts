/**
 * ATS keyword scores (schema v21): how much of each job's keywords each resume
 * covers. A cache only: rows are recomputed on read when the job description,
 * the resume text or ATS_VERSION changes; see src/ats/.
 *
 * `document_key` is `variant:<id>`, `base:<sourceVersion>` or `document:<versionId>`.
 * `pdf_hash` is the hash of the PDF's extracted text, the input the score reads.
 */
export const ATS_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS ats_scores (
  job_id                INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  document_key          TEXT NOT NULL,
  description_hash      TEXT NOT NULL,
  pdf_hash              TEXT NOT NULL,
  ats_version           INTEGER NOT NULL,
  score                 INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  band                  TEXT CHECK (band IS NULL OR band IN ('strong', 'partial', 'weak')),
  matched_json          TEXT NOT NULL DEFAULT '[]',
  missing_json          TEXT NOT NULL DEFAULT '[]',
  required_missing_json TEXT NOT NULL DEFAULT '[]',
  computed_at           TEXT NOT NULL,
  PRIMARY KEY (job_id, document_key)
);
`;

-- Synthetic Work Tracker workspace as written by schema v2 (before the apply flow).
-- DDL reproduces v2 SCHEMA_SQL plus its additive columns; IDs are deliberately sparse.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE profile (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  username       TEXT,
  name           TEXT,
  headline       TEXT,
  location       TEXT,
  current_company TEXT,
  last_synced_at TEXT
);
CREATE TABLE profile_metrics (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at        TEXT NOT NULL,
  search_appearances INTEGER,
  profile_views      INTEGER,
  post_impressions   INTEGER,
  connections        INTEGER,
  score              INTEGER,
  breakdown_json     TEXT
);
CREATE TABLE companies (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  urn_id  TEXT,
  notes   TEXT
);
CREATE TABLE recruiters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  username       TEXT,
  company        TEXT,
  title          TEXT,
  location       TEXT,
  degree         TEXT,
  mutuals_json   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  date_contacted TEXT,
  accepted_at    TEXT,
  replied_at     TEXT,
  note           TEXT,
  source_skill   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (username, company)
);
CREATE TABLE jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_job_id  TEXT UNIQUE,
  title            TEXT,
  company_id       INTEGER REFERENCES companies(id),
  company_name     TEXT,
  location         TEXT,
  work_type        TEXT,
  comp             TEXT,
  fit              TEXT,
  requirements_json TEXT,
  status           TEXT NOT NULL DEFAULT 'saved',
  link             TEXT,
  scouted_at       TEXT NOT NULL DEFAULT (datetime('now'))
, archived_at TEXT);
CREATE TABLE application_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('applied', 'recruiter', 'technical', 'assessment', 'offer')),
  position INTEGER NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE applications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id           INTEGER REFERENCES jobs(id),
  resume_path      TEXT,
  cover_letter_path TEXT,
  report_path      TEXT,
  keyword_score    INTEGER,
  status           TEXT NOT NULL DEFAULT 'draft',
  applied_at       TEXT
, portal TEXT, external_url TEXT, fields_filled_json TEXT, unfilled_json TEXT, company_name TEXT, role_title TEXT, role_type TEXT CHECK (role_type IN ('front_end', 'back_end', 'full_stack')), stack_json TEXT, comp TEXT, company_url TEXT, notes TEXT, current_stage_id INTEGER REFERENCES application_stages(id), tracking_status TEXT CHECK (tracking_status IN ('active', 'archived')), archive_reason TEXT CHECK (archive_reason IN ('rejected', 'withdrawn', 'no_response', 'hired')), archived_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'moved', 'archived', 'reopened')),
  from_stage_id INTEGER REFERENCES application_stages(id),
  to_stage_id INTEGER NOT NULL REFERENCES application_stages(id),
  stage_name TEXT NOT NULL,
  stage_category TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  reason TEXT,
  note TEXT
);
CREATE TABLE applicant_answers (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  category   TEXT NOT NULL DEFAULT 'custom',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE interviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company       TEXT NOT NULL,
  job_id        INTEGER REFERENCES jobs(id),
  scheduled_at  TEXT,
  stage         TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  notes         TEXT
);
CREATE TABLE outreach_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recruiter_id INTEGER REFERENCES recruiters(id),
  body         TEXT,
  kind         TEXT NOT NULL DEFAULT 'connect',
  sent_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE outreach_attempts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  person_username       TEXT NOT NULL,          -- stable identity key
  person_name           TEXT,
  recruiter_id          INTEGER REFERENCES recruiters(id),  -- optional link to directory
  company_urn           TEXT NOT NULL,          -- SCOPING key (stable URN, not name)
  company_name          TEXT,
  job_id                TEXT,                   -- role context (block is company-wide)
  channel               TEXT,                   -- connect_note | message | inmail
  cost_credits          INTEGER NOT NULL DEFAULT 0,  -- 0 = free path, 1 = InMail credit spent
  credit_refunded       INTEGER NOT NULL DEFAULT 0,  -- 1 if InMail credit refunded (reply <90d)
  refund_eligible_until TEXT,                   -- sent_at + 90d (InMail only)
  message_body          TEXT,
  state                 TEXT NOT NULL DEFAULT 'queued',
  -- lifecycle: queued | invited | invite_ignored | accepted | followed_up
  --            | unresponsive | engaged | do_not_contact
  sent_at               TEXT,
  accepted_at           TEXT,
  first_msg_at          TEXT,
  followed_up_at        TEXT,
  replied_at            TEXT,
  withdrawn_at          TEXT,
  closed_at             TEXT,
  next_action_due       TEXT,                   -- when the tracker should act next
  block_until           TEXT,                   -- cooldown expiry for terminal blocks (NULL = permanent/none)
  reason                TEXT,                    -- human-readable note on terminal transitions
  source_skill          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE outreach_budget (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  plan                    TEXT,                  -- career | business | recruiter_lite | sales_navigator | none
  inmail_monthly_allotment INTEGER NOT NULL DEFAULT 0,
  inmail_rollover_cap     INTEGER NOT NULL DEFAULT 0,
  cycle_reset_day         INTEGER NOT NULL DEFAULT 1,
  credits_remaining       INTEGER NOT NULL DEFAULT 0,
  credits_used_this_cycle INTEGER NOT NULL DEFAULT 0,
  reserve_floor           INTEGER NOT NULL DEFAULT 0,
  last_synced             TEXT
);
CREATE TABLE activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL DEFAULT (datetime('now')),
  kind         TEXT NOT NULL,
  skill        TEXT,
  summary      TEXT,
  payload_json TEXT
);
CREATE INDEX idx_recruiters_status  ON recruiters(status);
CREATE INDEX idx_recruiters_company ON recruiters(company);
CREATE INDEX idx_jobs_status        ON jobs(status);
CREATE INDEX idx_metrics_captured   ON profile_metrics(captured_at);
CREATE INDEX idx_activity_ts        ON activity_log(ts);
CREATE INDEX idx_answers_category   ON applicant_answers(category);
CREATE INDEX idx_attempts_scope     ON outreach_attempts(person_username, company_urn);
CREATE INDEX idx_attempts_state     ON outreach_attempts(state);
CREATE INDEX idx_attempts_due       ON outreach_attempts(next_action_due);
CREATE INDEX idx_attempts_company   ON outreach_attempts(company_urn);
CREATE INDEX idx_applications_tracking ON applications(tracking_status, current_stage_id);
CREATE INDEX idx_application_events_history ON application_events(application_id, occurred_at, id);

INSERT INTO meta (key, value) VALUES ('schema_version', '2');
INSERT INTO companies (id, name, urn_id) VALUES (3, 'Example Corp', 'urn:li:company:1001'), (8, 'Sample Labs', NULL);
INSERT INTO jobs (id, linkedin_job_id, title, company_id, company_name, status, link, scouted_at, archived_at)
  VALUES (11, 'job-11', 'Backend Engineer', 3, 'Example Corp', 'applied', 'https://jobs.example.test/11', '2026-01-02T10:00:00Z', NULL),
         (17, 'job-17', 'Frontend Engineer', 8, 'Sample Labs', 'saved', NULL, '2026-01-05T10:00:00Z', '2026-02-01T10:00:00Z');
INSERT INTO application_stages (id, key, name, category, position, created_at, updated_at)
  VALUES (1, 'applied', 'Applied', 'applied', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         (2, 'recruiter', 'Recruiter interview', 'recruiter', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         (3, 'technical', 'Technical interview', 'technical', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         (4, 'offer', 'Offer', 'offer', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         (9, 'take_home', 'Take-home', 'assessment', 4, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');
INSERT INTO applications (id, job_id, resume_path, cover_letter_path, report_path, keyword_score, status, applied_at,
    company_name, role_title, current_stage_id, tracking_status, created_at, updated_at)
  VALUES (21, 11, '/fixture/artifacts/21/resume.pdf', '/fixture/artifacts/21/cover.pdf', '/fixture/artifacts/21/report.md', 87,
          'submitted', '2026-01-03T09:00:00Z', 'Example Corp', 'Backend Engineer', 9, 'active', '2026-01-03T09:00:00Z', '2026-01-10T09:00:00Z'),
         (34, NULL, NULL, NULL, NULL, NULL, 'draft', NULL, 'Sample Labs', 'Platform Engineer', 1, 'archived', '2026-01-04T09:00:00Z', '2026-01-04T09:00:00Z');
UPDATE applications SET archive_reason = 'withdrawn', archived_at = '2026-01-20T09:00:00Z' WHERE id = 34;
INSERT INTO application_events (id, application_id, event_type, from_stage_id, to_stage_id, stage_name, stage_category, occurred_at, reason)
  VALUES (100, 21, 'created', NULL, 1, 'Applied', 'applied', '2026-01-03T09:00:00Z', NULL),
         (101, 21, 'moved', 1, 9, 'Take-home', 'assessment', '2026-01-10T09:00:00Z', NULL),
         (102, 34, 'created', NULL, 1, 'Applied', 'applied', '2026-01-04T09:00:00Z', NULL),
         (103, 34, 'archived', 1, 1, 'Applied', 'applied', '2026-01-20T09:00:00Z', 'withdrawn');
INSERT INTO interviews (id, company, job_id, scheduled_at, stage, status) VALUES (5, 'Example Corp', 11, '2026-01-15T14:00:00Z', 'technical', 'scheduled');
INSERT INTO outreach_budget (id, plan, credits_remaining) VALUES (1, 'career', 4);

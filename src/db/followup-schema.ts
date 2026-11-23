/**
 * Follow-up and thank-you drafts written by the followup skill. The user sends
 * each message on their own and marks it as sent; nothing is sent from here.
 */
export const FOLLOWUP_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS followup_drafts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  kind           TEXT NOT NULL CHECK (kind IN ('follow_up', 'thank_you')),
  channel        TEXT NOT NULL CHECK (channel IN ('email', 'linkedin', 'portal')),
  subject        TEXT,
  body_md        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'discarded')),
  stage_event_id INTEGER REFERENCES application_events(id),
  created_at     TEXT NOT NULL,
  sent_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_followup_drafts_application ON followup_drafts(application_id, kind, status);
`;

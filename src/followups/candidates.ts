import { now as currentTime } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { quietApplications, quietDays } from "../applications/quiet.ts";
import {
  FOLLOW_UP_DAYS,
  INTERVIEW_CATEGORIES,
  MAX_FOLLOW_UPS,
  THANK_YOU_DAYS,
  type FollowUpDue,
  type FollowupCandidates,
  type ThankYouDue,
} from "./types.ts";

const DAY_MS = 86_400_000;

/** Threshold of the follow-up scan: 10 days by default, validated like the quiet sweep. */
export function followUpDays(value: unknown): number {
  return value == null || value === "" ? FOLLOW_UP_DAYS : quietDays(value);
}

type Counts = { application_id: number; sent: number; drafts: number };

/** Quiet submitted applications below the follow-up cap, with what was already sent or drafted. */
function followUpsDue(d: Database, days: number, at: string): FollowUpDue[] {
  const counts = new Map(
    (d.query(`SELECT application_id, SUM(status = 'sent') AS sent, SUM(status = 'draft') AS drafts
      FROM followup_drafts WHERE kind = 'follow_up' GROUP BY application_id`).all() as Counts[])
      .map((row) => [row.application_id, row]),
  );
  return quietApplications(d, { days, now: at }).items.flatMap((item) => {
    const count = counts.get(item.id);
    const sent = count?.sent ?? 0;
    if (sent >= MAX_FOLLOW_UPS) return [];
    const { id, company_name, role_title, stage_name, last_activity_at, days_quiet } = item;
    return [{ id, company_name, role_title, stage_name, last_activity_at, days_quiet, sent_count: sent, has_draft: (count?.drafts ?? 0) > 0 }];
  });
}

/**
 * The latest move (or registration) of each active application into an
 * interview stage in the last week, newest first, unless a thank-you draft or
 * sent note already answers it. A discarded draft offers the note again.
 */
function thankYousDue(d: Database, at: string): ThankYouDue[] {
  const rows = d.query(`
    SELECT a.id, a.company_name, a.role_title, e.stage_name, e.id AS stage_event_id, e.occurred_at,
      EXISTS (SELECT 1 FROM followup_drafts f WHERE f.stage_event_id = e.id
        AND f.kind = 'thank_you' AND f.status IN ('draft', 'sent')) AS answered
    FROM application_events e JOIN applications a ON a.id = e.application_id
    WHERE a.tracking_status = 'active' AND e.event_type IN ('moved', 'created')
      AND e.stage_category IN (${INTERVIEW_CATEGORIES.map(() => "?").join(", ")})
    ORDER BY e.occurred_at DESC, e.id DESC
  `).all(...INTERVIEW_CATEGORIES) as unknown as (ThankYouDue & { answered: number })[];
  const end = Date.parse(at);
  const seen = new Set<number>();
  const due: ThankYouDue[] = [];
  for (const { answered, ...row } of rows) {
    const time = Date.parse(row.occurred_at);
    if (Number.isNaN(time) || time > end || end - time >= THANK_YOU_DAYS * DAY_MS || seen.has(row.id)) continue;
    seen.add(row.id);
    if (!answered) due.push(row);
  }
  return due;
}

/** Follow-ups and thank-you notes the user may want to draft now. */
export function followupCandidates(d: Database, options: { days?: number; now?: string } = {}): FollowupCandidates {
  const days = options.days ?? FOLLOW_UP_DAYS;
  const at = options.now ?? currentTime();
  return { days, follow_ups: followUpsDue(d, days, at), thank_yous: thankYousDue(d, at) };
}

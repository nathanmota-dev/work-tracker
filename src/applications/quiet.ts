import { now as currentTime } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { QUIET_MIN_DAYS, QUIET_STALE_DAYS, type QuietApplication, type QuietApplications, type QuietSkipped } from "./types.ts";
import { ApplicationBoardError } from "./validation.ts";

/** Days without activity after which a submitted application counts as quiet. */
export const STALE_DAYS = QUIET_STALE_DAYS;
/** Smallest threshold accepted, so a sweep never closes applications sent days ago. */
export const MIN_DAYS = QUIET_MIN_DAYS;
/** Largest threshold accepted (about ten years). */
export const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;

type Candidate = Omit<QuietApplication, "last_activity_at" | "days_quiet">;
type DateSource = { application_id: number; source: string; value: string | null };

// Open and submitted: drafts were never sent, and an offer in silence is not "no response".
const CANDIDATES = `FROM applications a JOIN application_stages s ON s.id = a.current_stage_id
  WHERE a.tracking_status = 'active' AND a.submission_status = 'submitted' AND s.category != 'offer'`;

/**
 * Every dated fact of the scoped applications: the submission, the application
 * date, board events and journey transitions. `updated_at` is deliberately
 * left out because any edit changes it, so it is not an activity clock.
 */
const datesSql = (scope: string) => `WITH scope(id) AS (${scope})
  SELECT a.id AS application_id, 'submitted_at' AS source, a.submitted_at AS value FROM applications a JOIN scope USING (id)
  UNION ALL SELECT a.id, 'applied_at', a.applied_at FROM applications a JOIN scope USING (id)
  UNION ALL SELECT e.application_id, 'event #' || e.id, e.occurred_at FROM application_events e JOIN scope ON scope.id = e.application_id
  UNION ALL SELECT t.application_id, 'transition #' || t.id, t.occurred_at FROM application_transitions t JOIN scope ON scope.id = t.application_id`;

/** Latest readable date and the dates that could not be read. */
function readClock(sources: DateSource[]): { last: number | null; unreadable: string[] } {
  let last: number | null = null;
  const unreadable: string[] = [];
  for (const { source, value } of sources) {
    if (value == null || value.trim() === "") continue;
    const time = Date.parse(value);
    if (Number.isNaN(time)) unreadable.push(`${source} "${value}"`);
    else last = last === null ? time : Math.max(last, time);
  }
  return { last, unreadable };
}

function groupDates(rows: DateSource[]): Map<number, DateSource[]> {
  const grouped = new Map<number, DateSource[]>();
  for (const row of rows) grouped.set(row.application_id, [...(grouped.get(row.application_id) ?? []), row]);
  return grouped;
}

/**
 * Most recent activity of one application: the latest of its submission,
 * application date, board events and journey transitions, as ISO text. Null
 * when it has no readable date.
 */
export function lastActivityAt(d: Database, applicationId: number): string | null {
  const rows = d.query(datesSql("SELECT ?")).all(applicationId) as DateSource[];
  const { last } = readClock(rows);
  return last === null ? null : new Date(last).toISOString();
}

/**
 * Validate a threshold in days from JSON, a query string or a CLI flag.
 * Missing means the default; anything else must be a whole number of days
 * between MIN_DAYS and MAX_DAYS.
 */
export function quietDays(value: unknown): number {
  if (value == null || value === "") return STALE_DAYS;
  const days = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof days !== "number" || !Number.isSafeInteger(days) || days < MIN_DAYS || days > MAX_DAYS)
    throw new ApplicationBoardError(`Days without activity must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}.`);
  return days;
}

/**
 * Submitted, active applications without activity for at least `days`, the
 * quietest first. A candidate whose old activity cannot be confirmed because a
 * date is unreadable, or that has no date at all, goes to `skipped` instead.
 */
export function quietApplications(
  d: Database,
  options: { days?: number; now?: string } = {},
): QuietApplications {
  const days = options.days ?? STALE_DAYS;
  const at = Date.parse(options.now ?? currentTime());
  const candidates = d
    .query(`SELECT a.id, a.company_name, a.role_title, a.applied_at, s.name AS stage_name, s.category AS stage_category
      ${CANDIDATES} ORDER BY a.id`)
    .all() as Candidate[];
  const dates = groupDates(d.query(datesSql(`SELECT a.id ${CANDIDATES}`)).all() as DateSource[]);
  const items: QuietApplication[] = [];
  const skipped: QuietSkipped[] = [];
  for (const candidate of candidates) {
    const { last, unreadable } = readClock(dates.get(candidate.id) ?? []);
    const quiet = last === null ? null : Math.floor((at - last) / DAY_MS);
    // A readable recent date proves activity; an unreadable one could only add more.
    if (quiet !== null && quiet < days) continue;
    const { id, company_name, role_title } = candidate;
    if (unreadable.length) skipped.push({ id, company_name, role_title, reason: `Unreadable date: ${unreadable.join(", ")}` });
    else if (last === null) skipped.push({ id, company_name, role_title, reason: "No submission or activity date" });
    else items.push({ ...candidate, last_activity_at: new Date(last).toISOString(), days_quiet: quiet! });
  }
  items.sort((a, b) => b.days_quiet - a.days_quiet || a.id - b.id);
  return { days, items, skipped };
}

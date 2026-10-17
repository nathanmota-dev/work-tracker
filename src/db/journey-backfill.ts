import type { Database } from "./sqlite.ts";

/** Legacy statuses whose meaning is unambiguous outside the board. */
const KNOWN_STATUSES = new Set(["draft", "filled", "needs_input", "submitted"]);

interface LegacyRow {
  id: number;
  job_id: number | null;
  job_exists: number;
  status: string | null;
  current_stage_id: number | null;
  preparation_run_id: string | null;
  resume_path: string | null;
  fields_filled_json: string | null;
  applied_at: string | null;
}

/**
 * Classify one legacy application. Only deterministic facts are written; rows
 * whose submission or job link cannot be decided are flagged with a review
 * reason for the reconciliation in feature 04 and are never re-linked here.
 */
function classify(row: LegacyRow, attempt: number) {
  const tracked = row.current_stage_id !== null;
  const status = row.status ?? "draft";
  const submitted = tracked || status === "submitted";
  const review =
    row.job_id !== null && !row.job_exists ? "missing_job"
    : !tracked && !KNOWN_STATUSES.has(status) ? "unknown_status"
    : !tracked && status === "submitted" ? "missing_stage"
    : !tracked && row.job_id === null ? "missing_job"
    : attempt > 1 ? "duplicate_job"
    : null;
  const fill = status === "filled" || status === "needs_input" ? status
    : submitted && row.fields_filled_json !== null ? "filled" : "not_started";
  return {
    origin: row.preparation_run_id ? "preparation" : tracked && row.job_id === null ? "manual" : "unknown",
    preparation: row.resume_path ? "ready" : "not_started",
    fill,
    submission: submitted ? "submitted" : "not_submitted",
    submittedAt: submitted ? row.applied_at : null,
    // Ambiguous statuses keep their original text for the reviewer.
    status: review === "unknown_status" ? status : submitted ? "submitted" : fill === "not_started" ? "draft" : fill,
    review,
  };
}

/**
 * Schema v4 backfill: give every unclassified application (attempt IS NULL) its
 * journey dimensions, origin and per-job attempt number. Idempotent, keeps every
 * ID, link, stage and event, and runs inside the migration transaction.
 */
export function backfillJourney(d: Database): void {
  // Very old workspaces may lack original columns that the additive baseline never adds.
  const present = new Set((d.query("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name));
  const pick = (name: string) => (present.has(name) ? `a.${name}` : `NULL AS ${name}`);
  const rows = d.query(`SELECT a.id, a.job_id, j.id IS NOT NULL AS job_exists, a.status, a.current_stage_id,
      ${["preparation_run_id", "resume_path", "fields_filled_json", "applied_at"].map(pick).join(", ")}
    FROM applications a LEFT JOIN jobs j ON j.id = a.job_id WHERE a.attempt IS NULL ORDER BY a.id`).all() as LegacyRow[];
  const attempts = new Map<number, number>();
  const update = d.query(`UPDATE applications SET origin = ?, preparation_status = ?, fill_status = ?, submission_status = ?,
    submitted_at = ?, status = ?, review_reason = ?, attempt = ? WHERE id = ?`);
  for (const row of rows) {
    let attempt = 1;
    if (row.job_id !== null) {
      const previous = attempts.get(row.job_id) ?? (d.query("SELECT COALESCE(MAX(attempt), 0) AS n FROM applications WHERE job_id = ?").get(row.job_id) as { n: number }).n;
      attempt = previous + 1;
      attempts.set(row.job_id, attempt);
    }
    const value = classify(row, attempt);
    update.run(value.origin, value.preparation, value.fill, value.submission, value.submittedAt, value.status, value.review, attempt, row.id);
  }
}

/** Every application has an attempt and no linked job has two equal attempts. */
export function verifyJourney(d: Database): void {
  const missing = d.query("SELECT COUNT(*) AS n FROM applications WHERE attempt IS NULL").get() as { n: number };
  if (missing.n) throw new Error(`${missing.n} application(s) were left without a journey classification.`);
}

import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { shortlistJob } from "../jobs/store.ts";
import {
  JourneyError,
  TRANSITIONS,
  legacyStatus,
  planTransition,
  statusAction,
  type ApplicationOrigin,
  type JourneyAction,
  type JourneyActor,
  type JourneyState,
  type ReviewReason,
} from "./journey.ts";
import { application, event } from "./records.ts";
import type { ApplicationStage } from "./types.ts";

/** Journey view of one application record; IDs are local unless named external. */
export interface JourneyRecord extends JourneyState {
  id: number;
  job_id: number | null;
  origin: ApplicationOrigin;
  attempt: number | null;
  previous_application_id: number | null;
  submitted_at: string | null;
  applied_at: string | null;
  review_reason: ReviewReason | null;
  preparation_run_id: string | null;
  external_url: string | null;
  status: string;
  /** 1 when an earlier portal fill result is stored for the current resume. */
  has_fill_result: number;
}
const journeyColumns = `id, job_id, origin, attempt, previous_application_id, preparation_status, fill_status,
  submission_status, tracking_status, submitted_at, applied_at, review_reason, preparation_run_id, external_url, status,
  fields_filled_json IS NOT NULL AS has_fill_result`;

export function journeyRecord(d: Database, id: number): JourneyRecord {
  const row = d.query(`SELECT ${journeyColumns} FROM applications WHERE id = ?`).get(id) as JourneyRecord | undefined;
  if (!row) throw new JourneyError("Application not found.", 404);
  return row;
}

/** The latest attempt linked to a local job, if any. */
export function latestForJob(d: Database, jobId: number): JourneyRecord | undefined {
  return d.query(`SELECT ${journeyColumns} FROM applications WHERE job_id = ? ORDER BY COALESCE(attempt, 0) DESC, id DESC LIMIT 1`)
    .get(jobId) as JourneyRecord | undefined;
}

/**
 * Resolve the local job ID from either a local ID or an external LinkedIn job ID.
 * Returns null when neither is given; never matches by title or company.
 */
export function resolveJob(d: Database, ref: { jobId?: number; linkedinJobId?: string }): number | null {
  const byLocal = ref.jobId === undefined ? undefined
    : (d.query("SELECT id FROM jobs WHERE id = ?").get(ref.jobId) as { id: number } | undefined)?.id;
  if (ref.jobId !== undefined && byLocal === undefined) throw new JourneyError(`Job #${ref.jobId} not found.`, 404);
  if (ref.linkedinJobId === undefined) return byLocal ?? null;
  const external = d.query("SELECT id FROM jobs WHERE linkedin_job_id = ?").get(ref.linkedinJobId) as { id: number } | undefined;
  if (!external) throw new JourneyError(`No saved job has LinkedIn ID ${ref.linkedinJobId}.`, 404);
  if (byLocal !== undefined && byLocal !== external.id)
    throw new JourneyError(`Job #${byLocal} does not have LinkedIn ID ${ref.linkedinJobId}.`, 409);
  return external.id;
}

/**
 * @property jobId Local job ID; null for an application without a saved job.
 * @property newAttempt Explicit decision to apply again (for example, a
 *   republished role). Allowed only after the latest attempt was submitted.
 * @property idempotencyKey Repeating a request with the same key returns the
 *   application it created.
 */
export interface OpenApplication {
  jobId: number | null;
  origin: ApplicationOrigin;
  newAttempt?: boolean;
  idempotencyKey?: string | null;
}

/**
 * Find or create the application for a request. Without `newAttempt`, a job keeps
 * reusing its latest attempt, so repeating an action never creates another
 * application. Must run inside the caller's transaction.
 */
export function openApplication(d: Database, input: OpenApplication): { record: JourneyRecord; created: boolean } {
  if (input.idempotencyKey) {
    const existing = d.query("SELECT id FROM applications WHERE idempotency_key = ?").get(input.idempotencyKey) as { id: number } | undefined;
    if (existing) {
      const record = journeyRecord(d, existing.id);
      if (record.job_id !== input.jobId) throw new JourneyError("This request key was already used for another application.");
      return { record, created: false };
    }
  }
  const latest = input.jobId === null ? undefined : latestForJob(d, input.jobId);
  if (latest && !input.newAttempt) return { record: latest, created: false };
  if (latest && latest.submission_status !== "submitted")
    throw new JourneyError(`Application #${latest.id} for this job is not submitted yet; continue it instead of starting a new attempt.`);
  if (!latest && input.newAttempt) throw new JourneyError("This job has no previous application to retry.");
  const at = now();
  const row = d.query(`INSERT INTO applications (job_id, origin, attempt, previous_application_id, idempotency_key, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?) RETURNING id`)
    .get(input.jobId, input.origin, (latest?.attempt ?? 0) + 1, latest?.id ?? null, input.idempotencyKey ?? null, at, at) as { id: number };
  if (input.jobId !== null) shortlistJob(d, input.jobId);
  return { record: journeyRecord(d, row.id), created: true };
}

/** Validate an action for an application without changing it. */
export function assertTransition(d: Database, id: number, action: JourneyAction): JourneyRecord {
  const record = journeyRecord(d, id);
  planTransition(record, action);
  return record;
}

/**
 * Apply one journey action, keep the legacy status summary in sync and record
 * the change. A repeated idempotent action changes and records nothing. Must
 * run inside the caller's transaction so a failure leaves no partial change.
 *
 * @param options.at Submission time; defaults to now.
 */
export function transition(
  d: Database,
  id: number,
  action: JourneyAction,
  actor: JourneyActor,
  options: { runId?: string | null; at?: string } = {},
): { record: JourneyRecord; changed: boolean } {
  const { dimension } = TRANSITIONS[action];
  if (dimension === "tracking") throw new JourneyError("Tracking changes belong to the application board.", 500);
  const record = journeyRecord(d, id);
  const { changed, next } = planTransition(record, action);
  if (!changed) return { record, changed };
  const column = `${dimension}_status` as const;
  const at = now();
  const submittedAt = action === "submit" ? options.at ?? at : record.submitted_at;
  d.query(`UPDATE applications SET ${column} = ?, status = ?, submitted_at = ?,
    applied_at = CASE WHEN ? THEN COALESCE(applied_at, ?) ELSE applied_at END, updated_at = ? WHERE id = ?`)
    .run(next[column], legacyStatus(next), submittedAt, action === "submit" ? 1 : 0, submittedAt, at, id);
  d.query(`INSERT INTO application_transitions (application_id, dimension, action, from_state, to_state, actor, run_id, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, dimension, action, record[column], next[column], actor, options.runId ?? null, at);
  return { record: journeyRecord(d, id), changed };
}

/**
 * Put a submitted application on the board: initial stage, active tracking and
 * one `created` board event. Card fields a prepared application lacks come from
 * its job. An application already on the board is left untouched, so repeating
 * a confirmation adds no card or event. Must run inside the caller's
 * transaction. Returns whether the application entered the board now.
 */
export function startTracking(d: Database, id: number): boolean {
  if (journeyRecord(d, id).submission_status !== "submitted")
    throw new JourneyError("Only a submitted application can be tracked on the board.");
  const initial = d.query("SELECT * FROM application_stages WHERE key = 'applied'").get() as ApplicationStage | undefined;
  if (!initial) throw new JourneyError("The board's initial stage is missing.", 500);
  const { changes } = d.query(`UPDATE applications SET
      company_name = COALESCE(company_name, (SELECT company_name FROM jobs WHERE jobs.id = applications.job_id)),
      role_title = COALESCE(role_title, (SELECT title FROM jobs WHERE jobs.id = applications.job_id)),
      external_url = COALESCE(external_url, (SELECT link FROM jobs WHERE jobs.id = applications.job_id)),
      stack_json = COALESCE(stack_json, '[]'), applied_at = COALESCE(applied_at, submitted_at),
      current_stage_id = ?, tracking_status = 'active', updated_at = ?
    WHERE id = ? AND current_stage_id IS NULL`).run(initial.id, now(), id);
  if (!changes) return false;
  event(d, application(d, id), initial, "created", null);
  return true;
}

/**
 * Apply a legacy `status` value (CLI and agent skills). `draft` is accepted only
 * while the application is unsubmitted, because a submission is never undone.
 */
export function applyStatus(d: Database, id: number, status: string, actor: JourneyActor): boolean {
  const action = statusAction(status);
  if (action) return transition(d, id, action, actor).changed;
  if (journeyRecord(d, id).submission_status === "submitted")
    throw new JourneyError("A submitted application cannot return to draft.");
  return false;
}

/**
 * Settle an execution that stopped before completing. An earlier validated
 * resume or fill result stays current; otherwise a failure is recorded as
 * failed and a cancellation returns to not_started.
 */
export function settleExecution(d: Database, id: number, phase: "preparation" | "fill", outcome: "failed" | "cancelled", runId?: string): void {
  const record = journeyRecord(d, id);
  if (phase === "preparation") {
    if (record.preparation_status !== "in_progress") return;
    const action = record.preparation_run_id ? "prepare.restore" : outcome === "failed" ? "prepare.fail" : "prepare.cancel";
    transition(d, id, action, "system", { runId });
    return;
  }
  if (record.fill_status !== "in_progress") return;
  const action = record.has_fill_result ? "fill.restore" : outcome === "failed" ? "fill.fail" : "fill.cancel";
  transition(d, id, action, "system", { runId });
}

export interface JourneyTransition {
  id: number;
  dimension: string;
  action: JourneyAction;
  from_state: string;
  to_state: string;
  actor: JourneyActor;
  run_id: string | null;
  occurred_at: string;
}
export function journeyTransitions(d: Database, id: number): JourneyTransition[] {
  return d.query("SELECT id, dimension, action, from_state, to_state, actor, run_id, occurred_at FROM application_transitions WHERE application_id = ? ORDER BY id")
    .all(id) as JourneyTransition[];
}

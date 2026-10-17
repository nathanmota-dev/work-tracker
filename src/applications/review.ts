import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { legacyStatus, type JourneyActor, type ReviewReason } from "./journey.ts";
import { journeyRecord, startTracking, transition } from "./journey-store.ts";
import { jobCandidates, normalizeLink } from "./job-link.ts";
import { REVIEW_DECISIONS, type BoardField, type ReviewDecision, type ReviewItem } from "./types.ts";
import { ApplicationBoardError, id, optionalText, type Body } from "./validation.ts";

/** Legacy statuses whose meaning is unambiguous outside the board. */
const KNOWN_STATUSES = new Set(["draft", "filled", "needs_input", "submitted"]);
const BOARD_LABELS: Record<BoardField, string> = { company_name: "company name", external_url: "job link", applied_at: "application date" };

interface ReviewRow {
  id: number;
  job_id: number | null;
  job_exists: number;
  origin: string;
  status: string;
  submission_status: string;
  submitted_at: string | null;
  applied_at: string | null;
  current_stage_id: number | null;
  attempt: number | null;
  previous_application_id: number | null;
  company_name: string | null;
  role_title: string | null;
  external_url: string | null;
  review_reason: ReviewReason | null;
}
const reviewQuery = `SELECT a.id, a.job_id, j.id IS NOT NULL AS job_exists, a.origin, a.status, a.submission_status, a.submitted_at,
    a.applied_at, a.current_stage_id, a.attempt, a.previous_application_id, COALESCE(a.company_name, j.company_name) AS company_name,
    COALESCE(a.role_title, j.title) AS role_title, COALESCE(a.external_url, j.link) AS external_url, a.review_reason
  FROM applications a LEFT JOIN jobs j ON j.id = a.job_id`;

function reviewRow(d: Database, applicationId: number): ReviewRow {
  journeyRecord(d, applicationId);
  return d.query(`${reviewQuery} WHERE a.id = ?`).get(applicationId) as ReviewRow;
}

/** The issue a record still has, in the order the v4 migration used. */
function deriveReason(row: ReviewRow): ReviewReason | null {
  const tracked = row.current_stage_id !== null;
  if (row.job_id !== null && !row.job_exists) return "missing_job";
  if (!KNOWN_STATUSES.has(row.status)) return "unknown_status";
  if (row.submission_status === "submitted" && !tracked) return "missing_stage";
  if (!tracked && row.job_id === null) return "missing_job";
  if ((row.attempt ?? 1) > 1 && row.previous_application_id === null) return "duplicate_job";
  return null;
}

function missingBoardData(row: Pick<ReviewRow, "company_name" | "external_url" | "applied_at" | "submitted_at">): BoardField[] {
  const missing: BoardField[] = [];
  if (!row.company_name?.trim()) missing.push("company_name");
  if (!normalizeLink(row.external_url)) missing.push("external_url");
  if (!row.applied_at && !row.submitted_at) missing.push("applied_at");
  return missing;
}

function decisionsFor(row: ReviewRow, reason: ReviewReason): ReviewDecision[] {
  if (reason === "unknown_status") return ["mark_submitted", "mark_not_submitted"];
  if (reason === "duplicate_job") return ["keep_attempt"];
  if (row.submission_status !== "submitted") return ["mark_submitted"];
  return row.current_stage_id === null ? ["track"] : [];
}

/**
 * A legacy `applied` outside the board means a submission when the record was
 * registered outside Apply (CLI, agents, manual). For an Apply record it is not
 * proof of submission, since only the browser confirmation submits there.
 */
function safeFix(row: ReviewRow, reason: ReviewReason, missing: BoardField[]): ReviewDecision | null {
  if (missing.length) return null;
  if (decisionsFor(row, reason).includes("track")) return "track";
  if (reason === "unknown_status" && row.status === "applied" && row.origin !== "preparation" && row.applied_at
    && (row.job_id === null || row.job_exists)) return "mark_submitted";
  return null;
}

function reviewItem(d: Database, row: ReviewRow): ReviewItem {
  const reason = row.review_reason!;
  const missing = missingBoardData(row);
  const related = row.job_id === null ? [] : d.query(`SELECT id, attempt, submission_status FROM applications
    WHERE job_id = ? AND id != ? ORDER BY COALESCE(attempt, 0), id`).all(row.job_id, row.id) as ReviewItem["related"];
  const linkJob = row.job_id === null || !row.job_exists;
  return {
    id: row.id, job_id: row.job_id, job_exists: Boolean(row.job_exists), origin: row.origin, status: row.status,
    submission_status: row.submission_status, applied_at: row.applied_at ?? row.submitted_at, tracked: row.current_stage_id !== null,
    company_name: row.company_name, role_title: row.role_title, external_url: row.external_url, review_reason: reason,
    safe_fix: safeFix(row, reason, missing), decisions: decisionsFor(row, reason), link_job: linkJob, missing,
    candidates: linkJob ? jobCandidates(d, row.external_url) : [], related,
  };
}

/** Recompute a flagged record's review reason after a change; unflagged records stay untouched. */
export function refreshReview(d: Database, applicationId: number): ReviewReason | null {
  const row = reviewRow(d, applicationId);
  if (row.review_reason === null) return null;
  const reason = deriveReason(row);
  if (reason !== row.review_reason) d.query("UPDATE applications SET review_reason = ? WHERE id = ?").run(reason, applicationId);
  return reason;
}

export function reviewItems(d: Database): ReviewItem[] {
  const rows = d.query(`${reviewQuery} WHERE a.review_reason IS NOT NULL ORDER BY a.id`).all() as ReviewRow[];
  return rows.map((row) => reviewItem(d, row));
}

/** Fill empty card fields from the reviewer's input; values already stored are kept. */
function completeBoardData(d: Database, row: ReviewRow, body: Body): void {
  const url = optionalText(body.external_url);
  if (url && !normalizeLink(url)) throw new ApplicationBoardError("Enter a valid HTTP or HTTPS URL.");
  const date = optionalText(body.applied_at);
  if (date && Number.isNaN(Date.parse(date))) throw new ApplicationBoardError("Invalid application date.");
  const values = {
    company_name: row.company_name?.trim() ? row.company_name : optionalText(body.company_name),
    external_url: normalizeLink(row.external_url) ? row.external_url : url && new URL(url).href,
    applied_at: row.applied_at ?? row.submitted_at ?? (date && new Date(date).toISOString()),
  };
  const missing = missingBoardData({ ...values, submitted_at: null });
  if (missing.length)
    throw new ApplicationBoardError(`Add the ${missing.map((field) => BOARD_LABELS[field]).join(", ")} before tracking this application.`);
  d.query("UPDATE applications SET company_name = ?, external_url = ?, applied_at = COALESCE(applied_at, ?), updated_at = ? WHERE id = ?")
    .run(values.company_name, values.external_url, values.applied_at, now(), row.id);
}

function applyDecision(d: Database, row: ReviewRow, decision: ReviewDecision, body: Body, actor: JourneyActor): void {
  if (decision === "track" || decision === "mark_submitted") {
    completeBoardData(d, row, body);
    if (decision === "mark_submitted") {
      const at = (d.query("SELECT applied_at FROM applications WHERE id = ?").get(row.id) as { applied_at: string }).applied_at;
      transition(d, row.id, "submit", actor, { at });
    }
    startTracking(d, row.id);
    return;
  }
  if (decision === "mark_not_submitted") {
    // Keeps preparation and fill results; only the unreadable legacy summary is normalized.
    d.query("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?").run(legacyStatus(journeyRecord(d, row.id)), now(), row.id);
    return;
  }
  const previous = d.query("SELECT id FROM applications WHERE job_id = ? AND attempt < ? ORDER BY attempt DESC LIMIT 1")
    .get(row.job_id, row.attempt) as { id: number } | undefined;
  if (!previous) throw new ApplicationBoardError("No earlier application exists for this job.", 409);
  d.query("UPDATE applications SET previous_application_id = ?, updated_at = ? WHERE id = ?").run(previous.id, now(), row.id);
}

/**
 * Apply one explicit decision to a flagged record. A record that was already
 * reconciled is returned unchanged; a decision that does not fit its current
 * issue is rejected. Must run inside the caller's transaction.
 */
export function resolveReview(d: Database, body: Body, actor: JourneyActor): { item: ReviewItem | null; changed: boolean } {
  const row = reviewRow(d, id(body.id));
  if (!(REVIEW_DECISIONS as readonly unknown[]).includes(body.decision))
    throw new ApplicationBoardError("Invalid review decision.");
  const decision = body.decision as ReviewDecision;
  if (row.review_reason === null) return { item: null, changed: false };
  if (!decisionsFor(row, row.review_reason).includes(decision))
    throw new ApplicationBoardError("This decision does not apply to the record's current review.", 409);
  applyDecision(d, row, decision, body, actor);
  refreshReview(d, row.id);
  const updated = reviewRow(d, row.id);
  return { item: updated.review_reason ? reviewItem(d, updated) : null, changed: true };
}

/**
 * Apply every safe fix (legacy submissions entering the board, and legacy
 * `applied` records registered outside Apply). Ambiguous records keep their
 * flag. Repeating it changes nothing. Must run inside the caller's transaction.
 */
export function reconcileReviews(d: Database, actor: JourneyActor): { fixed: number[]; items: ReviewItem[] } {
  const fixed: number[] = [];
  for (const item of reviewItems(d)) {
    if (!item.safe_fix) continue;
    applyDecision(d, reviewRow(d, item.id), item.safe_fix, {}, actor);
    refreshReview(d, item.id);
    fixed.push(item.id);
  }
  return { fixed, items: reviewItems(d) };
}

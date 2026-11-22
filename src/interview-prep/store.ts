import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";

export interface InterviewPrep {
  id: number;
  application_id: number;
  stage: string;
  scheduled_at: string | null;
  format: string | null;
  interviewers: string | null;
  body_md: string;
  created_at: string;
}

export interface InterviewPrepInput {
  applicationId: number;
  stage: string;
  body: string;
  scheduledAt?: string;
  format?: string;
  interviewers?: string;
}

/** A pack that cannot be stored or listed because its input is not valid. */
export class InterviewPrepError extends Error {
  override name = "InterviewPrepError";
}

const COLUMNS = "id, application_id, stage, scheduled_at, format, interviewers, body_md, created_at";

/** Stores a pack; a new pack for the same stage is kept next to earlier ones as history. */
export function saveInterviewPrep(input: InterviewPrepInput, d: Database = db()): number {
  const stage = input.stage.trim();
  const body = input.body.trim();
  if (!Number.isInteger(input.applicationId) || input.applicationId < 1) throw new InterviewPrepError("application id must be a positive integer");
  if (!stage) throw new InterviewPrepError("stage is required");
  if (!body) throw new InterviewPrepError("the preparation pack is empty");
  if (!d.query("SELECT 1 FROM applications WHERE id = ?").get(input.applicationId)) {
    throw new InterviewPrepError(`application #${input.applicationId} not found`);
  }
  const row = d.query(`
    INSERT INTO interview_preps (application_id, stage, scheduled_at, format, interviewers, body_md, created_at)
    VALUES ($application, $stage, $scheduled, $format, $interviewers, $body, $at)
    RETURNING id
  `).get({
    $application: input.applicationId,
    $stage: stage,
    $scheduled: input.scheduledAt?.trim() || null,
    $format: input.format?.trim() || null,
    $interviewers: input.interviewers?.trim() || null,
    $body: body,
    $at: now(),
  }) as { id: number };
  return row.id;
}

/** Newest first; narrowed to one application when an id is given. */
export function listInterviewPreps(applicationId?: number, d: Database = db()): InterviewPrep[] {
  if (applicationId === undefined) {
    return d.query(`SELECT ${COLUMNS} FROM interview_preps ORDER BY id DESC`).all() as unknown as InterviewPrep[];
  }
  return d.query(`SELECT ${COLUMNS} FROM interview_preps WHERE application_id = ? ORDER BY id DESC`).all(applicationId) as unknown as InterviewPrep[];
}

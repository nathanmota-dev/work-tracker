import type { Database } from "../db/sqlite.ts";
import { now } from "../db/index.ts";
import { missingForPreparation } from "./preparation.ts";
import { parseDeadline } from "../deadlines/urgency.ts";
import { linkedinJobId, normalizeLink, webUrl } from "./identity.ts";
import { guardDescription } from "../postings/description.ts";

export class JobError extends Error {
  constructor(message: string, public status = 400, public existingId?: number) { super(message); }
}
const fields = ["title", "company_name", "location", "work_type", "comp", "fit", "requirements_json", "status", "link", "description", "source", "source_job_id", "linkedin_job_id", "deadline"] as const;
type Field = typeof fields[number];
/** Columns written on save: the input fields plus the guard result, which input can never set. */
const columns = [...fields, "description_guard_json"] as const;
export type Job = Record<Field, string | null> & { id: number; archived_at: string | null; shortlisted_at: string | null; description_guard_json: string | null };
type Input = Partial<Record<Field, string | null>>;

function inputFields(body: unknown): Input {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new JobError("Expected job fields.");
  const input: Input = {};
  for (const key of fields) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") throw new JobError(`${key} must be text.`);
    input[key] = value?.trim() || null;
  }
  if (input.link && !webUrl(input.link)) throw new JobError("Enter a valid HTTP or HTTPS job URL without credentials.");
  if (input.link) input.link = webUrl(input.link)!.href;
  if (input.deadline && !parseDeadline(input.deadline)) throw new JobError("Enter the deadline as a valid date.");
  if (input.requirements_json) {
    try { JSON.parse(input.requirements_json); } catch { throw new JobError("Requirements must be valid JSON."); }
  }
  return input;
}

function identify(input: Input): Input {
  const source = input.source?.toLowerCase() || null;
  const fromUrl = linkedinJobId(input.link ?? null);
  const linkedId = input.linkedin_job_id || (source === "linkedin" ? input.source_job_id : null) || fromUrl;
  if (linkedId && ((fromUrl && fromUrl !== linkedId) || (source && source !== "linkedin")
    || (input.source_job_id && input.source_job_id !== linkedId)))
    throw new JobError("The source ID and LinkedIn URL identify different jobs.");
  if (input.source_job_id && !source && !linkedId) throw new JobError("Add a source for the source job ID.");
  return { ...input, source: linkedId ? "linkedin" : source, source_job_id: linkedId || input.source_job_id || null, linkedin_job_id: linkedId || null };
}

function sameSource(a: Input, b: Input): boolean {
  const left = a.linkedin_job_id || a.source_job_id;
  const right = b.linkedin_job_id || b.source_job_id;
  return !!left && left === right && (a.linkedin_job_id ? "linkedin" : a.source?.toLowerCase()) === (b.linkedin_job_id ? "linkedin" : b.source?.toLowerCase());
}

function existingJob(d: Database, input: Input, exclude?: number): Job | undefined {
  const url = normalizeLink(input.link ?? null);
  const matches = (d.query("SELECT * FROM jobs ORDER BY id").all() as Job[]).filter(job => job.id !== exclude
    && (sameSource(input, job) || (url && url === normalizeLink(job.link)) || (input.linkedin_job_id && input.linkedin_job_id === linkedinJobId(job.link))));
  if (matches.length > 1) throw new JobError("Several saved jobs match this identity. Review them before saving.", 409, matches[0]!.id);
  const match = matches[0];
  if (match && input.source_job_id && (match.source_job_id || match.linkedin_job_id) && !sameSource(input, match))
    throw new JobError(`Job #${match.id} has this URL with a different source ID. Review its identity.`, 409, match.id);
  return match;
}

function requireMinimum(input: Input): void {
  if (!input.title || !input.company_name) throw new JobError("Add a role title and company name before saving.");
}

/**
 * A provided description is saved only as the guard's cleaned text. An unchanged,
 * already checked description keeps its result; a legacy one is checked on its next edit.
 */
function guardedInput(input: Input, provided: Input, current: Job | undefined): Input & { description_guard_json: string | null } {
  const kept = { ...input, description_guard_json: current?.description_guard_json ?? null };
  if (provided.description === undefined) return kept;
  if (current?.description_guard_json && provided.description === current.description) return kept;
  const { description, guardJson } = guardDescription(provided.description);
  return { ...input, description, description_guard_json: guardJson };
}

/** One transaction serializes identity checks and writes across API and CLI processes. */
export function saveJob(d: Database, body: unknown, updateId?: number, rediscover = false) {
  const provided = inputFields(body);
  return d.transaction(() => {
    const current = updateId === undefined ? undefined : d.query("SELECT * FROM jobs WHERE id = ?").get(updateId) as Job | undefined;
    if (updateId !== undefined && !current) throw new JobError("Job not found.", 404);
    const input = identify({ ...current, ...provided });
    const existing = existingJob(d, input, updateId);
    if (existing && current) throw new JobError(`Job #${existing.id} already has this identity.`, 409, existing.id);
    if (existing) {
      // Rediscovery can refresh assessment, but cannot replace saved content or unarchive a job.
      if (rediscover) d.query("UPDATE jobs SET fit = COALESCE(?, fit), status = CASE WHEN archived_at IS NULL THEN COALESCE(?, status) ELSE status END WHERE id = ?")
        .run(provided.fit ?? null, provided.status ?? null, existing.id);
      return result(d, existing.id, false, true);
    }
    requireMinimum(input);
    if (current && d.query("SELECT 1 FROM application_runs WHERE job_id = ? AND status = 'running'").get(current.id))
      throw new JobError("Finish or cancel this job's active preparation before editing it.", 409);
    const guarded = guardedInput(input, provided, current);
    const values = columns.map(key => guarded[key] ?? (key === "status" ? "saved" : null));
    const job = current
      ? d.query(`UPDATE jobs SET ${columns.map(key => `${key} = ?`).join(", ")} WHERE id = ? RETURNING id`).get(...values, current.id)
      : d.query(`INSERT INTO jobs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`).get(...values);
    // A requirements check quotes the description it read; a new description needs a new check.
    if (current && (guarded.description ?? null) !== current.description) d.query("UPDATE jobs SET gate_json = NULL WHERE id = ?").run(current.id);
    if (current && (guarded.link ?? null) !== current.link) syncApplicationLinks(d, current.id, current.link, guarded.link ?? null);
    return result(d, (job as { id: number }).id, !current, false);
  })();
}

/**
 * Unsubmitted applications follow the job's new link unless they hold a different one;
 * a submitted application keeps the link it was sent through.
 */
function syncApplicationLinks(d: Database, jobId: number, previous: string | null, link: string | null): void {
  d.query(`UPDATE applications SET external_url = ?, updated_at = ?
    WHERE job_id = ? AND submission_status = 'not_submitted' AND (external_url IS NULL OR external_url = ?)`)
    .run(link, now(), jobId, previous);
}

/** A role the user chose (by hand or by applying) skips triage; archived roles stay archived. */
export function shortlistJob(d: Database, id: number): void {
  d.query("UPDATE jobs SET shortlisted_at = COALESCE(shortlisted_at, ?) WHERE id = ? AND archived_at IS NULL").run(now(), id);
}

function result(d: Database, id: number, created: boolean, existing: boolean) {
  const job = d.query("SELECT * FROM jobs WHERE id = ?").get(id) as Job;
  return { job, created, existing, missing: missingForPreparation(job) };
}

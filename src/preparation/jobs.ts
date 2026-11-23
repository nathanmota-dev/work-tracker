import { db } from "../db/index.ts";
import { PreparationError } from "./sources.ts";
import type { PreparationDetails } from "./types.ts";
import { saveGuardedDescription } from "../postings/description.ts";

export type PreparationJob = PreparationDetails["job"] & { linkedin_job_id?: string };
/** `guard` adds the stored posting check for the user; agent manifests never carry its excerpts. */
export function jobRecord(id: number, guard = false): PreparationJob {
  const row = db().query(`SELECT id, title, company_name, description, ${guard ? "description_guard_json, " : ""}link, archived_at, linkedin_job_id FROM jobs WHERE id = ?`).get(id) as PreparationJob | undefined;
  if (!row) throw new PreparationError("Job not found.", 404);
  return row;
}
/** A saved job's local ID from a request body. */
export function jobId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new PreparationError("Select a saved job.");
  return value;
}
/** Save a description pasted in Apply; only the guard's cleaned text is stored. */
export function savePastedDescription(id: number, raw: string): void {
  const { description, guard } = saveGuardedDescription(db(), id, raw);
  if (!description) throw new PreparationError(`No readable text remained after the posting check (${guard?.verdict}). Paste the visible job description.`);
}

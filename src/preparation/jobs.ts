import { db } from "../db/index.ts";
import { PreparationError } from "./sources.ts";
import type { PreparationDetails } from "./types.ts";

export type PreparationJob = PreparationDetails["job"] & { linkedin_job_id?: string };
export function jobRecord(id: number): PreparationJob {
  const row = db().query("SELECT id, title, company_name, description, link, archived_at, linkedin_job_id FROM jobs WHERE id = ?").get(id) as PreparationJob | undefined;
  if (!row) throw new PreparationError("Job not found.", 404);
  return row;
}
/** A saved job's local ID from a request body. */
export function jobId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new PreparationError("Select a saved job.");
  return value;
}

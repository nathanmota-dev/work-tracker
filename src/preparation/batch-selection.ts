import type { Database } from "../db/sqlite.ts";
import { linkedinJobId, normalizeLink } from "../jobs/identity.ts";
import { missingForPreparation } from "../jobs/preparation.ts";
import { jobId } from "./jobs.ts";
import { PreparationError } from "./sources.ts";
import type { NewItem } from "./batch-store.ts";
import type { BatchEligibility, BatchPreview } from "./types.ts";

type Job = { id: number; title: string; company_name: string; link: string | null; description: string | null; linkedin_job_id: string | null; source: string | null; source_job_id: string | null; archived_at: string | null };
export type { BatchPreview } from "./types.ts";

export function newItems(value: unknown): NewItem[] {
  if (!Array.isArray(value) || !value.length) throw new PreparationError("Select at least one job.");
  return value.map((entry: unknown) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return { jobId: jobId(item.jobId), extra: typeof item.extra === "string" ? item.extra.trim() : "" };
  });
}
function identities(job: Job): string[] {
  const link = normalizeLink(job.link);
  const linkedin = job.linkedin_job_id || linkedinJobId(job.link);
  return [link && `url:${link}`, linkedin && `linkedin:${linkedin}`,
    job.source && job.source_job_id && `${job.source.toLowerCase()}:${job.source_job_id}`].filter((key): key is string => !!key);
}
/** Preview uses the same rules as the atomic create, over explicit saved IDs. */
export function previewJobs(d: Database, selected: NewItem[]): BatchPreview {
  const jobs = d.query("SELECT id, title, company_name, link, description, linkedin_job_id, source, source_job_id, archived_at FROM jobs").all() as Job[];
  const byId = new Map(jobs.map(job => [job.id, job]));
  const submitted = new Set((d.query("SELECT DISTINCT job_id FROM applications WHERE submission_status = 'submitted'").all() as { job_id: number }[]).map(row => row.job_id));
  const queued = new Set((d.query("SELECT DISTINCT job_id FROM preparation_batch_items WHERE status NOT IN ('completed', 'cancelled')").all() as { job_id: number }[]).map(row => row.job_id));
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  const items = selected.map(({ jobId }): BatchEligibility => {
    const job = byId.get(jobId);
    const reasons: string[] = [];
    const missing = job ? missingForPreparation(job) : [];
    if (!job) reasons.push(`Job ${jobId} was not found`);
    else {
      if (job.archived_at) reasons.push("is archived");
      if (submitted.has(jobId)) reasons.push("was already submitted");
      if (missing.length) reasons.push(`is missing ${missing.join(", ")}`);
      if (queued.has(jobId)) reasons.push("is already in an unfinished batch item");
      const keys = identities(job);
      if (seenIds.has(jobId) || keys.some(key => seenKeys.has(key))) reasons.push("is a duplicate in this selection");
      if (!reasons.length) keys.forEach(key => seenKeys.add(key));
    }
    seenIds.add(jobId);
    return { jobId, title: job?.title ?? `Job ${jobId}`, company: job?.company_name ?? "", eligible: !reasons.length, reasons, missing };
  });
  const eligible = items.filter(item => item.eligible).length;
  return { selected: items.length, eligible, excluded: items.length - eligible, items };
}
export function checkSelection(d: Database, items: NewItem[]): void {
  if (new Set(items.map(item => item.jobId)).size !== items.length) throw new PreparationError("Each job can appear only once in a batch.");
  const excluded = previewJobs(d, items).items.filter(item => !item.eligible);
  if (excluded.length) throw new PreparationError(excluded.map(item => item.company
    ? `${item.company} · ${item.title} ${item.reasons.join("; ")}` : item.reasons.join("; ")).join("; ") + ".", 409);
}

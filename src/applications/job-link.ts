import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { journeyRecord, type JourneyRecord } from "./journey-store.ts";
import type { JobCandidate, JobLinkOptions, JobLinkResult, PreparationField } from "./types.ts";
import { ApplicationBoardError, id, optionalText, type Body } from "./validation.ts";

interface LinkContext extends JourneyRecord {
  role_title: string | null;
  company_name: string | null;
  comp: string | null;
  job_exists: number;
}
interface JobRow {
  id: number;
  title: string | null;
  company_name: string | null;
  link: string | null;
  linkedin_job_id: string | null;
  description: string | null;
  comp: string | null;
  archived_at: string | null;
}
const jobColumns = "id, title, company_name, link, linkedin_job_id, description, comp, archived_at";

/** Comparable form of a web link; null when the text is not an HTTP(S) URL. */
export function normalizeLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return null;
    url.hash = "";
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/** External LinkedIn job ID in a job URL (`/jobs/view/<id>` or `currentJobId=<id>`). */
export function linkedinJobId(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1] ?? url.searchParams.get("currentJobId")?.match(/^\d+$/)?.[0] ?? null;
  } catch {
    return null;
  }
}

function linkContext(d: Database, applicationId: number): LinkContext {
  journeyRecord(d, applicationId);
  return d.query(`SELECT a.id, a.job_id, a.origin, a.attempt, a.previous_application_id, a.submission_status, a.tracking_status,
      a.review_reason, a.status, a.role_title, a.company_name, a.external_url, a.comp, j.id IS NOT NULL AS job_exists
    FROM applications a LEFT JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`).get(applicationId) as LinkContext;
}

function applicationFor(d: Database, jobId: number): number | null {
  return (d.query("SELECT id FROM applications WHERE job_id = ? ORDER BY id LIMIT 1").get(jobId) as { id: number } | undefined)?.id ?? null;
}

/** Saved jobs with the same link or LinkedIn job ID as `url`, oldest first. */
export function jobCandidates(d: Database, url: string | null, exclude: number | null = null): JobCandidate[] {
  const link = normalizeLink(url);
  const external = linkedinJobId(url);
  if (!link && !external) return [];
  const rows = d.query(`SELECT ${jobColumns} FROM jobs ORDER BY id`).all() as JobRow[];
  return rows.flatMap((job) => {
    const match = external && job.linkedin_job_id === external ? "linkedin_id" as const
      : link && normalizeLink(job.link) === link ? "link" as const : null;
    if (!match || job.id === exclude) return [];
    const { id: jobId, title, company_name, link: jobLink, archived_at } = job;
    return [{ id: jobId, title, company_name, link: jobLink, archived_at, match, application_id: applicationFor(d, job.id) }];
  });
}

/** Data a job lacks for resume preparation; a LinkedIn ID lets Apply fetch the description. */
export function missingForPreparation(job: Pick<JobRow, "title" | "company_name" | "link" | "linkedin_job_id" | "description">): PreparationField[] {
  const missing: PreparationField[] = [];
  if (!job.title?.trim()) missing.push("role_title");
  if (!job.company_name?.trim()) missing.push("company_name");
  if (!normalizeLink(job.link)) missing.push("external_url");
  if (!job.description?.trim() && !job.linkedin_job_id) missing.push("description");
  return missing;
}

function requireUnlinked(record: LinkContext): void {
  if (record.job_id !== null && record.job_exists)
    throw new ApplicationBoardError(`Application #${record.id} is already linked to job #${record.job_id}.`, 409);
}

export function jobLinkOptions(d: Database, body: Body): JobLinkOptions {
  const record = linkContext(d, id(body.id));
  requireUnlinked(record);
  return {
    application_id: record.id,
    role_title: record.role_title,
    company_name: record.company_name,
    external_url: record.external_url,
    comp: record.comp,
    missing: missingForPreparation({ title: record.role_title, company_name: record.company_name, link: record.external_url, linkedin_job_id: linkedinJobId(record.external_url), description: null }),
    candidates: jobCandidates(d, record.external_url),
  };
}

function createJob(d: Database, record: LinkContext, body: Body): number {
  const title = optionalText(body.role_title) ?? record.role_title;
  const company = optionalText(body.company_name) ?? record.company_name;
  const link = optionalText(body.external_url) ?? record.external_url;
  const missing = [!title && "role title", !company && "company name", !normalizeLink(link) && "job link"].filter(Boolean);
  if (missing.length) throw new ApplicationBoardError(`Add the ${missing.join(", ")} before creating the job.`);
  // An existing job with the same link must be chosen explicitly instead of duplicated.
  const existing = jobCandidates(d, link);
  if (existing.length)
    throw new ApplicationBoardError(`Job #${existing[0]!.id} already has this link. Link that job instead of creating another one.`, 409);
  const row = d.query(`INSERT INTO jobs (linkedin_job_id, title, company_name, comp, link, description)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING id`).get(linkedinJobId(link), title, company, optionalText(body.comp) ?? record.comp,
    new URL(link!).href, optionalText(body.description)) as { id: number };
  return row.id;
}

/**
 * Link an application without a (valid) job to a saved job, or create the job
 * from the application's context. The application keeps its ID, origin,
 * submission, stage and events; empty card fields are copied from the job. A
 * job that already has an application is a conflict and is never merged. Must
 * run inside the caller's transaction.
 */
export function linkJob(d: Database, body: Body): JobLinkResult {
  const record = linkContext(d, id(body.id));
  requireUnlinked(record);
  if ((body.job_id === undefined) === (body.create !== true))
    throw new ApplicationBoardError("Choose a saved job or create one from this application.");
  const created = body.create === true;
  const jobId = created ? createJob(d, record, body) : id(body.job_id);
  const job = d.query(`SELECT ${jobColumns} FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
  if (!job) throw new ApplicationBoardError(`Job #${jobId} not found.`, 404);
  const linked = applicationFor(d, job.id);
  if (linked !== null)
    throw new ApplicationBoardError(`Job #${job.id} already has application #${linked}. Review both records instead of linking another one.`, 409);
  const description = optionalText(body.description);
  if (description && !job.description) d.query("UPDATE jobs SET description = ? WHERE id = ?").run(description, job.id);
  d.query(`UPDATE applications SET job_id = ?, attempt = 1,
      company_name = COALESCE(company_name, ?), role_title = COALESCE(role_title, ?), external_url = COALESCE(external_url, ?),
      comp = COALESCE(comp, ?), updated_at = ? WHERE id = ?`)
    .run(job.id, job.company_name, job.title, job.link, job.comp, now(), record.id);
  d.query("INSERT INTO activity_log (kind, summary, payload_json) VALUES ('application', ?, ?)")
    .run(`Linked application #${record.id} to job #${job.id}`, JSON.stringify({ applicationId: record.id, jobId: job.id, createdJob: created, previousJobId: record.job_id }));
  return { application_id: record.id, job_id: job.id, created_job: created, missing: missingForPreparation({ ...job, description: job.description ?? description }) };
}


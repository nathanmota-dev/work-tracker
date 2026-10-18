import { linkedinJobId, webUrl } from "./identity";

type Row = Record<string, unknown>;
export type SearchJobInput = Record<string, string> & { title: string; company_name: string };
export type SearchSaveResult = {
  key: string;
  status: "saved" | "existing" | "failed";
  job?: Row & { id: number };
  error?: string;
};

function record(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Only arrays, known envelopes and JSON content blocks; never parse prose. */
export function extractSearchRows(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!record(raw)) return undefined;
  let empty: unknown[] | undefined;
  for (const key of ["structuredContent", "jobs", "people", "results", "data", "items", "elements"]) {
    const rows = extractSearchRows(raw[key]);
    if (rows?.length) return rows;
    empty ??= rows;
  }
  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      if (!record(block) || typeof block.text !== "string") continue;
      try {
        const rows = extractSearchRows(JSON.parse(block.text));
        if (rows?.length) return rows;
        empty ??= rows;
      } catch { /* Non-JSON text remains readable, but cannot be saved. */ }
    }
  }
  return empty;
}

export function structuredSearchRows(raw: unknown): unknown[] {
  return extractSearchRows(raw) ?? [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Normalize the supported LinkedIn search fields into the manual-save contract. */
export function normalizeSearchJob(raw: unknown): { job: SearchJobInput | null; error?: string } {
  const fail = (error: string) => ({ job: null, error });
  if (!record(raw)) return fail("A structured job result is required.");
  const title = stringValue(raw.title ?? raw.job_title);
  const company = raw.company_name ?? raw.company;
  const companyName = stringValue(record(company) ? company.name : company);
  if (!title || !companyName) return fail("A role title and company name are required.");
  const job: SearchJobInput = { title, company_name: companyName, source: "linkedin", status: "saved" };
  const aliases = {
    link: raw.link ?? raw.url ?? raw.job_url,
    location: record(raw.location) ? raw.location.name ?? raw.location : raw.location,
    work_type: raw.work_type ?? raw.workType,
    description: raw.description ?? raw.job_description,
    comp: raw.comp ?? raw.salary,
  };
  for (const [key, value] of Object.entries(aliases)) {
    if (value === undefined || value === null || value === "") continue;
    const normalized = stringValue(value);
    if (!normalized) return fail(`${key} must be text.`);
    job[key] = normalized;
  }
  if (job.link && !webUrl(job.link)) return fail("A valid HTTP or HTTPS job link without credentials is required.");
  const id = raw.linkedin_job_id ?? raw.job_id ?? raw.id;
  if (id !== undefined && id !== null) {
    const normalized = typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : stringValue(id);
    if (!normalized) return fail("The job ID must be text or a positive integer.");
    job.linkedin_job_id = normalized;
  }
  const fromUrl = linkedinJobId(job.link ?? null);
  if (fromUrl && job.linkedin_job_id && fromUrl !== job.linkedin_job_id)
    return fail("The job ID and LinkedIn URL identify different jobs.");
  if (!job.link && !job.linkedin_job_id) return fail("A job link or LinkedIn job ID is required for deduplication.");
  if (!job.link) job.link = `https://www.linkedin.com/jobs/view/${encodeURIComponent(job.linkedin_job_id!)}/`;
  return { job };
}

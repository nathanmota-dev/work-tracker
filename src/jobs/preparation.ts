import type { PreparationField } from "../applications/types.ts";
import { normalizeLink } from "./identity.ts";

/** Data a job lacks for resume preparation; a LinkedIn ID lets Apply fetch the description. */
export function missingForPreparation(job: { title: string | null; company_name: string | null; link: string | null; linkedin_job_id?: string | null; description: string | null }): PreparationField[] {
  const missing: PreparationField[] = [];
  if (!job.title?.trim()) missing.push("role_title");
  if (!job.company_name?.trim()) missing.push("company_name");
  if (!normalizeLink(job.link)) missing.push("external_url");
  if (!job.description?.trim() && !job.linkedin_job_id) missing.push("description");
  return missing;
}

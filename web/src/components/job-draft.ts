import type { Row } from "@/lib/api"
import type { PreparationField } from "@/lib/application-board"

export const JOB_FIELDS = {
  title: "Role title", company_name: "Company name", link: "Job link", location: "Location",
  work_type: "Work type", comp: "Compensation", deadline: "Application deadline", source: "Source", source_job_id: "Source job ID",
  linkedin_job_id: "LinkedIn job ID", fit: "Fit", status: "Status",
  requirements_json: "Requirements (JSON)", description: "Job description",
}
export type JobField = keyof typeof JOB_FIELDS
export type Draft = Record<JobField, string>

const initialValue = (key: string) => key === "status" ? "saved" : ""

export function jobDraft(job?: Row): Draft {
  return Object.fromEntries(Object.keys(JOB_FIELDS).map(key => [key, String(job?.[key] ?? initialValue(key))])) as Draft
}

/** What a job page filled, plus the published description the posting check reads on save. */
export type ImportedJob = { fields: Partial<Draft>; description_source?: string }

/**
 * Apply an import over the draft. Values a previous import filled and nobody edited
 * are cleared first, so a second link never keeps details of the first.
 */
export function applyImport(draft: Draft, previous: ImportedJob | null, next: ImportedJob): Draft {
  const result = { ...draft }
  for (const [key, value] of Object.entries(previous?.fields ?? {}) as [JobField, string][])
    if (result[key] === value) result[key] = initialValue(key)
  return { ...result, ...next.fields }
}

/** The fields to save: an untouched imported description is sent as published. */
export function jobBody(draft: Draft, imported: ImportedJob | null): Draft {
  const source = imported?.description_source
  return source && draft.description === imported.fields.description ? { ...draft, description: source } : draft
}

export function preparationMissing(draft: Draft): PreparationField[] {
  const missing: PreparationField[] = []
  if (!draft.title.trim()) missing.push("role_title")
  if (!draft.company_name.trim()) missing.push("company_name")
  if (!draft.link.trim()) missing.push("external_url")
  if (!draft.description.trim() && !draft.linkedin_job_id.trim() && !(draft.source.toLowerCase() === "linkedin" && draft.source_job_id.trim())
    && !/^https?:\/\/(?:[\w-]+\.)?linkedin\.com\/jobs\/view\/(?:[^/]*-)?\d+/i.test(draft.link)) missing.push("description")
  return missing
}

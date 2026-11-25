import { useState } from "react"
import { useSubmit } from "@/components/form-dialog"
import { FormSection, FormSheet } from "@/components/form-sheet"
import { Field } from "@/components/workspace-ui"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PREPARATION_FIELDS } from "@/components/job-link-dialog"
import { request, type Row } from "@/lib/api"
import type { PreparationField } from "@/lib/application-board"
import { parsePostingGuard } from "@/components/posting-check"

const fields = {
  title: "Role title", company_name: "Company name", link: "Job link", location: "Location",
  work_type: "Work type", comp: "Compensation", deadline: "Application deadline", source: "Source", source_job_id: "Source job ID",
  linkedin_job_id: "LinkedIn job ID", fit: "Fit", status: "Status",
  requirements_json: "Requirements (JSON)", description: "Job description",
}
type Draft = Record<keyof typeof fields, string>
const sections: { title: string; keys: (keyof typeof fields)[]; wide?: boolean }[] = [
  { title: "Role", keys: ["title", "company_name", "link", "location", "work_type", "comp"] },
  { title: "Tracking", keys: ["status", "fit", "deadline", "source", "source_job_id", "linkedin_job_id"] },
  { title: "Details", keys: ["description", "requirements_json"], wide: true },
]
export type JobSaveResult = { job: Row; existing: boolean; missing: PreparationField[] }

/** The verdict of the posting check on a description saved with this form, if any. */
export function postingNotice(result: JobSaveResult): string {
  return parsePostingGuard(result.job.description_guard_json)?.verdict ?? ""
}

function preparationMissing(draft: Draft): PreparationField[] {
  const missing: PreparationField[] = []
  if (!draft.title.trim()) missing.push("role_title")
  if (!draft.company_name.trim()) missing.push("company_name")
  if (!draft.link.trim()) missing.push("external_url")
  if (!draft.description.trim() && !draft.linkedin_job_id.trim() && !(draft.source.toLowerCase() === "linkedin" && draft.source_job_id.trim())
    && !/^https?:\/\/(?:[\w-]+\.)?linkedin\.com\/jobs\/view\/(?:[^/]*-)?\d+/i.test(draft.link)) missing.push("description")
  return missing
}

/** Saving needs a title and company; preparation also needs a URL and description. */
export function JobForm({ job, onClose, onSaved }: {
  job?: Row
  onClose: () => void
  onSaved: (result: JobSaveResult) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(Object.keys(fields)
    .map(key => [key, String(job?.[key] ?? (key === "status" ? "saved" : ""))])) as Draft)
  const { busy, error, submit } = useSubmit()
  const missing = preparationMissing(draft)
  const set = (key: keyof Draft, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  return (
    <FormSheet
      title={job ? "Edit job" : "Add job"}
      description="Save an opportunity directly. Add its link and description when you are ready to prepare an application."
      busy={busy}
      error={error}
      submitLabel="Save job"
      canSubmit={!!draft.title.trim() && !!draft.company_name.trim()}
      onClose={onClose}
      onSubmit={() => void submit(async () => {
        const result = await request<JobSaveResult>(`jobs/${job ? "update" : "create"}`, { ...draft, ...(job ? { id: job.id } : {}) })
        onSaved(result)
      })}
      footer={missing.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Missing for preparation: {missing.map(key => PREPARATION_FIELDS[key]).join(", ")}.
        </p>
      )}
    >
      {sections.map(section => (
        <fieldset key={section.title} disabled={busy}>
          <FormSection title={section.title} className={section.wide ? "sm:grid-cols-1" : undefined}>
            {section.keys.map(key => (
              <Field key={key} label={fields[key]}>
                {section.wide ? (
                  <Textarea className={key === "description" ? "min-h-40" : undefined} value={draft[key]} onChange={e => set(key, e.target.value)} />
                ) : (
                  <Input type={key === "link" ? "url" : key === "deadline" ? "date" : "text"} required={key === "title" || key === "company_name"}
                    value={draft[key]} onChange={e => set(key, e.target.value)} />
                )}
              </Field>
            ))}
          </FormSection>
        </fieldset>
      ))}
    </FormSheet>
  )
}

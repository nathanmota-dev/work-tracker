import { useState } from "react"
import { FormDialog, useSubmit } from "@/components/form-dialog"
import { Field } from "@/components/workspace-ui"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PREPARATION_FIELDS } from "@/components/job-link-dialog"
import { request, type Row } from "@/lib/api"
import type { PreparationField } from "@/lib/application-board"

const fields = {
  title: "Role title", company_name: "Company name", link: "Job link", location: "Location",
  work_type: "Work type", comp: "Compensation", deadline: "Application deadline", source: "Source", source_job_id: "Source job ID",
  linkedin_job_id: "LinkedIn job ID", fit: "Fit", status: "Status",
  requirements_json: "Requirements (JSON)", description: "Job description",
}
type Draft = Record<keyof typeof fields, string>
export type JobSaveResult = { job: Row; existing: boolean; missing: PreparationField[] }

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
  return (
    <FormDialog
      title={job ? "Edit job" : "Add job"}
      description="Save an opportunity directly. Add its link and description when you are ready to prepare an application."
      busy={busy}
      error={error}
      submitLabel="Save job"
      canSubmit={!!draft.title.trim() && !!draft.company_name.trim()}
      className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      onClose={onClose}
      onSubmit={() => void submit(async () => {
        const result = await request<JobSaveResult>(`jobs/${job ? "update" : "create"}`, { ...draft, ...(job ? { id: job.id } : {}) })
        onSaved(result)
      })}
    >
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        {(Object.entries(fields) as [keyof Draft, string][]).map(([key, label]) => (
          <Field key={key} label={label}>
            {key === "description" || key === "requirements_json" ? (
              <Textarea value={draft[key]} onChange={e => setDraft(previous => ({ ...previous, [key]: e.target.value }))} />
            ) : (
              <Input type={key === "link" ? "url" : key === "deadline" ? "date" : "text"} required={key === "title" || key === "company_name"}
                value={draft[key]} onChange={e => setDraft(previous => ({ ...previous, [key]: e.target.value }))} />
            )}
          </Field>
        ))}
      </fieldset>
      {missing.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          Missing for preparation: {missing.map(key => PREPARATION_FIELDS[key]).join(", ")}.
        </p>
      )}
    </FormDialog>
  )
}

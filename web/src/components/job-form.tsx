import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { useSubmit } from "@/components/form-dialog"
import { FormSection, FormSheet } from "@/components/form-sheet"
import { Field } from "@/components/workspace-ui"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PREPARATION_FIELDS } from "@/components/job-link-dialog"
import { applyImport, jobBody, jobDraft, JOB_FIELDS, preparationMissing, type Draft, type JobField } from "@/components/job-draft"
import { JobLinkField, useJobImport } from "@/components/job-link-field"
import { request, type Row } from "@/lib/api"
import type { PreparationField } from "@/lib/application-board"
import { parsePostingGuard } from "@/components/posting-check"

const ROLE: JobField[] = ["title", "company_name", "location", "work_type", "comp"]
const MORE: JobField[] = ["status", "fit", "deadline", "source", "source_job_id", "linkedin_job_id"]
export type JobSaveResult = { job: Row; existing: boolean; missing: PreparationField[] }

/** The verdict of the posting check on a description saved with this form, if any. */
export function postingNotice(result: JobSaveResult): string {
  return parsePostingGuard(result.job.description_guard_json)?.verdict ?? ""
}

type FieldProps = { draft: Draft; set: (key: JobField, value: string) => void }

function TextFields({ keys, draft, set }: FieldProps & { keys: JobField[] }) {
  return keys.map(key => (
    <Field key={key} label={JOB_FIELDS[key]}>
      <Input type={key === "deadline" ? "date" : "text"} required={key === "title" || key === "company_name"}
        value={draft[key]} onChange={e => set(key, e.target.value)} />
    </Field>
  ))
}

function LongField({ field, className, draft, set }: FieldProps & { field: JobField; className?: string }) {
  return (
    <Field label={JOB_FIELDS[field]}>
      <Textarea className={className} value={draft[field]} onChange={e => set(field, e.target.value)} />
    </Field>
  )
}

/** Tracking and identity fields, collapsed because most jobs need none of them. */
function MoreDetails({ draft, set }: FieldProps) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        More details
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><TextFields keys={MORE} draft={draft} set={set} /></div>
        <LongField field="requirements_json" draft={draft} set={set} />
      </div>
    </details>
  )
}

/** Saving needs a title and company; preparation also needs a URL and description. */
export function JobForm({ job, onClose, onSaved }: {
  job?: Row
  onClose: () => void
  onSaved: (result: JobSaveResult) => void
}) {
  const [draft, setDraft] = useState(() => jobDraft(job))
  const { busy, error, submit } = useSubmit()
  const importer = useJobImport((previous, next) => setDraft(current => applyImport(current, previous, next)))
  const missing = preparationMissing(draft)
  const locked = busy || importer.importing
  const set = (key: JobField, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  return (
    <FormSheet
      title={job ? "Edit job" : "Add job"}
      description={job ? "Update the saved opportunity." : "Paste a job link to fill the form, or type the details."}
      busy={busy}
      error={error}
      submitLabel="Save job"
      canSubmit={!importer.importing && !!draft.title.trim() && !!draft.company_name.trim()}
      onClose={onClose}
      onSubmit={() => void submit(async () => {
        const body = jobBody(draft, importer.imported)
        const result = await request<JobSaveResult>(`jobs/${job ? "update" : "create"}`, { ...body, ...(job ? { id: job.id } : {}) })
        onSaved(result)
      })}
      footer={missing.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Missing for preparation: {missing.map(key => PREPARATION_FIELDS[key]).join(", ")}.
        </p>
      )}
    >
      <fieldset disabled={busy}>
        <JobLinkField value={draft.link} onChange={value => set("link", value)} importer={job ? undefined : importer} />
      </fieldset>
      <fieldset disabled={locked}>
        {/* The role title takes a full row, leaving the other fields in pairs. */}
        <FormSection title="Role" className="sm:[&>:first-child]:col-span-2"><TextFields keys={ROLE} draft={draft} set={set} /></FormSection>
      </fieldset>
      <fieldset disabled={locked}>
        <LongField field="description" className="min-h-40" draft={draft} set={set} />
      </fieldset>
      <fieldset disabled={locked}>
        <MoreDetails draft={draft} set={set} />
      </fieldset>
    </FormSheet>
  )
}

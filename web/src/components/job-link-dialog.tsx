import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormDialog, useSubmit } from "@/components/form-dialog"
import { Field, LoadState } from "@/components/workspace-ui"
import {
  boardAction,
  type JobCandidate,
  type JobLinkOptions,
  type JobLinkResult,
  type PreparationField,
} from "@/lib/application-board"

export const PREPARATION_FIELDS: Record<PreparationField, string> = {
  role_title: "role title",
  company_name: "company name",
  external_url: "job link",
  description: "job description",
}
const CREATE = "create"

function useLinkOptions(applicationId: number) {
  const [options, setOptions] = useState<JobLinkOptions>()
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError("")
    boardAction("link/options", { id: applicationId })
      .then((value) => {
        if (active) setOptions(value)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [applicationId, revision])
  return { options, error, retry: () => setRevision((value) => value + 1) }
}

function CandidateChoice({ candidate, checked, onChoose }: {
  candidate: JobCandidate
  checked: boolean
  onChoose: () => void
}) {
  const blocked = candidate.application_id !== null
  return (
    <label className="flex gap-3 rounded-lg border p-3 text-sm has-disabled:opacity-60">
      <input
        type="radio"
        name="job"
        checked={checked}
        disabled={blocked}
        onChange={onChoose}
      />
      <span className="min-w-0">
        <span className="block font-medium">
          #{candidate.id} · {candidate.company_name ?? "Unknown company"} ·{" "}
          {candidate.title ?? "Untitled role"}
          {candidate.archived_at ? " (archived)" : ""}
        </span>
        <span className="block break-all text-xs text-muted-foreground">
          {candidate.match === "linkedin_id" ? "Same LinkedIn job ID" : "Same link"}
          {candidate.link ? ` · ${candidate.link}` : ""}
        </span>
        {blocked && (
          <span className="block text-xs text-destructive">
            Already linked to application #{candidate.application_id}. Review
            both records instead of linking another one.
          </span>
        )}
      </span>
    </label>
  )
}

type Draft = Record<"role_title" | "company_name" | "external_url" | "comp" | "description", string>

function CreateFields({ draft, change }: {
  draft: Draft
  change: (key: keyof Draft, value: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Role title">
        <Input required aria-invalid={!draft.role_title.trim()} value={draft.role_title} onChange={(e) => change("role_title", e.target.value)} />
      </Field>
      <Field label="Company name">
        <Input required aria-invalid={!draft.company_name.trim()} value={draft.company_name} onChange={(e) => change("company_name", e.target.value)} />
      </Field>
      <Field label="Job link">
        <Input type="url" required aria-invalid={!draft.external_url.trim()} value={draft.external_url} onChange={(e) => change("external_url", e.target.value)} />
      </Field>
      <Field label="Compensation">
        <Input value={draft.comp} onChange={(e) => change("comp", e.target.value)} />
      </Field>
    </div>
  )
}

/**
 * Link an application to the saved job behind it, or create that job from the
 * application's data. Several plausible jobs are listed for an explicit choice;
 * nothing is linked automatically.
 */
export function JobLinkDialog({ applicationId, title, actionLabel = "Link job", onClose, onLinked }: {
  applicationId: number
  title: string
  actionLabel?: string
  onClose: () => void
  onLinked: (result: JobLinkResult) => void
}) {
  const { options, error: loadError, retry } = useLinkOptions(applicationId)
  const [choice, setChoice] = useState<string>()
  const [draft, setDraft] = useState<Draft>()
  const { busy, error, submit } = useSubmit()
  useEffect(() => {
    if (!options) return
    setDraft({ role_title: options.role_title ?? "", company_name: options.company_name ?? "", external_url: options.external_url ?? "", comp: options.comp ?? "", description: "" })
    setChoice((current) => current ?? (options.candidates.length ? undefined : CREATE))
  }, [options])
  const change = (key: keyof Draft, value: string) => setDraft((previous) => previous && { ...previous, [key]: value })
  const creating = choice === CREATE
  const incomplete = creating && !!draft && (!draft.role_title.trim() || !draft.company_name.trim() || !draft.external_url.trim())
  const missing = creating && draft
    ? (Object.keys(PREPARATION_FIELDS) as PreparationField[]).filter((key) => !draft[key].trim())
    : []
  const save = () =>
    submit(async () => {
      if (!draft || !choice) return
      const description = draft.description.trim() || undefined
      onLinked(await boardAction("link", creating
        ? { id: applicationId, create: true, role_title: draft.role_title, company_name: draft.company_name, external_url: draft.external_url, comp: draft.comp || undefined, description }
        : { id: applicationId, job_id: Number(choice), description }))
    })
  return (
    <FormDialog
      title={title}
      description="Apply needs a saved job. Choose the job behind this application or create it from the application’s data."
      busy={busy}
      error={error}
      submitLabel={actionLabel}
      canSubmit={!!draft && !!choice && !incomplete}
      className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      before={<LoadState loading={!options && !loadError} error={loadError} retry={retry} />}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      {options && draft && (
        <>
          <fieldset disabled={busy} className="space-y-3">
            {options.candidates.length > 1 && (
              <p role="status" className="text-sm">Several saved jobs match this application. Choose the right one.</p>
            )}
            {options.candidates.map((candidate) => (
              <CandidateChoice key={candidate.id} candidate={candidate} checked={choice === String(candidate.id)} onChoose={() => setChoice(String(candidate.id))} />
            ))}
            <label className="flex gap-3 rounded-lg border p-3 text-sm font-medium">
              <input type="radio" name="job" checked={creating} onChange={() => setChoice(CREATE)} />
              Create a job from this application
            </label>
            {creating && <CreateFields draft={draft} change={change} />}
            <Field label="Job description">
              <Textarea value={draft.description} onChange={(e) => change("description", e.target.value)} placeholder="Paste the description so the resume can be tailored to it." />
            </Field>
          </fieldset>
          {missing.length > 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              Missing for preparation: {missing.map((key) => PREPARATION_FIELDS[key]).join(", ")}.
            </p>
          )}
        </>
      )}
    </FormDialog>
  )
}

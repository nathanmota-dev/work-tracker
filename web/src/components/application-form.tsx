import { useState } from "react"
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { FormDialog, useSubmit } from "@/components/form-dialog"
import { Field } from "@/components/workspace-ui"
import { TagField } from "@/components/tag-field"
import { useApi, type Row } from "@/lib/api"
import {
  boardAction,
  localDateTime,
  ROLE_TYPES,
  type RoleType,
  type TrackedApplication,
} from "@/lib/application-board"

function initialDraft(application?: TrackedApplication) {
  return {
    job_id: "",
    company_name: application?.company_name ?? "",
    external_url: application?.external_url ?? "",
    role_title: application?.role_title ?? "",
    role_type: application?.role_type ?? "",
    stack: application?.stack.join(", ") ?? "",
    comp: application?.comp ?? "",
    company_url: application?.company_url ?? "",
    notes: application?.notes ?? "",
    deadline: application?.deadline ?? "",
    applied_at: localDateTime(
      application?.applied_at ?? new Date().toISOString(),
    ),
  }
}
type Draft = ReturnType<typeof initialDraft>

function applicationFields(draft: Draft, application?: TrackedApplication) {
  return {
    ...draft,
    job_id: Number(draft.job_id) || null,
    role_type: (draft.role_type || null) as RoleType | null,
    stack: draft.stack
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    applied_at: draft.applied_at
      ? application &&
        draft.applied_at === localDateTime(application.applied_at)
        ? application.applied_at
        : new Date(draft.applied_at).toISOString()
      : undefined,
  }
}

function ApplicationFieldset({ draft, busy, change }: {
  draft: Draft
  busy: boolean
  change: (key: keyof Draft, value: string) => void
}) {
  return (
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <Field label="Company name">
        <Input
          required
          value={draft.company_name}
          onChange={(e) => change("company_name", e.target.value)}
          placeholder="Company"
        />
      </Field>
      <Field label="Job link">
        <Input
          type="url"
          required
          value={draft.external_url}
          onChange={(e) => change("external_url", e.target.value)}
          placeholder="https://company.com/careers/role"
        />
      </Field>
      <Field label="Role title">
        <Input
          value={draft.role_title}
          onChange={(e) => change("role_title", e.target.value)}
          placeholder="e.g. Senior Software Engineer"
        />
      </Field>
      <Field label="Role type">
        <SelectControl
          aria-label="Role type"
          value={draft.role_type}
          onChange={(e) => change("role_type", e.target.value)}
        >
          <option value="">Not specified</option>
          {Object.entries(ROLE_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectControl>
      </Field>
      <TagField
        label="Stack"
        value={draft.stack}
        onChange={(value) => change("stack", value)}
        suggestions={["React", "TypeScript", "Node.js", "Python", "Java", "Go", "PostgreSQL", "AWS", "Docker", "Kubernetes"]}
        placeholder="React, TypeScript..."
      />
      <Field label="Compensation">
        <Input
          value={draft.comp}
          onChange={(e) => change("comp", e.target.value)}
          placeholder="e.g. R$ 12k/month or US$ 80–100k/year"
        />
      </Field>
      <Field label="Company website">
        <Input
          type="url"
          value={draft.company_url}
          onChange={(e) => change("company_url", e.target.value)}
          placeholder="https://company.com"
        />
      </Field>
      <Field label="Application deadline">
        <DatePicker
          value={draft.deadline}
          onChange={(value) => change("deadline", value)}
        />
      </Field>
      <Field label="Applied at">
        <DateTimePicker
          label="Applied at"
          value={draft.applied_at}
          onChange={(value) => change("applied_at", value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <Textarea
            value={draft.notes}
            onChange={(e) => change("notes", e.target.value)}
            placeholder="Anything you want to remember about this role"
          />
        </Field>
      </div>
    </fieldset>
  )
}

/** Saved job fields copied into empty card fields when a job is chosen. */
const JOB_FIELDS = { company_name: "company_name", external_url: "link", role_title: "title", comp: "comp" } as const

function SavedJob({ draft, busy, choose }: {
  draft: Draft
  busy: boolean
  choose: (job: Row | undefined) => void
}) {
  const jobs = useApi<Row[]>("jobs")
  const available = jobs.data?.filter((job) => !job.archived_at) ?? []
  return (
    <Field label="Saved job">
      <SelectControl
        aria-label="Saved job"
        disabled={busy || !available.length}
        value={draft.job_id}
        onChange={(e) => choose(available.find((job) => String(job.id) === e.target.value))}
      >
        <option value="">{available.length ? "Not linked to a saved job" : "No saved jobs"}</option>
        {available.map((job) => (
          <option key={String(job.id)} value={String(job.id)}>
            {String(job.company_name ?? "Unknown company")} · {String(job.title ?? "Untitled role")}
          </option>
        ))}
      </SelectControl>
    </Field>
  )
}

export function ApplicationForm({
  application,
  onClose,
  onSaved,
}: {
  application?: TrackedApplication
  onClose: () => void
  onSaved: (application: TrackedApplication) => void
}) {
  const [draft, setDraft] = useState(() => initialDraft(application))
  // One key per opened form: a retried save returns the first registration.
  const [requestId] = useState(() => crypto.randomUUID())
  const { busy, error, submit } = useSubmit()
  const change = (key: keyof typeof draft, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  // A chosen job fills only empty fields, so typed values are kept.
  const choose = (job: Row | undefined) =>
    setDraft((previous) => {
      const next = { ...previous, job_id: job ? String(job.id) : "" }
      for (const [key, column] of Object.entries(JOB_FIELDS) as [keyof typeof JOB_FIELDS, string][])
        if (job?.[column] && !next[key].trim()) next[key] = String(job[column])
      return next
    })
  const save = () =>
    submit(async () => {
      const fields = applicationFields(draft, application)
      // Editing never relinks: the job link is chosen only at registration.
      const { job_id: _jobId, ...card } = fields
      const saved = application
        ? await boardAction("update", { ...card, id: application.id })
        : await boardAction("create", { ...fields, request_id: requestId })
      onSaved(saved)
      onClose()
    })
  return (
    <FormDialog
      title={application ? "Edit application" : "New application"}
      description="Only the company name and job link are required. Choosing a saved job keeps this application linked to it."
      busy={busy}
      error={error}
      submitLabel="Save application"
      canSubmit={!!draft.company_name.trim() && !!draft.external_url.trim()}
      className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      onClose={onClose}
      onSubmit={() => void save()}
    >
      {!application && <SavedJob draft={draft} busy={busy} choose={choose} />}
      <ApplicationFieldset draft={draft} busy={busy} change={change} />
    </FormDialog>
  )
}

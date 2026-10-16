import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field } from "@/components/workspace-ui"
import {
  boardAction,
  localDateTime,
  ROLE_TYPES,
  type RoleType,
  type TrackedApplication,
} from "@/lib/application-board"

function initialDraft(application?: TrackedApplication) {
  return {
    company_name: application?.company_name ?? "",
    external_url: application?.external_url ?? "",
    role_title: application?.role_title ?? "",
    role_type: application?.role_type ?? "",
    stack: application?.stack.join(", ") ?? "",
    comp: application?.comp ?? "",
    company_url: application?.company_url ?? "",
    notes: application?.notes ?? "",
    applied_at: localDateTime(
      application?.applied_at ?? new Date().toISOString(),
    ),
  }
}
type Draft = ReturnType<typeof initialDraft>

function applicationFields(draft: Draft, application?: TrackedApplication) {
  return {
    ...draft,
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
      <Field label="Stack">
        <Input
          value={draft.stack}
          onChange={(e) => change("stack", e.target.value)}
          placeholder="React, TypeScript, Node.js"
        />
      </Field>
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
      <Field label="Applied at">
        <Input
          type="datetime-local"
          value={draft.applied_at}
          onChange={(e) => change("applied_at", e.target.value)}
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const change = (key: keyof typeof draft, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  async function save() {
    setBusy(true)
    setError("")
    try {
      const fields = applicationFields(draft, application)
      const saved = application
        ? await boardAction("update", { ...fields, id: application.id })
        : await boardAction("create", fields)
      onSaved(saved)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {application ? "Edit application" : "New application"}
          </DialogTitle>
          <DialogDescription>
            Only the company name and job link are required.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <ApplicationFieldset draft={draft} busy={busy} change={change} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              disabled={
                busy || !draft.company_name.trim() || !draft.external_url.trim()
              }
            >
              {busy ? "Saving…" : "Save application"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

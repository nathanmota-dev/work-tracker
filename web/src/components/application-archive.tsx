import { useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { FormDialog, useSubmit } from "@/components/form-dialog"
import { Field } from "@/components/workspace-ui"
import {
  ARCHIVE_REASONS,
  boardAction,
  type ArchiveReason,
  type TrackedApplication,
} from "@/lib/application-board"

export function ApplicationArchive({
  application,
  onClose,
  onSaved,
}: {
  application: TrackedApplication
  onClose: () => void
  onSaved: (application: TrackedApplication) => void
}) {
  const [reason, setReason] = useState<ArchiveReason>("rejected")
  const [note, setNote] = useState("")
  const { busy, error, submit } = useSubmit()
  const save = () =>
    submit(async () => {
      onSaved(
        await boardAction("archive", { id: application.id, reason, note }),
      )
      onClose()
    })
  return (
    <FormDialog
      title={`Archive ${application.company_name}`}
      description="The last stage and full history stay saved. You can reopen this application later."
      busy={busy}
      error={error}
      submitLabel="Archive application"
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <Field label="Outcome">
        <SelectControl
          aria-label="Outcome"
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value as ArchiveReason)}
        >
          {Object.entries(ARCHIVE_REASONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectControl>
      </Field>
      <Field label="Closing note">
        <Textarea
          disabled={busy}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </FormDialog>
  )
}

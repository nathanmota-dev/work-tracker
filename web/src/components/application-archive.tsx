import { useState } from "react"
import { Button } from "@/components/ui/button"
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save() {
    setBusy(true)
    setError("")
    try {
      onSaved(
        await boardAction("archive", { id: application.id, reason, note }),
      )
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
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Archive {application.company_name}</DialogTitle>
          <DialogDescription>
            The last stage and full history stay saved. You can reopen this
            application later.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
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
            <Button disabled={busy}>
              {busy ? "Saving…" : "Archive application"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

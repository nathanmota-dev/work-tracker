import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Run one save at a time; a failure stays visible until the next attempt. */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(action: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

/**
 * Modal form with the shared error, Cancel and submit row. It cannot be closed
 * while saving, so a pending save never loses its result.
 *
 * @param before Content shown above the form, such as a loading state.
 */
export function FormDialog({
  title,
  description,
  busy,
  error,
  submitLabel,
  canSubmit = true,
  className,
  before,
  onClose,
  onSubmit,
  children,
}: {
  title: ReactNode
  description: ReactNode
  busy: boolean
  error: string
  submitLabel: string
  canSubmit?: boolean
  className?: string
  before?: ReactNode
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className={className} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {before}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          {children}
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
            <Button disabled={busy || !canSubmit}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Runs a save once at a time, keeping its busy state and error message. */
export function useSave() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function run(save: () => Promise<void> | void) {
    setBusy(true); setError("")
    try { await save() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

/**
 * A profile section opened in place: its fields, any error, and the footer
 * with a note, Cancel and Save. Escape cancels while nothing is saving.
 */
export function InlineEditorForm({ busy, error, canSave, note, onSubmit, onClose, className, children }: {
  busy: boolean; error: string; canSave: boolean; note: string; onSubmit: () => void; onClose: () => void; className?: string; children: ReactNode
}) {
  return (
    <form noValidate className={cn("space-y-4 rounded-xl border bg-muted/20 p-4 animate-in fade-in-0", className)} onSubmit={event => { event.preventDefault(); onSubmit() }}
      onKeyDown={event => { if (event.key === "Escape" && !busy) onClose() }}>
      {children}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        <p className="mr-auto text-xs text-muted-foreground">{note}</p>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={busy || !canSave}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  )
}

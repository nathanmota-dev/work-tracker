import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Row } from "@/lib/api"

/**
 * Asks before a prepared application moves to Tracking: submitting is never
 * undone, so the candidate confirms they already submitted it in the portal.
 */
export function AdvanceDialog({ row, stage, busy = false, error = "", onConfirm, onCancel }: {
  row: Row | null
  /** Name of the board stage the card was dropped on, when it was dragged. */
  stage?: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Tracking?</DialogTitle>
          <DialogDescription>
            {row ? `Confirm that you already submitted "${String(row.job_title ?? "")}" at ${String(row.company_name ?? "")} in the portal. It will be marked as submitted and ${stage ? `placed in ${stage}` : "added to the board"}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">A submission cannot be undone.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy} onClick={onConfirm}>{busy ? "Saving…" : "Yes, I submitted it"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

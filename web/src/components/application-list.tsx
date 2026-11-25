import { useState } from "react"
import { Button } from "@/components/ui/button"
import { text, type Row } from "@/lib/api"
import { ArrowRight } from "lucide-react"
import { AdvanceDialog } from "@/components/advance-dialog"
import { boardAction } from "@/lib/application-board"
import {
  ORIGINS,
  canAdvance,
  PHASE_LABELS,
  nextStep,
  type ApplicationOrigin,
  type JourneyPhase,
} from "@/lib/application-journey"

export function originLabel(row: Row) {
  return ORIGINS[row.origin as ApplicationOrigin] ?? ORIGINS.unknown
}
export function phaseLabel(value: unknown) {
  return PHASE_LABELS[value as JourneyPhase] ?? PHASE_LABELS.draft
}

/** Board view of Applications, scrolled to one card; archived records open on that tab. */
export function boardHref(row: Row) {
  return `#/applications?view=board${row.view === "archived" ? "&tab=archived" : ""}&highlight=${text(row.id)}`
}

/** Moves the application forward: its detail while preparing, the board once tracked. */
export function NextStepAction({
  row,
  onPrepare,
}: {
  row: Row
  onPrepare: (row: Row) => void
}) {
  const step = nextStep(row)
  if (step.kind === "review")
    return <span className="text-xs text-muted-foreground">{step.label}</span>
  if (step.kind === "board")
    return (
      <Button asChild size="sm" variant="outline">
        <a href={boardHref(row)}>{step.label}</a>
      </Button>
    )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => onPrepare(row)}>
        {step.label}
      </Button>
      {canAdvance(row) && <AdvanceButton row={row} />}
    </div>
  )
}

/** Advances a prepared application to Tracking once the candidate submitted it in the portal. */
export function useAdvance(row: Row) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function advance() {
    setBusy(true)
    setError("")
    try {
      await boardAction("submit", { id: Number(row.id) })
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return {
    ask: () => { setError(""); setOpen(true) },
    dialog: <AdvanceDialog row={open ? row : null} busy={busy} error={error} onConfirm={() => void advance()} onCancel={() => setOpen(false)} />,
  }
}

function AdvanceButton({ row }: { row: Row }) {
  const advance = useAdvance(row)
  return (
    <>
      <Button size="sm" variant="ghost" title="Move to Tracking after you submitted it in the portal" onClick={advance.ask}>
        Advance to next step
        <ArrowRight className="size-4" />
      </Button>
      {advance.dialog}
    </>
  )
}

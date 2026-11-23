import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, Panel } from "@/components/workspace-ui"
import { QuietTable } from "@/components/quiet-table"
import { useApi } from "@/lib/api"
import {
  boardAction,
  QUIET_MIN_DAYS,
  QUIET_STALE_DAYS,
  quietPath,
  type QuietApplications as QuietScan,
  type QuietResolution,
} from "@/lib/application-board"

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`
const validDays = (value: string) =>
  /^\d+$/.test(value) && Number(value) >= QUIET_MIN_DAYS ? Number(value) : null

function ResolutionSummary({ result, names }: { result: QuietResolution; names: Map<number, string> }) {
  return (
    <div role="status" className="space-y-1 text-sm">
      <p>Closed {plural(result.resolved.length, "application")} as No response.</p>
      {result.skipped.length > 0 && (
        <ul aria-label="Skipped applications" className="text-xs text-muted-foreground">
          {result.skipped.map((item) => (
            <li key={item.id}>
              {names.get(item.id) ?? `#${item.id}`}: {item.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UnreadableList({ skipped }: { skipped: QuietScan["skipped"] }) {
  if (!skipped.length) return null
  return (
    <ul aria-label="Applications with unreadable dates" className="text-xs text-muted-foreground">
      {skipped.map((item) => (
        <li key={item.id}>{item.company_name ?? `#${item.id}`}: {item.reason}. It is left open.</li>
      ))}
    </ul>
  )
}

/** The close button, then an explicit confirmation that states the count. */
function CloseActions({ count, confirming, busy, disabled, onConfirming, onClose }: {
  count: number
  confirming: boolean
  busy: boolean
  disabled: boolean
  onConfirming: (confirming: boolean) => void
  onClose: () => void
}) {
  if (!confirming)
    return (
      <div className="flex justify-end">
        <Button disabled={disabled} onClick={() => onConfirming(true)}>Close selected as No response</Button>
      </div>
    )
  return (
    <div role="group" aria-label="Confirm closing" className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        Close {plural(count, "application")} as No response? Each one is archived with a closing note and can be reopened from the board.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => onConfirming(false)}>Keep open</Button>
        <Button disabled={busy} onClick={onClose}>{busy ? "Closing…" : `Close ${plural(count, "application")}`}</Button>
      </div>
    </div>
  )
}

/** Selection, confirmation and closing of one scan; the scan follows the threshold field. */
function QuietReview({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState(String(QUIET_STALE_DAYS))
  const [days, setDays] = useState(QUIET_STALE_DAYS)
  const scan = useApi<QuietScan>(quietPath(days))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<QuietResolution>()
  const [names, setNames] = useState(new Map<number, string>())
  const items = scan.data?.items ?? []
  const chosen = items.filter((item) => selected.has(item.id))
  const invalid = validDays(input) === null
  function threshold(value: string) {
    setInput(value)
    const next = validDays(value)
    if (next === null || next === days) return
    setDays(next)
    setSelected(new Set())
    setConfirming(false)
  }
  async function close() {
    setBusy(true)
    setError("")
    try {
      setNames(new Map(chosen.map((item) => [item.id, item.company_name ?? `#${item.id}`])))
      setResult(await boardAction("quiet/resolve", { ids: chosen.map((item) => item.id), days }))
      setSelected(new Set())
      setConfirming(false)
      scan.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Quiet applications</DialogTitle>
          <DialogDescription>
            Submitted applications with no activity since they were sent or last moved. Offers and drafts are never included.
          </DialogDescription>
        </DialogHeader>
        <Field label="Days without activity">
          <Input
            type="number"
            min={QUIET_MIN_DAYS}
            aria-invalid={invalid}
            disabled={busy}
            value={input}
            onChange={(e) => threshold(e.target.value)}
          />
        </Field>
        {invalid && <p role="alert" className="text-sm text-destructive">Use a whole number of at least {QUIET_MIN_DAYS} days.</p>}
        {scan.error && <p role="alert" className="text-sm text-destructive">{scan.error}</p>}
        {result && <ResolutionSummary result={result} names={names} />}
        {scan.data && (
          <QuietTable
            items={items}
            selected={selected}
            disabled={busy || confirming}
            onChange={setSelected}
          />
        )}
        <UnreadableList skipped={scan.data?.skipped ?? []} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <CloseActions
          count={chosen.length}
          confirming={confirming}
          busy={busy}
          disabled={!chosen.length || invalid}
          onConfirming={setConfirming}
          onClose={() => void close()}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Banner for submitted applications that went quiet for the default sweep
 * threshold. Review opens the sweep; nothing is closed without confirmation.
 */
export function QuietApplications() {
  const scan = useApi<QuietScan>(quietPath(QUIET_STALE_DAYS))
  const [open, setOpen] = useState(false)
  const count = scan.data?.items?.length ?? 0
  return (
    <>
      {count > 0 && (
        <Panel
          title={`${plural(count, "application")} quiet for ${QUIET_STALE_DAYS}+ days`}
          action={<Button size="sm" variant="outline" aria-label="Review quiet applications" onClick={() => setOpen(true)}>Review</Button>}
        >
          <p className="text-xs text-muted-foreground">
            No reply or movement since they were sent. Review them and close the ones that will not answer.
          </p>
        </Panel>
      )}
      {open && <QuietReview onClose={() => setOpen(false)} />}
    </>
  )
}

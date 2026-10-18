import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { PreparationRun, RecoveryCheckpoint } from "@/lib/preparation"
const KEPT: Record<RecoveryCheckpoint, string> = { sources: "source snapshot and base PDF", tailored: "tailored sources", compiled: "validated resume", filled: "portal fill result" }
const RETRY: Record<NonNullable<PreparationRun["recovery"]["retryFrom"]>, string> = { preparing: "Retry execution", tailoring: "Continue from tailoring", compiling: "Continue from compilation", filling: "Fill again" }
/**
 * What a stopped execution kept and how it continues. A portal fill that
 * stopped without a result is retried only after the candidate reviews it.
 */
export function RunRecovery({ run, disabled, onRetry }: { run?: PreparationRun; disabled: boolean; onRetry: (reviewed: boolean) => void }) {
  const [reviewed, setReviewed] = useState(false)
  useEffect(() => { setReviewed(false) }, [run?.id, run?.status])
  const recovery = run?.recovery
  if (!run || !recovery?.retryFrom) return null
  const label = run.status === "waiting_for_sign_in" ? "Retry after sign-in" : RETRY[recovery.retryFrom]
  return <section aria-label="Execution recovery" className="space-y-3 rounded-xl border p-4">
    <p role="status" className="text-sm">{recovery.summary}</p>
    {!!recovery.checkpoints.length && <p className="text-xs text-muted-foreground">Kept: {recovery.checkpoints.map(item => KEPT[item]).join(", ")}.</p>}
    {recovery.reviewRequired && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the portal in the browser</label>}
    <Button size="sm" disabled={disabled || (recovery.reviewRequired && !reviewed)} onClick={() => onRetry(reviewed)}>{label}</Button>
  </section>
}

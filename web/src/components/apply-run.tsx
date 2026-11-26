import { Button } from "@/components/ui/button"
import { RunRecovery } from "@/components/run-recovery"
import type { ApplyWorkspaceState } from "@/lib/apply-workspace"

type Props = { w: ApplyWorkspaceState; filling: boolean }

/** A stopped execution's recovery and error, shown in the step it belongs to. */
export function RunProblems({ w, filling }: Props) {
  const { run } = w
  if (!run || (run.phase === "filling") !== filling) return null
  const recovery = !w.review && <RunRecovery run={run} disabled={w.busy || w.archived || !w.live || w.submitted || (filling && w.fillBlocks.length > 0)} onRetry={reviewed => void w.action("retry", reviewed)} />
  return <>
    {recovery}
    {run.error && <details open className="rounded-xl border border-destructive/30 p-4"><summary className="cursor-pointer text-sm text-destructive">Execution needs attention</summary><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs">{run.error}</pre></details>}
  </>
}

/** Stop the step's running execution. */
export function CancelRun({ w, filling }: Props) {
  const { run } = w
  if (w.review || !run || (run.phase === "filling") !== filling || (run.status !== "running" && run.status !== "waiting_for_sign_in")) return null
  return <Button variant="outline" disabled={w.pending} onClick={() => void w.action("cancel")}>Cancel</Button>
}

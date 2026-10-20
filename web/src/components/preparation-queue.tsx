import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Panel, Status } from "@/components/workspace-ui"
import { batchReviewHref } from "@/lib/batch-review"
import { request, useApi, useConnection } from "@/lib/api"
import type { BatchItemPhase, BatchItemStatus, PreparationBatch, PreparationBatchItem, PreparationQueueState } from "@/lib/preparation"

type Act = (kind: "pause" | "resume" | "retry" | "cancel", body: Record<string, unknown>) => void
const PHASES: Record<BatchItemPhase, string> = { queued: "Queued", preparing: "Preparing sources", tailoring: "Tailoring", compiling: "Compiling", ready_for_review: "Resume ready for review", waiting_for_fill: "Waiting to fill", filling: "Filling the portal", in_review: "Form in review", submitted: "Submitted" }
const STATUSES: Record<BatchItemStatus, string> = { pending: "pending", running: "running", waiting_for_decision: "waiting for decision", waiting_for_sign_in: "waiting for sign-in", waiting_for_user: "needs you", failed: "failed", interrupted: "interrupted", cancelled: "cancelled", completed: "completed" }
const HINTS: Partial<Record<`${BatchItemPhase}:${BatchItemStatus}` | BatchItemStatus, string>> = {
  "ready_for_review:waiting_for_user": "Open it in Apply and approve the resume. Approved resumes are filled in order.",
  "waiting_for_fill:pending": "Fills when the agent is free and no other form is waiting in the browser.",
  "in_review:waiting_for_user": "Review the form in the browser and submit it there yourself, then confirm the submission in Apply.",
  waiting_for_decision: "The agent is waiting for your permission decision.",
  waiting_for_sign_in: "Complete sign-in in the browser, then retry.",
}
const SUMMARY: [string, (item: PreparationBatchItem) => boolean][] = [
  ["queued", item => item.phase === "queued" && item.status === "pending"],
  ["in progress", item => ["running", "waiting_for_decision"].includes(item.status)],
  ["ready for review", item => item.phase === "ready_for_review" && item.status !== "cancelled"],
  ["waiting to fill", item => item.phase === "waiting_for_fill" && item.status === "pending"],
  ["form in review", item => item.phase === "in_review" && item.status !== "cancelled"],
  ["submitted", item => item.status === "completed"],
  ["need attention", item => item.retryable],
  ["cancelled", item => item.status === "cancelled"],
]
const applyHref = (item: PreparationBatchItem) => `#/apply?${new URLSearchParams({ jobId: String(item.jobId), ...(item.applicationId ? { applicationId: String(item.applicationId) } : {}), ...(item.runId ? { runId: item.runId } : {}) })}`
function summary(items: PreparationBatchItem[]): string {
  const parts = SUMMARY.map(([label, match]) => [label, items.filter(match).length] as const).filter(([, count]) => count > 0)
  return [`${items.length} ${items.length === 1 ? "job" : "jobs"}`, ...parts.map(([label, count]) => `${count} ${label}`)].join(" · ")
}

/**
 * Persistent preparation batches: progress by item and phase, and the queue
 * operations. Items run one at a time; a form in review reserves the portal.
 */
export function PreparationQueue() {
  const queue = useApi<PreparationQueueState>("preparation-batches")
  const live = useConnection()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const batches = queue.data?.batches ?? []
  if (!batches.length) return null
  const act: Act = (kind, body) => {
    setPending(true); setError("")
    request(`preparation-batches/${kind}`, body).then(queue.refresh, (e: Error) => setError(e.message)).finally(() => setPending(false))
  }
  return <Panel title="Preparation queue">
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {queue.data?.portal && <p role="status" className="text-sm">The browser portal is reserved for {queue.data.portal.label}. Other applications are filled after you confirm its submission in Apply or cancel that item.</p>}
      {batches.map(batch => <BatchView key={batch.id} batch={batch} disabled={pending || !live} act={act} />)}
    </div>
  </Panel>
}
function BatchView({ batch, disabled, act }: { batch: PreparationBatch; disabled: boolean; act: Act }) {
  const open = batch.status === "active" || batch.status === "paused"
  const label = `Batch created ${new Date(batch.createdAt).toLocaleString()}`
  const restarted = batch.status === "paused" && batch.pauseReason === "restart"
  return <section aria-label={label} className="space-y-3 rounded-xl border p-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-medium">{label}</p>
      <Status value={restarted ? "paused after restart" : batch.status} />
      <div className="ml-auto flex flex-wrap gap-2">
        <a className="text-sm underline" href={batchReviewHref(batch.id)}>Review batch</a>
        {batch.status === "active" && <Button size="sm" variant="outline" disabled={disabled} onClick={() => act("pause", { batchId: batch.id })}>Pause</Button>}
        {batch.status === "paused" && <Button size="sm" disabled={disabled} onClick={() => act("resume", { batchId: batch.id })}>Resume</Button>}
        {open && batch.items.some(item => item.retryable && !item.reviewRequired) && <Button size="sm" variant="outline" disabled={disabled} onClick={() => act("retry", { batchId: batch.id })}>Retry failed</Button>}
        {open && <Button size="sm" variant="outline" disabled={disabled} onClick={() => act("cancel", { batchId: batch.id })}>Cancel batch</Button>}
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{summary(batch.items)}{batch.model ? ` · ${batch.provider} · ${batch.model}` : ` · ${batch.provider}`}</p>
    {restarted && <p className="text-xs text-muted-foreground">The app closed while this batch was active. Finished items are kept; resume to continue the pending ones.</p>}
    {batch.status === "paused" && !restarted && <p className="text-xs text-muted-foreground">Paused. The current item finishes its phase; no other item starts until you resume.</p>}
    <ol aria-label={`${label} items`} className="divide-y">{batch.items.map(item => <ItemRow key={item.id} item={item} open={open} disabled={disabled} act={act} />)}</ol>
  </section>
}
function ItemRow({ item, open, disabled, act }: { item: PreparationBatchItem; open: boolean; disabled: boolean; act: Act }) {
  const [reviewed, setReviewed] = useState(false)
  const name = `${item.company} · ${item.title}`
  const hint = HINTS[`${item.phase}:${item.status}`] ?? HINTS[item.status]
  return <li aria-label={`${item.position}. ${name}`} className="space-y-1 py-2">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{item.position}. {name}</span>
      <span className="text-muted-foreground">{PHASES[item.phase]} · {STATUSES[item.status]}</span>
      {item.attempts > 1 && <span className="text-xs text-muted-foreground">Attempt {item.attempts}</span>}
      {item.holdsPortal && <Status value="holds the portal" />}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <a className="text-sm underline" href={applyHref(item)} aria-label={`Open ${name} in Apply`}>Open in Apply</a>
        {open && item.retryable && <Button size="sm" variant="outline" aria-label={`Retry ${name}`} disabled={disabled || (item.reviewRequired && !reviewed)} onClick={() => act("retry", { batchId: item.batchId, itemId: item.id, reviewed })}>{item.status === "waiting_for_sign_in" ? "Retry after sign-in" : "Retry"}</Button>}
        {open && !["completed", "cancelled"].includes(item.status) && <Button size="sm" variant="ghost" aria-label={`Cancel ${name}`} disabled={disabled} onClick={() => act("cancel", { batchId: item.batchId, itemId: item.id })}>Cancel</Button>}
      </div>
    </div>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    {item.error && <p className="text-xs text-destructive">{item.error}</p>}
    {open && item.reviewRequired && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed this portal in the browser; fill it again</label>}
  </li>
}

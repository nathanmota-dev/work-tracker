import { useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Page, Panel, LoadState, Status } from "@/components/workspace-ui"
import { BatchReviewActions, type ReviewAct } from "@/components/batch-review-actions"
import { request, useApi, useConnection } from "@/lib/api"
import { batchReviewHref, nextReviewAction, unfinished, type ReviewSearch } from "@/lib/batch-review"
import type { PreparationBatch, PreparationBatchItem, PreparationQueueState } from "@/lib/preparation"

export function BatchReviewWorkspace({ search, renderItem }: { search: ReviewSearch; renderItem: (item: PreparationBatchItem, controls: ReactNode, locked: boolean) => ReactNode }) {
  const queue = useApi<PreparationQueueState>(`preparation-batches/review/${encodeURIComponent(search.batchId!)}`)
  const live = useConnection()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [initialItemId, setInitialItemId] = useState<string>()
  const running = useRef(false)
  const batch = queue.data?.batches.find(batch => batch.id === search.batchId)
  const first = batch?.items.find(unfinished) ?? batch?.items[0]
  if (!initialItemId && first) setInitialItemId(first.id)
  const item = batch?.items.find(item => item.id === (search.itemId ?? initialItemId ?? first?.id))
  const act: ReviewAct = async (kind, body) => {
    if (running.current) return false
    running.current = true; setPending(true); setError("")
    try { await request(`preparation-batches/${kind}`, body); queue.refresh(); return true }
    catch (e) { setError((e as Error).message); return false }
    finally { running.current = false; setPending(false) }
  }
  const controls = <>
    <LoadState loading={queue.loading && !queue.data} error={queue.error} retry={queue.refresh} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {batch && <ReviewPanel batch={batch} selected={item} pendingOnly={!!search.pendingOnly} disabled={pending || queue.loading || !live || !!queue.error} act={act} />}
    {queue.data?.portal && <p role="status" className="text-sm">The browser portal is reserved for {queue.data.portal.label}. Confirm its submission or cancel that item before filling another.</p>}
  </>
  if (!batch || !item) return <Page title="Apply" description="Review the documents and pending work of a preparation batch.">{controls}{!queue.loading && !queue.error && <p role="alert">Batch item not found. Select an item above or return to the queue.</p>}<a className="underline" href="#/apply">All preparation batches</a></Page>
  return renderItem(item, controls, pending || queue.loading || !!queue.error || !["active", "paused"].includes(batch.status) || item.status === "cancelled" || item.phase === "queued")
}

function ReviewPanel({ batch, selected, pendingOnly, disabled, act }: { batch: PreparationBatch; selected?: PreparationBatchItem; pendingOnly: boolean; disabled: boolean; act: ReviewAct }) {
  const pending = batch.items.filter(unfinished)
  // Keep the selected result visible after a confirmation, until the candidate moves on.
  const items = pendingOnly ? batch.items.filter(item => unfinished(item) || item.id === selected?.id) : batch.items
  const index = items.findIndex(item => item.id === selected?.id)
  return <Panel title="Application review center" action={<a className="text-sm underline" href="#/apply">All preparation batches</a>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm"><span>Batch created {new Date(batch.createdAt).toLocaleString()}</span><Status value={batch.status === "paused" && batch.pauseReason === "restart" ? "paused after restart" : batch.status} /></div>
      <p className="text-xs text-muted-foreground">{batch.provider}{batch.model ? ` · ${batch.model}` : ""} · {batch.items.length} items · {pending.length} unfinished</p>
      <dl aria-label="Batch results" className="grid grid-cols-3 gap-2 sm:grid-cols-6">{Object.entries(batch.summary).map(([label, count]) => <div key={label} className="rounded-lg border p-3 text-sm"><dt className="capitalize">{label}</dt><dd className="text-xl font-medium">{count}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Each item counts once. Prepared PDFs and filled forms still need review; submission is confirmed individually.</p>
      <div className="flex flex-wrap items-center gap-3">
        <a className="text-sm underline" href={batchReviewHref(batch.id, selected, !pendingOnly)}>{pendingOnly ? "Show all items" : "Show unfinished only"}</a>
        {batch.status === "active" && <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act("pause", { batchId: batch.id })}>Pause batch</Button>}
        {batch.status === "paused" && <Button size="sm" disabled={disabled} onClick={() => void act("resume", { batchId: batch.id })}>Resume pending work</Button>}
        {["active", "paused"].includes(batch.status) && batch.items.some(item => item.retryable && !item.reviewRequired) && <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act("retry", { batchId: batch.id })}>Retry pending failures</Button>}
      </div>
      {batch.status === "paused" && <p className="text-sm">{batch.pauseReason === "restart" ? "The app restarted. " : ""}Finished results are kept. Resume pending work to continue the queue.</p>}
      <nav aria-label="Batch items" className="max-h-56 overflow-auto rounded-lg border"><ol className="divide-y">{items.map(item => <li key={item.id}><a className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/50" href={batchReviewHref(batch.id, item, pendingOnly)} aria-current={item.id === selected?.id ? "step" : undefined}><span>{item.position}. {item.company} · {item.title}</span><span>{item.result} · {item.phase.replaceAll("_", " ")} · {item.status.replaceAll("_", " ")}</span></a></li>)}</ol></nav>
      {pendingOnly && !pending.length && <p role="status">No unfinished items remain.</p>}
      {selected && <section aria-label="Selected batch item" className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">{index > 0 && <a className="underline" href={batchReviewHref(batch.id, items[index - 1], pendingOnly)}>Previous item</a>}<span>Item {selected.position} of {batch.items.length}: {selected.company} · {selected.title}</span>{index >= 0 && index < items.length - 1 && <a className="underline" href={batchReviewHref(batch.id, items[index + 1], pendingOnly)}>Next item</a>}</div>
        <p className="text-sm font-medium">Next action: {nextReviewAction(selected)}</p>
        {selected.error && <p className="whitespace-pre-wrap text-sm text-destructive">{selected.error}</p>}
        <BatchReviewActions key={`${selected.id}:${selected.runId}:${selected.attempts}`} batch={batch} item={selected} disabled={disabled} act={act} />
      </section>}
    </div>
  </Panel>
}

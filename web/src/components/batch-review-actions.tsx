import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/workspace-ui"
import { reviewPermission } from "@/components/agent-permissions"
import { useContextDraft } from "@/lib/context-draft"
import type { PreparationBatch, PreparationBatchItem } from "@/lib/preparation"
export type ReviewAct = (kind: "pause" | "resume" | "retry" | "cancel" | "adjust", body: Record<string, unknown>) => Promise<boolean>

export function BatchReviewActions({ batch, item, disabled, act }: { batch: PreparationBatch; item: PreparationBatchItem; disabled: boolean; act: ReviewAct }) {
  const draft = useContextDraft(`batch-adjustment:${batch.id}:${item.id}`)
  const [reviewed, setReviewed] = useState(false)
  const open = batch.status === "active" || batch.status === "paused"
  const body = { batchId: batch.id, itemId: item.id }
  return <div className="space-y-3">
    {item.adjustment && <p className="whitespace-pre-wrap text-sm">Requested adjustment: {item.adjustment}</p>}
    {item.status === "waiting_for_decision" && item.runId && <Button size="sm" disabled={disabled} onClick={() => reviewPermission(item.runId!)}>Decide permission</Button>}
    {open && item.retryable && <div className="space-y-2">
      {item.reviewRequired && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed this portal in the browser; fill it again</label>}
      <Button size="sm" disabled={disabled || item.reviewRequired && !reviewed} onClick={() => void act("retry", { ...body, reviewed })}>Retry this item</Button>
    </div>}
    {open && ["ready_for_review", "waiting_for_fill"].includes(item.phase) && !item.holdsPortal && <div className="space-y-2">
      <Field label="Document adjustment"><Textarea value={draft.draft.extra} disabled={disabled} maxLength={12000} placeholder="Describe what to change in this resume" onChange={e => draft.update({ extra: e.target.value })} /></Field>
      <Button size="sm" variant="outline" disabled={disabled || !draft.draft.extra.trim()} onClick={async () => { if (await act("adjust", { ...body, adjustment: draft.draft.extra })) draft.update({ extra: "" }) }}>Request adjustment</Button>
      {draft.error && <p role="alert">{draft.error}</p>}
    </div>}
    {open && !["completed", "cancelled"].includes(item.status) && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void act("cancel", body)}>Cancel this item</Button>}
  </div>
}

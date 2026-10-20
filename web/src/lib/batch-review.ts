import type { PreparationBatchItem } from "./preparation"
export type ReviewSearch = { batchId?: string; itemId?: string; pendingOnly?: boolean; jobId?: number; applicationId?: number; runId?: string }
export const unfinished = (item: PreparationBatchItem) => !["submitted", "cancelled"].includes(item.result)

/** Keep display preferences when moving through a batch; item identity is explicit. */
export function batchReviewHref(batchId: string, item?: PreparationBatchItem, pendingOnly = false) {
  const current = new URLSearchParams(window.location.hash.split("?")[1])
  const params = new URLSearchParams({ batchId, ...(item ? { itemId: item.id, jobId: String(item.jobId), ...(item.applicationId ? { applicationId: String(item.applicationId) } : {}), ...(item.runId ? { runId: item.runId } : {}) } : {}), ...(pendingOnly ? { pendingOnly: "true" } : {}) })
  for (const key of ["pdfTab", "workspaceTab"]) if (current.has(key)) params.set(key, current.get(key)!)
  return `#/apply?${params}`
}

export function nextReviewAction(item: PreparationBatchItem): string {
  if (item.status === "cancelled") return "This item was cancelled. Its earlier results are preserved."
  if (item.status === "completed") return "Submission confirmed. Continue to the next item."
  if (item.status === "waiting_for_decision") return "Decide the pending tool permission to continue."
  if (item.status === "waiting_for_sign_in") return "Finish signing in in the browser, then retry this item."
  if (item.retryable) return item.reviewRequired ? "Review the portal before retrying this incomplete fill." : "Correct the error, then retry this item from its checkpoint."
  if (item.phase === "ready_for_review") return "Review the PDF below, request an adjustment or approve this version to queue its fill."
  if (item.phase === "waiting_for_fill" || item.phase === "filling" && item.status === "pending") return "The approved document is queued for filling when the agent and portal are free."
  if (item.phase === "in_review") return "Review the checklist below, complete pending fields and submit in the browser, then confirm individually."
  if (item.status === "running") return "Wait for this execution to finish. You can review another item meanwhile."
  return item.adjustment ? "The requested adjustment is queued. Previous documents remain available below." : item.phase === "queued" ? "This item is queued for preparation." : "This item is queued to continue from its last checkpoint."
}

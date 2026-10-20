import type { ItemState } from "./batch-state.ts";
import type { BatchReviewResult, PreparationBatchItem } from "./types.ts";

/** A failed latest action takes precedence over its earlier successful checkpoints. */
export function reviewResult(item: ItemState, signals: { submitted: boolean; filled: boolean; prepared: boolean; adjustmentRequested: boolean }): BatchReviewResult {
  if (item.status === "cancelled") return "cancelled";
  if (signals.submitted || item.status === "completed") return "submitted";
  if (["failed", "interrupted"].includes(item.status)) return "failed";
  if (signals.adjustmentRequested) return "pending";
  if (signals.filled) return "filled";
  if (signals.prepared) return "prepared";
  return "pending";
}

export function reviewSummary(items: Pick<PreparationBatchItem, "result">[]): Record<BatchReviewResult, number> {
  const counts = { prepared: 0, filled: 0, submitted: 0, failed: 0, cancelled: 0, pending: 0 };
  for (const item of items) counts[item.result]++;
  return counts;
}

import type { Database } from "../db/sqlite.ts";
import { itemOptions, itemRow, setItem } from "./batch-store.ts";
import { PreparationError } from "./sources.ts";

/** Queue a new version while retaining the old run, PDF, approval and application. */
export function requestAdjustment(d: Database, batchId: string, input: Record<string, unknown>): void {
  const item = itemRow(d, batchId, input.itemId);
  const adjustment = typeof input.adjustment === "string" ? input.adjustment.trim() : "";
  if (!adjustment || adjustment.length > 12000) throw new PreparationError("Describe the requested adjustment in 1 to 12000 characters.");
  if (item.holds_portal || item.status !== "waiting_for_user" && item.status !== "pending" || !["ready_for_review", "waiting_for_fill"].includes(item.phase))
    throw new PreparationError("Request adjustments before filling, while the document is ready for review.", 409);
  if (!d.query("SELECT id FROM document_versions WHERE run_id = ? AND application_id = ?").get(item.run_id, item.application_id))
    throw new PreparationError("No document is available for this item.", 409);
  setItem(d, item.id, { phase: "queued", status: "pending", error: null, options_json: JSON.stringify({ ...itemOptions(item), adjustment, regenerate: true }) });
}

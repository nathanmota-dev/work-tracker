import type { BatchItemPhase, BatchItemStatus, PreparationRun } from "./types.ts";

export interface ItemState { phase: BatchItemPhase; status: BatchItemStatus; error: string | null }
/**
 * What the item's execution and application currently say.
 *
 * @property filled The run completed a portal fill (its `filled` checkpoint).
 * @property portalStarted The portal agent may have acted without reporting a result.
 * @property superseded The application now uses another execution's documents.
 */
export interface ItemSignals {
  runStatus: PreparationRun["status"] | null;
  runPhase: PreparationRun["phase"] | null;
  runError: string | null;
  decision: boolean;
  filled: boolean;
  portalStarted: boolean;
  approved: boolean;
  submitted: boolean;
  superseded: boolean;
}
export const RETRYABLE: BatchItemStatus[] = ["failed", "interrupted", "waiting_for_sign_in"];
export const FINISHED: BatchItemStatus[] = ["completed", "cancelled"];
export const SUPERSEDED_MESSAGE = "This application now uses a resume from another execution in Apply, so the batch no longer manages it.";
const STOPPED_MESSAGE = "Stopped before finishing. Retry to continue from its last checkpoint.";
const STOPPED: Partial<Record<PreparationRun["status"], BatchItemStatus>> = { failed: "failed", interrupted: "interrupted", cancelled: "interrupted", waiting_for_sign_in: "waiting_for_sign_in" };
const ACTIVE: BatchItemStatus[] = ["running", "waiting_for_decision", "waiting_for_sign_in"];

/** The item phase for a run phase; "review" belongs to the item's own pipeline position. */
function phaseOf(run: ItemSignals["runPhase"], current: BatchItemPhase): BatchItemPhase {
  return !run || run === "review" ? current : run;
}
function follow(item: ItemState, signals: ItemSignals): ItemState {
  const { runStatus } = signals;
  if (runStatus === "running") return { phase: phaseOf(signals.runPhase, item.phase), status: signals.decision ? "waiting_for_decision" : "running", error: null };
  if (runStatus === "completed") {
    if (signals.superseded) return { phase: item.phase, status: "cancelled", error: SUPERSEDED_MESSAGE };
    if (signals.filled) return { phase: "in_review", status: "waiting_for_user", error: null };
    // Only an approved PDF enters the fill phase.
    return signals.approved ? { phase: "waiting_for_fill", status: "pending", error: null } : { phase: "ready_for_review", status: "waiting_for_user", error: null };
  }
  const status = STOPPED[runStatus!] ?? "failed";
  // A retry the candidate requested waits for the executor instead of reverting to the failure,
  // and a refused start keeps its own reason.
  if (item.status === "pending") return { ...item, error: null };
  if (RETRYABLE.includes(item.status) && item.error) return item;
  // A run cancelled outside the batch (Apply, or the app closing) can continue from its checkpoint.
  return { phase: phaseOf(signals.runPhase, item.phase), status, error: runStatus === "cancelled" ? STOPPED_MESSAGE : signals.runError };
}

/**
 * Item state derived from its run and application. A submitted application
 * completes the item; a cancelled item stays cancelled.
 */
export function deriveItem(item: ItemState, signals: ItemSignals): ItemState & { holdsPortal: boolean } {
  if (item.status === "cancelled") return { ...item, holdsPortal: false };
  if (signals.submitted) return { phase: "submitted", status: "completed", error: null, holdsPortal: false };
  if (!signals.runStatus) return { ...item, holdsPortal: false };
  const next = follow(item, signals);
  const holdsPortal = next.phase === "in_review" || (next.phase === "filling" && (ACTIVE.includes(next.status) || signals.portalStarted));
  return { ...next, holdsPortal };
}

/** The last fill stopped while the agent could act on the portal. */
export function needsReview(signals: Pick<ItemSignals, "runStatus" | "runPhase" | "portalStarted">): boolean {
  return !!signals.runStatus && !["running", "completed"].includes(signals.runStatus) && signals.runPhase === "filling" && signals.portalStarted;
}

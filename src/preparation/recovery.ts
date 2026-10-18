import { db } from "../db/index.ts";
import type { PdfArtifact, PreparationPhase, PreparationRun, RecoveryCheckpoint, RunRecovery } from "./types.ts";

/**
 * Persisted part of a run's recovery state (`application_runs.recovery_json`).
 *
 * @property checkpoints Phases whose validated output is on disk.
 * @property portal "started" from the moment the portal agent may act on the
 *   portal until it reports a result or a sign-in wait.
 */
export interface StoredRecovery {
  checkpoints?: RecoveryCheckpoint[];
  portal?: "started" | null;
}
const STOPPED: PreparationRun["status"][] = ["failed", "cancelled", "interrupted", "waiting_for_sign_in"];
const LABELS: Record<PreparationPhase, string> = { preparing: "source preparation", tailoring: "tailoring", compiling: "compilation", review: "review", filling: "portal filling" };
const KEPT: Partial<Record<RecoveryCheckpoint, string>> = { compiled: "with the validated resume; it is not regenerated", tailored: "with the tailored sources", sources: "with the saved source snapshot" };

export function parseRecovery(json: string | null | undefined): StoredRecovery {
  try {
    const value: unknown = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as StoredRecovery : {};
  } catch { return {}; }
}

/** Checkpoints of legacy runs are inferred from their stored artifacts. */
function checkpointsFor(stored: StoredRecovery, artifacts: PdfArtifact[]): RecoveryCheckpoint[] {
  const found = new Set(stored.checkpoints ?? []);
  if (artifacts.some(item => item.kind === "base")) found.add("sources");
  if (artifacts.some(item => item.kind === "tailored")) found.add("compiled");
  return (["sources", "tailored", "compiled", "filled"] as const).filter(item => found.has(item));
}

function retryPhase(phase: PreparationPhase, checkpoints: RecoveryCheckpoint[]): RunRecovery["retryFrom"] {
  if (phase === "filling" || phase === "review") return checkpoints.includes("compiled") ? "filling" : null;
  if (phase === "compiling" && checkpoints.includes("tailored")) return "compiling";
  return checkpoints.includes("sources") ? "tailoring" : "preparing";
}

function summary(status: PreparationRun["status"], phase: PreparationPhase, from: NonNullable<RunRecovery["retryFrom"]>, checkpoints: RecoveryCheckpoint[], review: boolean): string {
  // An unknown stored phase (legacy or partial rows) still gets a readable summary.
  const label = LABELS[phase] ?? "this execution";
  const title = `${label[0]!.toUpperCase()}${label.slice(1)}`;
  const lead = status === "interrupted" ? `The app closed during ${label}.`
    : status === "cancelled" ? `${title} was cancelled.`
      : status === "waiting_for_sign_in" ? `${title} is waiting for sign-in. Complete it in the browser first.`
        : `${title} failed.`;
  if (review) return `${lead} The agent stopped without reporting a result, so the portal may hold a partial fill. Review it in the browser and confirm before filling again with the same resume.`;
  if (from === "preparing") return `${lead} Retrying starts this execution again.`;
  const kept = (["compiled", "tailored", "sources"] as const).find(item => checkpoints.includes(item) && (item !== "compiled" || from === "filling"));
  return `${lead} Retrying continues from ${LABELS[from]}${kept ? ` ${KEPT[kept]}` : ""}.`;
}

/** What a run kept and how it can continue; null fields while it runs or after it completed. */
export function deriveRecovery(run: Pick<PreparationRun, "status" | "phase" | "artifacts">, stored: StoredRecovery): RunRecovery {
  const checkpoints = checkpointsFor(stored, run.artifacts);
  const from = STOPPED.includes(run.status) ? retryPhase(run.phase, checkpoints) : null;
  if (!from) return { checkpoints, retryFrom: null, reviewRequired: false, summary: null };
  const reviewRequired = from === "filling" && stored.portal === "started";
  return { checkpoints, retryFrom: from, reviewRequired, summary: summary(run.status, run.phase, from, checkpoints, reviewRequired) };
}

/** Change a run's persisted recovery state; runs inside the caller's transaction when there is one. */
export function updateRecovery(id: string, change: (value: StoredRecovery) => StoredRecovery): void {
  const row = db().query("SELECT recovery_json FROM application_runs WHERE id = ?").get(id) as { recovery_json: string } | undefined;
  if (!row) return;
  db().query("UPDATE application_runs SET recovery_json = ? WHERE id = ?").run(JSON.stringify(change(parseRecovery(row.recovery_json))), id);
}
export function addCheckpoint(id: string, checkpoint: RecoveryCheckpoint): void {
  updateRecovery(id, value => ({ ...value, checkpoints: [...new Set([...(value.checkpoints ?? []), checkpoint])] }));
}
/** Drop checkpoints whose output a retry regenerates. */
export function dropCheckpoints(id: string, ...checkpoints: RecoveryCheckpoint[]): void {
  updateRecovery(id, value => ({ ...value, checkpoints: (value.checkpoints ?? []).filter(item => !checkpoints.includes(item)) }));
}
export function markPortal(id: string, started: boolean): void {
  updateRecovery(id, value => ({ ...value, portal: started ? "started" : null }));
}

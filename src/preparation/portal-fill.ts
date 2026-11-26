import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { journeyRecord, settleExecution, transition } from "../applications/journey-store.ts";
import { PreparationError } from "./sources.ts";
import { addCheckpoint, markPortal, parseRecovery } from "./recovery.ts";
import { verifyDocumentUse, recordDocumentUse } from "./documents.ts";
import { reviewDrafts } from "./fill-drafts.ts";
import { updateRun } from "./store.ts";

/** Written next to the run manifest for the portal agent; also read back after a restart. */
export interface FillManifest {
  versionId?: string;
  pdfHash?: string;
  runId: string;
  applicationId: number;
  pdfPath: string;
  url: string;
  resultPath: string;
  /** Evidence the agent may draft answers from; absent in manifests written before drafts. */
  contextPath?: string;
  reportPath: string;
  coverPath: string | null;
  [key: string]: unknown;
}
export interface FillResult { fields: Record<string, unknown>; unfilled: unknown[]; externalUrl: string; portal: string }

export function webLink(value: unknown): string {
  try { const url = new URL(String(value)); if (["https:", "http:"].includes(url.protocol)) return url.href; } catch { /* invalid */ }
  throw new PreparationError("This application needs an HTTP or HTTPS portal URL.");
}
export function fillManifestPath(manifestPath: string): string { return join(dirname(manifestPath), "fill-manifest.json"); }

/** Validate the agent's fill result file; throws when it is missing or malformed. */
export function readFillResult(manifest: Pick<FillManifest, "resultPath" | "contextPath" | "url" | "versionId" | "pdfHash" | "pdfPath">): FillResult {
  const result = JSON.parse(readFileSync(manifest.resultPath, "utf8")) as Record<string, unknown>;
  if (!result.fields || typeof result.fields !== "object" || Array.isArray(result.fields) || !Array.isArray(result.unfilled) || !(result.drafted === undefined || Array.isArray(result.drafted))) throw new Error("The agent did not produce a valid fill result. Review the browser and retry.");
  if (manifest.versionId && (result.versionId !== manifest.versionId || result.pdfHash !== manifest.pdfHash || result.pdfPath !== manifest.pdfPath)) throw new PreparationError("The portal result must identify the approved PDF actually used.", 409);
  const reviewed = reviewDrafts(result.fields as Record<string, unknown>, result.unfilled, (result.drafted ?? []) as unknown[], manifest.contextPath);
  return { ...reviewed, externalUrl: result.externalUrl ? webLink(result.externalUrl) : manifest.url, portal: String(result.portal ?? "generic") };
}

/**
 * Store a validated fill result on its application and complete the run. Filling
 * never submits: the candidate confirms the submission separately. Must run
 * inside the caller's transaction.
 */
export function applyFillResult(d: Database, manifest: FillManifest, result: FillResult): void {
  verifyDocumentUse(d, manifest);
  recordDocumentUse(d, manifest);
  d.query("UPDATE applications SET fields_filled_json = ?, unfilled_json = ?, external_url = ?, portal = ?, resume_path = ?, preparation_run_id = ?, report_path = ?, cover_letter_path = ? WHERE id = ?")
    .run(JSON.stringify(result.fields), JSON.stringify(result.unfilled), result.externalUrl, result.portal, manifest.pdfPath, manifest.runId, manifest.reportPath, manifest.coverPath && existsSync(manifest.coverPath) ? manifest.coverPath : null, manifest.applicationId);
  transition(d, manifest.applicationId, "fill.complete", "agent", { runId: manifest.runId });
  addCheckpoint(manifest.runId, "filled");
  markPortal(manifest.runId, false);
  updateRun(manifest.runId, { status: "completed", phase: "review", error: null });
}

/** A fill result the agent saved before the app closed; null when its outcome is unknown. */
function savedFill(d: Database, run: StaleRun): { manifest: FillManifest; result: FillResult } | null {
  try {
    const manifest = JSON.parse(readFileSync(fillManifestPath(JSON.parse(run.manifest_json).manifestPath), "utf8")) as FillManifest;
    if (manifest.runId !== run.id || manifest.applicationId !== run.application_id || journeyRecord(d, manifest.applicationId).submission_status === "submitted") return null;
    verifyDocumentUse(d, manifest);
    return { manifest, result: readFillResult(manifest) };
  } catch { return null; }
}

type StaleRun = { id: string; application_id: number | null; status: string; phase: string; manifest_json: string; recovery_json: string };
export const CLOSED_MESSAGE = "The app closed during this execution. Validated files were kept; retry to continue.";
export const SIGN_IN_LOST_MESSAGE = "Sign-in was pending when the app closed. That agent session ended with the app and cannot be restored; complete sign-in, then retry to start a new session with the validated files.";

/**
 * A restart cannot resume an in-flight agent, compiler or sign-in session. Mark
 * those runs interrupted and settle their journey; a portal fill whose agent
 * saved a valid result before the app closed is completed from that result
 * instead of being repeated. Must run inside the caller's transaction.
 */
export function interruptStaleRuns(d: Database): void {
  const runs = d.query("SELECT id, application_id, status, phase, manifest_json, recovery_json FROM application_runs WHERE status IN ('running', 'waiting_for_sign_in')").all() as StaleRun[];
  for (const run of runs) {
    const saved = run.phase === "filling" && parseRecovery(run.recovery_json).portal === "started" ? savedFill(d, run) : null;
    if (saved) { applyFillResult(d, saved.manifest, saved.result); continue; }
    d.query("UPDATE application_runs SET status = 'interrupted', error = ?, updated_at = ? WHERE id = ?").run(run.status === "waiting_for_sign_in" ? SIGN_IN_LOST_MESSAGE : CLOSED_MESSAGE, now(), run.id);
    if (run.application_id) settleExecution(d, run.application_id, run.phase === "filling" ? "fill" : "preparation", "failed", run.id);
  }
}

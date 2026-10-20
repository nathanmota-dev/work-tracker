import { randomUUID } from "node:crypto";
import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { parseRecovery } from "./recovery.ts";
import { PreparationError } from "./sources.ts";
import { awaitingDecision } from "./store.ts";
import { deriveItem, FINISHED, needsReview, RETRYABLE, type ItemSignals } from "./batch-state.ts";
import type { BatchItemPhase, BatchItemStatus, PreparationBatch, PreparationBatchItem, PreparationQueueState, ResumeSourcesConfig } from "./types.ts";

export type StoredBatch = { id: string; status: "active" | "paused" | "cancelled"; pause_reason: PreparationBatch["pauseReason"]; provider: string; model: string | null; extra: string; source_version: string; sources_json: string; created_at: string; updated_at: string };
export type StoredItem = { id: string; batch_id: string; position: number; job_id: number; application_id: number | null; run_id: string | null; phase: BatchItemPhase; status: BatchItemStatus; attempts: number; holds_portal: number; options_json: string; error: string | null; created_at: string; updated_at: string };
export type RunnableItem = StoredItem & Pick<StoredBatch, "provider" | "model" | "sources_json" | "source_version"> & { batch_extra: string };
/** Per-item options: context overriding the batch's and a retry confirmed after reviewing the portal. */
export type ItemOptions = { extra?: string; reviewed?: boolean };
export type NewItem = { jobId: number; extra: string };
type SignalRow = StoredItem & { title: string; company_name: string; run_status: ItemSignals["runStatus"]; run_phase: ItemSignals["runPhase"]; run_error: string | null; recovery_json: string | null; run_application_id: number | null; running_events: string | null; submission_status: string | null; preparation_run_id: string | null; approved_at: string | null };

const UNFINISHED = "status NOT IN ('completed', 'cancelled')";
const SIGNALS = `SELECT i.*, j.title, j.company_name, r.status AS run_status, r.phase AS run_phase, r.error AS run_error, r.recovery_json,
  r.application_id AS run_application_id, CASE WHEN r.status = 'running' THEN r.events_json END AS running_events,
  a.submission_status, a.preparation_run_id, v.approved_at
  FROM preparation_batch_items i JOIN jobs j ON j.id = i.job_id
  LEFT JOIN application_runs r ON r.id = i.run_id
  LEFT JOIN applications a ON a.id = COALESCE(r.application_id, i.application_id)
  LEFT JOIN document_versions v ON v.run_id = i.run_id`;

export const itemOptions = (item: Pick<StoredItem, "options_json">): ItemOptions => JSON.parse(item.options_json) as ItemOptions;
const label = (job: { company_name: string; title: string }) => `${job.company_name} · ${job.title}`;
function signals(row: SignalRow): ItemSignals {
  const recovery = parseRecovery(row.recovery_json);
  return {
    runStatus: row.run_status, runPhase: row.run_phase, runError: row.run_error,
    decision: !!row.running_events && awaitingDecision(JSON.parse(row.running_events) as Record<string, unknown>[]),
    filled: !!recovery.checkpoints?.includes("filled"), portalStarted: recovery.portal === "started", approved: !!row.approved_at,
    submitted: row.submission_status === "submitted", superseded: !!row.run_id && !!row.preparation_run_id && row.preparation_run_id !== row.run_id,
  };
}

export { checkSelection as checkJobs } from "./batch-selection.ts";
export function insertBatch(d: Database, batch: Pick<StoredBatch, "provider" | "model" | "extra" | "source_version"> & { sources: ResumeSourcesConfig }, id = randomUUID()): string {
  const at = now();
  d.query("INSERT INTO preparation_batches (id, status, provider, model, extra, source_version, sources_json, created_at, updated_at) VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?)")
    .run(id, batch.provider, batch.model, batch.extra, batch.source_version, JSON.stringify(batch.sources), at, at);
  return id;
}
/** Append items after the batch's last position; positions never change afterwards. */
export function appendItems(d: Database, batchId: string, items: NewItem[]): void {
  const at = now();
  const last = (d.query("SELECT COALESCE(MAX(position), 0) AS last FROM preparation_batch_items WHERE batch_id = ?").get(batchId) as { last: number }).last;
  items.forEach((item, index) => d.query("INSERT INTO preparation_batch_items (id, batch_id, position, job_id, phase, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 'pending', ?, ?, ?)")
    .run(randomUUID(), batchId, last + index + 1, item.jobId, JSON.stringify(item.extra ? { extra: item.extra } : {}), at, at));
  setBatch(d, batchId, {});
}
export function batchRow(d: Database, id: unknown): StoredBatch {
  const row = d.query("SELECT * FROM preparation_batches WHERE id = ?").get(String(id ?? "")) as StoredBatch | undefined;
  if (!row) throw new PreparationError("Batch not found.", 404);
  return row;
}
export function batchItems(d: Database, batchId: string): StoredItem[] {
  return d.query("SELECT * FROM preparation_batch_items WHERE batch_id = ? ORDER BY position").all(batchId) as StoredItem[];
}
export function itemRow(d: Database, batchId: string, id: unknown): StoredItem {
  const row = d.query("SELECT * FROM preparation_batch_items WHERE batch_id = ? AND id = ?").get(batchId, String(id ?? "")) as StoredItem | undefined;
  if (!row) throw new PreparationError("Batch item not found.", 404);
  return row;
}
export function setBatch(d: Database, id: string, fields: Partial<Pick<StoredBatch, "status" | "pause_reason">>): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  d.query(`UPDATE preparation_batches SET ${keys.map(key => `${key} = ?, `).join("")}updated_at = ? WHERE id = ?`).run(...keys.map(key => fields[key] ?? null), now(), id);
}
export function setItem(d: Database, id: string, fields: Partial<Pick<StoredItem, "phase" | "status" | "error" | "run_id" | "application_id" | "attempts" | "holds_portal" | "options_json">>): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  d.query(`UPDATE preparation_batch_items SET ${keys.map(key => `${key} = ?, `).join("")}updated_at = ? WHERE id = ?`).run(...keys.map(key => fields[key] ?? null), now(), id);
}
/** A restart cannot continue a batch on its own: active batches wait for the candidate to resume them. */
export function pauseAfterRestart(d: Database): void {
  d.query("UPDATE preparation_batches SET status = 'paused', pause_reason = 'restart', updated_at = ? WHERE status = 'active'").run(now());
}
/** Bring each unfinished item up to date with its run and application. Returns whether anything changed. */
export function reconcileItems(d: Database): boolean {
  let changed = false;
  for (const row of d.query(`${SIGNALS} WHERE i.${UNFINISHED}`).all() as SignalRow[]) {
    const next = deriveItem({ phase: row.phase, status: row.status, error: row.error }, signals(row));
    const applicationId = row.run_application_id ?? row.application_id;
    if (next.phase === row.phase && next.status === row.status && next.error === row.error && Number(next.holdsPortal) === row.holds_portal && applicationId === row.application_id) continue;
    setItem(d, row.id, { phase: next.phase, status: next.status, error: next.error, holds_portal: Number(next.holdsPortal), application_id: applicationId });
    changed = true;
  }
  return changed;
}
/** Items the executor may start, oldest batch first, then by position. */
export function pendingItems(d: Database): RunnableItem[] {
  return d.query(`SELECT i.*, b.provider, b.model, b.extra AS batch_extra, b.sources_json, b.source_version FROM preparation_batch_items i
    JOIN preparation_batches b ON b.id = i.batch_id WHERE b.status = 'active' AND i.status = 'pending' ORDER BY b.created_at, b.rowid, i.position`).all() as RunnableItem[];
}
export function portalHolder(d: Database): (StoredItem & { title: string; company_name: string }) | undefined {
  return d.query(`SELECT i.*, j.title, j.company_name FROM preparation_batch_items i JOIN jobs j ON j.id = i.job_id
    WHERE i.holds_portal = 1 AND i.${UNFINISHED} ORDER BY i.updated_at, i.rowid LIMIT 1`).get() as (StoredItem & { title: string; company_name: string }) | undefined;
}
/** Never fill another application while a form is waiting for the candidate in the browser. */
export function assertPortalFree(d: Database, applicationId: number): void {
  const holder = portalHolder(d);
  if (holder && holder.application_id !== applicationId)
    throw new PreparationError(`The ${label(holder)} form is waiting for your review in the browser. Confirm its submission in Apply or cancel its batch item before filling another application.`, 409);
}
function itemView(row: SignalRow): PreparationBatchItem {
  return {
    id: row.id, batchId: row.batch_id, position: row.position, jobId: row.job_id, company: row.company_name, title: row.title,
    applicationId: row.application_id, runId: row.run_id, phase: row.phase, status: row.status, attempts: row.attempts, holdsPortal: !!row.holds_portal,
    reviewRequired: row.status !== "cancelled" && needsReview(signals(row)), retryable: RETRYABLE.includes(row.status),
    extra: itemOptions(row).extra ?? "", error: row.error, updatedAt: row.updated_at,
  };
}
/** The 50 most recent batches (or only `only`) with their items and the current portal reservation. */
export function queueState(d: Database, busy: boolean, only?: string): PreparationQueueState {
  const stored = (only ? [batchRow(d, only)] : d.query("SELECT * FROM preparation_batches ORDER BY created_at DESC, rowid DESC LIMIT 50").all()) as StoredBatch[];
  const ids = stored.map(batch => batch.id);
  const items = (d.query(`${SIGNALS} WHERE i.batch_id IN (${ids.map(() => "?").join(", ")}) ORDER BY i.position`).all(...ids) as SignalRow[]).map(itemView);
  const batches = stored.map((batch): PreparationBatch => {
    const own = items.filter(item => item.batchId === batch.id);
    const done = own.length > 0 && own.every(item => FINISHED.includes(item.status));
    const counts: PreparationBatch["counts"] = {};
    for (const item of own) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return {
      id: batch.id, status: batch.status !== "cancelled" && done ? "completed" : batch.status, pauseReason: batch.pause_reason, provider: batch.provider, model: batch.model,
      extra: batch.extra, sourceVersion: batch.source_version, createdAt: batch.created_at, updatedAt: batch.updated_at, items: own, counts,
    };
  });
  const holder = portalHolder(d);
  return { batches, busy, portal: holder ? { batchId: holder.batch_id, itemId: holder.id, applicationId: holder.application_id, jobId: holder.job_id, label: label(holder) } : null };
}

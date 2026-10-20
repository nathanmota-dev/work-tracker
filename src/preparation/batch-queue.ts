import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { paths } from "../paths.ts";
import type { PreparationService } from "./service.ts";
import { PreparationError, snapshotSources, writeSnapshot, type SourcesSnapshot } from "./sources.ts";
import { runRecord } from "./store.ts";
import { newItems, previewJobs, type BatchPreview } from "./batch-selection.ts";
import { batchRequest, recordBatchRequest } from "./batch-request.ts";
import { FINISHED, RETRYABLE } from "./batch-state.ts";
import { appendItems, batchItems, batchRow, checkJobs, insertBatch, itemOptions, itemRow, pauseAfterRestart, pendingItems, portalHolder, queueState, reconcileItems, setBatch, setItem, type RunnableItem, type StoredBatch } from "./batch-store.ts";
import type { PreparationBatch, PreparationQueueState, ResumeSourcesConfig } from "./types.ts";

export type QueueService = Pick<PreparationService, "generate" | "retry" | "fill" | "cancel" | "isBusy">;
const ACTIVE = ["running", "waiting_for_decision", "waiting_for_sign_in"];
export const REVIEW_MESSAGE = "The last portal fill stopped without a result, so the portal may hold a partial fill. Review it in the browser, then confirm before filling again.";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(-24000);

const batchRoot = (id: string) => join(paths.artifacts, "batches", id);
/** Copy the sources under the batch, so every item uses the version recorded when it was created. */
export function freezeSources(id: string, snapshot: SourcesSnapshot): ResumeSourcesConfig {
  const root = join(batchRoot(id), "sources");
  writeSnapshot(snapshot, join(root, "project"));
  const dataFile = snapshot.data ? join(root, "resume-data.json") : "";
  if (dataFile) writeFileSync(dataFile, JSON.stringify(snapshot.data), { mode: 0o600 });
  const config = { projectDir: join(root, "project"), mainFile: snapshot.config.mainFile, dataFile, engine: snapshot.config.engine };
  if (snapshotSources(config).version !== snapshot.version) throw new PreparationError("The resume sources could not be recorded for this batch.");
  return config;
}
function batchSources(item: RunnableItem): SourcesSnapshot {
  const snapshot = snapshotSources(JSON.parse(item.sources_json) as ResumeSourcesConfig);
  if (snapshot.version !== item.source_version) throw new PreparationError("This batch's recorded resume sources changed. Cancel the item and add its job to a new batch.");
  return snapshot;
}

/**
 * Persistent batch executor. Items run one at a time through the shared
 * preparation service, so the batch, Apply and Launch never use the agent
 * together. A form waiting for the candidate reserves the browser portal:
 * other fills wait, while generation continues whenever the agent is free.
 */
export class PreparationQueue {
  private scheduled = false;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  /** @param agentBusy Whether Launch, a diagnostic or a sign-in browser is using the agent. */
  constructor(private service: QueueService, private agentBusy: () => boolean, private broadcast: (event: unknown) => void, pollMs = 3000) {
    const d = db();
    d.transaction(() => { reconcileItems(d); pauseAfterRestart(d); })();
    // Events drive the queue; polling only covers availability changes without events.
    if (pollMs > 0) { this.timer = setInterval(() => this.schedule(), pollMs); this.timer.unref?.(); }
  }
  /** React to runs, applications and agent sessions changing. */
  observe(event: unknown): void {
    const { type, table } = (event ?? {}) as { type?: string; table?: string };
    if ((type === "changed" && table !== "preparation_batches") || type === "acp-status" || type === "acp-exit") this.schedule();
  }
  schedule(): void {
    if (this.scheduled || this.closed) return;
    this.scheduled = true;
    setTimeout(() => { this.scheduled = false; this.pump(); }, 0);
  }
  /** Sync items with their runs, then start the next pending item while the agent is free. */
  pump(): void {
    if (this.closed) return;
    const d = db();
    let changed = this.sync(d);
    if (!this.service.isBusy && !this.agentBusy()) for (const item of pendingItems(d)) {
      if (["waiting_for_fill", "filling"].includes(item.phase) && this.portalTaken(d, item)) continue;
      changed = true;
      if (this.start(d, item)) break;
    }
    if (changed) this.changed();
  }
  state(): PreparationQueueState {
    const d = db();
    if (this.sync(d)) this.changed();
    return queueState(d, this.service.isBusy);
  }
  preview(input: Record<string, unknown>): BatchPreview { return previewJobs(db(), newItems(input.items)); }
  create(input: Record<string, unknown>): PreparationBatch {
    const items = newItems(input.items);
    if (typeof input.provider !== "string" || !input.provider) throw new PreparationError("Select an agent.");
    const d = db();
    const config = { provider: input.provider, model: typeof input.model === "string" && input.model ? input.model : null, extra: typeof input.extra === "string" ? input.extra.trim() : "" };
    const fingerprint = JSON.stringify({ ...config, items });
    const existing = batchRequest(d, input.requestId, fingerprint);
    if (existing) return queueState(d, this.service.isBusy, existing).batches[0]!;
    checkJobs(d, items);
    const snapshot = snapshotSources();
    const id = randomUUID();
    try {
      const sources = freezeSources(id, snapshot);
      d.transaction(() => {
        checkJobs(d, items);
        insertBatch(d, { ...config, provider: config.provider as string, source_version: snapshot.version, sources }, id);
        appendItems(d, id, items);
        recordBatchRequest(d, input.requestId, id, fingerprint);
      })();
    } catch (error) { rmSync(batchRoot(id), { recursive: true, force: true }); throw error; }
    return this.updated(id);
  }
  /** Re-adding a cancelled job appends it; positions never change. */
  add(input: Record<string, unknown>): PreparationBatch {
    const d = db();
    const batch = this.open(d, input.batchId);
    const items = newItems(input.items);
    d.transaction(() => { checkJobs(d, items); appendItems(d, batch.id, items); })();
    return this.updated(batch.id);
  }
  /** Stop starting items; the running one finishes its current phase. */
  pause(input: Record<string, unknown>): PreparationBatch {
    const d = db();
    const batch = batchRow(d, input.batchId);
    if (batch.status !== "active") throw new PreparationError("Only an active batch can be paused.", 409);
    setBatch(d, batch.id, { status: "paused", pause_reason: "user" });
    return this.updated(batch.id);
  }
  resume(input: Record<string, unknown>): PreparationBatch {
    const d = db();
    const batch = batchRow(d, input.batchId);
    if (batch.status !== "paused") throw new PreparationError("Only a paused batch can be resumed.", 409);
    setBatch(d, batch.id, { status: "active", pause_reason: null });
    return this.updated(batch.id);
  }
  /** Cancel one item, or the whole batch. Finished results and the application stay as they are. */
  async cancel(input: Record<string, unknown>): Promise<PreparationBatch> {
    const d = db();
    this.sync(d);
    const batch = this.open(d, input.batchId);
    const targets = (input.itemId ? [itemRow(d, batch.id, input.itemId)] : batchItems(d, batch.id)).filter(item => !FINISHED.includes(item.status));
    if (input.itemId && !targets.length) throw new PreparationError("This item has already finished.", 409);
    d.transaction(() => {
      for (const item of targets) setItem(d, item.id, { status: "cancelled", holds_portal: 0 });
      if (!input.itemId) setBatch(d, batch.id, { status: "cancelled", pause_reason: null });
    })();
    for (const item of targets) if (item.run_id && ACTIVE.includes(item.status)) await this.service.cancel(item.run_id).catch(() => {});
    return this.updated(batch.id);
  }
  /** Retry failed items from their checkpoints; a fill with an unknown outcome needs the candidate's review. */
  retry(input: Record<string, unknown>): PreparationBatch {
    const d = db();
    this.sync(d);
    const batch = this.open(d, input.batchId);
    const reviewed = !!input.itemId && input.reviewed === true;
    const targets = input.itemId ? [itemRow(d, batch.id, input.itemId)] : batchItems(d, batch.id).filter(item => RETRYABLE.includes(item.status));
    const views = new Map(queueState(d, false, batch.id).batches[0]!.items.map(item => [item.id, item]));
    let retried = 0;
    d.transaction(() => {
      for (const item of targets) {
        if (!RETRYABLE.includes(item.status)) throw new PreparationError("Only failed, interrupted or sign-in items can be retried.", 409);
        if (views.get(item.id)!.reviewRequired && !reviewed) continue;
        setItem(d, item.id, { status: "pending", error: null, options_json: JSON.stringify({ ...itemOptions(item), reviewed: reviewed || undefined }) });
        retried++;
      }
    })();
    if (!retried) throw new PreparationError(targets.length ? REVIEW_MESSAGE : "No failed items to retry.", 409);
    return this.updated(batch.id);
  }
  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }
  private open(d: Database, id: unknown): StoredBatch {
    const batch = batchRow(d, id);
    if (batch.status === "cancelled") throw new PreparationError("This batch was cancelled.", 409);
    return batch;
  }
  private sync(d: Database): boolean { return d.transaction(() => reconcileItems(d))(); }
  private changed(): void { this.broadcast({ type: "changed", table: "preparation_batches" }); }
  private updated(id: string): PreparationBatch {
    this.changed();
    this.schedule();
    const d = db();
    this.sync(d);
    return queueState(d, this.service.isBusy, id).batches[0]!;
  }
  private portalTaken(d: Database, item: RunnableItem): boolean {
    const holder = portalHolder(d);
    return !!holder && holder.id !== item.id && holder.application_id !== item.application_id;
  }
  /** Start the item's next phase. A refusal fails only this item, so the batch continues. */
  private start(d: Database, item: RunnableItem): boolean {
    const options = itemOptions(item);
    try {
      const run = !item.run_id
        ? this.service.generate({ jobId: item.job_id, provider: item.provider, model: item.model ?? undefined, extra: options.extra || item.batch_extra }, batchSources(item))
        : item.phase === "waiting_for_fill" ? this.service.fill({ runId: item.run_id })
          : this.service.retry({ runId: item.run_id, reviewed: options.reviewed === true }, runRecord(item.run_id).recovery.retryFrom === "preparing" ? batchSources(item) : undefined);
      setItem(d, item.id, { run_id: run.id, attempts: item.attempts + 1, error: null, options_json: JSON.stringify({ ...options, reviewed: undefined }) });
      this.sync(d);
      return true;
    } catch (error) {
      setItem(d, item.id, { status: "failed", attempts: item.attempts + 1, error: message(error) });
      return false;
    }
  }
}

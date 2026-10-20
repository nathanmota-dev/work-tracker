import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { snapshotSources, writeSnapshot, type SourcesSnapshot } from "./sources.ts";
import { runRecord } from "./store.ts";
import { batchItems, batchRow, setItem } from "./batch-store.ts";
import { freezeSources, PreparationQueue, REVIEW_MESSAGE, type QueueService } from "./batch-queue.ts";
import type { PreparationRun } from "./types.ts";

vi.mock("../db/index.ts", async (original) => ({ ...(await original<typeof import("../db/index.ts")>()), db: vi.fn() }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("./sources.ts", async (original) => ({ ...(await original<typeof import("./sources.ts")>()), snapshotSources: vi.fn(), writeSnapshot: vi.fn() }));
vi.mock("./store.ts", async (original) => ({ ...(await original<typeof import("./store.ts")>()), runRecord: vi.fn() }));

let d: Database;
let queue: PreparationQueue;
let jobs: number[];
let busy: boolean;
const broadcast = vi.fn();
const snapshot = (version = "v1", data: SourcesSnapshot["data"] = null): SourcesSnapshot => ({ config: { projectDir: "/source", mainFile: "resume.tex", dataFile: data ? "/source/data.json" : "", engine: "pdflatex" }, files: [], data, warnings: [], version });
function runRow(id: string, jobId: number, status = "running", phase = "preparing", recovery = "{}"): { id: string } {
  d.query("INSERT INTO application_runs (id, job_id, status, phase, provider, recovery_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'agent', ?, 'now', 'now')").run(id, jobId, status, phase, recovery);
  return { id };
}
const service = {
  isBusy: false as boolean,
  generate: vi.fn((input: Record<string, unknown>) => runRow(`run-${String(input.jobId)}`, input.jobId as number) as PreparationRun),
  fill: vi.fn((input: Record<string, unknown>) => { d.query("UPDATE application_runs SET status = 'running', phase = 'filling' WHERE id = ?").run(String(input.runId)); return { id: input.runId } as PreparationRun; }),
  retry: vi.fn((input: Record<string, unknown>) => { d.query("UPDATE application_runs SET status = 'running' WHERE id = ?").run(String(input.runId)); return { id: input.runId } as PreparationRun; }),
  cancel: vi.fn(async () => {}),
} satisfies QueueService;
const items = (batchId: string) => batchItems(d, batchId);
function create(count = 2, input: Record<string, unknown> = {}) {
  return queue.create({ provider: "agent", items: jobs.slice(0, count).map(jobId => ({ jobId })), ...input });
}
function stop(runId: string, status: string, fields = "") {
  d.query(`UPDATE application_runs SET status = ?${fields} WHERE id = ?`).run(status, runId);
}
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  vi.mocked(snapshotSources).mockReturnValue(snapshot());
  vi.mocked(writeSnapshot).mockReturnValue(undefined);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fs.rmSync).mockReturnValue(undefined);
  vi.mocked(runRecord).mockImplementation(id => ({ id, recovery: { retryFrom: "tailoring" } }) as PreparationRun);
  service.isBusy = false;
  busy = false;
  broadcast.mockClear();
  jobs = [1, 2, 3].map(index => insertJob(d, { title: `Role ${index}`, description: "React", link: `https://example.test/jobs/${index}` }));
  queue = new PreparationQueue(service, () => busy, broadcast, 0);
});
afterEach(() => { queue.close(); vi.useRealTimers(); });

test("freezes the sources with their data so every item uses the recorded version", () => {
  vi.mocked(snapshotSources).mockReturnValueOnce(snapshot("v1", { skills: ["React"] }));
  expect(freezeSources("b", snapshot("v1", { skills: ["React"] }))).toEqual({ projectDir: "/artifacts/batches/b/sources/project", mainFile: "resume.tex", dataFile: "/artifacts/batches/b/sources/resume-data.json", engine: "pdflatex" });
  expect(writeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ version: "v1" }), "/artifacts/batches/b/sources/project");
  expect(fs.writeFileSync).toHaveBeenCalledWith("/artifacts/batches/b/sources/resume-data.json", '{"skills":["React"]}', { mode: 0o600 });
  vi.mocked(snapshotSources).mockReturnValueOnce(snapshot("other"));
  expect(() => freezeSources("b", snapshot())).toThrow("could not be recorded");
});

test("validates a new batch before recording anything", () => {
  expect(() => queue.create({ provider: "agent", items: [] })).toThrow("Select at least one job.");
  expect(() => queue.create({ provider: "agent", items: [{ jobId: jobs[0] }, { jobId: jobs[0] }] })).toThrow("only once");
  expect(() => queue.create({ provider: "agent", items: [null] })).toThrow("Select a saved job.");
  expect(() => queue.create({ items: [{ jobId: jobs[0] }] })).toThrow("Select an agent.");
  expect(() => queue.create({ provider: "agent", items: [{ jobId: 99 }] })).toThrow("Job 99 was not found.");
  vi.mocked(snapshotSources).mockReturnValueOnce(snapshot()).mockReturnValueOnce(snapshot("changed"));
  expect(() => create(1)).toThrow("could not be recorded");
  expect(fs.rmSync).toHaveBeenCalledWith(expect.stringMatching(/^\/artifacts\/batches\/.+/), { recursive: true, force: true });
  expect(d.query("SELECT COUNT(*) AS n FROM preparation_batches").get()).toEqual({ n: 0 });
  expect(service.generate).not.toHaveBeenCalled();
});

test("runs pending items one at a time with the batch's sources, model and context", () => {
  const batch = create(2, { model: "fast", extra: " Shared ", items: [{ jobId: jobs[0], extra: "Mention Rust" }, { jobId: jobs[1] }] });
  expect(batch).toMatchObject({ status: "active", model: "fast", extra: "Shared", sourceVersion: "v1", items: [{ position: 1, phase: "queued", status: "pending" }, { position: 2 }] });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "preparation_batches" });
  queue.pump();
  expect(service.generate).toHaveBeenCalledOnce();
  expect(service.generate).toHaveBeenCalledWith({ jobId: jobs[0], provider: "agent", model: "fast", extra: "Mention Rust" }, expect.objectContaining({ version: "v1" }));
  expect(items(batch.id).map(item => [item.status, item.phase, item.attempts, item.run_id])).toEqual([["running", "preparing", 1, `run-${jobs[0]}`], ["pending", "queued", 0, null]]);
  service.isBusy = true;
  queue.pump();
  service.isBusy = false;
  busy = true;
  queue.pump();
  busy = false;
  expect(service.generate).toHaveBeenCalledOnce();
  stop(`run-${jobs[0]}`, "failed", ", error = 'Agent failed'");
  queue.pump();
  expect(service.generate).toHaveBeenCalledTimes(2);
  expect(items(batch.id).map(item => [item.status, item.error])).toEqual([["failed", "Agent failed"], ["running", null]]);
});

test("a refused start fails only that item and the batch continues", () => {
  const batch = create(3);
  service.generate.mockImplementationOnce(() => { throw new Error("Restore this job first."); });
  vi.mocked(snapshotSources).mockReturnValueOnce(snapshot()).mockReturnValueOnce(snapshot("edited"));
  queue.pump();
  expect(items(batch.id).map(item => [item.status, item.attempts, item.error])).toEqual([
    ["failed", 1, "Restore this job first."], ["failed", 1, expect.stringContaining("recorded resume sources changed")], ["running", 1, null],
  ]);
});

test("an approved resume is filled when the portal is free; a form in review makes other fills wait", () => {
  const batch = create(2);
  const [first, second] = items(batch.id);
  for (const [item, jobId, run] of [[first!, jobs[0]!, "run-a"], [second!, jobs[1]!, "run-b"]] as const) {
    runRow(run, jobId, "completed", "review", '{"checkpoints":["compiled"]}');
    const application = insertApplication(d, { job_id: jobId, preparation_run_id: run });
    d.query("UPDATE application_runs SET application_id = ? WHERE id = ?").run(application, run);
    d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, approved_at) VALUES (?, ?, ?, 'h', 'v1', '{}', 'now', ?)").run(`pdf-${run}`, run, application, run === "run-a" ? "now" : null);
    setItem(d, item.id, { run_id: run, phase: "compiling", status: "running" });
  }
  queue.pump();
  expect(service.fill).toHaveBeenCalledExactlyOnceWith({ runId: "run-a" });
  stop("run-a", "completed", ", phase = 'review', recovery_json = '{\"checkpoints\":[\"compiled\",\"filled\"]}'");
  d.query("UPDATE document_versions SET approved_at = 'now' WHERE run_id = 'run-b'").run();
  queue.pump();
  expect(items(batch.id).map(item => [item.phase, item.status, item.holds_portal])).toEqual([["in_review", "waiting_for_user", 1], ["waiting_for_fill", "pending", 0]]);
  expect(service.fill).toHaveBeenCalledOnce();
  expect(queue.state().portal).toMatchObject({ itemId: first!.id });
  d.query("UPDATE applications SET submission_status = 'submitted' WHERE preparation_run_id = 'run-a'").run();
  queue.pump();
  expect(service.fill).toHaveBeenLastCalledWith({ runId: "run-b" });
  expect(items(batch.id)[0]).toMatchObject({ phase: "submitted", status: "completed", holds_portal: 0 });
});

test("pause keeps every phase, resume continues, and a restart pauses the batch", () => {
  const batch = create(2);
  queue.pump();
  expect(queue.pause({ batchId: batch.id })).toMatchObject({ status: "paused", pauseReason: "user", items: [{ status: "running", phase: "preparing" }, { status: "pending", phase: "queued" }] });
  expect(() => queue.pause({ batchId: batch.id })).toThrow("Only an active batch can be paused.");
  stop(`run-${jobs[0]}`, "completed", ", phase = 'review'");
  queue.pump();
  expect(service.generate).toHaveBeenCalledOnce();
  expect(items(batch.id).map(item => item.phase)).toEqual(["ready_for_review", "queued"]);
  expect(queue.resume({ batchId: batch.id })).toMatchObject({ status: "active", pauseReason: null });
  expect(() => queue.resume({ batchId: batch.id })).toThrow("Only a paused batch can be resumed.");
  queue.pump();
  expect(service.generate).toHaveBeenCalledTimes(2);
  queue.close();
  queue = new PreparationQueue(service, () => busy, broadcast, 0);
  expect(batchRow(d, batch.id)).toMatchObject({ status: "paused", pause_reason: "restart" });
});

test("cancels a running item, then the whole batch, without touching finished results", async () => {
  const batch = create(3);
  queue.pump();
  const [first] = items(batch.id);
  expect(await queue.cancel({ batchId: batch.id, itemId: first!.id })).toMatchObject({ items: [{ status: "cancelled", phase: "preparing" }, {}, {}] });
  expect(service.cancel).toHaveBeenCalledWith(first!.run_id);
  await expect(queue.cancel({ batchId: batch.id, itemId: first!.id })).rejects.toThrow("already finished");
  stop(first!.run_id!, "cancelled");
  queue.pump();
  stop(`run-${jobs[1]}`, "completed", ", phase = 'review'");
  queue.pump();
  service.cancel.mockRejectedValueOnce(new Error("This execution is not active."));
  const cancelled = await queue.cancel({ batchId: batch.id });
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.items.map(item => [item.phase, item.status])).toEqual([["preparing", "cancelled"], ["ready_for_review", "cancelled"], ["preparing", "cancelled"]]);
  expect(() => queue.retry({ batchId: batch.id })).toThrow("This batch was cancelled.");
  await expect(queue.cancel({ batchId: batch.id })).rejects.toThrow("This batch was cancelled.");
  expect(() => queue.add({ batchId: batch.id, items: [{ jobId: jobs[0] }] })).toThrow("This batch was cancelled.");
});

test("retries failed items from their checkpoints; an unknown fill outcome needs an explicit review", () => {
  const batch = create(3);
  const [first, second, third] = items(batch.id);
  runRow("gen", jobs[0]!, "failed", "preparing", '{"checkpoints":[]}');
  runRow("fill", jobs[1]!, "interrupted", "filling", '{"checkpoints":["compiled"],"portal":"started"}');
  setItem(d, first!.id, { run_id: "gen", status: "running" });
  setItem(d, second!.id, { run_id: "fill", status: "running" });
  setItem(d, third!.id, { status: "waiting_for_user", phase: "ready_for_review" });
  queue.pause({ batchId: batch.id });
  expect(() => queue.retry({ batchId: batch.id, itemId: third!.id })).toThrow("Only failed, interrupted or sign-in items can be retried.");
  expect(queue.retry({ batchId: batch.id }).items.map(item => item.status)).toEqual(["pending", "interrupted", "waiting_for_user"]);
  expect(() => queue.retry({ batchId: batch.id })).toThrow(REVIEW_MESSAGE);
  expect(() => queue.retry({ batchId: batch.id, itemId: second!.id })).toThrow(REVIEW_MESSAGE);
  queue.retry({ batchId: batch.id, itemId: second!.id, reviewed: true });
  vi.mocked(runRecord).mockImplementation(id => ({ id, recovery: { retryFrom: id === "gen" ? "preparing" : "filling" } }) as PreparationRun);
  queue.resume({ batchId: batch.id });
  queue.pump();
  expect(service.retry).toHaveBeenCalledExactlyOnceWith({ runId: "gen", reviewed: false }, expect.objectContaining({ version: "v1" }));
  stop("gen", "completed", ", phase = 'review'");
  queue.pump();
  expect(service.retry).toHaveBeenLastCalledWith({ runId: "fill", reviewed: true }, undefined);
  expect(items(batch.id)[1]).toMatchObject({ status: "running", attempts: 1, options_json: "{}" });
  expect(() => queue.retry({ batchId: batch.id })).toThrow("No failed items to retry.");
});

test("adds jobs at the end, reports state and follows events", async () => {
  vi.useFakeTimers();
  const batch = create(1);
  expect(queue.add({ batchId: batch.id, items: [{ jobId: jobs[2], extra: "Late" }] }).items.map(item => [item.position, item.jobId, item.extra])).toEqual([[1, jobs[0], ""], [2, jobs[2], "Late"]]);
  expect(() => queue.add({ batchId: batch.id, items: [{ jobId: jobs[2] }] })).toThrow("already in an unfinished batch item");
  await vi.runAllTimersAsync();
  expect(service.generate).toHaveBeenCalledOnce();
  stop(`run-${jobs[0]}`, "failed");
  broadcast.mockClear();
  expect(queue.state().batches[0]!.items[0]).toMatchObject({ status: "failed", retryable: true });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "preparation_batches" });
  queue.observe({ type: "changed", table: "preparation_batches" });
  queue.observe({ type: "acp-update" });
  queue.observe(null);
  await vi.runAllTimersAsync();
  expect(service.generate).toHaveBeenCalledOnce();
  for (const event of [{ type: "changed", table: "application_runs" }, { type: "acp-status" }, { type: "acp-exit" }]) queue.observe(event);
  await vi.runAllTimersAsync();
  expect(service.generate).toHaveBeenCalledTimes(2);
});

test("polls for availability changes without events and stops on close", async () => {
  vi.useFakeTimers();
  queue.close();
  queue = new PreparationQueue(service, () => busy, broadcast, 1000);
  busy = true;
  create(1);
  await vi.advanceTimersByTimeAsync(10);
  expect(service.generate).not.toHaveBeenCalled();
  busy = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(service.generate).toHaveBeenCalledOnce();
  queue.close();
  queue.schedule();
  queue.pump();
  await vi.advanceTimersByTimeAsync(5000);
  expect(service.generate).toHaveBeenCalledOnce();
});

test("replays an identical request after progress without duplicating or freezing sources again", () => {
  const input = { requestId: "retry-key", provider: "agent", items: [{ jobId: jobs[0] }] };
  expect(queue.preview(input)).toMatchObject({ eligible: 1, excluded: 0 });
  const first = queue.create(input);
  queue.pump();
  const writes = vi.mocked(writeSnapshot).mock.calls.length;
  expect(queue.create(input).id).toBe(first.id);
  expect(vi.mocked(writeSnapshot).mock.calls).toHaveLength(writes);
  expect(d.query("SELECT COUNT(*) AS n FROM preparation_batches").get()).toEqual({ n: 1 });
  expect(() => queue.create({ ...input, extra: "Changed" })).toThrow("different selection or configuration");
  queue.add({ batchId: first.id, items: [{ jobId: jobs[1] }] });
  expect(queue.create(input).items).toHaveLength(2);
});

test("an adjustment waits for the executor, survives restart and starts a new version from the frozen sources", () => {
  const batch = create(1);
  queue.pause({ batchId: batch.id });
  const selected = items(batch.id)[0]!;
  runRow("old", jobs[0]!, "completed", "review", '{"checkpoints":["compiled"]}');
  const app = insertApplication(d, { job_id: jobs[0]!, preparation_run_id: "old" });
  d.query("UPDATE application_runs SET application_id = ? WHERE id = 'old'").run(app);
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at) VALUES ('old-pdf', 'old', ?, 'hash', 'v1', '{}', 'now')").run(app);
  setItem(d, selected.id, { run_id: "old", phase: "compiling", status: "running" });
  const adjusted = queue.adjust({ batchId: batch.id, itemId: selected.id, adjustment: "Emphasize React" });
  expect(adjusted).toMatchObject({ summary: { pending: 1, prepared: 0 }, items: [{ phase: "queued", status: "pending", adjustment: "Emphasize React", runId: "old" }] });
  queue.pump();
  expect(service.generate).not.toHaveBeenCalled();
  queue.close(); queue = new PreparationQueue(service, () => busy, broadcast, 0);
  expect(queue.state(batch.id).batches[0]!.items[0]).toMatchObject({ phase: "queued", status: "pending" });
  queue.resume({ batchId: batch.id });
  // A refused start keeps the request and previous PDF for a later retry.
  service.generate.mockImplementationOnce(() => { throw Error("Synthetic unavailable agent"); });
  queue.pump();
  expect(queue.state(batch.id).batches[0]).toMatchObject({ summary: { failed: 1, prepared: 0 }, items: [{ runId: "old", error: "Synthetic unavailable agent" }] });
  queue.retry({ batchId: batch.id, itemId: selected.id });
  queue.pump();
  expect(service.generate).toHaveBeenLastCalledWith({ jobId: jobs[0], applicationId: app, provider: "agent", model: undefined, extra: "Requested adjustment:\nEmphasize React" }, expect.objectContaining({ version: "v1" }));
  expect(items(batch.id)[0]).toMatchObject({ run_id: `run-${jobs[0]}`, attempts: 2, status: "running", options_json: '{"adjustment":"Emphasize React"}' });
  expect(d.query("SELECT id FROM document_versions").all()).toEqual([{ id: "old-pdf" }]);
});

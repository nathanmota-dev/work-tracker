import { beforeEach, expect, test } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { appendItems, assertPortalFree, batchItems, batchRow, checkJobs, insertBatch, itemRow, pauseAfterRestart, pendingItems, portalHolder, queueState, reconcileItems, setBatch, setItem } from "./batch-store.ts";

let d: Database;
const sources = { projectDir: "/batch/sources", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" as const, profileDir: "" };
const batch = (fields: { provider?: string; extra?: string } = {}) => insertBatch(d, { provider: "agent", model: null, extra: "", source_version: "v1", sources, ...fields });
function run(id: string, jobId: number, fields: Record<string, string | number | null> = {}): void {
  const values = { id, job_id: jobId, application_id: null, status: "running", phase: "tailoring", provider: "agent", events_json: "[]", recovery_json: "{}", created_at: "now", updated_at: "now", ...fields };
  d.query(`INSERT INTO application_runs (${Object.keys(values).join(", ")}) VALUES (${Object.keys(values).map(() => "?").join(", ")})`).run(...Object.values(values));
}
const item = (batchId: string, position = 1) => batchItems(d, batchId)[position - 1]!;
beforeEach(async () => { d = await memoryDatabase(); });

test("rejects jobs that cannot be prepared or are already queued, naming each one", () => {
  const ready = insertJob(d, { description: "React" });
  const archived = insertJob(d, { title: "Archived", description: "React", archived_at: "2026-10-01" });
  const incomplete = insertJob(d, { title: "Incomplete", link: null, description: null });
  const submitted = insertJob(d, { title: "Submitted", description: "React" });
  insertApplication(d, { job_id: submitted, submission_status: "submitted" });
  expect(() => checkJobs(d, [{ jobId: ready, extra: "" }])).not.toThrow();
  expect(() => checkJobs(d, [999, archived, incomplete, submitted].map(jobId => ({ jobId, extra: "" }))))
    .toThrow("Job 999 was not found; Example Corp · Archived is archived; Example Corp · Incomplete is missing external_url, description; Example Corp · Submitted was already submitted.");
  const id = batch();
  appendItems(d, id, [{ jobId: ready, extra: "" }]);
  expect(() => checkJobs(d, [{ jobId: ready, extra: "" }])).toThrow("Example Corp · Engineer is already in an unfinished batch item.");
  setItem(d, item(id).id, { status: "cancelled" });
  expect(() => checkJobs(d, [{ jobId: ready, extra: "" }])).not.toThrow();
});

test("persists a batch with ordered items, per-item context and stable positions", () => {
  const [a, b, c] = [insertJob(d), insertJob(d), insertJob(d)];
  const id = batch({ extra: "Shared" });
  appendItems(d, id, [{ jobId: a, extra: "" }, { jobId: b, extra: "Mention Rust" }]);
  appendItems(d, id, [{ jobId: c, extra: "" }]);
  expect(batchRow(d, id)).toMatchObject({ status: "active", provider: "agent", extra: "Shared", source_version: "v1", sources_json: JSON.stringify(sources) });
  expect(batchItems(d, id).map(row => [row.position, row.job_id, row.phase, row.status, row.attempts, row.options_json])).toEqual([
    [1, a, "queued", "pending", 0, "{}"], [2, b, "queued", "pending", 0, '{"extra":"Mention Rust"}'], [3, c, "queued", "pending", 0, "{}"],
  ]);
  expect(itemRow(d, id, item(id, 2).id).job_id).toBe(b);
  expect(() => batchRow(d, "missing")).toThrow("Batch not found.");
  expect(() => batchRow(d, undefined)).toThrow("Batch not found.");
  expect(() => itemRow(d, id, "missing")).toThrow("Batch item not found.");
  setBatch(d, id, { status: "paused", pause_reason: "user" });
  expect(batchRow(d, id)).toMatchObject({ status: "paused", pause_reason: "user" });
});

test("a restart pauses active batches and pending items run oldest batch first, by position", () => {
  const [a, b, c] = [insertJob(d), insertJob(d), insertJob(d)];
  const first = batch();
  appendItems(d, first, [{ jobId: a, extra: "" }, { jobId: b, extra: "" }]);
  const second = batch();
  appendItems(d, second, [{ jobId: c, extra: "" }]);
  setItem(d, item(first).id, { status: "waiting_for_user", phase: "ready_for_review" });
  expect(pendingItems(d).map(row => [row.job_id, row.provider, row.batch_extra])).toEqual([[b, "agent", ""], [c, "agent", ""]]);
  pauseAfterRestart(d);
  expect([batchRow(d, first).pause_reason, batchRow(d, second).status]).toEqual(["restart", "paused"]);
  expect(pendingItems(d)).toEqual([]);
});

test("items follow their execution: decision wait, approval, fill and submission", () => {
  const job = insertJob(d);
  const id = batch();
  appendItems(d, id, [{ jobId: job, extra: "" }]);
  const { id: itemId } = item(id);
  expect(reconcileItems(d)).toBe(false);
  run("run-1", job, { events_json: JSON.stringify([{ type: "acp-status", status: "running" }, { type: "acp-status", status: "waiting_for_permission" }]) });
  setItem(d, itemId, { run_id: "run-1" });
  expect(reconcileItems(d)).toBe(true);
  expect(item(id)).toMatchObject({ phase: "tailoring", status: "waiting_for_decision", holds_portal: 0 });
  expect(reconcileItems(d)).toBe(false);
  const application = insertApplication(d, { job_id: job, preparation_run_id: "run-1" });
  d.query("UPDATE application_runs SET status = 'completed', phase = 'review', application_id = ?, recovery_json = '{\"checkpoints\":[\"sources\",\"tailored\",\"compiled\"]}' WHERE id = 'run-1'").run(application);
  reconcileItems(d);
  expect(item(id)).toMatchObject({ phase: "ready_for_review", status: "waiting_for_user", application_id: application });
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, approved_at) VALUES ('pdf-1', 'run-1', ?, 'hash', 'v1', '{}', 'now', 'now')").run(application);
  reconcileItems(d);
  expect(item(id)).toMatchObject({ phase: "waiting_for_fill", status: "pending" });
  expect(portalHolder(d)).toBeUndefined();
  d.query("UPDATE application_runs SET recovery_json = '{\"checkpoints\":[\"compiled\",\"filled\"]}' WHERE id = 'run-1'").run();
  reconcileItems(d);
  expect(item(id)).toMatchObject({ phase: "in_review", status: "waiting_for_user", holds_portal: 1 });
  expect(portalHolder(d)).toMatchObject({ id: itemId, application_id: application, company_name: "Example Corp" });
  expect(() => assertPortalFree(d, application)).not.toThrow();
  expect(() => assertPortalFree(d, application + 1)).toThrow("The Example Corp · Engineer form is waiting for your review in the browser.");
  d.query("UPDATE applications SET submission_status = 'submitted' WHERE id = ?").run(application);
  reconcileItems(d);
  expect(item(id)).toMatchObject({ phase: "submitted", status: "completed", holds_portal: 0 });
  expect(portalHolder(d)).toBeUndefined();
});

test("the queue state reports items, counts, derived completion, review needs and the portal", () => {
  const [a, b, c] = [insertJob(d, { title: "First" }), insertJob(d, { title: "Second" }), insertJob(d, { title: "Third" })];
  const done = batch();
  appendItems(d, done, [{ jobId: a, extra: "" }]);
  setItem(d, item(done).id, { status: "cancelled" });
  const open = batch();
  appendItems(d, open, [{ jobId: b, extra: "Focus" }, { jobId: c, extra: "" }]);
  run("fill-run", c, { status: "interrupted", phase: "filling", recovery_json: '{"checkpoints":["compiled"],"portal":"started"}', error: "The app closed" });
  setItem(d, item(open, 2).id, { run_id: "fill-run", phase: "filling", status: "running" });
  reconcileItems(d);
  const state = queueState(d, true);
  expect(state.busy).toBe(true);
  expect(state.batches.map(value => [value.id, value.status])).toEqual(expect.arrayContaining([[done, "completed"], [open, "active"]]));
  const view = state.batches.find(value => value.id === open)!;
  expect(view.counts).toEqual({ pending: 1, interrupted: 1 });
  expect(view.items).toEqual([
    expect.objectContaining({ position: 1, title: "Second", company: "Example Corp", extra: "Focus", retryable: false, reviewRequired: false, holdsPortal: false }),
    expect.objectContaining({ position: 2, title: "Third", phase: "filling", status: "interrupted", error: "The app closed", retryable: true, reviewRequired: true, holdsPortal: true, runId: "fill-run" }),
  ]);
  expect(state.portal).toEqual({ batchId: open, itemId: item(open, 2).id, applicationId: null, jobId: c, label: "Example Corp · Third" });
  setBatch(d, done, { status: "cancelled" });
  expect(queueState(d, false, done)).toMatchObject({ busy: false, portal: { jobId: c }, batches: [{ id: done, status: "cancelled", counts: { cancelled: 1 } }] });
  const empty = batch();
  expect(queueState(d, false, empty).batches[0]).toMatchObject({ status: "active", items: [], counts: {} });
});

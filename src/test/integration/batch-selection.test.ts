import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreparationQueue } from "../../preparation/batch-queue.ts";
import { baseResumeFile, writeProfile } from "./base-profile.ts";
import type { BatchPreview, PreparationBatch, PreparationRun } from "../../preparation/types.ts";

const home = mkdtempSync(join(tmpdir(), "work-tracker-selection-"));
const previous = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let Queue: typeof import("../../preparation/batch-queue.ts").PreparationQueue;
let handle: typeof import("../../preparation/batch-http.ts").handleBatches;
let queue: PreparationQueue;
const generate = vi.fn((input: Record<string, unknown>) => {
  const id = `run-${String(input.jobId)}`;
  database.db().query("INSERT INTO application_runs (id, job_id, status, phase, provider, created_at, updated_at) VALUES (?, ?, 'completed', 'review', 'fixture', 'now', 'now')").run(id, Number(input.jobId));
  return { id } as PreparationRun;
});
const service = { generate, retry: vi.fn(), fill: vi.fn(), cancel: vi.fn(), isBusy: false };
const call = (operation: string, body: unknown) => handle(`/api/preparation-batches/${operation}`, new Request("http://local", { method: "POST", body: JSON.stringify(body) }), queue);
const selection = (...ids: number[]) => ({ items: ids.map(jobId => ({ jobId })) });
const job = (title: string, fields = "") => Number((database.db().query(`INSERT INTO jobs (title, company_name, link, description${fields}) VALUES (?, 'Synthetic', ?, 'React'${fields ? ", 'now'" : ""}) RETURNING id`).get(title, `https://example.test/${title}`) as { id: number }).id);
beforeAll(async () => {
  database = await import("../../db/index.ts");
  Queue = (await import("../../preparation/batch-queue.ts")).PreparationQueue;
  handle = (await import("../../preparation/batch-http.ts")).handleBatches;
  writeProfile(home, { summary: "Synthetic resume." });
});
beforeEach(() => { queue?.close(); database.db().exec("UPDATE preparation_batch_items SET status = 'cancelled'"); generate.mockClear(); queue = new Queue(service, () => true, () => {}, 0); });
afterAll(() => {
  queue?.close(); database?.closeDb(); rmSync(home, { recursive: true, force: true });
  if (previous === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previous;
});

test("HTTP preview excludes archived, submitted, duplicate and incomplete jobs; creation revalidates atomically", async () => {
  const a = job("ready"), b = job("duplicate"), archived = job("archived", ", archived_at"), submitted = job("submitted"), incomplete = job("incomplete");
  const d = database.db();
  d.query("UPDATE jobs SET link = (SELECT link FROM jobs WHERE id = ?) || '?utm_source=test' WHERE id = ?").run(a, b);
  d.query("UPDATE jobs SET description = NULL WHERE id = ?").run(incomplete);
  d.query("INSERT INTO applications (job_id, submission_status) VALUES (?, 'submitted')").run(submitted);
  const preview = await call("preview", selection(a, b, archived, submitted, incomplete));
  expect(preview.status).toBe(200);
  const result = await preview.json() as BatchPreview;
  expect(result).toMatchObject({ eligible: 1, excluded: 4 });
  expect(result.items.map((item: { reasons: string[] }) => item.reasons.join(" "))).toEqual(["", expect.stringContaining("duplicate"), "is archived", "was already submitted", "is missing description"]);
  d.query("UPDATE jobs SET archived_at = 'now' WHERE id = ?").run(a);
  const failed = await call("create", { ...selection(a), provider: "fixture", requestId: "stale-preview" });
  expect([failed.status, await failed.json()]).toEqual([409, { error: "Synthetic · ready is archived." }]);
  expect(d.query("SELECT COUNT(*) AS n FROM preparation_batches").get()).toEqual({ n: 0 });
  d.query("UPDATE jobs SET archived_at = NULL WHERE id = ?").run(a);
  expect((await call("create", { ...selection(a), provider: "fixture", requestId: "stale-preview" })).status).toBe(201);
  expect(await (await call("preview", selection(a))).json()).toMatchObject({ eligible: 0, items: [{ reasons: ["is already in an unfinished batch item"] }] });
});

test("five jobs create five items; concurrent retries and restart reuse the batch and context overrides win", async () => {
  const ids = Array.from({ length: 5 }, (_, i) => job(`five-${i}`));
  const input = { ...selection(...ids), provider: "fixture", model: "fixture-model", extra: "Common", requestId: "five-jobs" };
  input.items[1] = { jobId: ids[1]!, ...{ extra: "Override" } };
  expect(await (await call("preview", input)).json()).toMatchObject({ eligible: 5 });
  const responses = await Promise.all([call("create", input), call("create", input)]);
  expect(responses.map(response => response.status)).toEqual([201, 201]);
  const batches = await Promise.all(responses.map(response => response.json() as Promise<PreparationBatch>));
  expect(batches[0]!.id).toBe(batches[1]!.id);
  expect(batches[0]!.items).toHaveLength(5);
  queue.close(); queue = new Queue(service, () => false, () => {}, 0);
  expect((await (await call("create", input)).json() as PreparationBatch).id).toBe(batches[0]!.id);
  queue.resume({ batchId: batches[0]!.id });
  for (let i = 0; i < 5; i++) queue.pump();
  expect(generate.mock.calls.map(([body]) => [body.provider, body.model, body.extra])).toEqual(ids.map((_, i) => ["fixture", "fixture-model", i === 1 ? "Override" : "Common"]));
  expect(database.db().query("SELECT COUNT(*) AS n FROM preparation_batches WHERE id = ?").get(batches[0]!.id)).toEqual({ n: 1 });
  expect((await call("create", { ...input, extra: "Changed" })).status).toBe(409);
});

test("a failed insertion rolls back the batch, items and request and removes only its new artifacts", async () => {
  const id = job("rollback");
  const root = join(home, "artifacts", "batches");
  const before = readdirSync(root);
  const source = readFileSync(baseResumeFile(home), "utf8");
  database.db().exec("CREATE TRIGGER reject_fixture_item BEFORE INSERT ON preparation_batch_items BEGIN SELECT RAISE(ABORT, 'fixture insertion failure'); END;");
  const failed = await call("create", { ...selection(id), provider: "fixture", requestId: "rollback" });
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "fixture insertion failure" });
  expect(readdirSync(root)).toEqual(before);
  expect(readFileSync(baseResumeFile(home), "utf8")).toBe(source);
  expect(database.db().query("SELECT * FROM preparation_batch_requests WHERE request_id = 'rollback'").all()).toEqual([]);
  expect(database.db().query("SELECT * FROM preparation_batch_items WHERE job_id = ?").all(id)).toEqual([]);
  database.db().exec("DROP TRIGGER reject_fixture_item");
  expect((await call("create", { ...selection(id), provider: "fixture", requestId: "rollback" })).status).toBe(201);
});

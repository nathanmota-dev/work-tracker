import { beforeEach, expect, test } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { appendItems, batchItems, insertBatch, setItem } from "./batch-store.ts";
import { requestAdjustment } from "./batch-adjustment.ts";

let d: Database;
let batchId: string;
let itemId: string;
beforeEach(async () => {
  d = await memoryDatabase();
  const job = insertJob(d);
  const app = insertApplication(d, { job_id: job });
  batchId = insertBatch(d, { provider: "agent", model: null, extra: "Common", source_version: "v1", sources: { projectDir: "/source", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" } });
  appendItems(d, batchId, [{ jobId: job, extra: "Override" }]);
  itemId = batchItems(d, batchId)[0]!.id;
  d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at) VALUES ('old', ?, ?, 'completed', 'review', 'agent', 'now', 'now')").run(job, app);
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, approved_at) VALUES ('pdf', 'old', ?, 'hash', 'v1', '{}', 'now', 'now')").run(app);
  setItem(d, itemId, { run_id: "old", application_id: app, phase: "ready_for_review", status: "waiting_for_user" });
});
const adjust = (adjustment: unknown = "Mention React") => requestAdjustment(d, batchId, { itemId, adjustment });
test("records an adjustment without changing the previous run, document or approval", () => {
  const old = d.query("SELECT * FROM document_versions").all();
  adjust("  Mention React  ");
  expect(batchItems(d, batchId)[0]).toMatchObject({ phase: "queued", status: "pending", run_id: "old", options_json: '{"extra":"Override","adjustment":"Mention React","regenerate":true}' });
  expect(d.query("SELECT * FROM document_versions").all()).toEqual(old);
  expect(() => adjust()).toThrow("before filling");
});
test("rejects empty, oversized, foreign and unavailable documents without partial edits", () => {
  const old = batchItems(d, batchId);
  for (const value of ["", null, "x".repeat(12001)]) expect(() => adjust(value)).toThrow("1 to 12000");
  expect(() => requestAdjustment(d, "foreign", { itemId, adjustment: "React" })).toThrow("not found");
  expect(batchItems(d, batchId)).toEqual(old);
  setItem(d, itemId, { holds_portal: 1 });
  expect(() => adjust()).toThrow("before filling");
  setItem(d, itemId, { holds_portal: 0, status: "failed" });
  expect(() => adjust()).toThrow("before filling");
  setItem(d, itemId, { status: "pending", phase: "waiting_for_fill", run_id: null });
  expect(() => adjust()).toThrow("No document");
});

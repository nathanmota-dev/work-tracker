import { beforeEach, expect, test } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { checkSelection, newItems, previewJobs } from "./batch-selection.ts";
import { batchRequest, recordBatchRequest } from "./batch-request.ts";
import { appendItems, insertBatch } from "./batch-store.ts";

let d: Database;
beforeEach(async () => { d = await memoryDatabase(); });
const select = (...ids: number[]) => ids.map(jobId => ({ jobId, extra: "" }));
const batch = () => insertBatch(d, { provider: "agent", model: null, extra: "", source_version: "v", sources: { projectDir: "/fixture", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" } });

test("previews all exclusions, canonical duplicates and missing fields without changing records", () => {
  const ready = insertJob(d, { description: "React" });
  const duplicate = insertJob(d, { link: "https://jobs.example.test/role/?utm_source=fixture", description: "React" });
  const archived = insertJob(d, { archived_at: "now", description: "React" });
  const incomplete = insertJob(d, { link: null });
  const submitted = insertJob(d, { description: "React" });
  const queued = insertJob(d, { description: "React" });
  insertApplication(d, { job_id: submitted, submission_status: "submitted" });
  appendItems(d, batch(), select(queued));
  const preview = previewJobs(d, select(ready, duplicate, archived, incomplete, submitted, queued, 999, ready));
  expect(preview).toMatchObject({ selected: 8, eligible: 1, excluded: 7 });
  expect(preview.items.map(item => item.reasons)).toEqual([
    [], ["is a duplicate in this selection"], ["is archived", "is a duplicate in this selection"],
    ["is missing external_url, description"], ["was already submitted", "is a duplicate in this selection"],
    ["is already in an unfinished batch item", "is a duplicate in this selection"], ["Job 999 was not found"], ["is a duplicate in this selection"],
  ]);
  expect(preview.items[3]!.missing).toEqual(["external_url", "description"]);
  expect(() => checkSelection(d, select(ready, ready))).toThrow("only once");
  expect(() => checkSelection(d, select(999))).toThrow("Job 999 was not found");
  expect(() => checkSelection(d, select(archived))).toThrow("is archived");
});

test("identity also matches LinkedIn and source IDs, but never guesses from a title", () => {
  const a = insertJob(d, { linkedin_job_id: "123", source: "LinkedIn", source_job_id: "123", link: "https://a.test/1", description: "React" });
  const b = insertJob(d, { link: "https://linkedin.com/jobs/view/123", description: "React" });
  const c = insertJob(d, { source: "linkedin", source_job_id: "123", link: "https://c.test/1", description: "React" });
  const e = insertJob(d, { link: "https://e.test/1", description: "React" });
  expect(previewJobs(d, select(a, b, c, e)).items.map(item => item.eligible)).toEqual([true, false, false, true]);
  expect(() => checkSelection(d, select(a, e))).not.toThrow();
});

test("parses explicit IDs without a page-size cap and rejects invalid selection", () => {
  for (const input of [undefined, [], null]) expect(() => newItems(input)).toThrow("at least one");
  for (const input of [null, 1, { jobId: -1 }]) expect(() => newItems([input])).toThrow("saved job");
  expect(newItems([{ jobId: 1, extra: " Override " }, { jobId: 2 }])).toEqual([{ jobId: 1, extra: "Override" }, { jobId: 2, extra: "" }]);
  expect(newItems(Array.from({ length: 60 }, (_, i) => ({ jobId: i + 1 })))).toHaveLength(60);
});

test("request IDs persist a fingerprint and cannot be reused for another payload", () => {
  const id = batch();
  expect(batchRequest(d, undefined, "a")).toBeUndefined();
  for (const key of [null, "", "/unsafe", 1, "x".repeat(129)]) expect(() => batchRequest(d, key, "a")).toThrow("Invalid batch request ID");
  expect(batchRequest(d, "request", "a")).toBeUndefined();
  recordBatchRequest(d, undefined, id, "a");
  recordBatchRequest(d, "request", id, "a");
  expect(batchRequest(d, "request", "a")).toBe(id);
  expect(() => batchRequest(d, "request", "b")).toThrow("different selection or configuration");
});

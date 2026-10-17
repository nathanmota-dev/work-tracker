import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { reconcileReviews, refreshReview, resolveReview, reviewItems } from "./review.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-17T10:00:00.000Z" }));

let d: Database;
const at = "2026-09-01T12:00:00.000Z";
const legacy = (fields: Record<string, string | number | null>) => insertApplication(d, {
  origin: "unknown", company_name: "Example Corp", external_url: "https://jobs.example.test/role", ...fields,
});
const row = (id: number) => d.query(`SELECT id, job_id, status, submission_status, submitted_at, applied_at, current_stage_id,
  tracking_status, review_reason, previous_application_id, company_name, external_url FROM applications WHERE id = ?`).get(id) as Record<string, unknown>;
const count = (table: string) => (d.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const item = (id: number) => reviewItems(d).find((entry) => entry.id === id);

beforeEach(async () => {
  d = await memoryDatabase();
});

test("describes each flagged record with its safe fix, decisions, missing data and conflicts", () => {
  const job = insertJob(d);
  const stage = legacy({ status: "submitted", submission_status: "submitted", submitted_at: at, applied_at: at, review_reason: "missing_stage", job_id: job });
  const applied = legacy({ status: "applied", applied_at: at, review_reason: "unknown_status" });
  const prepared = legacy({ status: "applied", origin: "preparation", applied_at: at, review_reason: "unknown_status" });
  const bare = legacy({ status: "draft", company_name: null, external_url: null, review_reason: "missing_job" });
  const duplicate = legacy({ status: "draft", job_id: job, attempt: 2, review_reason: "duplicate_job" });
  legacy({ status: "draft" });
  expect(reviewItems(d).map((entry) => entry.id)).toEqual([stage, applied, prepared, bare, duplicate]);
  expect(item(stage)).toMatchObject({ safe_fix: "track", decisions: ["track"], link_job: false, missing: [], related: [{ id: duplicate, attempt: 2 }] });
  expect(item(applied)).toMatchObject({ safe_fix: "mark_submitted", decisions: ["mark_submitted", "mark_not_submitted"], link_job: true });
  // Only the browser confirmation submits an Apply record, so its "applied" stays a question.
  expect(item(prepared)).toMatchObject({ safe_fix: null });
  expect(item(bare)).toMatchObject({ safe_fix: null, decisions: ["mark_submitted"], missing: ["company_name", "external_url", "applied_at"] });
  expect(item(duplicate)).toMatchObject({ safe_fix: null, decisions: ["keep_attempt"], related: [{ id: stage, attempt: 1, submission_status: "submitted" }] });
});

test("safe fixes keep IDs, add one board event each and are idempotent", () => {
  const job = insertJob(d);
  const stage = legacy({ status: "submitted", submission_status: "submitted", submitted_at: at, job_id: job, review_reason: "missing_stage", external_url: null });
  const applied = legacy({ status: "applied", applied_at: at, review_reason: "unknown_status" });
  const unclear = legacy({ status: "applied", applied_at: null, review_reason: "unknown_status" });
  const first = reconcileReviews(d, "system");
  expect(first.fixed).toEqual([stage, applied]);
  expect(first.items.map((entry) => entry.id)).toEqual([unclear]);
  expect(row(stage)).toMatchObject({ id: stage, current_stage_id: expect.any(Number), tracking_status: "active", review_reason: null, applied_at: at, external_url: "https://jobs.example.test/role" });
  expect(row(applied)).toMatchObject({ status: "submitted", submission_status: "submitted", submitted_at: at, tracking_status: "active", review_reason: null });
  expect(d.query("SELECT actor FROM application_transitions WHERE application_id = ?").all(applied)).toEqual([{ actor: "system" }]);
  const events = count("application_events");
  expect(events).toBe(2);
  expect(reconcileReviews(d, "system")).toEqual({ fixed: [], items: first.items });
  expect(count("application_events")).toBe(events);
  expect(count("applications")).toBe(3);
});

test("explicit decisions complete missing data, track and keep other flags", () => {
  const bare = legacy({ status: "draft", company_name: null, external_url: "bad", review_reason: "missing_job" });
  expect(() => resolveReview(d, { id: bare, decision: "mark_submitted" }, "api")).toThrow("Add the company name, job link, application date before tracking this application.");
  expect(() => resolveReview(d, { id: bare, decision: "mark_submitted", external_url: "nope" }, "api")).toThrow("Enter a valid HTTP or HTTPS URL.");
  expect(() => resolveReview(d, { id: bare, decision: "mark_submitted", applied_at: "never" }, "api")).toThrow("Invalid application date.");
  expect(row(bare)).toMatchObject({ submission_status: "not_submitted", company_name: null });
  const result = resolveReview(d, { id: bare, decision: "mark_submitted", company_name: "Typed Corp", external_url: "https://typed.test/job", applied_at: at }, "api");
  expect(result).toEqual({ item: null, changed: true });
  expect(row(bare)).toMatchObject({ company_name: "Typed Corp", external_url: "https://typed.test/job", submitted_at: at, tracking_status: "active", review_reason: null });
  expect(resolveReview(d, { id: bare, decision: "track" }, "api")).toEqual({ item: null, changed: false });
});

test("not-submitted and separate-attempt decisions never merge records", () => {
  const job = insertJob(d);
  const first = legacy({ status: "submitted", submission_status: "submitted", job_id: job });
  const second = legacy({ status: "draft", job_id: job, attempt: 2, review_reason: "duplicate_job" });
  expect(resolveReview(d, { id: second, decision: "keep_attempt" }, "api").item).toBeNull();
  expect(row(second)).toMatchObject({ previous_application_id: first, review_reason: null });
  const unclear = legacy({ status: "interviewing", fill_status: "filled", review_reason: "unknown_status" });
  expect(() => resolveReview(d, { id: unclear, decision: "keep_attempt" }, "api")).toThrow("does not apply");
  expect(() => resolveReview(d, { id: unclear, decision: "merge" }, "api")).toThrow("Invalid review decision.");
  const { item: remaining } = resolveReview(d, { id: unclear, decision: "mark_not_submitted" }, "api");
  // A record without a job still needs one after its status is clarified.
  expect(remaining).toMatchObject({ review_reason: "missing_job", status: "filled", decisions: ["mark_submitted"] });
  const orphan = legacy({ status: "draft", job_id: 404, attempt: 3, review_reason: "duplicate_job" });
  expect(() => resolveReview(d, { id: orphan, decision: "keep_attempt" }, "api")).toThrow("No earlier application exists for this job.");
  expect(count("applications")).toBe(4);
});

test("refreshes only flagged records", () => {
  const plain = legacy({ status: "draft" });
  expect(refreshReview(d, plain)).toBeNull();
  expect(row(plain).review_reason).toBeNull();
  const tracked = legacy({ status: "submitted", submission_status: "submitted", current_stage_id: 1, tracking_status: "active", job_id: 99, review_reason: "missing_job" });
  expect(refreshReview(d, tracked)).toBe("missing_job");
  expect(item(tracked)).toMatchObject({ decisions: [], link_job: true, job_exists: false, candidates: [] });
  expect(() => refreshReview(d, 999)).toThrow("Application not found.");
});

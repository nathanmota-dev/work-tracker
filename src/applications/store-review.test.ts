import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { executeApplicationAction } from "./store.ts";
import type { TrackedApplication } from "./types.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-17T10:00:00.000Z" }));

let d: Database;
const card = { company_name: "Typed Corp", external_url: "https://typed.test/job", role_title: "Typed role", applied_at: "2026-10-01T09:00:00.000Z" };
const count = (table: string) => (d.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const run = (action: Parameters<typeof executeApplicationAction>[0], input: unknown) => executeApplicationAction(action, input, d);

beforeEach(async () => {
  d = await memoryDatabase();
});

test("registering with a saved job reuses the job's draft and keeps its stored fields", () => {
  const job = insertJob(d);
  const draft = insertApplication(d, { job_id: job, origin: "preparation", external_url: "https://portal.example.test/apply", preparation_status: "ready" });
  const result = run("create", { ...card, job_id: job });
  const saved = result.value as TrackedApplication;
  expect(saved).toMatchObject({ id: draft, job_id: job, origin: "preparation", submission_status: "submitted", tracking_status: "active",
    company_name: "Typed Corp", external_url: "https://portal.example.test/apply", role_title: "Typed role" });
  expect(result.changed).toEqual(["applications", "application_events"]);
  // Registering the same job again (another screen) adds no application or card.
  expect(run("create", { ...card, job_id: job })).toEqual({ value: saved, changed: [] });
  expect(count("applications")).toBe(1);
  expect(count("application_events")).toBe(1);
  expect(() => run("create", { ...card, job_id: 404 })).toThrow("Job #404 not found.");
});

test("registering a new job application overwrites nothing and clears a legacy flag", () => {
  const job = insertJob(d);
  const created = run("create", { ...card, job_id: job }).value as TrackedApplication;
  expect(created).toMatchObject({ job_id: job, origin: "manual", attempt: 1, company_name: "Typed Corp" });
  const flagged = insertJob(d, { link: "https://jobs.example.test/flagged" });
  const legacy = insertApplication(d, { job_id: flagged, review_reason: "missing_stage", status: "submitted", submission_status: "submitted" });
  run("create", { ...card, job_id: flagged });
  expect(d.query("SELECT review_reason, tracking_status FROM applications WHERE id = ?").get(legacy)).toEqual({ review_reason: null, tracking_status: "active" });
});

test("link actions offer options, link and report changes; review actions resolve and reconcile", () => {
  const id = run("create", card).value as TrackedApplication;
  expect(run("link/options", { id: id.id })).toMatchObject({ value: { application_id: id.id, candidates: [] }, changed: [] });
  expect(run("link", { id: id.id, create: true })).toMatchObject({ value: { application_id: id.id, created_job: true, missing: ["description"] },
    changed: ["applications", "jobs", "activity_log"] });
  const stale = insertApplication(d, { status: "submitted", submission_status: "submitted", submitted_at: card.applied_at,
    company_name: "Old", external_url: "https://old.test", review_reason: "missing_stage" });
  const unclear = insertApplication(d, { status: "weird", company_name: "Old", external_url: "https://old.test", review_reason: "unknown_status" });
  expect((run("review", {}).value as { items: { id: number }[] }).items.map((item) => item.id)).toEqual([stale, unclear]);
  expect(run("review/reconcile", {})).toMatchObject({ value: { fixed: [stale] }, changed: ["applications", "application_events"] });
  expect(run("review/reconcile", {})).toMatchObject({ value: { fixed: [] }, changed: [] });
  expect(run("review/resolve", { id: unclear, decision: "mark_not_submitted" })).toMatchObject({ value: { item: { review_reason: "missing_job" } }, changed: ["applications", "application_events"] });
  expect(run("review/resolve", { id: stale, decision: "track" })).toEqual({ value: { item: null }, changed: [] });
});

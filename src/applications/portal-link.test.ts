import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { openApplication } from "./journey-store.ts";
import { executeApplicationAction } from "./store.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-26T12:00:00.000Z" }));

let d: Database;
const save = (body: unknown) => executeApplicationAction("portal-link", body, d);
const stored = (id: number) =>
  d.query("SELECT external_url, current_stage_id, tracking_status FROM applications WHERE id = ?").get(id);

beforeEach(async () => {
  d = await memoryDatabase();
});

test("saves the form link of an application that is not on the board yet", () => {
  const { record } = openApplication(d, { jobId: insertJob(d), origin: "agent" });
  expect(save({ id: record.id, external_url: " https://tally.so/r/QoRLkA?utm_source=linkedin " })).toEqual({
    value: { id: record.id, external_url: "https://tally.so/r/QoRLkA?utm_source=linkedin" },
    changed: ["applications"],
  });
  expect(stored(record.id)).toEqual({
    external_url: "https://tally.so/r/QoRLkA?utm_source=linkedin", current_stage_id: null, tracking_status: null,
  });
});

test("rejects invalid links, unknown records and submitted applications", () => {
  const { record } = openApplication(d, { jobId: insertJob(d), origin: "agent" });
  expect(() => save({ id: record.id })).toThrow("Job link is required");
  expect(() => save({ id: record.id, external_url: "ftp://bad" })).toThrow("HTTP or HTTPS");
  expect(() => save({ id: 999, external_url: "https://jobs.example.test/1" })).toThrow("Application not found");
  const submitted = insertApplication(d, { status: "submitted", submission_status: "submitted", external_url: "https://jobs.example.test/sent" });
  expect(() => save({ id: submitted, external_url: "https://jobs.example.test/1" })).toThrow("already submitted");
  expect(stored(submitted)).toEqual(expect.objectContaining({ external_url: "https://jobs.example.test/sent" }));
});

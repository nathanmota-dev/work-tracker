import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import type { Database } from "../db/sqlite.ts";
import { cliSpies } from "../test/doubles.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { applicationCmd } from "./records.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-17T10:00:00.000Z" }));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));

let d: Database, output: ReturnType<typeof cliSpies>;
const legacy = (fields: Record<string, string | number | null>) => insertApplication(d, {
  company_name: "Example Corp", external_url: "https://jobs.example.test/role", ...fields,
});

beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  output = cliSpies();
  vi.mocked(notifyChange).mockClear();
});

test("review lists flagged records and reconcile applies only safe fixes once", async () => {
  const stage = legacy({ status: "submitted", submission_status: "submitted", submitted_at: "2026-09-01T00:00:00.000Z", review_reason: "missing_stage" });
  legacy({ status: "weird", review_reason: "unknown_status" });
  await applicationCmd("review", {});
  expect(JSON.parse(output.log.mock.calls[0]![0] as string)).toHaveLength(2);
  await applicationCmd("reconcile", {});
  expect(output.log).toHaveBeenLastCalledWith("1 application(s) reconciled; 1 still need review");
  expect(notifyChange).toHaveBeenCalledWith("application_events");
  vi.mocked(notifyChange).mockClear();
  await applicationCmd("reconcile", {});
  expect(output.log).toHaveBeenLastCalledWith("0 application(s) reconciled; 1 still need review");
  expect(notifyChange).not.toHaveBeenCalled();
  expect(d.query("SELECT actor FROM application_transitions").all()).toEqual([]);
  expect(d.query("SELECT tracking_status FROM applications WHERE id = ?").get(stage)).toEqual({ tracking_status: "active" });
});

test("resolve applies one decision and reports what remains", async () => {
  const unclear = legacy({ status: "weird", review_reason: "unknown_status" });
  await applicationCmd("resolve", { id: String(unclear), decision: "mark_not_submitted" });
  expect(output.log).toHaveBeenLastCalledWith(`application #${unclear} still needs review (missing_job)`);
  await applicationCmd("resolve", { id: String(unclear), decision: "mark_submitted", "applied-at": "2026-09-02T00:00:00.000Z" });
  expect(output.log).toHaveBeenLastCalledWith(`application #${unclear} reconciled`);
  expect(d.query("SELECT actor FROM application_transitions").all()).toEqual([{ actor: "cli" }]);
  await applicationCmd("resolve", { id: String(unclear), decision: "track" });
  expect(output.log).toHaveBeenLastCalledWith(`application #${unclear} needs no review`);
  await expect(applicationCmd("resolve", { id: String(unclear), decision: "merge" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: Invalid review decision.");
});

test("link attaches a saved job by local or LinkedIn ID, or creates one", async () => {
  const job = insertJob(d, { linkedin_job_id: "77", description: "Saved" });
  const first = legacy({ status: "submitted", submission_status: "submitted" });
  await applicationCmd("link", { id: String(first), "linkedin-job-id": "77" });
  expect(output.log).toHaveBeenLastCalledWith(`application #${first} linked to job #${job}`);
  expect(notifyChange).toHaveBeenCalledWith("jobs");
  const second = legacy({ status: "submitted", submission_status: "submitted", role_title: "Engineer", external_url: "https://other.test/job" });
  await applicationCmd("link", { id: String(second), create: true, comp: "R$ 1" });
  expect(output.log).toHaveBeenLastCalledWith(`application #${second} linked to new job #${job + 1}; missing for preparation: description`);
  await expect(applicationCmd("link", { id: String(second), "job-id": String(job) })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith(`error: Application #${second} is already linked to job #${job + 1}.`);
  await expect(applicationCmd("link", { id: String(legacy({ status: "draft" })) })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: Choose a saved job or create one from this application.");
});

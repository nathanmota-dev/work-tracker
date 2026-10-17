import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import {
  applyStatus,
  assertTransition,
  journeyRecord,
  journeyTransitions,
  latestForJob,
  openApplication,
  resolveJob,
  settleExecution,
  transition,
  type JourneyRecord,
} from "./journey-store.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-17T10:00:00.000Z" }));

let d: ReturnType<typeof databaseDouble>;
let rows: Map<number, JourneyRecord>;
let jobs: { id: number; linkedin_job_id: string | null }[];
let keys: Map<string, number>;
const at = "2026-10-17T10:00:00.000Z";
const record = (fields: Partial<JourneyRecord> = {}): JourneyRecord => ({
  id: 1,
  job_id: 10,
  origin: "preparation",
  attempt: 1,
  previous_application_id: null,
  preparation_status: "ready",
  fill_status: "not_started",
  submission_status: "not_submitted",
  tracking_status: null,
  submitted_at: null,
  applied_at: null,
  review_reason: null,
  preparation_run_id: null,
  external_url: null,
  status: "draft",
  has_fill_result: 0,
  ...fields,
});
const writes = () => d.statement.run.mock.calls as unknown as unknown[][];

/** Routes the store's statements to in-memory rows so each rule can be observed. */
beforeEach(() => {
  d = databaseDouble();
  rows = new Map([[1, record()]]);
  jobs = [{ id: 10, linkedin_job_id: "li-10" }, { id: 11, linkedin_job_id: null }];
  keys = new Map();
  d.query.mockImplementation((sql: string) => ({
    ...d.statement,
    get: vi.fn((...args: unknown[]) => {
      d.statement.get(sql, ...args);
      if (sql.includes("FROM jobs WHERE id")) return jobs.find((job) => job.id === args[0]);
      if (sql.includes("FROM jobs WHERE linkedin_job_id")) return jobs.find((job) => job.linkedin_job_id === args[0]);
      if (sql.includes("idempotency_key = ?")) return keys.has(args[0] as string) ? { id: keys.get(args[0] as string) } : undefined;
      if (sql.includes("WHERE job_id = ?"))
        return [...rows.values()].filter((row) => row.job_id === args[0]).sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0))[0];
      if (sql.includes("INSERT INTO applications")) {
        const [job_id, origin, attempt, previous_application_id, key] = args as [number | null, JourneyRecord["origin"], number, number | null, string | null];
        const id = rows.size + 1;
        rows.set(id, record({ id, job_id, origin, attempt, previous_application_id, preparation_status: "not_started" }));
        if (key) keys.set(key, id);
        return { id };
      }
      return rows.get(args[0] as number);
    }),
    run: vi.fn((...args: unknown[]) => {
      (d.statement.run as (...values: unknown[]) => unknown)(...args);
      if (sql.startsWith("UPDATE applications SET")) {
        const column = /SET (\w+) = \?/.exec(sql)![1] as keyof JourneyRecord;
        const row = rows.get(args.at(-1) as number)!;
        rows.set(row.id, { ...row, [column]: args[0], status: args[1] as string, submitted_at: args[2] as string | null });
      }
      return { changes: 1, lastInsertRowid: 1 };
    }),
  }));
});

test("reads one record or the latest attempt and reports a missing application", () => {
  expect(journeyRecord(d.asDatabase, 1)).toMatchObject({ id: 1, job_id: 10 });
  expect(() => journeyRecord(d.asDatabase, 9)).toThrow("Application not found.");
  rows.set(2, record({ id: 2, attempt: 2 }));
  expect(latestForJob(d.asDatabase, 10)?.id).toBe(2);
  expect(latestForJob(d.asDatabase, 99)).toBeUndefined();
});

test("resolves local and external job IDs without guessing", () => {
  expect(resolveJob(d.asDatabase, {})).toBeNull();
  expect(resolveJob(d.asDatabase, { jobId: 11 })).toBe(11);
  expect(resolveJob(d.asDatabase, { linkedinJobId: "li-10" })).toBe(10);
  expect(resolveJob(d.asDatabase, { jobId: 10, linkedinJobId: "li-10" })).toBe(10);
  expect(() => resolveJob(d.asDatabase, { jobId: 99 })).toThrow("Job #99 not found.");
  expect(() => resolveJob(d.asDatabase, { linkedinJobId: "li-404" })).toThrow("No saved job has LinkedIn ID li-404.");
  expect(() => resolveJob(d.asDatabase, { jobId: 11, linkedinJobId: "li-10" })).toThrow("Job #11 does not have LinkedIn ID li-10.");
});

test("reuses a job's application and creates a new attempt only by explicit decision after submission", () => {
  expect(openApplication(d.asDatabase, { jobId: 10, origin: "agent" })).toEqual({ record: rows.get(1), created: false });
  expect(() => openApplication(d.asDatabase, { jobId: 10, origin: "agent", newAttempt: true })).toThrow("not submitted yet");
  expect(() => openApplication(d.asDatabase, { jobId: 11, origin: "agent", newAttempt: true })).toThrow("no previous application");
  rows.set(1, record({ submission_status: "submitted" }));
  const retry = openApplication(d.asDatabase, { jobId: 10, origin: "preparation", newAttempt: true });
  expect(retry).toMatchObject({ created: true, record: { id: 2, attempt: 2, previous_application_id: 1, origin: "preparation" } });
  expect(openApplication(d.asDatabase, { jobId: 11, origin: "agent" }).record).toMatchObject({ id: 3, attempt: 1, previous_application_id: null });
});

test("an idempotency key returns its first application and cannot be reused for another job", () => {
  const first = openApplication(d.asDatabase, { jobId: null, origin: "manual", idempotencyKey: "form-1" });
  expect(first.created).toBe(true);
  expect(openApplication(d.asDatabase, { jobId: null, origin: "manual", idempotencyKey: "form-1" })).toEqual({ record: first.record, created: false });
  expect(() => openApplication(d.asDatabase, { jobId: 10, origin: "manual", idempotencyKey: "form-1" })).toThrow("already used");
  expect(openApplication(d.asDatabase, { jobId: null, origin: "manual" }).record.id).not.toBe(first.record.id);
});

test("records one transition per effective change and keeps the legacy status in sync", () => {
  rows.set(1, record({ fill_status: "filled", status: "filled" }));
  const result = transition(d.asDatabase, 1, "submit", "api", { runId: "run-1" });
  expect(result).toMatchObject({ changed: true, record: { submission_status: "submitted", status: "submitted", submitted_at: at } });
  expect(writes()).toContainEqual(["submitted", "submitted", at, 1, at, at, 1]);
  expect(writes()).toContainEqual([1, "submission", "submit", "not_submitted", "submitted", "api", "run-1", at]);
  const count = writes().length;
  expect(transition(d.asDatabase, 1, "submit", "api").changed).toBe(false);
  expect(writes()).toHaveLength(count);
});

test("a manual registration keeps its own submission date", () => {
  transition(d.asDatabase, 1, "submit", "api", { at: "2026-01-02T00:00:00.000Z" });
  expect(rows.get(1)?.submitted_at).toBe("2026-01-02T00:00:00.000Z");
  expect(writes()[0]).toEqual(["submitted", "submitted", "2026-01-02T00:00:00.000Z", 1, "2026-01-02T00:00:00.000Z", at, 1]);
});

test("validates without writing and keeps tracking changes on the board", () => {
  expect(assertTransition(d.asDatabase, 1, "fill.start")).toMatchObject({ id: 1 });
  expect(() => assertTransition(d.asDatabase, 1, "prepare.fail")).toThrow("No resume preparation is running.");
  expect(() => transition(d.asDatabase, 1, "archive", "api")).toThrow("belong to the application board");
  expect(writes()).toEqual([]);
});

test("legacy statuses apply journey actions and never undo a submission", () => {
  expect(applyStatus(d.asDatabase, 1, "draft", "cli")).toBe(false);
  expect(applyStatus(d.asDatabase, 1, "filled", "cli")).toBe(true);
  expect(rows.get(1)).toMatchObject({ fill_status: "filled", status: "filled" });
  expect(applyStatus(d.asDatabase, 1, "applied", "cli")).toBe(true);
  expect(() => applyStatus(d.asDatabase, 1, "draft", "cli")).toThrow("cannot return to draft");
  expect(applyStatus(d.asDatabase, 1, "filled", "cli")).toBe(false);
  expect(() => applyStatus(d.asDatabase, 1, "needs_input", "cli")).toThrow("already submitted");
});

test.each([
  [{ preparation_status: "in_progress", preparation_run_id: "old" }, "failed", "preparation_status", "ready"],
  [{ preparation_status: "in_progress" }, "failed", "preparation_status", "failed"],
  [{ preparation_status: "in_progress" }, "cancelled", "preparation_status", "not_started"],
  [{ preparation_status: "ready" }, "failed", "preparation_status", "ready"],
] as const)("settles preparation %j after %s", (fields, outcome, column, expected) => {
  rows.set(1, record(fields));
  settleExecution(d.asDatabase, 1, "preparation", outcome, "run-2");
  expect(rows.get(1)?.[column]).toBe(expected);
});

test.each([
  ["in_progress", 0, "failed", "failed"],
  ["in_progress", 0, "cancelled", "not_started"],
  ["in_progress", 1, "cancelled", "filled"],
  ["filled", 0, "failed", "filled"],
] as const)("settles fill %s (earlier result %i) after %s as %s", (fill_status, has_fill_result, outcome, expected) => {
  rows.set(1, record({ fill_status, has_fill_result }));
  settleExecution(d.asDatabase, 1, "fill", outcome);
  expect(rows.get(1)?.fill_status).toBe(expected);
});

test("lists recorded transitions in order", () => {
  d.statement.all.mockReturnValue([{ id: 1, action: "submit" }]);
  expect(journeyTransitions(d.asDatabase, 1)).toEqual([{ id: 1, action: "submit" }]);
  expect(d.statement.all).toHaveBeenCalledWith(1);
});

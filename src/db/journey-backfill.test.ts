import { beforeEach, expect, test } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { backfillJourney, verifyJourney } from "./journey-backfill.ts";

let d: ReturnType<typeof databaseDouble>;
const legacy = (fields: Record<string, unknown>) => ({
  id: 1,
  job_id: 10,
  job_exists: 1,
  status: "draft",
  current_stage_id: null,
  preparation_run_id: null,
  resume_path: null,
  fields_filled_json: null,
  applied_at: null,
  ...fields,
});
/** [origin, preparation, fill, submission, submitted_at, status, review, attempt, id] per row. */
const updates = () => d.statement.run.mock.calls as unknown as unknown[][];

const columns = ["preparation_run_id", "resume_path", "fields_filled_json", "applied_at"].map((name) => ({ name }));
/** The first `all` answers PRAGMA table_info; the second returns the legacy rows. */
const legacyRows = (rows: unknown[], present = columns) => d.statement.all.mockReturnValueOnce(present).mockReturnValueOnce(rows);
beforeEach(() => {
  d = databaseDouble();
  d.statement.get.mockReturnValue({ n: 0 });
});

test("classifies deterministic legacy rows from status, stage, run and resume", () => {
  legacyRows([
    legacy({ id: 1, preparation_run_id: "run", resume_path: "/r.pdf" }),
    legacy({ id: 2, job_id: 11, status: "filled", resume_path: "/r.pdf" }),
    legacy({ id: 3, job_id: null, job_exists: 0, status: "applied", current_stage_id: 1, applied_at: "2026-01-01" }),
    legacy({ id: 4, job_id: 12, status: "submitted", current_stage_id: 2, fields_filled_json: "{}", applied_at: "2026-01-02" }),
    legacy({ id: 5, job_id: 13, status: "needs_input" }),
  ]);
  backfillJourney(d.asDatabase);
  expect(updates()).toEqual([
    ["preparation", "ready", "not_started", "not_submitted", null, "draft", null, 1, 1],
    ["unknown", "ready", "filled", "not_submitted", null, "filled", null, 1, 2],
    ["manual", "not_started", "not_started", "submitted", "2026-01-01", "submitted", null, 1, 3],
    ["unknown", "not_started", "filled", "submitted", "2026-01-02", "submitted", null, 1, 4],
    ["unknown", "not_started", "needs_input", "not_submitted", null, "needs_input", null, 1, 5],
  ]);
});

test("flags ambiguous rows for reconciliation without re-linking them", () => {
  legacyRows([
    legacy({ id: 1, job_exists: 0 }),
    legacy({ id: 2, job_id: 11, status: "applied" }),
    legacy({ id: 3, job_id: 12, status: "submitted", applied_at: "2026-01-03" }),
    legacy({ id: 4, job_id: null, job_exists: 0, status: null }),
    legacy({ id: 5, job_id: 14, status: "submitted", current_stage_id: 1 }),
    legacy({ id: 6, job_id: 14, status: "draft" }),
  ]);
  backfillJourney(d.asDatabase);
  expect(updates().map((args) => [args[8], args[6], args[7], args[5], args[3]])).toEqual([
    [1, "missing_job", 1, "draft", "not_submitted"],
    // An unknown status keeps its text and is not treated as a submission.
    [2, "unknown_status", 1, "applied", "not_submitted"],
    [3, "missing_stage", 1, "submitted", "submitted"],
    [4, "missing_job", 1, "draft", "not_submitted"],
    [5, null, 1, "submitted", "submitted"],
    // A second application for the same job is never merged or dropped.
    [6, "duplicate_job", 2, "draft", "not_submitted"],
  ]);
  expect(updates().map((args) => args.at(-1))).toEqual([1, 2, 3, 4, 5, 6]);
});

test("continues attempt numbers after already classified applications", () => {
  legacyRows([legacy({ id: 7, job_id: 20 })]);
  d.statement.get.mockReturnValueOnce({ n: 2 });
  backfillJourney(d.asDatabase);
  expect(updates()[0]).toEqual(["unknown", "not_started", "not_started", "not_submitted", null, "draft", "duplicate_job", 3, 7]);
  expect(d.query.mock.calls[1]![0]).toContain("WHERE a.attempt IS NULL");
});
test("reads missing original columns of very old workspaces as NULL", () => {
  legacyRows([legacy({ id: 8, resume_path: null })], [{ name: "applied_at" }]);
  backfillJourney(d.asDatabase);
  const select = d.query.mock.calls[1]![0];
  expect(select).toContain("NULL AS resume_path");
  expect(select).toContain("NULL AS preparation_run_id");
  expect(select).toContain("a.applied_at");
});

test("verification fails while any application is unclassified", () => {
  d.statement.get.mockReturnValueOnce({ n: 0 });
  expect(() => verifyJourney(d.asDatabase)).not.toThrow();
  d.statement.get.mockReturnValueOnce({ n: 2 });
  expect(() => verifyJourney(d.asDatabase)).toThrow("2 application(s) were left without a journey classification.");
});

import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { db } from "../db/index.ts";
import { applicationContext } from "./context.ts";
import { InterviewPrepError, listInterviewPreps, saveInterviewPrep } from "./store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "fixture-time" }));

let d: ReturnType<typeof databaseDouble>;
beforeEach(() => { d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase); });

test("trims a valid pack, stores empty details as null and returns the new id", () => {
  d.statement.get.mockReturnValueOnce({ 1: 1 }).mockReturnValueOnce({ id: 4 });
  expect(saveInterviewPrep({ applicationId: 7, stage: " Final ", body: " pack ", format: "  " })).toBe(4);
  expect(d.statement.get).toHaveBeenLastCalledWith({ $application: 7, $stage: "Final", $scheduled: null, $format: null, $interviewers: null, $body: "pack", $at: "fixture-time" });
});

test.each([
  [{ applicationId: 0, stage: "x", body: "x" }, "positive integer"],
  [{ applicationId: 1.5, stage: "x", body: "x" }, "positive integer"],
  [{ applicationId: 7, stage: " ", body: "x" }, "stage is required"],
  [{ applicationId: 7, stage: "x", body: " " }, "empty"],
])("rejects %j before touching the database", (input, message) => {
  expect(() => saveInterviewPrep(input)).toThrow(message);
  expect(d.query).not.toHaveBeenCalled();
});

test("rejects an unknown application and lists packs with or without a filter", () => {
  d.statement.get.mockReturnValueOnce(undefined);
  expect(() => saveInterviewPrep({ applicationId: 9, stage: "x", body: "x" })).toThrow(InterviewPrepError);
  listInterviewPreps(); listInterviewPreps(7);
  expect(d.statement.all).toHaveBeenLastCalledWith(7);
});

test("application context parses requirements, tolerates bad JSON and reports unknown ids", () => {
  d.statement.get.mockReturnValueOnce({ id: 7, requirements_json: '["Node"]' }).mockReturnValueOnce({ id: 7, requirements_json: "oops" }).mockReturnValueOnce({ id: 7, requirements_json: null }).mockReturnValueOnce(undefined);
  expect(applicationContext(7)?.requirements).toEqual(["Node"]);
  expect(applicationContext(7)?.requirements).toBe("oops");
  expect(applicationContext(7)?.requirements).toBeNull();
  expect(applicationContext(8)).toBeNull();
});

test("application context carries the posting check verdict, never its excerpts", () => {
  const guard = JSON.stringify({ verdict: "Posting check ⚠: 1 instruction-shaped line", flagged: true, excerpts: { hidden_blocks: ["secret"] } });
  d.statement.get.mockReturnValueOnce({ id: 7, requirements_json: null, description_guard_json: guard }).mockReturnValueOnce({ id: 7, requirements_json: null, description_guard_json: null });
  const context = applicationContext(7)!;
  expect(context.guard).toEqual({ verdict: "Posting check ⚠: 1 instruction-shaped line", flagged: true });
  expect(JSON.stringify(context)).not.toContain("secret");
  expect(applicationContext(7)?.guard).toEqual({ verdict: "Not checked", flagged: false });
});

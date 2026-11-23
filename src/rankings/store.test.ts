import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import { overallScore, verdictBand } from "./bands.ts";
import { getRanking, saveRanking, shortError } from "./store.ts";
import { RankingError, type RankingInput } from "./types.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-20T12:00:00.000Z" }));

let d: Database;
let job: number;
beforeEach(async () => {
  d = await memoryDatabase();
  job = insertJob(d);
});
const scored = (fields: Partial<RankingInput> = {}): RankingInput => ({
  jobId: job, status: "scored", technical: 80, experience: 70, career: 75,
  strengths: ["React and TypeScript match the core stack"], gaps: ["No Kubernetes experience"], ...fields,
});
const hours = (n: number) => new Date(Date.parse("2026-11-20T12:00:00.000Z") + n * 3_600_000).toISOString();

test("stores a scored posting with the overall score and verdict computed in code", () => {
  const ranking = saveRanking(scored(), d);
  expect(ranking).toEqual({
    job_id: job, status: "scored", technical: 80, experience: 70, career: 75,
    overall: overallScore({ technical: 80, experience: 70, career: 75 }), verdict: verdictBand(75),
    strengths: ["React and TypeScript match the core stack"], gaps: ["No Kubernetes experience"],
    fetch_attempts: 0, first_unreachable_at: null, last_error: null, ranked_at: "2026-11-20T12:00:00.000Z",
  });
  expect(getRanking(job, d)).toEqual(ranking);
  expect(getRanking(job + 1, d)).toBeNull();
});

test("re-ranking replaces scores and lists instead of accumulating them", () => {
  saveRanking(scored({ strengths: ["One", "Two", "Three"], gaps: ["Gap one", "Gap two"] }), d);
  const again = saveRanking(scored({ technical: 20, experience: 20, career: 20, strengths: ["Only strength"], gaps: ["Only gap"] }), d, hours(1));
  expect(again).toMatchObject({ overall: 20, verdict: "Poor Fit", strengths: ["Only strength"], gaps: ["Only gap"], ranked_at: hours(1) });
  expect(d.query("SELECT COUNT(*) AS n FROM job_rankings").get()).toEqual({ n: 1 });
});

test.each([
  [{ technical: 101 }, "technical must be an integer score from 0 to 100"],
  [{ experience: -1 }, "experience must be an integer score from 0 to 100"],
  [{ career: 70.5 }, "career must be an integer score from 0 to 100"],
  [{ career: "70" }, "career must be an integer score from 0 to 100"],
  [{ technical: undefined }, "technical must be an integer"],
  [{ strengths: [] }, "strengths must list 1 to 3 items"],
  [{ gaps: ["a", "b", "c", "d"] }, "gaps must list 1 to 3 items"],
  [{ gaps: "No Kubernetes" }, "gaps must list 1 to 3 items"],
  [{ strengths: ["  "] }, "strengths[0] must be non-empty text"],
  [{ strengths: [3] }, "strengths[0] must be non-empty text"],
  [{ strengths: ["a".repeat(281)] }, "has 281 characters"],
  [{ gaps: ["line\nbreak"] }, "gaps[0] must be a single line"],
  [{ strengths: ["See https://example.com/apply"] }, "must be plain text, without URLs or markup"],
  [{ strengths: ["Visit www.example.com"] }, "without URLs"],
  [{ gaps: ["<b>Bold</b> claim"] }, "without URLs or markup"],
  [{ gaps: ["[link](somewhere)"] }, "without URLs or markup"],
  [{ gaps: ["**Bold** gap"] }, "without URLs or markup"],
  [{ gaps: ["# Heading"] }, "without URLs or markup"],
  [{ status: "gave_up" }, "status must be one of: scored, expired, unreachable"],
  [{ jobId: 0 }, "job id must be a positive integer"],
])("refuses an invalid scored result %j", (fields, message) => {
  expect(() => saveRanking(scored(fields as Partial<RankingInput>), d)).toThrow(message);
  expect(getRanking(job, d)).toBeNull();
});

test("accepts plain text up to 280 characters and trims it", () => {
  const ranking = saveRanking(scored({ strengths: [`  ${"a".repeat(280)}  `], gaps: ["Less than 3 years of Go (< 3 required)"] }), d);
  expect(ranking.strengths).toEqual(["a".repeat(280)]);
  expect(ranking.gaps).toEqual(["Less than 3 years of Go (< 3 required)"]);
});

test("refuses a missing job with 404", () => {
  const error = (() => { try { saveRanking(scored({ jobId: 999 }), d); } catch (e) { return e; } })() as RankingError;
  expect(error).toBeInstanceOf(RankingError);
  expect(error.status).toBe(404);
});

test("an expired posting stores no scores and resets the retry history", () => {
  saveRanking({ jobId: job, status: "unreachable", fetch_error: "timeout" }, d);
  expect(saveRanking({ jobId: job, status: "expired", fetch_error: "No longer accepting applications" }, d)).toMatchObject({
    status: "expired", technical: null, overall: null, verdict: null, strengths: [], gaps: [],
    fetch_attempts: 0, first_unreachable_at: null, last_error: "No longer accepting applications",
  });
  expect(saveRanking({ jobId: job, status: "expired", strengths: [] }, d)).toMatchObject({ status: "expired", last_error: null });
  expect(() => saveRanking({ jobId: job, status: "expired", technical: 50 }, d)).toThrow("an expired posting has no scores");
  expect(() => saveRanking({ jobId: job, status: "unreachable", fetch_error: "x", gaps: ["Gap"] }, d)).toThrow("has no gaps");
});

test("an unreachable posting needs a short error, truncated to 200 characters and kept as one plain line", () => {
  expect(() => saveRanking({ jobId: job, status: "unreachable" }, d)).toThrow("needs a short fetch_error");
  expect(() => saveRanking({ jobId: job, status: "unreachable", fetch_error: "   " }, d)).toThrow("needs a short fetch_error");
  expect(() => saveRanking({ jobId: job, status: "unreachable", fetch_error: 404 }, d)).toThrow("fetch_error must be text");
  const ranking = saveRanking({ jobId: job, status: "unreachable", fetch_error: `404\n\tNot   Found ${"x".repeat(300)}` }, d);
  expect(ranking.last_error).toHaveLength(200);
  expect(ranking.last_error!.startsWith("404 Not Found x")).toBe(true);
  expect(shortError(null)).toBeNull();
});

test("unreachable retries count attempts and give up only after 3 attempts spread over 48 hours", () => {
  const fail = (at: string) => saveRanking({ jobId: job, status: "unreachable", fetch_error: "login wall" }, d, at);
  expect(fail(hours(0))).toMatchObject({ status: "unreachable", fetch_attempts: 1, first_unreachable_at: hours(0) });
  expect(fail(hours(1))).toMatchObject({ status: "unreachable", fetch_attempts: 2, first_unreachable_at: hours(0) });
  // A third failure on the same day waits out the 48-hour floor.
  expect(fail(hours(2))).toMatchObject({ status: "unreachable", fetch_attempts: 3, first_unreachable_at: hours(0) });
  expect(fail(hours(48))).toMatchObject({ status: "gave_up", fetch_attempts: 4, first_unreachable_at: hours(0), last_error: "login wall" });
  // A later successful read drops the retry history.
  expect(saveRanking(scored(), d, hours(50))).toMatchObject({ status: "scored", fetch_attempts: 0, first_unreachable_at: null, last_error: null });
  expect(fail(hours(51))).toMatchObject({ status: "unreachable", fetch_attempts: 1, first_unreachable_at: hours(51) });
});

test("three attempts with exactly 48 hours between the first and the last give up", () => {
  for (const at of [0, 24]) saveRanking({ jobId: job, status: "unreachable", fetch_error: "timeout" }, d, hours(at));
  expect(saveRanking({ jobId: job, status: "unreachable", fetch_error: "timeout" }, d, hours(48))).toMatchObject({ status: "gave_up", fetch_attempts: 3 });
  expect(saveRanking({ jobId: job, status: "unreachable", fetch_error: "timeout" }, d, hours(60))).toMatchObject({ status: "gave_up", fetch_attempts: 4 });
});

test("deleting a job removes its ranking", () => {
  saveRanking(scored(), d);
  d.exec("PRAGMA foreign_keys = ON");
  d.query("DELETE FROM jobs WHERE id = ?").run(job);
  expect(getRanking(job, d)).toBeNull();
});

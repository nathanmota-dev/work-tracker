import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { rankingCandidates, rankingJobIds, rankingLimit } from "./candidates.ts";
import { saveRanking } from "./store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-20T12:00:00.000Z" }));

const today = "2026-11-20";
let d: Database;
beforeEach(async () => {
  d = await memoryDatabase();
});
const job = (title: string, fields: Record<string, string | null> = {}) =>
  insertJob(d, { title, link: `https://jobs.example.test/${encodeURIComponent(title)}`, scouted_at: "2026-11-01T00:00:00Z", ...fields });
const candidates = (options: Parameters<typeof rankingCandidates>[1] = {}) => rankingCandidates(d, { today, ...options });
const titles = (result: ReturnType<typeof candidates>) => result.items.map((item) => item.title);
const score = (jobId: number) => saveRanking({ jobId, status: "scored", technical: 70, experience: 70, career: 70, strengths: ["Fit"], gaps: ["Gap"] }, d);

test("ranks at most the limit and defers the rest, soonest deadline first then the newest", () => {
  job("Old", { scouted_at: "2026-10-01T00:00:00Z" });
  job("New", { scouted_at: "2026-11-10T00:00:00Z" });
  job("Due soon", { deadline: "2026-11-22" });
  job("Due later", { deadline: "2026-12-20" });
  for (let i = 0; i < 9; i++) job(`Filler ${i}`, { scouted_at: "2026-09-01T00:00:00Z" });
  const result = candidates();
  expect(result).toMatchObject({ limit: 10, all: false, eligible: 13, deferred: 3, expired: 0, already_ranked: 0 });
  expect(titles(result).slice(0, 4)).toEqual(["Due soon", "Due later", "New", "Old"]);
  expect(result.items[0]).toMatchObject({ closing_soon: true, deadline: "2026-11-22", guard_verdict: "Not checked", previous_status: null, fetch_attempts: 0 });
  expect(result.items[1]!.closing_soon).toBe(false);
  expect(candidates({ limit: 2 })).toMatchObject({ eligible: 13, deferred: 11 });
});

test("excludes archived jobs, jobs with a submitted application and passed deadlines", () => {
  job("Open");
  job("Archived", { archived_at: "2026-11-02T00:00:00Z" });
  const sent = job("Sent");
  insertApplication(d, { job_id: sent, submission_status: "submitted" });
  const draft = job("Draft application");
  insertApplication(d, { job_id: draft, submission_status: "not_submitted" });
  job("Closed", { deadline: "2026-11-19" });
  job("Due today", { deadline: today });
  const result = candidates();
  expect(titles(result).sort()).toEqual(["Draft application", "Due today", "Open"]);
  expect(result).toMatchObject({ eligible: 3, expired: 1, already_ranked: 0 });
});

test("skips scored, expired and given-up jobs, retries unreachable ones, and re-ranks everything with all", () => {
  const scored = job("Scored", { scouted_at: "2026-11-05T00:00:00Z" });
  const expired = job("Expired", { scouted_at: "2026-11-04T00:00:00Z" });
  const unreachable = job("Unreachable", { scouted_at: "2026-11-03T00:00:00Z" });
  job("Unranked", { scouted_at: "2026-11-02T00:00:00Z" });
  score(scored);
  saveRanking({ jobId: expired, status: "expired" }, d, "2026-11-20T10:00:00.000Z");
  saveRanking({ jobId: unreachable, status: "unreachable", fetch_error: "timeout" }, d, "2026-11-20T09:00:00.000Z");
  const result = candidates();
  expect(titles(result)).toEqual(["Unreachable", "Unranked"]);
  expect(result.items[0]).toMatchObject({ previous_status: "unreachable", fetch_attempts: 1 });
  expect(result.already_ranked).toBe(2);
  // `all` starts with the never ranked, then the least recently ranked, so repeated runs advance.
  const all = candidates({ all: true });
  expect(titles(all)).toEqual(["Unranked", "Unreachable", "Expired", "Scored"]);
  expect(all).toMatchObject({ all: true, eligible: 4, already_ranked: 0 });
});

test("narrows the run to the selected jobs", () => {
  const first = job("First");
  job("Second");
  const third = job("Third", { archived_at: "2026-11-02T00:00:00Z" });
  const result = candidates({ jobIds: [first, third, 999] });
  expect(titles(result)).toEqual(["First"]);
  expect(result).toMatchObject({ eligible: 1, deferred: 0 });
});

test("reports the saved description with its posting check verdict", () => {
  job("Described", { description: "Build services", description_guard_json: JSON.stringify({ verdict: "⚠ 1 instruction-shaped line" }) });
  expect(candidates().items[0]).toMatchObject({ description: "Build services", guard_verdict: "⚠ 1 instruction-shaped line" });
});

test.each([[undefined, 10], ["", 10], ["5", 5], [100, 100]])("limit %j reads as %i", (value, expected) => {
  expect(rankingLimit(value)).toBe(expected);
});
test.each([0, 101, "-1", "1.5", "ten", 2.5])("rejects the limit %j", (value) => {
  expect(() => rankingLimit(value)).toThrow("limit must be an integer from 1 to 100");
});
test("parses job ids without duplicates and rejects anything else", () => {
  expect(rankingJobIds(undefined)).toBeUndefined();
  expect(rankingJobIds("")).toBeUndefined();
  expect(rankingJobIds("3,1,3")).toEqual([3, 1]);
  for (const value of ["0", "1,", "a", "1;2", 3]) expect(() => rankingJobIds(value)).toThrow("comma-separated list");
});

test("jobs that failed the requirements check are listed apart with the quoted reason and never ranked", async () => {
  const { saveGate } = await import("../gates/store.ts");
  const { saveLanguage, setEligibility } = await import("../gates/profile-store.ts");
  saveLanguage({ language: "Spanish", level: "Native" }, d);
  setEligibility("needs_permission", d);
  const silent = { requires_citizenship_or_pr: false, requires_clearance: false, names_permit_or_sponsors: false };
  const russian = job("Russian role", { company_name: "Acme" });
  saveGate(russian, { languages: [{ language: "Russian", stated_bar: "fluent", bar_above_declared: true, quote: "Fluent Russian required." }], eligibility: silent }, d);
  const citizens = job("Citizens only");
  saveGate(citizens, { languages: [], eligibility: { ...silent, requires_citizenship_or_pr: true, quote: "Must be a citizen." } }, d);
  const flagged = job("Flagged");
  saveGate(flagged, { languages: [{ language: "Spanish", bar_above_declared: true, quote: "Fluent Spanish." }], eligibility: silent }, d);
  job("Unchecked");
  const result = candidates();
  expect(titles(result).sort()).toEqual(["Flagged", "Unchecked"]);
  expect(result).toMatchObject({ eligible: 2, already_ranked: 0 });
  expect(result.gate_failed).toEqual(expect.arrayContaining([
    { job_id: russian, title: "Russian role", company: "Acme", reason: 'Requires Russian (fluent), which is not in your languages. "Fluent Russian required."' },
    { job_id: citizens, title: "Citizens only", company: "Example Corp", reason: 'Requires citizenship or permanent residency. "Must be a citizen."' },
  ]));
  expect(candidates({ all: true, jobIds: [russian] })).toMatchObject({ items: [], eligible: 0, gate_failed: [{ job_id: russian }] });
  expect(result.items.every((item) => !("gate_json" in item))).toBe(true);
});

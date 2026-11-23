import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import { saveLanguage, setEligibility } from "./profile-store.ts";
import { gateUnverified, gateVerdict, jobGate, parseStoredGate, saveGate } from "./store.ts";
import { reevaluateGates } from "./stored.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-23T12:00:00.000Z" }));

const silent = { requires_citizenship_or_pr: false, requires_clearance: false, names_permit_or_sponsors: false, program_confirmed: "unknown" };
const russian = { languages: [{ language: "Russian", stated_bar: "fluent", bar_above_declared: true, quote: "Fluent Russian required" }], eligibility: silent };
let d: Database;
let job: number;
beforeEach(async () => {
  d = await memoryDatabase();
  job = insertJob(d);
});
const column = () => (d.query("SELECT gate_json FROM jobs WHERE id = ?").get(job) as { gate_json: string | null }).gate_json;

test("jobs saved before the gates read as unchecked, and unreadable values too", () => {
  expect(jobGate(job, d)).toBeNull();
  for (const value of [null, "", "not json", "null", '{"verdict":"maybe","extraction":{}}', '{"verdict":"pass"}', 3]) {
    expect(parseStoredGate(value)).toBeNull();
    expect(gateVerdict(value)).toBe("unchecked");
    expect(gateUnverified(value)).toBe(false);
  }
});

test("stores the evaluation with its extraction and quotes, against the current profile", () => {
  saveLanguage({ language: "Spanish", level: "Native" }, d);
  const gate = saveGate(job, russian, d);
  expect(gate).toMatchObject({
    version: 1, verdict: "fail", unverified: false, checked_at: "2026-11-23T12:00:00.000Z",
    language: { status: "fail", findings: [{ quote: "Fluent Russian required" }] }, eligibility: { status: "off" },
    extraction: { languages: [{ language: "Russian" }], eligibility: silent },
  });
  expect(JSON.parse(column()!)).toEqual(gate);
  expect(jobGate(job, d)).toEqual(gate);
  expect(gateVerdict(column())).toBe("fail");
});

test("an invalid extraction or an unknown job writes nothing", () => {
  expect(() => saveGate(job, { languages: [{ language: "Polish", bar_above_declared: true }], eligibility: silent }, d)).toThrow('needs the literal posting text in "quote"');
  expect(() => saveGate(999, russian, d)).toThrow("job #999 not found");
  expect(() => jobGate(0, d)).toThrow("positive integer");
  expect(column()).toBeNull();
});

test("a profile change re-evaluates stored checks and keeps when they were read", () => {
  const gate = saveGate(job, russian, d);
  expect(gate).toMatchObject({ verdict: "pass", unverified: true });
  saveLanguage({ language: "Spanish", level: "Native" }, d);
  expect(jobGate(job, d)).toMatchObject({ verdict: "fail", checked_at: gate.checked_at, extraction: gate.extraction });
  saveLanguage({ language: "russian", level: "C2" }, d);
  expect(jobGate(job, d)).toMatchObject({ verdict: "flag" });
  setEligibility("needs_permission", d);
  expect(jobGate(job, d)?.eligibility).toMatchObject({ status: "pass", summary: expect.stringContaining("Silence is not permission") });
  expect(reevaluateGates({ languages: [], eligibility: "needs_permission" }, d)).toBe(1);
  expect(reevaluateGates({ languages: [], eligibility: "needs_permission" }, d)).toBe(0);
  d.query("UPDATE jobs SET gate_json = 'broken' WHERE id = ?").run(job);
  expect(reevaluateGates({ languages: [], eligibility: null }, d)).toBe(0);
});

test("a changed description clears the stored check", async () => {
  const { saveJob } = await import("../jobs/store.ts");
  const { saveGuardedDescription } = await import("../postings/description.ts");
  d.query("UPDATE jobs SET description = 'Fluent Russian required' WHERE id = ?").run(job);
  saveGate(job, russian, d);
  saveJob(d, { title: "Renamed", description: "Fluent Russian required" }, job);
  expect(column()).not.toBeNull();
  saveGuardedDescription(d, job, "Fluent Russian required");
  expect(column()).not.toBeNull();
  saveGuardedDescription(d, job, "Spanish only");
  expect(column()).toBeNull();
  saveGate(job, russian, d);
  saveJob(d, { description: "English and Russian" }, job);
  expect(column()).toBeNull();
});

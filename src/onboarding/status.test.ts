import { beforeEach, expect, test, vi } from "vitest";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import type { Database } from "../db/sqlite.ts";
import { db } from "../db/index.ts";
import { agentReady, onboardingStatus, readyAgents } from "./status.ts";
import { readPreferences, recordVerification, savePreferences } from "./store.ts";
import { handleOnboarding } from "./http.ts";

const fake = vi.hoisted(() => ({ executable: vi.fn(), snapshot: vi.fn(), tools: vi.fn(), sources: vi.fn(), read: vi.fn() }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-30T12:00:00.000Z" }));
vi.mock("../integrations/http.ts", () => ({ executable: fake.executable }));
vi.mock("../integrations/config.ts", async original => ({
  ...await original<typeof import("../integrations/config.ts")>(),
  configSnapshot: fake.snapshot, commandFingerprint: (target: string) => `print-${target}`,
}));
vi.mock("../preparation/latex.ts", () => ({ dependencyStatus: fake.tools }));
vi.mock("../preparation/sources.ts", () => ({ sourcesConfig: fake.sources, snapshotSources: fake.read }));

let d: Database;
let clock = 0;
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  // Each test reads its own tool check instead of the shared recent one.
  vi.spyOn(Date, "now").mockReturnValue(++clock * 60_000);
  fake.snapshot.mockReturnValue({ revision: "r", config: {} });
  fake.executable.mockReturnValue(false);
  fake.sources.mockReturnValue({ projectDir: "", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  fake.read.mockReturnValue({});
  fake.tools.mockResolvedValue([{ command: "latexmk", available: false }, { command: "pdfinfo", available: false }]);
});
const step = async (id: string) => (await onboardingStatus(d)).steps.find(item => item.id === id)!;
function answer(key: string, value: string) {
  d.query("INSERT INTO applicant_answers (key, value, category, updated_at) VALUES (?, ?, 'contact', 'now')").run(key, value);
}
function configure() {
  fake.executable.mockReturnValue(true);
  for (const target of ["acp/claude-code"]) recordVerification(target, `print-${target}`, true, d);
  fake.sources.mockReturnValue({ projectDir: "/resume", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  fake.tools.mockResolvedValue([{ command: "latexmk", available: true }]);
  for (const [key, value] of [["first_name", "Ada"], ["last_name", "Lovelace"], ["email", "ada@example.com"]]) answer(key!, value!);
}

const empty = { hidden: false, skipped: [], completedAt: null, setupCompletedAt: null };

test("an empty workspace lists every real requirement, starts at the resume step and has no agent", async () => {
  const status = await onboardingStatus(d);
  expect(status).toMatchObject({ agentReady: false, readyAgents: [], setupCompletedAt: null, hidden: false, completedAt: null, complete: false, next: "resume" });
  expect(status.steps.map(item => [item.id, item.state, item.optional])).toEqual([
    ["resume", "pending", true], ["answers", "pending", false], ["search", "pending", false], ["apply", "pending", false],
  ]);
  expect(status.steps[0]!.items).toEqual([{ key: "sources", ready: false, reason: "not_configured" }, { key: "tools", ready: false, reason: "latexmk, pdfinfo" }]);
  expect(status.steps[1]!.items[0]).toEqual({ key: "first_name", ready: false, reason: "missing", target: "first_name" });
});

test("only an installed agent tested with its current command is ready; MCP servers do not count", () => {
  fake.executable.mockReturnValue(true);
  recordVerification("mcp/linkedin", "print-mcp/linkedin", true, d);
  recordVerification("acp/opencode", "print-old-command", true, d);
  expect(readyAgents(d)).toEqual([]);
  recordVerification("acp/opencode", "print-acp/opencode", true, d);
  expect(readyAgents(d)).toEqual(["acp/opencode"]);
  fake.executable.mockImplementation((target: string) => target !== "acp/opencode");
  expect(agentReady(d)).toBe(false);
  fake.executable.mockReturnValue(true);
  recordVerification("acp/opencode", "print-acp/opencode", false, d);
  expect(d.query("SELECT target FROM integration_verifications ORDER BY target").all()).toEqual([{ target: "mcp/linkedin" }]);
});

test("an invalid workspace config has no ready agent without failing the status", async () => {
  fake.snapshot.mockImplementation(() => { throw new Error("invalid"); });
  expect(await onboardingStatus(d)).toMatchObject({ agentReady: false, readyAgents: [] });
});

test("a partly configured workspace keeps a skipped resume step and points at the next pending one", async () => {
  answer("first_name", "Ada"); answer("email", "not-an-email");
  insertJob(d);
  insertApplication(d, { preparation_status: "in_progress" });
  savePreferences({ skipped: ["resume"] }, d);
  const status = await onboardingStatus(d);
  expect(status.steps.map(item => item.state)).toEqual(["skipped", "pending", "done", "pending"]);
  expect(status.next).toBe("answers");
  expect(status.steps[1]!.items.map(item => item.reason)).toEqual([undefined, "missing", "invalid"]);
  fake.sources.mockReturnValue({ projectDir: "/missing", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  fake.read.mockImplementation(() => { throw new Error("missing"); });
  expect((await step("resume")).items[0]).toEqual({ key: "sources", ready: false, reason: "invalid" });
});

test("a complete workspace finishes every step and a skipped step that becomes ready is done", async () => {
  configure();
  insertJob(d);
  insertApplication(d, { submission_status: "submitted" });
  const status = await onboardingStatus(d);
  expect(status.steps.every(item => item.state === "done")).toBe(true);
  expect(status).toMatchObject({ complete: true, next: null, agentReady: true, readyAgents: ["acp/claude-code"] });
  savePreferences({ skipped: ["resume"] }, d);
  expect((await step("resume")).state).toBe("done");
});

test("only applications past draft complete the last step", async () => {
  configure();
  insertApplication(d);
  expect((await step("apply")).state).toBe("pending");
});

test.each([null, [], { hidden: "yes" }, { completed: false }, { setupCompleted: false }, { skipped: "resume" }, { skipped: ["answers"] }, { skipped: ["connect"] }])("rejects malformed preferences %j", input => {
  expect(() => savePreferences(input, d)).toThrow();
  expect(readPreferences(d)).toEqual(empty);
});

test("preferences merge partial updates and record the first completion only once", () => {
  expect(savePreferences({ hidden: true, skipped: ["resume", "resume"] }, d)).toEqual({ ...empty, hidden: true, skipped: ["resume"] });
  expect(savePreferences({ completed: true }, d)).toMatchObject({ hidden: true, completedAt: "2026-10-30T12:00:00.000Z" });
  d.query("UPDATE onboarding_state SET completed_at = 'first'").run();
  expect(savePreferences({ hidden: false, completed: true }, d)).toEqual({ ...empty, skipped: ["resume"], completedAt: "first" });
  // A list saved before the agent step left the checklist keeps only steps that still exist.
  d.query(`UPDATE onboarding_state SET skipped_json = '["connect","resume"]'`).run();
  expect(readPreferences(d).skipped).toEqual(["resume"]);
  d.query("UPDATE onboarding_state SET skipped_json = '{'").run();
  expect(readPreferences(d).skipped).toEqual([]);
});

test("the setup finishes only with a tested agent, once", () => {
  expect(() => savePreferences({ setupCompleted: true }, d, () => false)).toThrow("Test Claude Code or opencode before finishing setup.");
  expect(readPreferences(d).setupCompletedAt).toBeNull();
  expect(savePreferences({ setupCompleted: true }, d, () => true).setupCompletedAt).toBe("2026-10-30T12:00:00.000Z");
  d.query("UPDATE onboarding_state SET setup_completed_at = 'first'").run();
  // Once finished, a later save neither needs an agent nor moves the date.
  expect(savePreferences({ setupCompleted: true, hidden: true }, d, () => false)).toMatchObject({ hidden: true, setupCompletedAt: "first" });
});

test("HTTP reads the status, saves preferences and announces the change", async () => {
  const broadcast = vi.fn();
  const call = (path: string, body?: unknown) => handleOnboarding(path, new Request(`http://fixture${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), broadcast);
  expect(await (await call("/api/onboarding/status")).json()).toMatchObject({ next: "resume", hidden: false, agentReady: false, setupCompletedAt: null });
  const saved = await call("/api/onboarding/preferences", { hidden: true, skipped: ["resume"] });
  expect(await saved.json()).toMatchObject({ hidden: true, next: "answers" });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "onboarding_state" });
  const rejected = await call("/api/onboarding/preferences", { skipped: ["apply"] });
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({ error: "Only the base resume step can be skipped." });
  const early = await call("/api/onboarding/preferences", { setupCompleted: true });
  expect(early.status).toBe(400);
  expect(await early.json()).toEqual({ error: "Test Claude Code or opencode before finishing setup." });
  fake.executable.mockReturnValue(true);
  recordVerification("acp/claude-code", "print-acp/claude-code", true, d);
  expect(await (await call("/api/onboarding/preferences", { setupCompleted: true })).json()).toMatchObject({ agentReady: true, setupCompletedAt: "2026-10-30T12:00:00.000Z" });
  expect((await call("/api/onboarding/unknown", {})).status).toBe(404);
  vi.spyOn(d, "query").mockImplementation(() => { throw new Error("disk-secret"); });
  const failed = await call("/api/onboarding/preferences", { hidden: false });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("disk-secret");
  expect(broadcast).toHaveBeenCalledTimes(2);
});

import { beforeEach, expect, test, vi } from "vitest";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import type { Database } from "../db/sqlite.ts";
import { db } from "../db/index.ts";
import { onboardingStatus } from "./status.ts";
import { readPreferences, recordVerification, savePreferences } from "./store.ts";
import { handleOnboarding } from "./http.ts";

const fake = vi.hoisted(() => ({ executable: vi.fn(), snapshot: vi.fn(), tools: vi.fn(), sources: vi.fn(), read: vi.fn(), install: vi.fn(() => [] as { name: string; state: string }[]) }));
vi.mock("../mcp/install/index.ts", () => ({ installStates: fake.install }));
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
  for (const target of ["acp/claude-code", "mcp/linkedin", "mcp/chrome"]) recordVerification(target, `print-${target}`, true, d);
  fake.sources.mockReturnValue({ projectDir: "/resume", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  fake.tools.mockResolvedValue([{ command: "latexmk", available: true }]);
  for (const [key, value] of [["first_name", "Ada"], ["last_name", "Lovelace"], ["email", "ada@example.com"]]) answer(key!, value!);
}

test("an empty workspace lists every real requirement and starts at the agent step", async () => {
  const status = await onboardingStatus(d);
  expect(status).toMatchObject({ hidden: false, completedAt: null, complete: false, next: "connect" });
  expect(status.steps.map(item => [item.id, item.state, item.optional])).toEqual([
    ["connect", "pending", true], ["resume", "pending", true], ["answers", "pending", false], ["search", "pending", false], ["apply", "pending", false],
  ]);
  expect(status.steps[0]!.items).toEqual([
    { key: "agent", ready: false, reason: "missing_executable", target: "acp/opencode" },
    { key: "mcp/linkedin", ready: false, reason: "missing_executable", target: "mcp/linkedin" },
    { key: "mcp/chrome", ready: false, reason: "missing_executable", target: "mcp/chrome" },
  ]);
  expect(status.steps[1]!.items).toEqual([{ key: "sources", ready: false, reason: "not_configured" }, { key: "tools", ready: false, reason: "latexmk, pdfinfo" }]);
  expect(status.steps[2]!.items[0]).toEqual({ key: "first_name", ready: false, reason: "missing", target: "first_name" });
});
test("a missing MCP that the app is installing is not reported as missing", async () => {
  fake.install.mockReturnValue([{ name: "linkedin", state: "installing" }, { name: "chrome", state: "failed" }]);
  const [, linkedin, chrome] = (await onboardingStatus(d)).steps[0]!.items;
  expect([linkedin!.reason, chrome!.reason]).toEqual(["installing", "missing_executable"]);
});

test("a partly configured workspace keeps skipped agent steps and points at the next pending one", async () => {
  fake.executable.mockReturnValue(true);
  fake.snapshot.mockReturnValue({ revision: "r", config: { provider: "claude-code" } });
  answer("first_name", "Ada"); answer("email", "not-an-email");
  insertJob(d);
  insertApplication(d, { preparation_status: "in_progress" });
  savePreferences({ skipped: ["connect"] }, d);
  const status = await onboardingStatus(d);
  expect(status.steps.map(item => item.state)).toEqual(["skipped", "pending", "pending", "done", "pending"]);
  expect(status.next).toBe("resume");
  // The workspace default agent is the first one to test.
  expect(status.steps[0]!.items[0]).toEqual({ key: "agent", ready: false, reason: "untested", target: "acp/claude-code" });
  expect(status.steps[2]!.items.map(item => item.reason)).toEqual([undefined, "missing", "invalid"]);
  fake.sources.mockReturnValue({ projectDir: "/missing", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  fake.read.mockImplementation(() => { throw new Error("missing"); });
  expect((await step("resume")).items[0]).toEqual({ key: "sources", ready: false, reason: "invalid" });
});

test("a complete workspace finishes every step, whichever agent passed", async () => {
  configure();
  insertJob(d);
  insertApplication(d, { submission_status: "submitted" });
  const status = await onboardingStatus(d);
  expect(status.steps.every(item => item.state === "done")).toBe(true);
  expect(status).toMatchObject({ complete: true, next: null });
  expect(status.steps[0]!.items[0]).toEqual({ key: "agent", ready: true, target: "acp/claude-code" });
  // A skipped step that becomes ready is shown as done.
  savePreferences({ skipped: ["connect", "resume"] }, d);
  expect((await onboardingStatus(d)).steps.slice(0, 2).map(item => item.state)).toEqual(["done", "done"]);
});

test("only applications past draft complete the last step and a changed command needs a new test", async () => {
  configure();
  insertApplication(d);
  expect((await step("apply")).state).toBe("pending");
  recordVerification("mcp/chrome", "print-old-command", true, d);
  expect((await step("connect")).items[2]).toEqual({ key: "mcp/chrome", ready: false, reason: "untested", target: "mcp/chrome" });
  recordVerification("mcp/chrome", "print-mcp/chrome", false, d);
  expect(d.query("SELECT target FROM integration_verifications ORDER BY target").all()).toEqual([{ target: "acp/claude-code" }, { target: "mcp/linkedin" }]);
});

test("an invalid workspace config blocks the agent step without failing the status", async () => {
  fake.snapshot.mockImplementation(() => { throw new Error("invalid"); });
  expect((await step("connect")).items).toEqual([{ key: "config", ready: false, reason: "invalid_config" }]);
});

test.each([null, [], { hidden: "yes" }, { completed: false }, { skipped: "connect" }, { skipped: ["answers"] }])("rejects malformed preferences %j", input => {
  expect(() => savePreferences(input, d)).toThrow();
  expect(readPreferences(d)).toEqual({ hidden: false, skipped: [], completedAt: null });
});

test("preferences merge partial updates and record the first completion only once", () => {
  expect(savePreferences({ hidden: true, skipped: ["resume", "connect", "resume"] }, d)).toEqual({ hidden: true, skipped: ["connect", "resume"], completedAt: null });
  expect(savePreferences({ completed: true }, d)).toMatchObject({ hidden: true, completedAt: "2026-10-30T12:00:00.000Z" });
  d.query("UPDATE onboarding_state SET completed_at = 'first'").run();
  expect(savePreferences({ hidden: false, completed: true }, d)).toEqual({ hidden: false, skipped: ["connect", "resume"], completedAt: "first" });
  d.query("UPDATE onboarding_state SET skipped_json = '{'").run();
  expect(readPreferences(d).skipped).toEqual([]);
});

test("HTTP reads the status, saves preferences and announces the change", async () => {
  const broadcast = vi.fn();
  const call = (path: string, body?: unknown) => handleOnboarding(path, new Request(`http://fixture${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), broadcast);
  expect(await (await call("/api/onboarding/status")).json()).toMatchObject({ next: "connect", hidden: false });
  const saved = await call("/api/onboarding/preferences", { hidden: true, skipped: ["connect"] });
  expect(await saved.json()).toMatchObject({ hidden: true, next: "resume" });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "onboarding_state" });
  const rejected = await call("/api/onboarding/preferences", { skipped: ["apply"] });
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({ error: "Only the agent and base resume steps can be skipped." });
  expect((await call("/api/onboarding/unknown", {})).status).toBe(404);
  vi.spyOn(d, "query").mockImplementation(() => { throw new Error("disk-secret"); });
  const failed = await call("/api/onboarding/preferences", { hidden: false });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("disk-secret");
  expect(broadcast).toHaveBeenCalledOnce();
});

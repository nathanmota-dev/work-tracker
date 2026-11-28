import { afterAll, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeProfile } from "./base-profile.ts";
import { join, resolve } from "node:path";

// LaTeX tools are machine-specific; their detection has its own tests.
vi.mock("../../preparation/latex.ts", async original => ({
  ...await original<typeof import("../../preparation/latex.ts")>(),
  dependencyStatus: async () => [{ command: "latexmk", available: true }],
}));

// Synthetic workspaces only: one is set up from scratch, backed up and restored into another.
const root = mkdtempSync(join(tmpdir(), "work tracker onboarding "));
const previousEnv = { ...process.env };
process.env.WORK_TRACKER_RESOURCES = resolve("resources");
const fixture = resolve("src/test/fixtures/protocol-server.cjs");
type Modules = {
  database: typeof import("../../db/index.ts");
  http: typeof import("../../onboarding/http.ts");
  integrations: typeof import("../../integrations/http.ts");
  answers: typeof import("../../answers/store.ts");
  create: typeof import("../../backup/create.ts");
  restore: typeof import("../../backup/restore.ts");
  process: typeof import("../../acp/process.ts");
};
let current: Modules | undefined;
async function workspace(name: string): Promise<Modules & { home: string }> {
  current?.database.closeDb();
  await current?.process.stopAllOwned();
  const home = join(root, name);
  process.env.WORK_TRACKER_HOME = home;
  process.env.WORK_TRACKER_REPO_ROOT = join(root, "no-repository");
  vi.resetModules();
  current = {
    database: await import("../../db/index.ts"),
    http: await import("../../onboarding/http.ts"),
    integrations: await import("../../integrations/http.ts"),
    answers: await import("../../answers/store.ts"),
    create: await import("../../backup/create.ts"),
    restore: await import("../../backup/restore.ts"),
    process: await import("../../acp/process.ts"),
  };
  current.database.db();
  return { ...current, home };
}
afterAll(async () => {
  current?.database.closeDb();
  await current?.process.stopAllOwned();
  rmSync(root, { recursive: true, force: true });
  process.env = previousEnv;
});

const broadcast = vi.fn();
async function status(m: Modules) {
  const response = await m.http.handleOnboarding("/api/onboarding/status", new Request("http://fixture/api/onboarding/status"), broadcast);
  return await response.json() as import("../../onboarding/types.ts").OnboardingStatus;
}
const states = async (m: Modules) => (await status(m)).steps.map(step => step.state);
async function save(m: Modules, body: unknown) {
  return m.http.handleOnboarding("/api/onboarding/preferences", new Request("http://fixture/api/onboarding/preferences", { method: "POST", body: JSON.stringify(body) }), broadcast);
}
async function testIntegration(m: Modules, target: string) {
  const request = new Request("http://fixture/api/integrations/test", { method: "POST", body: JSON.stringify({ target }) });
  return await (await m.integrations.handleIntegrations("/api/integrations/test", request, false, broadcast)).json() as { checks: { state: string }[] };
}

test("Setup and Get started follow a new workspace to its first application and survive backup and restore", async () => {
  const source = await workspace("source");
  expect(await status(source)).toMatchObject({ complete: false, next: "resume", hidden: false, completedAt: null, agentReady: false, setupCompletedAt: null });
  expect(await states(source)).toEqual(["pending", "pending", "pending", "pending"]);
  // The full-screen setup cannot finish before an agent passes its test.
  expect((await save(source, { setupCompleted: true })).status).toBe(400);

  // An agent alone completes the setup: the MCP servers are not part of it.
  const command = { command: process.execPath, args: [fixture], env: { FIXTURE_MODE: "normal", FIXTURE_DIAGNOSTIC: "1" } };
  const config = (agent: typeof command) => JSON.stringify({ username: "fixture", acp: { opencode: agent }, mcp: { linkedin: command, chrome: command } });
  writeFileSync(join(source.home, "config.json"), config(command));
  await testIntegration(source, "acp/opencode");
  expect(await status(source)).toMatchObject({ agentReady: true, readyAgents: ["acp/opencode"] });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "integrations" });
  expect(await (await save(source, { setupCompleted: true })).json()).toMatchObject({ setupCompletedAt: expect.any(String) });

  // Without a profile: skip the resume step, then fill answers and add records by hand.
  expect((await save(source, { skipped: ["resume"] })).status).toBe(200);
  for (const [key, value] of [["first_name", "Ada"], ["last_name", "Lovelace"], ["email", "ada@example.com"]]) source.answers.saveAnswer({ key, value });
  source.database.db().exec("INSERT INTO jobs (id, title, company_name) VALUES (1, 'Engineer', 'Example Corp')");
  expect(await status(source)).toMatchObject({ next: "apply", complete: false });
  expect(await states(source)).toEqual(["skipped", "done", "done", "pending"]);
  source.database.db().exec("INSERT INTO applications (id, job_id, attempt, preparation_status) VALUES (1, 1, 1, 'in_progress')");
  expect((await status(source)).next).toBe("apply");
  source.database.db().exec("UPDATE applications SET submission_status = 'submitted' WHERE id = 1");
  expect(await status(source)).toMatchObject({ complete: true, next: null });

  // Uploading a profile builds the base resume and completes the skipped step.
  await save(source, { skipped: [] });
  writeProfile(source.home, { name: "Ada Lovelace" });
  expect(await states(source)).toEqual(["done", "done", "done", "done"]);

  // A failing diagnostic of a changed command leaves no ready agent, but the finished setup stays finished.
  const failing = { ...command, env: { FIXTURE_MODE: "auth", FIXTURE_DIAGNOSTIC: "1" } };
  writeFileSync(join(source.home, "config.json"), config(failing));
  expect((await status(source)).agentReady).toBe(false);
  await testIntegration(source, "acp/opencode");
  expect(await status(source)).toMatchObject({ agentReady: false, setupCompletedAt: expect.any(String) });
  writeFileSync(join(source.home, "config.json"), config(command));
  await testIntegration(source, "acp/opencode");
  await save(source, { skipped: ["resume"], hidden: true, completed: true });

  const destination = join(root, "destination");
  mkdirSync(destination);
  const backup = source.create.createBackup(destination);
  const restored = await workspace("restored");
  expect(await status(restored)).toMatchObject({ hidden: false, next: "resume", setupCompletedAt: null });
  restored.restore.restoreBackup(backup.path, backup.fingerprint);
  const after = await status(restored);
  expect(after).toMatchObject({ hidden: true, completedAt: expect.any(String), setupCompletedAt: expect.any(String), complete: true, next: null });
  expect(after.steps.map(step => step.state)).toEqual(["skipped", "done", "done", "done"]);
  // Passing diagnostics are restored with the config whose commands they verified.
  expect(after).toMatchObject({ agentReady: true, readyAgents: ["acp/opencode"] });
});

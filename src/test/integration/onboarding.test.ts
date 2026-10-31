import { afterAll, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("Get started follows a new workspace to its first application and survives backup and restore", async () => {
  const source = await workspace("source");
  expect(await status(source)).toMatchObject({ complete: false, next: "connect", hidden: false, completedAt: null });
  expect(await states(source)).toEqual(["pending", "pending", "pending", "pending", "pending"]);

  // Manual tracking: skip the agent steps, then fill answers and add records by hand.
  expect((await save(source, { skipped: ["connect", "resume"] })).status).toBe(200);
  for (const [key, value] of [["first_name", "Ada"], ["last_name", "Lovelace"], ["email", "ada@example.com"]]) source.answers.saveAnswer({ key, value });
  source.database.db().exec("INSERT INTO jobs (id, title, company_name) VALUES (1, 'Engineer', 'Example Corp')");
  expect(await status(source)).toMatchObject({ next: "apply", complete: false });
  expect(await states(source)).toEqual(["skipped", "skipped", "done", "done", "pending"]);
  source.database.db().exec("INSERT INTO applications (id, job_id, attempt, preparation_status) VALUES (1, 1, 1, 'in_progress')");
  expect((await status(source)).next).toBe("apply");
  source.database.db().exec("UPDATE applications SET submission_status = 'submitted' WHERE id = 1");
  expect(await status(source)).toMatchObject({ complete: true, next: null });

  // Resuming the agent steps: a passing diagnostic and real resume sources complete them.
  await save(source, { skipped: [] });
  const project = join(root, "resume");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "resume.tex"), "\\documentclass{article}\\begin{document}Ada\\end{document}\n");
  const command = { command: process.execPath, args: [fixture], env: { FIXTURE_MODE: "normal", FIXTURE_DIAGNOSTIC: "1" } };
  writeFileSync(join(source.home, "config.json"), JSON.stringify({ username: "fixture", acp: { opencode: command }, mcp: { linkedin: command, chrome: command },
    resumeSources: { projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" } }));
  expect(await states(source)).toEqual(["pending", "done", "done", "done", "done"]);
  for (const target of ["acp/opencode", "mcp/linkedin"]) await testIntegration(source, target);
  expect((await status(source)).steps[0]!.items.map(item => item.ready)).toEqual([true, true, false]);
  await testIntegration(source, "mcp/chrome");
  expect(await status(source)).toMatchObject({ complete: true });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "integrations" });

  // A failing diagnostic of the same command makes the step pending again.
  writeFileSync(join(source.home, "config.json"), JSON.stringify({ username: "fixture", acp: { opencode: command }, mcp: { linkedin: { ...command, env: { FIXTURE_MODE: "auth", FIXTURE_DIAGNOSTIC: "1" } }, chrome: command },
    resumeSources: { projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" } }));
  expect((await status(source)).steps[0]!.items[1]).toMatchObject({ ready: false, reason: "untested" });
  expect((await testIntegration(source, "mcp/linkedin")).checks.at(-1)?.state).toBe("authentication_required");
  expect((await status(source)).steps[0]!.state).toBe("pending");
  await save(source, { skipped: ["connect"], hidden: true, completed: true });

  const destination = join(root, "destination");
  mkdirSync(destination);
  const backup = source.create.createBackup(destination);
  const restored = await workspace("restored");
  expect(await status(restored)).toMatchObject({ hidden: false, next: "connect" });
  restored.restore.restoreBackup(backup.path, backup.fingerprint);
  const after = await status(restored);
  expect(after).toMatchObject({ hidden: true, completedAt: expect.any(String), complete: true, next: null });
  expect(after.steps.map(step => step.state)).toEqual(["skipped", "done", "done", "done", "done"]);
  // Passing diagnostics are restored with the config whose commands they verified.
  expect(after.steps[0]!.items.map(item => item.ready)).toEqual([true, false, true]);
});

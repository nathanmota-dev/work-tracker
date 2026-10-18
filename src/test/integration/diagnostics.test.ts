import { afterAll, afterEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const previousEnv = { ...process.env };
const home = mkdtempSync(join(tmpdir(), "work tracker diagnostics "));
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_RESOURCES = resolve("resources");
const { paths, saveConfig } = await import("../../paths.ts");
const { integrationSettings, saveIntegration } = await import("../../integrations/config.ts");
const { probeIntegration } = await import("../../integrations/probe.ts");
const { stopAllOwned } = await import("../../acp/process.ts");
const fixture = resolve("src/test/fixtures/protocol-server.cjs");
afterEach(async () => { await stopAllOwned(); });
afterAll(() => { rmSync(home, { recursive: true, force: true }); process.env = previousEnv; });
function configure(mode: string) {
  const command = { command: process.execPath, args: [fixture], env: { FIXTURE_MODE: mode, FIXTURE_DIAGNOSTIC: "1", FIXTURE_MODELS: '[{"modelId":"fixture/valid"}]' } };
  saveConfig({ username: "fixture", acp: { opencode: command }, mcp: { chrome: command, linkedin: command } });
}
test.each([ ["normal", "ready"], ["exit", "failed"], ["hang", "timeout"], ["auth", "authentication_required"] ])("ACP fake process %s reports %s", async (mode, state) => {
  configure(mode);
  const checks = await probeIntegration("acp/opencode", "fixture/valid", 300);
  expect(checks[0]?.state).toBe(state);
  expect(JSON.stringify(checks)).not.toContain("synthetic-secret");
});
test.each([ ["normal", "ready"], ["exit", "failed"], ["hang", "timeout"], ["auth", "authentication_required"] ])("MCP fake process %s reports %s", async (mode, state) => {
  configure(mode);
  const checks = await probeIntegration("mcp/linkedin", "", 300);
  expect(checks.at(-1)?.state).toBe(state);
  expect(JSON.stringify(checks)).not.toContain("synthetic-secret");
});
test("Chrome availability and LinkedIn pending login remain independent", async () => {
  configure("pending-login");
  expect((await probeIntegration("mcp/chrome", "", 500)).at(-1)?.state).toBe("ready");
  expect((await probeIntegration("mcp/linkedin", "", 500)).at(-1)?.state).toBe("authentication_required");
  expect((await probeIntegration("acp/opencode", "missing", 500)).find(check => check.stage === "model")?.state).toBe("invalid_model");
});
test("validated settings retain secrets, unrelated values and the entire prior file after failure", () => {
  configure("normal");
  const settings = integrationSettings();
  const entry = settings.entries.find(entry => entry.target === "mcp/chrome")!;
  saveIntegration({ ...entry, revision: settings.revision, command: process.execPath });
  const saved = readFileSync(paths.config, "utf8");
  expect(JSON.parse(saved)).toMatchObject({ username: "fixture", mcp: { chrome: { args: [fixture], env: { FIXTURE_MODE: "normal" } } } });
  expect(() => saveIntegration({ ...entry, revision: integrationSettings().revision, args: [1] })).toThrow();
  expect(readFileSync(paths.config, "utf8")).toBe(saved);
});

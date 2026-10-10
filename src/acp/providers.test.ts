import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const home = mkdtempSync(join(tmpdir(), "work tracker providers "));
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_RESOURCES = resolve("resources");
const fixture = resolve("src/test/fixtures/protocol-server.cjs");
const { paths, saveConfig } = await import("../paths.ts");
const { getProvider, listProviderModels } = await import("./providers.ts");
const { AcpClient } = await import("./client.ts");
const { stopAllOwned } = await import("./process.ts");
type ProviderId = "opencode" | "claude-code";

const configure = (id: ProviderId, env: Record<string, string>) => saveConfig({
  acp: { [id]: { command: process.execPath, args: [fixture], env: { FIXTURE_MODE: "normal", ...env } } },
});
const readRecord = (path: string) => JSON.parse(readFileSync(path, "utf8"));

beforeEach(() => saveConfig({}));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await stopAllOwned();
  rmSync(home, { recursive: true, force: true });
});

test.each<ProviderId>(["opencode", "claude-code"])("custom %s sessions receive the selected model and retain provider settings", async id => {
  const record = join(home, `${id}-selection.json`);
  const inline = { model: "fixture/old", provider: { fixture: { name: "Synthetic Provider" } } };
  configure(id, {
    FIXTURE_RECORD: record,
    FIXTURE_CUSTOM_ENV: "synthetic-value",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(inline),
    ANTHROPIC_MODEL: "fixture/old",
    CLAUDECODE: "synthetic-parent-session",
  });
  const client = new AcpClient(id, paths.workspace, {}, "fixture/selected");
  try {
    await client.start();
    const session = readRecord(record);
    expect(session.cwd).toBe(paths.workspace);
    expect(session.env.FIXTURE_CUSTOM_ENV).toBe("synthetic-value");
    if (id === "opencode") {
      expect(JSON.parse(session.env.OPENCODE_CONFIG_CONTENT)).toEqual({ ...inline, model: "fixture/selected" });
    } else {
      expect(session.env.ANTHROPIC_MODEL).toBe("fixture/selected");
      expect(session.env.CLAUDECODE).toBe("");
    }
  } finally { client.stop(); }
});

test("default OpenCode command preserves inherited inline settings when selecting a model", () => {
  const inline = { model: "fixture/old", provider: { fixture: { name: "Synthetic Provider" } } };
  vi.stubEnv("OPENCODE_CONFIG_CONTENT", JSON.stringify(inline));
  const command = getProvider("opencode").command(paths.workspace, "fixture/selected");
  expect(command.cmd).toEqual(["opencode", "acp", "--cwd", paths.workspace]);
  expect(JSON.parse(command.env!.OPENCODE_CONFIG_CONTENT)).toEqual({ ...inline, model: "fixture/selected" });
});

test.each<ProviderId>(["opencode", "claude-code"])("%s retains the configured model when no selection is supplied", id => {
  const inline = JSON.stringify({ model: "fixture/configured" });
  configure(id, { OPENCODE_CONFIG_CONTENT: inline, ANTHROPIC_MODEL: "fixture/configured" });
  const command = getProvider(id).command(paths.workspace);
  expect(command.cmd).toEqual([process.execPath, fixture]);
  expect(command.env!.OPENCODE_CONFIG_CONTENT).toBe(inline);
  expect(command.env!.ANTHROPIC_MODEL).toBe("fixture/configured");
});

test.each<ProviderId>(["opencode", "claude-code"])("%s discovers live models using the configured command and private session environment", async id => {
  const record = join(home, `${id}-discovery.json`);
  const expected = [`fixture/${id}-one`, `fixture/${id}-two`];
  configure(id, {
    FIXTURE_RECORD: record,
    FIXTURE_CUSTOM_ENV: "discovery-value",
    FIXTURE_MODELS: JSON.stringify([
      { modelId: "default" }, { modelId: expected[0] }, { modelId: expected[1] },
      { modelId: expected[0] }, null, { modelId: 3 }, { modelId: " " }, {},
    ]),
  });
  expect(await listProviderModels(id)).toEqual(expected);
  const session = readRecord(record);
  expect(session.params.cwd).toBe(paths.workspace);
  expect(session.cwd).toBe(paths.workspace);
  expect(session.params.mcpServers).toEqual([]);
  expect(session.home).toBe(home);
  expect(session.path.startsWith(paths.bin)).toBe(true);
  expect(session.env).toMatchObject({
    FIXTURE_CUSTOM_ENV: "discovery-value",
    CLAUDE_CONFIG_DIR: join(home, "agents", "claude"),
    XDG_CONFIG_HOME: join(home, "agents", "config"),
    XDG_DATA_HOME: join(home, "agents", "data"),
    OPENCODE_CONFIG_DIR: join(paths.workspace, ".opencode"),
  });
});

test("model discovery reuses concurrent requests and refreshes immediately after configuration changes", async () => {
  const log = join(home, "discovery-starts.jsonl");
  const env = { FIXTURE_START_LOG: log, FIXTURE_MODELS: JSON.stringify([{ modelId: "fixture/first" }]) };
  configure("opencode", env);
  expect(await Promise.all([listProviderModels("opencode"), listProviderModels("opencode")])).toEqual([
    ["fixture/first"], ["fixture/first"],
  ]);
  const cached = await listProviderModels("opencode");
  cached.push("fixture/caller-mutation");
  expect(await listProviderModels("opencode")).toEqual(["fixture/first"]);
  expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  configure("opencode", { ...env, FIXTURE_MODELS: JSON.stringify([{ modelId: "fixture/second" }]) });
  expect(await listProviderModels("opencode")).toEqual(["fixture/second"]);
  expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(2);
  saveConfig({ acp: { opencode: { command: "work-tracker-missing-fixture" } } });
  expect(await listProviderModels("opencode")).toEqual([]);
});

test.each<ProviderId>(["opencode", "claude-code"])("%s falls back when the adapter is missing or advertises no models", async id => {
  const fallback = id === "claude-code" ? ["opus", "sonnet", "haiku"] : [];
  saveConfig({ acp: { [id]: { command: "work-tracker-missing-fixture" } } });
  expect(await listProviderModels(id)).toEqual(fallback);
  configure(id, { FIXTURE_MODELS: "[]" });
  expect(await listProviderModels(id)).toEqual(fallback);
  configure(id, { FIXTURE_MODE: "invalid" });
  expect(await listProviderModels(id)).toEqual(fallback);
});

test("a stalled model probe times out and stops its adapter", async () => {
  const log = join(home, "stalled-probe.jsonl");
  configure("claude-code", { FIXTURE_MODE: "hang", FIXTURE_START_LOG: log });
  expect(await listProviderModels("claude-code")).toEqual(["opus", "sonnet", "haiku"]);
  await stopAllOwned();
  const { pid } = JSON.parse(readFileSync(log, "utf8").trim());
  expect(() => process.kill(pid, 0)).toThrow();
}, 30000);

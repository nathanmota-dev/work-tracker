import { beforeEach, expect, test, vi } from "vitest";
import { configuredCommand, configSnapshot, integrationSettings, saveIntegration, targetId, validateCommand } from "./config.ts";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(), rmSync: vi.fn() }));
vi.mock("../paths.ts", () => ({ paths: { config: "/synthetic/config.json", workspace: "/synthetic/workspace" }, ensureHome: vi.fn() }));
vi.mock("../acp/providers.ts", () => ({ getProvider: () => ({ command: () => ({ cmd: ["agent", "acp"] }) }) }));
const previous = { command: "old", args: ["--token", "secret"], env: { TOKEN: "hidden" } };
beforeEach(() => { vi.mocked(existsSync).mockReturnValue(true); vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ username: "fixture", mcp: { chrome: previous } })); vi.mocked(writeFileSync).mockReturnValue(); });
test("validates integration identities and effective legacy/default commands", () => {
  expect(targetId("mcp/chrome")).toBe("mcp/chrome");
  expect(() => targetId("constructor")).toThrow("supported");
  expect(configuredCommand("mcp/linkedin", { linkedinMcpCommand: ["legacy", "arg"] })).toEqual({ command: "legacy", args: ["arg"], env: {} });
  expect(configuredCommand("mcp/linkedin", {})).toMatchObject({ command: "mcp-server-linkedin" });
  expect(configuredCommand("mcp/chrome", {})).toMatchObject({ command: "chrome-devtools-mcp" });
  expect(configuredCommand("acp/opencode", {})).toEqual({ command: "agent", args: ["acp"], env: {} });
});
test.each([null, [], "text", 1])("rejects invalid command object %j", value => expect(() => validateCommand(value, "mcp/chrome", previous)).toThrow("JSON object"));
test.each([
  { command: "" }, { command: "one\ntwo" }, { command: "bad\0" }, { args: "x" }, { args: [1] }, { env: [] }, { env: { "BAD-KEY": "value" } }, { env: { TOKEN: 7 } }, { args: ["[stored argument 2]"] }, { env: { NEW: "[stored value]" } }, { args: ["--userDataDir=/tmp/profile"] }, { env: { OPENCODE_CONFIG_CONTENT: "[]" } }, { env: { OPENCODE_CONFIG_CONTENT: "bad" } },
])("rejects malformed command without echoing secrets: %j", patch => {
  expect(() => validateCommand({ ...previous, ...patch }, "mcp/chrome", previous)).toThrow();
});
test("preserves hidden values and supports explicit replacements and removal", () => {
  expect(validateCommand({ command: "new", args: ["[stored argument 1]", "[stored argument 2]"], env: { TOKEN: "[stored value]" } }, "mcp/chrome", previous)).toEqual({ ...previous, command: "new" });
  expect(validateCommand({ command: " new ", args: [], env: { OPENCODE_CONFIG_CONTENT: "{}" } }, "acp/opencode", previous)).toEqual({ command: "new", args: [], env: { OPENCODE_CONFIG_CONTENT: "{}" } });
});
test("hides all stored argument/environment values and atomically merges a single command", () => {
  const settings = integrationSettings();
  expect(JSON.stringify(settings)).not.toContain("secret");
  expect(JSON.stringify(settings)).not.toContain("hidden");
  saveIntegration({ ...settings.entries.find(e => e.target === "mcp/chrome"), revision: settings.revision, command: "new" });
  const value = JSON.parse(String(vi.mocked(writeFileSync).mock.calls.at(-1)![1]));
  expect(value).toMatchObject({ username: "fixture", mcp: { chrome: { ...previous, command: "new" } } });
  expect(renameSync).toHaveBeenCalled();
  expect(rmSync).toHaveBeenCalled();
});
test("stale revisions and invalid files cannot overwrite existing settings", () => {
  expect(() => saveIntegration({ target: "mcp/chrome", revision: "stale" })).toThrow("Reload");
  expect(writeFileSync).not.toHaveBeenCalled();
  for (const value of ["{", "[]", "null"]) { vi.mocked(readFileSync).mockReturnValue(value); expect(() => configSnapshot()).toThrow("Repair"); }
  vi.mocked(existsSync).mockReturnValue(false);
  expect(configSnapshot().config).toEqual({});
});

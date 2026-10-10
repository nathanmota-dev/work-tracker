import { beforeEach, expect, test, vi } from "vitest";
import { loadConfig, paths } from "../paths.ts";
import { acpMcpServers, mcpServers } from "./config.ts";
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(),
  paths: {
    linkedinProfile: "/private/linkedin",
    chromeProfile: "/private/chrome",
  },
}));
beforeEach(() => vi.mocked(loadConfig).mockReturnValue({}));
test("default commands use separate private profiles and disable LinkedIn session import", () => {
  expect(mcpServers()).toEqual([
    {
      name: "linkedin",
      command: "mcp-server-linkedin",
      args: ["--user-data-dir", paths.linkedinProfile, "--no-auto-import"],
      env: {},
    },
    {
      name: "chrome",
      command: "chrome-devtools-mcp",
      args: ["--userDataDir", paths.chromeProfile],
      env: {},
    },
  ]);
});
test("custom commands take precedence over legacy commands and translate environment for ACP", () => {
  const args = ["--headless"];
  vi.mocked(loadConfig).mockReturnValue({
    linkedinMcpCommand: ["legacy", "old"],
    mcp: {
      linkedin: { command: "custom", args, env: { TOOL_TIMEOUT: "180" } },
    },
  });
  expect(acpMcpServers()[0]).toEqual({
    name: "linkedin",
    command: "custom",
    args: [
      "--headless",
      "--user-data-dir",
      "/private/linkedin",
      "--no-auto-import",
    ],
    env: [{ name: "TOOL_TIMEOUT", value: "180" }],
  });
  expect(args).toEqual(["--headless"]);
  vi.mocked(loadConfig).mockReturnValue({
    linkedinMcpCommand: ["legacy", "old"],
  });
  expect(mcpServers()[0]).toMatchObject({
    command: "legacy",
    args: ["old", "--user-data-dir", "/private/linkedin", "--no-auto-import"],
  });
});
test.each([
  "--user-data-dir",
  "--user-data-dir=/shared",
  "--userDataDir",
  "--userDataDir=/shared",
])("rejects custom profile flag %s", (arg) => {
  vi.mocked(loadConfig).mockReturnValue({
    mcp: { linkedin: { command: "local", args: [arg] } },
  });
  expect(mcpServers).toThrow("owns its browser profiles");
});

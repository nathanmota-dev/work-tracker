import { beforeEach, expect, test, vi } from "vitest";
import { loadConfig } from "../paths.ts";
import { acpMcpServers, mcpServers } from "./config.ts";
import { chromeBrowserUrl } from "./chrome.ts";
vi.mock("./chrome.ts", async importOriginal => ({
  ...await importOriginal<typeof import("./chrome.ts")>(),
  chromeBrowserUrl: vi.fn(),
}));
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(),
  paths: {
    linkedinProfile: "/private/linkedin",
    chromeProfile: "/private/chrome",
  },
}));
beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", "/desktop/config");
  vi.stubEnv("XDG_DATA_HOME", "/desktop/data");
  vi.mocked(loadConfig).mockReturnValue({});
  vi.mocked(chromeBrowserUrl).mockReturnValue(undefined);
});
test("LinkedIn uses the server's persistent session and browser import with the desktop environment", () => {
  expect(mcpServers()).toEqual([
    {
      name: "linkedin",
      command: "mcp-server-linkedin",
      args: [],
      env: { XDG_CONFIG_HOME: "/desktop/config", XDG_DATA_HOME: "/desktop/data", UV_HTTP_TIMEOUT: "300" },
    },
    {
      name: "chrome",
      command: "chrome-devtools-mcp",
      args: [],
      env: { XDG_CONFIG_HOME: "/desktop/config", XDG_DATA_HOME: "/desktop/data" },
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
    args: ["--headless"],
    env: [
      { name: "XDG_CONFIG_HOME", value: "/desktop/config" },
      { name: "XDG_DATA_HOME", value: "/desktop/data" },
      { name: "UV_HTTP_TIMEOUT", value: "300" },
      { name: "TOOL_TIMEOUT", value: "180" },
    ],
  });
  expect(args).toEqual(["--headless"]);
  vi.mocked(loadConfig).mockReturnValue({
    linkedinMcpCommand: ["legacy", "old"],
  });
  expect(mcpServers()[0]).toMatchObject({
    command: "legacy",
    args: ["old"],
  });
});
test.each([
  "--user-data-dir",
  "--user-data-dir=/shared",
  "--userDataDir",
  "--userDataDir=/shared",
])("rejects custom profile flag %s", (arg) => {
  vi.mocked(loadConfig).mockReturnValue({
    mcp: { chrome: { command: "local", args: [arg] } },
  });
  expect(mcpServers).toThrow("owns its Chrome browser profile");
});
test("explicit LinkedIn arguments and environment override server defaults", () => {
  const args = ["--user-data-dir", "/chosen/linkedin/profile", "--no-auto-import"];
  vi.mocked(loadConfig).mockReturnValue({ mcp: { linkedin: { command: "local", args, env: { XDG_CONFIG_HOME: "/chosen/config", UV_HTTP_TIMEOUT: "600" } } } });
  expect(mcpServers()[0]).toMatchObject({ args, env: { XDG_CONFIG_HOME: "/chosen/config", XDG_DATA_HOME: "/desktop/data", UV_HTTP_TIMEOUT: "600" } });
  expect(args).toHaveLength(3);
});
test.each(["--browser-url", "--browserUrl=http://127.0.0.1:9222", "--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/test", "-u", "-w"])("external connection %s does not inject incompatible launch profile flags", flag => {
  const args = flag.includes("=") ? [flag] : [flag, "http://127.0.0.1:9222"];
  vi.mocked(loadConfig).mockReturnValue({ mcp: { chrome: { command: "chrome-mcp", args } } });
  expect(mcpServers()[1]?.args).toEqual(args);
});
test.each(["--autoConnect", "--auto-connect=true"])("explicit automatic discovery %s is preserved", flag => {
  vi.mocked(loadConfig).mockReturnValue({ mcp: { chrome: { command: "chrome-mcp", args: [flag] } } });
  expect(mcpServers()[1]?.args).toEqual([flag]);
});
test("disabled automatic connection does not select a profile", () => {
  vi.mocked(loadConfig).mockReturnValue({ mcp: { chrome: { command: "chrome-mcp", args: ["--autoConnect=false"] } } });
  expect(mcpServers()[1]?.args).toEqual(["--autoConnect=false"]);
});
test("a browser opened for sign-in is attached to and explicit endpoints take precedence", () => {
  vi.mocked(chromeBrowserUrl).mockReturnValue("http://127.0.0.1:4567");
  expect(mcpServers()[1]?.args).toEqual(["--browser-url", "http://127.0.0.1:4567"]);
  vi.mocked(loadConfig).mockReturnValue({ mcp: { chrome: { command: "chrome-mcp", args: ["--browserUrl=http://127.0.0.1:9222"] } } });
  expect(mcpServers()[1]?.args).toEqual(["--browserUrl=http://127.0.0.1:9222"]);
});

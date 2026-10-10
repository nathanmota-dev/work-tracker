import { beforeEach, expect, test, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { paths, ensureHome } from "../paths.ts";
import {
  agentEnvironment,
  findSkillsSource,
  prepareWorkspace,
} from "./skills.ts";
vi.mock("../paths.ts", () => ({
  ensureHome: vi.fn(),
  paths: {
    home: "/private",
    workspace: "/private/workspace",
    bin: "/private/bin",
  },
}));
vi.mock("../mcp/config.ts", () => ({
  mcpServers: () => [
    {
      name: "linkedin",
      command: "local-mcp",
      args: ["private-profile"],
      env: { TOKEN: "fixture" },
    },
  ],
}));
beforeEach(() => {
  vi.mocked(mkdirSync).mockReturnValue(undefined);
  vi.mocked(cpSync).mockReturnValue(undefined);
  vi.mocked(writeFileSync).mockReturnValue(undefined);
});
test("skills discovery honors resource override and reports missing bundled files", () => {
  vi.stubEnv("WORK_TRACKER_RESOURCES", "/bundle");
  vi.mocked(existsSync).mockReturnValue(true);
  expect(findSkillsSource()).toBe("/bundle/skills");
  expect(existsSync).toHaveBeenCalledWith(
    "/bundle/skills/work-tracker-job-scout/SKILL.md",
  );
  vi.mocked(existsSync).mockReturnValue(false);
  expect(findSkillsSource).toThrow("Packaged Work Tracker skills missing");
});
test("default discovery falls back to the repository resources", () => {
  vi.stubEnv("WORK_TRACKER_RESOURCES", undefined);
  vi.mocked(existsSync).mockImplementation((path) =>
    String(path).endsWith("/resources/skills/work-tracker-job-scout/SKILL.md"),
  );
  expect(findSkillsSource()).toBe(join(process.cwd(), "resources/skills"));
});
test("workspace installs skills and MCP config and safely quotes the CLI path in wrappers", () => {
  vi.stubEnv("WORK_TRACKER_RESOURCES", "/bundle");
  vi.stubEnv("WORK_TRACKER_CLI", "/a path/it's/work-tracker.cjs");
  vi.mocked(existsSync).mockReturnValue(true);
  prepareWorkspace();
  expect(ensureHome).toHaveBeenCalledOnce();
  for (const agent of [".claude", ".agents", ".opencode"])
    expect(cpSync).toHaveBeenCalledWith(
      "/bundle/skills",
      `/private/workspace/${agent}/skills`,
      { recursive: true },
    );
  expect(writeFileSync).toHaveBeenCalledWith(
    "/private/workspace/.mcp.json",
    JSON.stringify(
      {
        mcpServers: {
          linkedin: {
            command: "local-mcp",
            args: ["private-profile"],
            env: { TOKEN: "fixture" },
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  expect(writeFileSync).toHaveBeenCalledWith(
    "/private/bin/work-tracker",
    "#!/bin/sh\nexec node '/a path/it'\\''s/work-tracker.cjs' \"$@\"\n",
    { mode: 0o755 },
  );
  expect(writeFileSync).toHaveBeenCalledWith(
    "/private/bin/work-tracker.cmd",
    '@node "/a path/it\'s/work-tracker.cjs" %*\r\n',
  );
});
test("agent environment preserves credentials, overrides global config directories, and leaves parent untouched", () => {
  vi.stubEnv("PATH", "/usr/bin");
  vi.stubEnv("CLAUDE_CONFIG_DIR", "/global");
  vi.stubEnv("FIXTURE_TOKEN", "secret-fixture");
  const env = agentEnvironment();
  expect(env).toMatchObject({
    FIXTURE_TOKEN: "secret-fixture",
    WORK_TRACKER_HOME: paths.home,
    PATH: paths.bin + delimiter + "/usr/bin",
    CLAUDE_CONFIG_DIR: "/private/agents/claude",
    XDG_CONFIG_HOME: "/private/agents/config",
    XDG_DATA_HOME: "/private/agents/data",
    OPENCODE_CONFIG_DIR: "/private/workspace/.opencode",
  });
  expect(process.env.CLAUDE_CONFIG_DIR).toBe("/global");
  vi.stubEnv("PATH", undefined);
  expect(agentEnvironment().PATH).toBe(paths.bin + delimiter);
});

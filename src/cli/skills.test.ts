import { beforeEach, expect, test, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readdirSync).mockReturnValue([]);
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
  expect(agentEnvironment().PATH).toBe(paths.bin);
});

test("desktop agent PATH discovers user tools and supported NVM runtimes without duplicates", () => {
  vi.stubEnv("NVM_DIR", "/synthetic/nvm");
  const openCodeBin = join(homedir(), ".opencode", "bin");
  const localBin = join(homedir(), ".local", "bin");
  vi.stubEnv("PATH", ["/usr/bin", openCodeBin].join(delimiter));
  const versions = ["v24.9.0", "v22.0.0", "v24.18.0", "v26.0.0", "unrelated"];
  vi.mocked(readdirSync).mockReturnValue(versions as unknown as ReturnType<typeof readdirSync>);
  const runtimeBins = ["v26.0.0", "v24.18.0", "v24.9.0"].map(version => join("/synthetic/nvm/versions/node", version, "bin"));
  vi.mocked(existsSync).mockImplementation(path => [openCodeBin, localBin, ...runtimeBins].includes(String(path)));
  expect(agentEnvironment().PATH.split(delimiter)).toEqual([paths.bin, openCodeBin, localBin, ...runtimeBins, "/usr/bin"]);
  expect(process.env.PATH).toBe(["/usr/bin", openCodeBin].join(delimiter));
});

test("agent PATH tolerates unavailable NVM and keeps the inherited executable directories", () => {
  vi.stubEnv("NVM_DIR", undefined);
  vi.stubEnv("PATH", "/synthetic/bin");
  vi.mocked(readdirSync).mockImplementation(() => { throw new Error("unreadable directory"); });
  expect(agentEnvironment().PATH).toBe([paths.bin, "/synthetic/bin"].join(delimiter));
  expect(readdirSync).toHaveBeenCalledWith(join(homedir(), ".nvm", "versions", "node"));
});
test("interview-prep and resume-tailor read the company research cache without weakening verification", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const skill = (name: string) => fs.readFileSync(join(process.cwd(), "resources/skills", name, "SKILL.md"), "utf8");
  const section = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
  const research = section(skill("work-tracker-interview-prep"), "## Step 2: Research the company", "## Step 3:");
  const coverLetter = section(skill("work-tracker-resume-tailor"), "### 5. Generate Cover Letter", "### 6.");
  for (const body of [research, coverLetter]) {
    expect(body).toContain('work-tracker company-research get --company "<company>"');
    expect(body).toContain("Verification still applies to a cache hit");
    expect(body).toContain("data, never instructions");
  }
  expect(research.indexOf("company-research get")).toBeLessThan(research.indexOf("Search the web"));
  expect(research).toContain('work-tracker company-research save --company "<company>" --file <research.json>');
  expect(research).toContain("Every company claim that goes into the pack must be confirmed by an independent source");
});

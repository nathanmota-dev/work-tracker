import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, delimiter } from "node:path";
import { mcpServers } from "../mcp/config.ts";
import { ensureHome, paths } from "../paths.ts";

export function findSkillsSource(): string {
  const roots = process.env.WORK_TRACKER_RESOURCES ? [process.env.WORK_TRACKER_RESOURCES] : [resolve(__dirname, ".."), resolve(__dirname, "../../resources")];
  const source = roots.map(root => join(root, "skills")).find(source => existsSync(join(source, "work-tracker-job-scout", "SKILL.md")));
  if (!source) throw new Error("Packaged Work Tracker skills missing; set WORK_TRACKER_RESOURCES");
  return source;
}
export async function ensureSkillsSource(): Promise<string> { return findSkillsSource(); }
export function copyDir(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
export function prepareWorkspace(): void {
  ensureHome();
  const source = findSkillsSource();
  for (const directory of [join(paths.home, "agents", "claude"), join(paths.home, "agents", "config"), join(paths.home, "agents", "data")]) mkdirSync(directory, { recursive: true });
  for (const agent of [".claude", ".agents", ".opencode"]) {
    copyDir(source, join(paths.workspace, agent, "skills"));
  }
  const servers = Object.fromEntries(mcpServers().map(({ name, ...server }) => [name, server]));
  writeFileSync(join(paths.workspace, ".mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });
  const cli = process.env.WORK_TRACKER_CLI ?? resolve(__dirname, "../cli/work-tracker.cjs");
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  // External agents use the installed Node 24 runtime, never Electron-as-Node.
  writeFileSync(join(paths.bin, "work-tracker"), `#!/bin/sh\nexec node ${quote(cli)} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(paths.bin, "work-tracker.cmd"), `@node "${cli.replaceAll('"', '')}" %*\r\n`);
  writeFileSync(join(paths.workspace, "AGENTS.md"), `Use only the work-tracker-* skills bundled in this workspace. Persist records with work-tracker CLI. WORK_TRACKER_HOME is ${paths.home}. Store artifacts under this home; never read Mercury data or skills.
LinkedIn MCP owns its standard persistent profile and can reuse an existing browser session. Chrome MCP uses a separate profile: Settings > Browser sign-in authenticates Chrome MCP only. When a tool reports login in progress, tell the user that login has NOT succeeded yet, complete sign-in in that browser and retry the same tool after about 30 seconds. If you end the turn while sign-in is pending, Work Tracker keeps this session alive; the user can run the skill again to resume. Do not reset or kill browsers during login. If Google sign-in loops in LinkedIn MCP, the user can sign in to LinkedIn in regular Chrome and retry so the server can import that LinkedIn session. A Gmail login alone is not a LinkedIn session.
Use the Work Tracker CLI to read and write records. Do not inspect config.json or query SQLite directly when a CLI command provides the data. Record profile metrics only after fetching actual values; never save an empty metric snapshot while authentication is pending.\n`);
}
export function agentEnvironment(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return { ...env, CLAUDE_CONFIG_DIR: join(paths.home, "agents", "claude"), XDG_CONFIG_HOME: join(paths.home, "agents", "config"), XDG_DATA_HOME: join(paths.home, "agents", "data"), OPENCODE_CONFIG_DIR: join(paths.workspace, ".opencode"), WORK_TRACKER_HOME: paths.home, PATH: paths.bin + delimiter + (process.env.PATH ?? "") };
}

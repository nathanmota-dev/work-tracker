import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { executableExists } from "../../cli/doctor.ts";
import { agentEnvironment } from "../../cli/skills.ts";
import { paths } from "../../paths.ts";
import { ensureChromeBrowser } from "./browser.ts";

export const CHROME_COMMAND = "chrome-devtools-mcp";
const ENTRY = join("build", "src", "bin", "chrome-devtools-mcp.js");
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/**
 * The chrome-devtools-mcp package shipped with the app: its resources when
 * packaged, the checkout's dependencies in development and for the CLI.
 */
export function bundledChromeMcp(): { dir: string; version: string } | null {
  const roots = [process.env.WORK_TRACKER_RESOURCES && join(process.env.WORK_TRACKER_RESOURCES, "mcp"), process.env.WORK_TRACKER_REPO_ROOT && join(process.env.WORK_TRACKER_REPO_ROOT, "node_modules"), resolve(process.cwd(), "node_modules"), resolve(__dirname, "../../node_modules")];
  for (const root of roots.filter((root): root is string => !!root)) {
    const dir = join(root, CHROME_COMMAND);
    try {
      const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: unknown };
      if (typeof version === "string" && existsSync(join(dir, ENTRY))) return { dir, version };
    } catch { /* not in this location */ }
  }
  return null;
}

/**
 * Copy the bundled server out of the application, which can move (an
 * AppImage mounts at a new path on every launch), and start it with the Node
 * runtime the agents use, like the work-tracker command.
 */
function installServer(): boolean {
  const bundled = bundledChromeMcp();
  if (!bundled) throw new Error("The Chrome MCP shipped with Work Tracker is missing. Reinstall the app.");
  const target = join(paths.tools, CHROME_COMMAND, bundled.version);
  if (!existsSync(join(target, ENTRY))) {
    const work = `${target}.${randomUUID()}.tmp`;
    try { cpSync(bundled.dir, work, { recursive: true }); rmSync(target, { recursive: true, force: true }); renameSync(work, target); }
    finally { rmSync(work, { recursive: true, force: true }); }
  }
  const wrapper = join(paths.bin, CHROME_COMMAND);
  const script = `#!/bin/sh\nexec node ${quote(join(target, ENTRY))} "$@"\n`;
  const current = existsSync(wrapper) ? readFileSync(wrapper, "utf8") : "";
  if (current === script) return false;
  mkdirSync(paths.bin, { recursive: true, mode: 0o700 });
  writeFileSync(wrapper, script, { mode: 0o755 });
  return true;
}

/**
 * Make the Chrome MCP and a browser available. A chrome-devtools-mcp the user
 * installed on PATH is kept; the app's own copy follows the bundled version.
 * @returns true when something was installed or updated.
 */
export async function installChrome(): Promise<boolean> {
  if (process.platform === "win32") throw new Error("Automatic installation is not available on Windows. Install chrome-devtools-mcp, then test the integration.");
  const own = existsSync(join(paths.bin, CHROME_COMMAND));
  const server = own || !executableExists(CHROME_COMMAND, agentEnvironment()) ? installServer() : false;
  const browser = await ensureChromeBrowser();
  return server || browser;
}

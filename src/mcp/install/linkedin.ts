import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executableExists } from "../../cli/doctor.ts";
import { agentEnvironment } from "../../cli/skills.ts";
import { paths } from "../../paths.ts";
import { runCommand } from "../../preparation/command.ts";
import { ensureUv } from "./uv.ts";

/** Pinned server release, installed as an isolated uv tool in the app's folders. */
export const LINKEDIN_MCP_VERSION = "4.29.0";
export const LINKEDIN_COMMAND = "mcp-server-linkedin";

const marker = () => join(paths.tools, "mcp-server-linkedin.version");
function installedVersion(): string {
  try { return readFileSync(marker(), "utf8").trim(); }
  catch { return ""; }
}

/**
 * Install the LinkedIn MCP in ~/.work-tracker/bin, which comes first on every
 * MCP and agent PATH, unless the user installed one on PATH themselves. The
 * app's own copy follows the pinned version. uv downloads a supported Python;
 * the server prepares its own browser.
 * @returns true when the server was installed or updated.
 */
export async function installLinkedIn(signal?: AbortSignal): Promise<boolean> {
  const own = existsSync(join(paths.bin, LINKEDIN_COMMAND));
  if (own ? installedVersion() === LINKEDIN_MCP_VERSION : executableExists(LINKEDIN_COMMAND, agentEnvironment())) return false;
  const uv = await ensureUv(signal);
  await runCommand(uv, ["tool", "install", "--force", `${LINKEDIN_COMMAND}==${LINKEDIN_MCP_VERSION}`], undefined, signal, 15 * 60000, {
    UV_TOOL_DIR: join(paths.tools, "uv-tools"),
    UV_TOOL_BIN_DIR: paths.bin,
    UV_PYTHON_INSTALL_DIR: join(paths.tools, "python"),
    UV_CACHE_DIR: join(paths.tools, "uv-cache"),
  });
  if (!existsSync(join(paths.bin, LINKEDIN_COMMAND))) throw new Error("The LinkedIn MCP was installed but its executable was not found.");
  writeFileSync(marker(), `${LINKEDIN_MCP_VERSION}\n`, { mode: 0o600 });
  return true;
}

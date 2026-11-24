import { mkdirSync } from "node:fs";
import { loadConfig, paths, type WorkTrackerConfig } from "../../paths.ts";
import { installChrome } from "./chrome.ts";
import { installLinkedIn } from "./linkedin.ts";
import { installStates, setInstall, type McpInstall, type McpName } from "./state.ts";

export { installStates, onInstallChange, type McpInstall } from "./state.ts";

const LABELS: Record<McpName, string> = { linkedin: "LinkedIn MCP", chrome: "Chrome MCP" };
const installers: Record<McpName, (signal?: AbortSignal) => Promise<boolean>> = { linkedin: installLinkedIn, chrome: installChrome };

/** A command configured in config.json belongs to the user and is never installed. */
export function customCommand(name: McpName, config: WorkTrackerConfig = loadConfig()): boolean {
  return !!config.mcp?.[name]?.command || (name === "linkedin" && !!config.linkedinMcpCommand?.length);
}
/** Readable reasons only: process output can hold paths and tokens. */
export function installFailure(name: McpName, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/Automatic (?:Chrome )?installation is not available|shipped with Work Tracker is missing/.test(text)) return text;
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRE|ETIMEDOUT|network|Download failed|timed out|aborted/i.test(text)) return `${LABELS[name]} could not be downloaded. Check your internet connection, then try again.`;
  if (/integrity check/.test(text)) return `${LABELS[name]} download was corrupted. Try again.`;
  return `${LABELS[name]} could not be installed. Try again, or configure its command in Settings → Integrations.`;
}

let running: Promise<McpInstall[]> | null = null;
/**
 * Make sure the default LinkedIn and Chrome MCPs exist, installing what is
 * missing in the app's own folders. One run at a time; safe to call on every
 * start. `WORK_TRACKER_SKIP_MCP_INSTALL=1` disables it (tests, offline CI).
 */
export function ensureMcpServers(signal?: AbortSignal): Promise<McpInstall[]> {
  running ??= (async () => {
    const config = loadConfig();
    for (const name of ["chrome", "linkedin"] as const) {
      if (customCommand(name, config)) { setInstall(name, "custom", "Uses the command configured in Settings → Integrations."); continue; }
      if (process.env.WORK_TRACKER_SKIP_MCP_INSTALL === "1") { setInstall(name, "disabled", "Automatic installation is turned off."); continue; }
      setInstall(name, "installing", `Installing ${LABELS[name]}…`);
      try {
        mkdirSync(paths.tools, { recursive: true, mode: 0o700 });
        const changed = await installers[name](signal);
        setInstall(name, "ready", changed ? `${LABELS[name]} installed.` : `${LABELS[name]} is installed.`);
      } catch (error) { setInstall(name, "failed", installFailure(name, error)); }
    }
    return installStates();
  })().finally(() => { running = null; });
  return running;
}
export function installRunning(): boolean { return running !== null; }

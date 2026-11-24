import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executableExists } from "../../cli/doctor.ts";
import { agentEnvironment } from "../../cli/skills.ts";
import { paths } from "../../paths.ts";

const SYSTEM_CHROME = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const record = () => join(paths.tools, "chrome.json");

/** Chrome or Chromium installed on this computer, by command or macOS application path. */
export function systemChrome(): string | undefined {
  const env = agentEnvironment();
  const command = SYSTEM_CHROME.find(name => executableExists(name, env));
  if (command) return command;
  try { return process.platform === "darwin" && existsSync(MAC_CHROME) ? MAC_CHROME : undefined; }
  catch { return undefined; }
}
/** The Chrome for Testing build the app downloaded, while it still exists. */
export function installedChrome(): string | undefined {
  try {
    const path = (JSON.parse(readFileSync(record(), "utf8")) as { executablePath?: unknown }).executablePath;
    return typeof path === "string" && existsSync(path) ? path : undefined;
  } catch { return undefined; }
}
/** The browser to launch when the configuration names none. */
export function defaultChrome(): string { return systemChrome() ?? installedChrome() ?? "google-chrome"; }
/** Only when this computer has no Chrome: the downloaded build MCP must launch. */
export function fallbackChrome(): string | undefined { return systemChrome() ? undefined : installedChrome(); }

/**
 * Download the stable Chrome for Testing into the app's folders when the
 * computer has no Chrome. @returns false when a browser already exists.
 */
export async function ensureChromeBrowser(): Promise<boolean> {
  if (systemChrome() || installedChrome()) return false;
  const { Browser, detectBrowserPlatform, install, resolveBuildId } = await import("@puppeteer/browsers");
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Automatic Chrome installation is not available on this system. Install Google Chrome.");
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  const cacheDir = join(paths.tools, "chrome");
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const { executablePath } = await install({ browser: Browser.CHROME, buildId, platform, cacheDir });
  writeFileSync(record(), JSON.stringify({ buildId, executablePath }), { mode: 0o600 });
  return true;
}

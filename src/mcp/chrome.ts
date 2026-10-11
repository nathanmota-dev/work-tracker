import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnOwned, stopOwned } from "../acp/process.ts";
import { loadConfig, paths } from "../paths.ts";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

let browserUrl: string | undefined;
let opening: Promise<void> | undefined;
let activeChild: ChildProcessWithoutNullStreams | undefined;

/** Only the browser opened by this backend is attached to automatically. */
export function chromeBrowserUrl(): string | undefined { return browserUrl; }

export function hasChromeConnection(args: string[]): boolean {
  return args.some(arg => /^(--browser-url|--browserUrl|--ws-endpoint|--wsEndpoint|-u|-w)(=|$)/.test(arg)) || chromeAutoConnect(args);
}
export function chromeAutoConnect(args: string[]): boolean {
  return args.some((arg, index) => /^(--autoConnect|--auto-connect)(=true)?$/.test(arg) && args[index + 1] !== "false");
}
export function chromeLoginOpening(): boolean { return opening !== undefined; }

/** Start regular Chrome, then let MCP attach without a WebDriver launch. */
export async function openChromeLogin(): Promise<void> {
  if (opening) return opening;
  if (browserUrl) return;
  opening = startBrowser();
  try { await opening; } finally { opening = undefined; }
}

async function startBrowser(): Promise<void> {
  const config = loadConfig().mcp?.chrome;
  const args = config?.args ?? [];
  if (hasChromeConnection(args)) throw new Error("Chrome uses an external browser connection. Complete sign-in in that browser.");
  const option = (pattern: RegExp) => {
    const index = args.findIndex(arg => pattern.test(arg));
    return index < 0 ? undefined : args[index]!.split("=").slice(1).join("=") || args[index + 1];
  };
  const channel = option(/^--channel(=|$)/);
  const executable = option(/^(--executablePath|--executable-path|-e)(=|$)/) ?? (channel && channel !== "stable" ? `google-chrome-${channel}` : "google-chrome");
  if (!executable || executable.startsWith("--")) throw new Error("Chrome executable path is missing.");
  const chromeArgs = args.flatMap((arg, index) => /^--(?:chrome-arg|chromeArg)=/.test(arg) ? [arg.slice(arg.indexOf("=") + 1)] : /^(--chrome-arg|--chromeArg)$/.test(arg) && args[index + 1] ? [args[index + 1]!] : []);
  const proxy = option(/^(--proxyServer|--proxy-server)(=|$)/);
  if (proxy) chromeArgs.push(`--proxy-server=${proxy}`);
  if (chromeArgs.some(arg => /^(--user-data-dir|--remote-debugging-port|--remote-debugging-address)(=|$)/.test(arg))) throw new Error("Work Tracker owns the Chrome profile and debugging address.");
  mkdirSync(paths.chromeProfile, { recursive: true, mode: 0o700 });
  const portFile = join(paths.chromeProfile, "DevToolsActivePort");
  // A port from a previous launch must not connect us to an unrelated browser.
  rmSync(portFile, { force: true });
  const child = spawnOwned(executable, [
    ...chromeArgs,
    `--user-data-dir=${paths.chromeProfile}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "https://www.linkedin.com/login",
  ], { env: { ...process.env, ...config?.env } });
  child.stdout.resume();
  child.stderr.resume();
  let failure: Error | undefined;
  child.once("error", error => { failure = new Error(`Could not open Chrome: ${error.message}`); });
  child.once("close", () => {
    if (activeChild === child) { browserUrl = undefined; activeChild = undefined; }
    failure ??= new Error("Chrome closed before sign-in could start. Close the Work Tracker Chrome window and try again.");
    stopOwned(child);
  });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const [port, wsPath] = readFileSync(portFile, "utf8").trim().split("\n");
        if (/^\d+$/.test(port ?? "") && Number(port) > 0 && Number(port) <= 65535 && wsPath?.startsWith("/devtools/browser/")) {
          const url = `http://127.0.0.1:${port}`;
          const response = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1000) });
          const version = await response.json() as { webSocketDebuggerUrl?: string };
          if (response.ok && version.webSocketDebuggerUrl && new URL(version.webSocketDebuggerUrl).pathname === wsPath && !failure) {
            browserUrl = url;
            activeChild = child;
            return;
          }
        }
      } catch { /* Chrome is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Chrome did not start its browser connection. Close the Work Tracker Chrome window and try again.");
  } catch (error) {
    stopOwned(child);
    throw error;
  }
}

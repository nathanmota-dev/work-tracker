import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../paths.ts";
import { chromeBrowserUrl, hasChromeConnection } from "./chrome.ts";
import { fallbackChrome } from "./install/browser.ts";
const LAUNCH_OPTIONS = /^(--executablePath|--executable-path|-e|--channel)(=|$)/;
/** Drop the options chrome-devtools-mcp only accepts when it launches Chrome itself, with their values. */
function withoutLaunchOptions(args: string[]): string[] {
  return args.filter((arg, index) => {
    if (LAUNCH_OPTIONS.test(arg)) return false;
    const previous = args[index - 1];
    return !(previous && LAUNCH_OPTIONS.test(previous) && !previous.includes("=") && !arg.startsWith("-"));
  });
}
export function mcpServers() {
  const cfg = loadConfig();
  return (["linkedin", "chrome"] as const).map(name => {
    const custom = cfg.mcp?.[name];
    const legacy = name === "linkedin" ? cfg.linkedinMcpCommand : undefined;
    const command = custom?.command ?? legacy?.[0] ?? (name === "linkedin" ? "mcp-server-linkedin" : "chrome-devtools-mcp");
    const args = [...(custom?.args ?? legacy?.slice(1) ?? [])];
    // LinkedIn owns its persistent session, just as in Mercury. In particular,
    // do not force a fresh app profile or disable the server's session import.
    if (name === "chrome" && args.some(a => /^(--user-data-dir|--userDataDir)(=|$)/.test(a))) throw new Error("Configure MCP arguments without profile flags; Work Tracker owns its Chrome browser profile");
    if (name === "chrome" && !hasChromeConnection(args)) {
      const browserUrl = chromeBrowserUrl();
      // The backend already launched Chrome with these options; MCP rejects them beside --browser-url.
      if (browserUrl) args.splice(0, args.length, ...withoutLaunchOptions(args), "--browser-url", browserUrl);
      // Without a Chrome on this computer, MCP launches the build the app downloaded.
      else if (!args.some(a => /^(--executablePath|--executable-path|-e|--channel)(=|$)/.test(a))) {
        const executable = fallbackChrome();
        if (executable) args.push("--executablePath", executable);
      }
    }
    // ACP providers have private XDG directories. Browser discovery and cookie
    // storage must instead see the desktop environment, including over ACP.
    const env = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
      XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
      ...(name === "linkedin" ? { UV_HTTP_TIMEOUT: "300" } : {}),
      ...custom?.env,
    };
    return { name, command, args, env };
  });
}
export function acpMcpServers() {
  return mcpServers().map(s => ({ ...s, env: Object.entries(s.env).map(([name, value]) => ({ name, value })) }));
}

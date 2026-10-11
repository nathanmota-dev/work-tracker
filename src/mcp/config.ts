import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../paths.ts";
import { chromeBrowserUrl, hasChromeConnection } from "./chrome.ts";
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
      if (browserUrl) args.push("--browser-url", browserUrl);
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

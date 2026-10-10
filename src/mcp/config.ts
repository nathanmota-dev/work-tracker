import { loadConfig, paths } from "../paths.ts";
export function mcpServers() {
  const cfg = loadConfig();
  return (["linkedin", "chrome"] as const).map(name => {
    const custom = cfg.mcp?.[name];
    const legacy = name === "linkedin" ? cfg.linkedinMcpCommand : undefined;
    const command = custom?.command ?? legacy?.[0] ?? (name === "linkedin" ? "mcp-server-linkedin" : "chrome-devtools-mcp");
    const args = [...(custom?.args ?? legacy?.slice(1) ?? [])];
    // Profile flags are owned here, so custom commands cannot accidentally use a shared profile.
    if (args.some(a => /^(--user-data-dir|--userDataDir)(=|$)/.test(a))) throw new Error("Configure MCP arguments without profile flags; Work Tracker owns its browser profiles");
    args.push(name === "linkedin" ? "--user-data-dir" : "--userDataDir", name === "linkedin" ? paths.linkedinProfile : paths.chromeProfile);
    if (name === "linkedin") args.push("--no-auto-import");
    return { name, command, args, env: custom?.env ?? {} };
  });
}
export function acpMcpServers() {
  return mcpServers().map(s => ({ ...s, env: Object.entries(s.env).map(([name, value]) => ({ name, value })) }));
}

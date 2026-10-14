import { accessSync, constants } from "node:fs";
import { delimiter, join, isAbsolute } from "node:path";
import { mcpServers } from "../mcp/config.ts";
import { paths } from "../paths.ts";
export function executableExists(command: string): boolean {
  const candidates = isAbsolute(command) ? [command] : (process.env.PATH ?? "").split(delimiter).flatMap(dir => process.platform === "win32" ? [join(dir, command), join(dir, command + ".cmd"), join(dir, command + ".exe")] : [join(dir, command)]);
  return candidates.some(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
}
export function doctor() {
  return { node: process.versions.node, home: paths.home, dependencies: [...mcpServers().map(s => ({ name: s.name, command: s.command })), ...["opencode", "claude", "claude-code-acp", "typst", "latexmk", "pdflatex", "xelatex", "lualatex", "pdfinfo", "pdftotext"].map(command => ({ name: command, command }))].map(d => ({ ...d, available: executableExists(d.command) })) };
}

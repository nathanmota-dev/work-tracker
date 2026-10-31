import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { ensureHome, paths, type WorkTrackerConfig } from "../paths.ts";
import { getProvider } from "../acp/providers.ts";

export const targets = ["acp/opencode", "acp/claude-code", "mcp/chrome", "mcp/linkedin"] as const;
export type Target = typeof targets[number];
export type Command = { command: string; args: string[]; env: Record<string, string> };
export class IntegrationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function targetId(value: unknown): Target {
  if (!targets.includes(value as Target)) throw new IntegrationError("Select a supported integration.");
  return value as Target;
}
export function configSnapshot() {
  const text = existsSync(paths.config) ? readFileSync(paths.config, "utf8") : "{}";
  let config: WorkTrackerConfig;
  try {
    config = JSON.parse(text);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
  } catch { throw new IntegrationError("Repair the invalid workspace config.json before changing integrations.", 409); }
  return { config, revision: createHash("sha256").update(text).digest("hex") };
}
export function configuredCommand(target: Target, config = configSnapshot().config): Command {
  const [kind, id] = target.split("/") as ["acp" | "mcp", string];
  const custom = (config[kind] as Record<string, Command> | undefined)?.[id];
  if (custom) return { command: custom.command, args: custom.args ?? [], env: custom.env ?? {} };
  if (kind === "acp") {
    const defaults = getProvider(id).command(paths.workspace);
    return { command: defaults.cmd[0]!, args: defaults.cmd.slice(1), env: {} };
  }
  const legacy = id === "linkedin" ? config.linkedinMcpCommand : undefined;
  return { command: legacy?.[0] ?? (id === "linkedin" ? "mcp-server-linkedin" : "chrome-devtools-mcp"), args: legacy?.slice(1) ?? [], env: {} };
}
/** Identifies one target's effective command, so a diagnostic stays valid until that command changes. */
export function commandFingerprint(target: Target, config = configSnapshot().config): string {
  return createHash("sha256").update(JSON.stringify(configuredCommand(target, config))).digest("hex");
}
const storedValue = "[stored value]";
const storedArgument = (index: number) => `[stored argument ${index + 1}]`;
export function integrationSettings() {
  const { config, revision } = configSnapshot();
  return { revision, entries: targets.map(target => {
    const command = configuredCommand(target, config);
    return { target, command: command.command, args: command.args.map((_, i) => storedArgument(i)), env: Object.fromEntries(Object.keys(command.env).map(key => [key, storedValue])) };
  }) };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationError("Enter a JSON object.");
  return value as Record<string, unknown>;
}
function validText(value: unknown): value is string { return typeof value === "string" && !value.includes("\0") && value.length <= 32768; }
export function validateCommand(raw: unknown, target: Target, previous: Command): Command {
  const body = object(raw);
  if (!validText(body.command) || !body.command.trim() || /[\r\n]/.test(body.command)) throw new IntegrationError("Enter an executable name or path, with arguments in the arguments field.");
  if (!Array.isArray(body.args) || body.args.length > 256 || !body.args.every(validText)) throw new IntegrationError("Arguments must be a JSON array of strings without null characters.");
  const args = body.args.map((arg: string, i: number) => {
    if (arg === storedArgument(i) && previous.args[i] !== undefined) return previous.args[i]!;
    if (/^\[stored argument /.test(arg)) throw new IntegrationError("Keep stored argument placeholders in their original positions, or replace them.");
    return arg;
  });
  if (target === "mcp/chrome" && args.some(arg => /^(--user-data-dir|--userDataDir)(=|$)/.test(arg))) throw new IntegrationError("Remove Chrome profile flags; Work Tracker manages its browser profile.");
  const env = Object.fromEntries(Object.entries(object(body.env)).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !validText(value)) throw new IntegrationError("Environment keys must be variable names and values must be strings without null characters.");
    if (value === storedValue && previous.env[key] === undefined) throw new IntegrationError("Enter a value for the new environment variable.");
    return [key, value === storedValue ? previous.env[key]! : value];
  }));
  if (env.OPENCODE_CONFIG_CONTENT) {
    try { object(JSON.parse(env.OPENCODE_CONFIG_CONTENT)); }
    catch { throw new IntegrationError("OPENCODE_CONFIG_CONTENT must be a JSON object."); }
  }
  return { command: body.command.trim(), args, env };
}
export function saveIntegration(raw: unknown) {
  const body = object(raw);
  const target = targetId(body.target);
  const snapshot = configSnapshot();
  if (body.revision !== snapshot.revision) throw new IntegrationError("Settings changed. Reload before saving your edits.", 409);
  const command = validateCommand(body, target, configuredCommand(target, snapshot.config));
  const [kind, id] = target.split("/") as ["acp" | "mcp", string];
  const config = { ...snapshot.config, [kind]: { ...snapshot.config[kind], [id]: command } };
  ensureHome();
  const temporary = `${paths.config}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" }); renameSync(temporary, paths.config); }
  finally { rmSync(temporary, { force: true }); }
  return integrationSettings();
}

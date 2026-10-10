import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OwnedStdioTransport } from "./transport.ts";
import { ensureHome, paths } from "../paths.ts";
import { mcpServers } from "./config.ts";
import { agentEnvironment } from "../cli/skills.ts";
import { VERSION } from "../version.gen.ts";

let client: Client | null = null;
let transport: OwnedStdioTransport | null = null;
let connecting: Promise<Client> | null = null;
let generation = 0;
async function connect(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;
  const current = generation;
  connecting = (async () => {
    ensureHome();
    const server = mcpServers().find(s => s.name === "linkedin")!;
    const t = new OwnedStdioTransport({ command: server.command, args: server.args, env: { ...agentEnvironment(), ...server.env }, cwd: paths.workspace });
    transport = t;
    const c = new Client({ name: "work-tracker", version: VERSION });
    c.onclose = () => { if (client === c) client = null; };
    try {
      await c.connect(t, { timeout: 15000 });
      if (generation !== current) throw new Error("MCP connection cancelled");
      client = c;
      return c;
    } catch (error) {
      await t.close().catch(() => {});
      throw new Error(`LinkedIn MCP unavailable. Run work-tracker doctor and configure a local server. ${String(error)}`);
    }
  })();
  try { return await connecting; } finally { connecting = null; }
}
export async function listTools(): Promise<string[]> {
  return (await (await connect()).listTools()).tools.map(t => t.name);
}
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await (await connect()).callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content.filter(c => c.type === "text").map(c => c.text).join("\n");
  if (result.isError) throw new Error(text || `MCP tool failed: ${name}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
export async function closeMcp(): Promise<void> {
  generation++;
  await transport?.close().catch(() => {});
  client = null;
  transport = null;
}

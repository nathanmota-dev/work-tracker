import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OwnedStdioTransport } from "../mcp/transport.ts";
import { mcpServers } from "../mcp/config.ts";
import { AcpClient } from "../acp/client.ts";
import { getProvider } from "../acp/providers.ts";
import { agentEnvironment, prepareWorkspace } from "../cli/skills.ts";
import { paths, loadConfig } from "../paths.ts";
import { db } from "../db/index.ts";
import type { Target } from "./config.ts";

export type ProbeState = "ready" | "failed" | "timeout" | "authentication_required" | "invalid_model" | "unverified" | "missing_executable";
export type Check = { stage: string; state: ProbeState; message: string };
export type Diagnostic = { target: Target; model: string; checkedAt: string; checks: Check[] };
const check = (stage: string, state: ProbeState, message: string): Check => ({ stage, state, message });
export function failureCheck(error: unknown, stage: string): Check {
  // Classify privately; never echo process output, RPC errors, paths, tokens or URLs.
  const text = error instanceof Error ? error.message : "";
  if (/(?:unknown|invalid|unsupported).{0,30}model|model.{0,30}(?:unknown|invalid|unsupported|not found)/i.test(text)) return check("model", "invalid_model", "The selected model is invalid. Choose an available model or the provider default.");
  if (/timeout|timed out/i.test(text)) return check(stage, "timeout", "The integration timed out. Check its configuration and test again.");
  if (/auth|log.?in|sign.?in|credential|unauthori[sz]ed|\b401\b|\b403\b/i.test(text)) return check("authentication", "authentication_required", "Sign in to this integration, then test again.");
  return check(stage, "failed", "The integration could not complete this check. Review its command and configuration, then test again.");
}
async function probeAcp(target: Target, model: string, timeout: number): Promise<Check[]> {
  const id = target.slice(4);
  const client = new AcpClient(id, paths.workspace, {}, model || undefined, timeout);
  try {
    prepareWorkspace();
    await client.start({ command: getProvider(id).command(paths.workspace, model || undefined), mcpServers: [] });
    const checks = [check("connection", "ready", "ACP session created. No prompt was sent.")];
    checks.push(model && !client.availableModels.includes(model)
      ? check("model", "invalid_model", "The provider did not advertise the selected model. Choose an available model or the provider default.")
      : check("model", "ready", model ? "The selected model is available." : "Using the provider default model."));
    checks.push(check("authentication", "unverified", "The session opened. Some providers require sign-in on the first request; no prompt was sent."));
    return checks;
  } finally { client.stop(); }
}
export function diagnosticUsername(): string | undefined {
  const answer = db().query("SELECT value FROM applicant_answers WHERE key = 'linkedin_url'").get() as { value: string } | undefined;
  const username = answer?.value?.match(/^https:\/\/(?:www\.)?linkedin\.com\/in\/([^/]+)\/?$/i)?.[1];
  if (username) return decodeURIComponent(username);
  return loadConfig().username;
}
async function probeMcp(target: Target, timeout: number): Promise<Check[]> {
  const server = mcpServers().find(server => target === `mcp/${server.name}`)!;
  const transport = new OwnedStdioTransport({ ...server, cwd: paths.workspace, env: { ...agentEnvironment(), ...server.env } });
  const client = new Client({ name: "work-tracker-diagnostics", version: "1.0.0" });
  let stage = "connection";
  const checks: Check[] = [];
  try {
    await client.connect(transport, { timeout });
    const { tools } = await client.listTools(undefined, { timeout });
    checks.push(check("connection", "ready", "MCP connected and tools discovered."));
    const chrome = target === "mcp/chrome";
    stage = chrome ? "browser" : "authentication";
    const tool = chrome ? "list_pages" : "get_person_profile";
    const username = chrome ? undefined : diagnosticUsername();
    if (!tools.some(t => t.name === tool) || (!chrome && !username)) {
      checks.push(check(stage, "unverified", chrome ? "Browser access could not be verified: this server does not expose list_pages." : "Set your LinkedIn username in Profile and ensure this server exposes get_person_profile to verify its separate session."));
      return checks;
    }
    const result = await client.callTool({ name: tool, arguments: chrome ? {} : { linkedin_username: username, sections: "experience" } }, undefined, { timeout });
    // Some servers report pending login in successful tool content.
    const text = JSON.stringify(result);
    if (result.isError || /(?:sign.?in|log.?in|authenticat).{0,40}(?:required|pending|progress|expired)|(?:please|must|need to).{0,20}(?:log.?in|sign.?in)/i.test(text)) {
      checks.push(failureCheck(new Error(result.isError ? text : "authentication required"), stage));
    } else {
      checks.push(check(stage, "ready", chrome ? "Chrome is reachable. Portal sign-in depends on the site; this does not verify LinkedIn authentication." : "The separate LinkedIn session answered a profile read."));
    }
    return checks;
  } catch (error) { return [...checks, failureCheck(error, stage)]; }
  finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}
export async function probeIntegration(target: Target, model = "", timeout = 15000): Promise<Check[]> {
  try { return await (target.startsWith("acp/") ? probeAcp(target, model, timeout) : probeMcp(target, timeout)); }
  catch (error) { return [failureCheck(error, "connection")]; }
}

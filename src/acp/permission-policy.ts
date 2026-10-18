import type { PermissionOption, ToolRule } from "./permission-types.ts";

export class PermissionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function safeToolName(name: string): boolean {
  return name.length <= 200 && /^[\w.:-]+$/.test(name) &&
    /(?:^|[_:.])(?:read|list|get|search|inspect|fetch|take_snapshot)(?:[_:.]|$)/i.test(name) &&
    !/submit|send|apply|click|evaluate|execute|upload|write|shell|bash/i.test(name);
}
export function toolRule(input: unknown): ToolRule {
  const value = input as Partial<ToolRule> | null;
  if (!value || !["opencode", "claude-code"].includes(String(value.provider)) || typeof value.tool !== "string" || !safeToolName(value.tool))
    throw new PermissionError("Choose an agent and an exact read-only tool name (for example linkedin_get_person_profile). Sending applications cannot be remembered.");
  return { provider: value.provider!, tool: value.tool };
}
export function sameRule(a: ToolRule, b: ToolRule): boolean { return a.provider === b.provider && a.tool === b.tool; }
export function permissionParams(input: unknown) {
  if (!input || typeof input !== "object") throw new PermissionError("Invalid ACP permission request.");
  const value = input as Record<string, unknown>;
  const call = value.toolCall as Record<string, unknown> | undefined;
  if (!call || (typeof call.title !== "string" && typeof call.toolCallId !== "string") || !Array.isArray(value.options) || !value.options.length)
    throw new PermissionError("Permission request needs tool context and options.");
  const options: PermissionOption[] = value.options.map(item => {
    if (!item || typeof item.optionId !== "string" || !item.optionId || typeof item.name !== "string" || !["allow_once", "allow_always", "reject_once", "reject_always"].includes(item.kind))
      throw new PermissionError("Invalid permission option.");
    return { optionId: item.optionId, name: item.name, kind: item.kind };
  });
  if (new Set(options.map(o => o.optionId)).size !== options.length) throw new PermissionError("Duplicate permission option.");
  // ACP titles are often prose or shell commands; those are never rule identities.
  const tool = typeof call.title === "string" && call.title.trim() ? call.title : `Tool call ${call.toolCallId}`;
  const rememberable = safeToolName(tool) && ["read", "search", "fetch"].includes(String(call.kind));
  const context = JSON.stringify({ toolCallId: call.toolCallId, kind: call.kind, input: call.rawInput, content: call.content, locations: call.locations }, null, 2).slice(0, 16000);
  return { tool, title: tool.slice(0, 1000), context, options, rememberable };
}

import { randomUUID } from "node:crypto";
import { permissionStore } from "./permission-store.ts";
import { PermissionError, permissionParams, sameRule, toolRule } from "./permission-policy.ts";
import type { PermissionAnswer, PermissionRequest, PermissionSnapshot, ToolRule } from "./permission-types.ts";

type Pending = { request: PermissionRequest; resolve: (option: string | null) => void; timer: ReturnType<typeof setTimeout> };
export class AgentPermissions {
  private pending = new Map<string, Pending>();
  private remembered: PermissionSnapshot["sessionRules"] = [];
  private execution?: PermissionSnapshot["execution"];
  constructor(private emit: (event: Record<string, unknown>) => void, private store = permissionStore, private timeoutMs = 5 * 60_000) {}

  snapshot(): PermissionSnapshot {
    return { execution: this.execution, pending: [...this.pending.values()].map(p => p.request), history: this.store.history(), rules: this.store.rules(), sessionRules: [...this.remembered] };
  }
  setExecution(execution: PermissionSnapshot["execution"]): void { this.execution = execution; this.changed(); }
  get waiting(): boolean { return this.pending.size > 0; }
  async request(input: unknown, scope: { runId: string; sessionId: string; provider: string }): Promise<string | null> {
    const data = permissionParams(input);
    const at = Date.now();
    const request: PermissionRequest = { ...data, ...scope, id: randomUUID(), createdAt: new Date(at).toISOString(), expiresAt: new Date(at + this.timeoutMs).toISOString(), status: "pending" };
    const rule = { provider: scope.provider, tool: data.tool };
    const allow = data.options.find(o => o.kind === "allow_once");
    const remembered = data.rememberable && allow && (this.remembered.some(r => r.sessionId === scope.sessionId && sameRule(r, rule)) ? "session" : this.store.rules().some(r => sameRule(r, rule)) ? "persistent" : undefined);
    if (remembered && allow) {
      this.store.save({ ...request, status: "selected", optionId: allow.optionId, remember: remembered, reason: "Remembered tool rule", decidedAt: new Date().toISOString() });
      this.emit({ type: "acp-permission-decision", request: { ...request, status: "selected", optionId: allow.optionId, remember: remembered } });
      this.changed();
      return allow.optionId;
    }
    this.store.save(request);
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(request.id, null, "Expired"), this.timeoutMs);
      this.pending.set(request.id, { request, resolve, timer });
      this.execution = { runId: scope.runId, sessionId: scope.sessionId, status: "waiting_for_permission" };
      this.emit({ type: "acp-permission", request });
      this.emit({ type: "acp-status", status: "waiting_for_permission", runId: scope.runId, sessionId: scope.sessionId });
      this.changed();
    });
  }
  answer(input: PermissionAnswer): void {
    const pending = input && this.pending.get(input.id);
    if (!pending || pending.request.runId !== input.runId || pending.request.sessionId !== input.sessionId)
      throw new PermissionError("Permission is no longer pending in this execution and session.", 409);
    if (Date.now() >= Date.parse(pending.request.expiresAt)) { this.finish(input.id, null, "Expired"); throw new PermissionError("Permission expired.", 409); }
    const remember = input.remember ?? "once";
    if (!["once", "session", "persistent"].includes(remember)) throw new PermissionError("Invalid remember choice.");
    const option = pending.request.options.find(o => o.optionId === input.optionId);
    if (input.optionId !== undefined && !option) throw new PermissionError("Select one of the requested options.");
    if (remember !== "once" && (!pending.request.rememberable || !option?.kind.startsWith("allow_"))) throw new PermissionError("Only read-only tool approvals can be remembered.");
    this.finish(input.id, option?.optionId ?? null, option ? "User decision" : "Dismissed", remember);
  }
  private finish(id: string, optionId: string | null, reason: string, remember: PermissionRequest["remember"] = "once"): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    const request: PermissionRequest = { ...pending.request, status: optionId === null ? "cancelled" : "selected", ...(optionId !== null ? { optionId } : {}), reason, remember, decidedAt: new Date().toISOString() };
    const rule = { provider: request.provider, tool: request.tool };
    // Commit history and a persistent rule together, before releasing the ACP wait.
    try { this.store.save(request, remember === "persistent" ? rule : undefined); }
    catch (error) {
      if (optionId !== null) throw error;
      this.emit({ type: "acp-log", line: `Could not record permission cancellation: ${String(error)}` });
    }
    if (remember === "session" && !this.remembered.some(r => r.sessionId === request.sessionId && sameRule(r, rule))) this.remembered.push({ ...rule, sessionId: request.sessionId });
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(optionId);
    this.emit({ type: "acp-permission-decision", request });
    if (["User decision", "Dismissed", "Expired"].includes(reason)) {
      const status = this.waiting ? "waiting_for_permission" : "running";
      this.execution = { runId: request.runId, sessionId: request.sessionId, status };
      this.emit({ type: "acp-status", status, runId: request.runId, sessionId: request.sessionId });
    }
    this.changed();
  }
  close(reason: string): void {
    for (const id of this.pending.keys()) this.finish(id, null, reason);
  }
  endSession(): void { this.close("Session ended"); this.remembered = []; }
  setRule(input: unknown, enabled: boolean, sessionId?: string): void {
    const rule: ToolRule = toolRule(input);
    if (sessionId) {
      if (enabled) throw new PermissionError("Session rules are created by an approval.");
      this.remembered = this.remembered.filter(r => r.sessionId !== sessionId || !sameRule(r, rule));
    } else this.store.setRule(rule, enabled);
    this.changed();
  }
  private changed(): void { this.emit({ type: "changed", table: "agent_permissions" }); this.emit({ type: "changed", table: "activity_log" }); }
}

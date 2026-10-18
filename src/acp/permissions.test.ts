import { beforeEach, expect, test, vi } from "vitest";
import { AgentPermissions } from "./permissions.ts";
import { permissionParams, safeToolName, toolRule } from "./permission-policy.ts";
import type { PermissionRequest, ToolRule } from "./permission-types.ts";

export const permissionFixture = (title = "linkedin_get_person_profile", kind = "fetch") => ({
  sessionId: "session", toolCall: { title, kind, rawInput: { username: "synthetic" } },
  options: [{ optionId: "reject-id", name: "Refuse", kind: "reject_once" }, { optionId: "specific-allow-id", name: "Allow once", kind: "allow_once" }],
});
const scope = { provider: "opencode", sessionId: "session", runId: "run" };
let permissions: AgentPermissions;
let events: ReturnType<typeof vi.fn<(event: Record<string, unknown>) => void>>;
let store: {
  rules: ReturnType<typeof vi.fn<() => ToolRule[]>>;
  setRule: ReturnType<typeof vi.fn<(rule: ToolRule, enabled: boolean) => void>>;
  save: ReturnType<typeof vi.fn<(request: PermissionRequest, rule?: ToolRule) => void>>;
  history: ReturnType<typeof vi.fn<() => PermissionRequest[]>>;
  recover: ReturnType<typeof vi.fn<() => void>>;
};
const pending = () => permissions.snapshot().pending[0]!;
function answer(optionId?: string, remember: "once" | "session" | "persistent" = "once") {
  const request = pending();
  permissions.answer({ id: request.id, runId: request.runId, sessionId: request.sessionId, optionId, remember });
}
beforeEach(() => {
  vi.useFakeTimers();
  store = { rules: vi.fn(() => []), setRule: vi.fn(), save: vi.fn(), history: vi.fn(() => []), recover: vi.fn() };
  events = vi.fn();
  permissions = new AgentPermissions(events, store, 1000);
});
test("permission stays pending until the exact choice, with readable context and execution identity", async () => {
  const done = vi.fn();
  const result = permissions.request(permissionFixture(), scope).then(value => { done(value); return value; });
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  expect(pending()).toMatchObject({ ...scope, status: "pending", rememberable: true, context: expect.stringContaining("synthetic") });
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "acp-status", status: "waiting_for_permission", runId: "run" }));
  answer("reject-id");
  expect(await result).toBe("reject-id");
  expect(permissions.waiting).toBe(false);
  expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: "selected", optionId: "reject-id" }), undefined);
  expect(vi.getTimerCount()).toBe(0);
});
test("invalid options, old sessions and old runs cannot authorize; a duplicate is a conflict", async () => {
  const result = permissions.request(permissionFixture(), scope);
  const req = pending();
  for (const input of [{ ...req, optionId: "invented" }, { ...req, sessionId: "old", optionId: "specific-allow-id" }, { ...req, runId: "old", optionId: "specific-allow-id" }])
    expect(() => permissions.answer(input)).toThrow();
  expect(permissions.waiting).toBe(true);
  answer("specific-allow-id");
  expect(await result).toBe("specific-allow-id");
  expect(() => permissions.answer(req)).toThrow("no longer pending");
  const next = permissions.request(permissionFixture(), { ...scope, runId: "new" });
  expect(() => permissions.answer({ ...req, optionId: "specific-allow-id" })).toThrow();
  answer();
  expect(await next).toBeNull();
});
test("remembered rules are exact, scoped to the provider and session, and revocable", async () => {
  const first = permissions.request(permissionFixture(), scope);
  answer("specific-allow-id", "session");
  await first;
  expect(await permissions.request(permissionFixture(), scope)).toBe("specific-allow-id");
  expect(permissions.snapshot().sessionRules).toEqual([{ provider: "opencode", sessionId: "session", tool: "linkedin_get_person_profile" }]);
  for (const [input, changed] of [[permissionFixture("linkedin_search_jobs"), scope], [permissionFixture(), { ...scope, provider: "claude-code" }], [permissionFixture(), { ...scope, sessionId: "another" }]] as const) {
    const result = permissions.request(input, changed);
    expect(permissions.waiting).toBe(true);
    answer(); await result;
  }
  permissions.setRule({ provider: scope.provider, tool: "linkedin_get_person_profile" }, false, scope.sessionId);
  const revoked = permissions.request(permissionFixture(), scope);
  expect(permissions.waiting).toBe(true);
  permissions.endSession();
  expect(await revoked).toBeNull();
  expect(permissions.snapshot().sessionRules).toEqual([]);
});
test("persistent allowlist authorizes only exact read-only tools and revocation asks again", async () => {
  const rule = { provider: "opencode", tool: "linkedin_get_person_profile" };
  const result = permissions.request(permissionFixture(), scope);
  answer("specific-allow-id", "persistent"); await result;
  expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ remember: "persistent" }), rule);
  store.rules.mockReturnValue([rule]);
  expect(await permissions.request(permissionFixture(), scope)).toBe("specific-allow-id");
  permissions.setRule(rule, false);
  expect(store.setRule).toHaveBeenCalledWith(rule, false);
  store.rules.mockReturnValue([]);
  const next = permissions.request(permissionFixture(), scope);
  permissions.close("Disconnected"); expect(await next).toBeNull();
  permissions.setRule(rule, true);
  expect(store.setRule).toHaveBeenLastCalledWith(rule, true);
  expect(() => permissions.setRule(rule, true, "session")).toThrow();
});
test.each(["submit_application", "browser_click", "bash", "get_and_send_application"])("%s cannot be remembered or auto-approved", async tool => {
  store.rules.mockReturnValue([{ provider: "opencode", tool }]);
  const result = permissions.request(permissionFixture(tool, "read"), scope);
  expect(pending().rememberable).toBe(false);
  expect(() => answer("specific-allow-id", "persistent")).toThrow("read-only");
  expect(() => permissions.setRule({ provider: "opencode", tool }, true)).toThrow();
  answer(); expect(await result).toBeNull();
});
test("rejects invalid remember choices and remembers neither rejections nor commands", async () => {
  const result = permissions.request(permissionFixture("get_profile", "execute"), scope);
  const req = pending();
  expect(() => permissions.answer({ ...req, remember: "bad" as "once" })).toThrow("remember choice");
  expect(() => answer("reject-id", "session")).toThrow();
  answer(); expect(await result).toBeNull();
});
test("expiration and cancellation settle all waits without selecting an option", async () => {
  const a = permissions.request(permissionFixture(), scope);
  const b = permissions.request(permissionFixture("get_jobs"), scope);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await a).toBeNull(); expect(await b).toBeNull();
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", reason: "Expired" }), undefined);
  const c = permissions.request(permissionFixture(), scope);
  const req = pending();
  vi.setSystemTime(Date.now() + 1000);
  expect(() => permissions.answer({ ...req, optionId: "specific-allow-id" })).toThrow("expired");
  expect(await c).toBeNull();
  const d = permissions.request(permissionFixture(), scope);
  permissions.close("Cancelled"); expect(await d).toBeNull();
});
test("failed persistence never releases an approval or saves a partial rule", async () => {
  const result = permissions.request(permissionFixture(), scope);
  store.save.mockImplementation(() => { throw new Error("Disk full"); });
  expect(() => answer("specific-allow-id", "persistent")).toThrow("Disk full");
  expect(permissions.waiting).toBe(true);
  permissions.close("Cancelled");
  expect(await result).toBeNull();
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "acp-log" }));
});
test("malformed ACP data never becomes an approval", () => {
  for (const input of [null, {}, { toolCall: { title: "tool" }, options: [] }, { toolCall: { title: "tool" }, options: [{}] }, { ...permissionFixture(), options: [permissionFixture().options[0], permissionFixture().options[0]] }]) expect(() => permissionParams(input)).toThrow();
  expect(() => toolRule({ provider: "unknown", tool: "get_jobs" })).toThrow();
  expect(safeToolName("read file")).toBe(false);
});
test("a partial ACP tool update still waits for a decision without remembering an unknown identity", async () => {
  const result = permissions.request({ ...permissionFixture(), toolCall: { toolCallId: "unknown-call" } }, scope);
  expect(pending()).toMatchObject({ title: "Tool call unknown-call", rememberable: false, context: expect.stringContaining("unknown-call") });
  answer("reject-id"); expect(await result).toBe("reject-id");
});

import { expect, test, vi } from "vitest";
import { handlePermissions } from "./permission-http.ts";
import { PermissionError } from "./permission-policy.ts";
import type { AgentPermissions } from "./permissions.ts";
const actions = { snapshot: vi.fn(() => ({ pending: [] })), answer: vi.fn(), setRule: vi.fn() };
const permissions = actions as unknown as AgentPermissions;
const req = (body?: unknown, method = body === undefined ? "GET" : "POST") => new Request("http://localhost", { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
test("dispatches only explicit permission actions and methods", async () => {
  expect(await (await handlePermissions("/api/acp/permissions", req(), permissions)).json()).toEqual({ pending: [] });
  expect((await handlePermissions("/api/acp/permissions/answer", req({ id: "a" }), permissions)).status).toBe(200);
  expect(actions.answer).toHaveBeenCalledWith({ id: "a" });
  await handlePermissions("/api/acp/permissions/rule", req({ provider: "opencode", tool: "get_jobs", enabled: false, sessionId: "s" }), permissions);
  expect(actions.setRule).toHaveBeenCalledWith(expect.objectContaining({ tool: "get_jobs" }), false, "s");
  expect((await handlePermissions("missing", req({}), permissions)).status).toBe(404);
  expect((await handlePermissions("missing", req(), permissions)).status).toBe(405);
  expect((await handlePermissions("missing", req())).status).toBe(503);
});
test("invalid JSON, invalid actions, stale choices and storage errors are not success", async () => {
  for (const body of ["bad", "null", { enabled: "yes" }, { enabled: true, sessionId: 1 }]) expect((await handlePermissions("/api/acp/permissions/rule", req(body), permissions)).status).toBe(400);
  actions.answer.mockImplementationOnce(() => { throw new PermissionError("Already answered", 409); }).mockImplementationOnce(() => { throw Error("Disk full"); });
  expect((await handlePermissions("/api/acp/permissions/answer", req({}), permissions)).status).toBe(409);
  expect((await handlePermissions("/api/acp/permissions/answer", req({}), permissions)).status).toBe(500);
});

import { beforeEach, expect, test, vi } from "vitest";
import { handleIntegrations, integrationStatus, integrationTesting, resetDiagnostics } from "./http.ts";
const fake = vi.hoisted(() => ({ executable: vi.fn(), probe: vi.fn(), save: vi.fn(), snapshot: vi.fn(), close: vi.fn(), verified: vi.fn() }));
vi.mock("../onboarding/store.ts", () => ({ recordVerification: fake.verified }));
vi.mock("../cli/doctor.ts", () => ({ executableExists: fake.executable }));
vi.mock("../cli/skills.ts", () => ({ agentEnvironment: () => ({ PATH: "/fixture/bin" }) }));
vi.mock("../preparation/latex.ts", () => ({ dependencyStatus: async () => [{ command: "latexmk", available: true }] }));
vi.mock("../preparation/sources.ts", () => ({ sourcesConfig: () => ({ engine: "pdflatex" }) }));
vi.mock("../mcp/linkedin.ts", () => ({ closeMcp: () => fake.close() }));
vi.mock("./probe.ts", () => ({ probeIntegration: fake.probe }));
vi.mock("./config.ts", async original => ({ ...await original<typeof import("./config.ts")>(), configSnapshot: fake.snapshot, configuredCommand: () => ({ command: "fixture", args: [], env: {} }), commandFingerprint: () => "f".repeat(64), integrationSettings: () => ({ revision: "revision", entries: [] }), saveIntegration: fake.save }));
const broadcast = vi.fn();
const call = (path = "/api/integrations", body?: unknown, busy = false, method = body === undefined ? "GET" : "POST") => handleIntegrations(path, new Request("http://fixture" + path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) }), busy, broadcast);
beforeEach(() => { vi.clearAllMocks(); resetDiagnostics(); fake.snapshot.mockReturnValue({ revision: "revision", config: {} }); fake.executable.mockReturnValue(true); fake.probe.mockResolvedValue([{ stage: "connection", state: "ready", message: "Ready" }]); fake.save.mockReturnValue({ revision: "new", entries: [] }); fake.close.mockResolvedValue(undefined); });
test("reads settings/status, saves atomically and invalidates cached diagnostics", async () => {
  expect(await (await call()).json()).toEqual({ revision: "revision", entries: [] });
  expect(await (await call("/api/integrations/status")).json()).toMatchObject({ backend: true, dependencies: [{ available: true }] });
  await call("/api/integrations/test", { target: "acp/opencode" });
  expect((await integrationStatus()).entries[0]?.diagnostic?.checks[0]?.state).toBe("ready");
  expect(fake.verified).toHaveBeenCalledWith("acp/opencode", expect.stringMatching(/^[0-9a-f]{64}$/), true);
  expect((await call("/api/integrations", { command: "new" })).status).toBe(200);
  expect(fake.close).toHaveBeenCalledOnce(); expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "integrations" });
  expect((await integrationStatus()).entries[0]?.diagnostic).toBeUndefined();
});
test("missing commands never launch a process; model changes and revisions stay independent", async () => {
  fake.executable.mockReturnValue(false);
  const result = await (await call("/api/integrations/test", { target: "acp/opencode", model: "one" })).json();
  expect(result).toMatchObject({ model: "one", checks: [{ state: "missing_executable" }] });
  expect(fake.probe).not.toHaveBeenCalled();
  expect(fake.verified).toHaveBeenCalledWith("acp/opencode", expect.any(String), false);
  fake.snapshot.mockReturnValue({ revision: "other", config: {} });
  expect((await integrationStatus()).entries[0]?.diagnostic).toBeUndefined();
});
test("rejects malformed requests, unknown paths and concurrent operations", async () => {
  expect((await call("/api/integrations", {}, true)).status).toBe(409);
  expect((await call("/api/integrations", undefined, false, "DELETE")).status).toBe(405);
  expect((await call("/api/integrations/unknown", {})).status).toBe(404);
  expect((await call("/api/integrations/test", null)).status).toBe(400);
  expect((await call("/api/integrations/test", { target: "acp/opencode", model: 3 })).status).toBe(400);
  expect((await call("/api/integrations/test", { target: "acp/opencode", model: "a\n" })).status).toBe(400);
  let finish!: (value: unknown) => void;
  fake.probe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = call("/api/integrations/test", { target: "mcp/chrome" });
  await vi.waitFor(() => expect(integrationTesting()).toBe(true));
  expect((await call("/api/integrations", {})).status).toBe(409);
  finish([]); await first; expect(integrationTesting()).toBe(false);
});
test("I/O failures do not echo secrets or report successful saves", async () => {
  fake.save.mockImplementation(() => { throw new Error("private-token"); });
  const response = await call("/api/integrations", {});
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("private-token"); expect(broadcast).not.toHaveBeenCalled();
});
test("simultaneous requests and an execution starting during body parsing cannot race the diagnostic", async () => {
  let finish!: (value: unknown) => void;
  fake.probe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = call("/api/integrations/test", { target: "mcp/chrome" });
  const second = call("/api/integrations/test", { target: "mcp/linkedin" });
  expect((await second).status).toBe(409);
  finish([]); await first;
  const request = new Request("http://fixture/api/integrations/test", { method: "POST", body: JSON.stringify({ target: "mcp/chrome" }) });
  expect((await handleIntegrations("/api/integrations/test", request, () => true, broadcast)).status).toBe(409);
});
test("malformed JSON returns a validation error without changing configuration", async () => {
  const request = new Request("http://fixture/api/integrations/test", { method: "POST", body: "{" });
  const response = await handleIntegrations("/api/integrations/test", request, false, broadcast);
  expect(response.status).toBe(400); expect(fake.save).not.toHaveBeenCalled();
});

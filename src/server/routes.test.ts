import { beforeEach, expect, test, vi } from "vitest";
import { routeApi } from "./routes.ts";
import { handleApplicationBoard } from "../applications/http.ts";
import { handleJobAction } from "../jobs/http.ts";
import { handlePreparation } from "../preparation/http.ts";
import { PreparationService } from "../preparation/service.ts";
import { handleWorkspaceBackup } from "../backup/http.ts";
import { chromeLoginOpening } from "../mcp/chrome.ts";
import { integrationTesting } from "../integrations/http.ts";
import { handleBatches } from "../preparation/batch-http.ts";
import { PreparationQueue } from "../preparation/batch-queue.ts";

vi.mock("../applications/http.ts", () => ({ handleApplicationBoard: vi.fn() }));
vi.mock("../jobs/http.ts", () => ({ handleJobAction: vi.fn() }));
vi.mock("../preparation/http.ts", () => ({ handlePreparation: vi.fn() }));
vi.mock("../backup/http.ts", () => ({ handleWorkspaceBackup: vi.fn() }));
vi.mock("../mcp/chrome.ts", () => ({ chromeLoginOpening: vi.fn(() => false), openChromeLogin: vi.fn() }));
vi.mock("../integrations/http.ts", async (original) => ({ ...(await original<typeof import("../integrations/http.ts")>()), integrationTesting: vi.fn(() => false) }));
vi.mock("../preparation/service.ts", () => ({ PreparationService: vi.fn() }));
vi.mock("../preparation/batch-http.ts", () => ({ handleBatches: vi.fn() }));
vi.mock("../preparation/batch-queue.ts", () => ({ PreparationQueue: vi.fn() }));
vi.mock("./queries.ts", () => ({ queries: {} }));

const acp = { run: vi.fn(), cancel: vi.fn() };
const broadcast = vi.fn();
const ok = new Response("ok");
beforeEach(() => {
  vi.mocked(handleApplicationBoard).mockResolvedValue(ok);
  vi.mocked(handleJobAction).mockResolvedValue(ok);
  vi.mocked(handlePreparation).mockResolvedValue(ok);
});

test("delegates feature routes to their handlers", async () => {
  const req = new Request("http://localhost/api/jobs/archive", { method: "POST" });
  expect(await routeApi("/api/jobs/archive", req, { acp, broadcast })).toBe(ok);
  expect(handleJobAction).toHaveBeenCalledWith("/api/jobs/archive", req, broadcast);
  expect(await routeApi("/api/application-board", req, { acp, broadcast })).toBe(ok);
  expect(await routeApi("/api/application-board/move", req, { acp, broadcast })).toBe(ok);
  expect(handleApplicationBoard).toHaveBeenCalledTimes(2);
});

test("creates the preparation service once and reuses it", async () => {
  const context = { acp, broadcast };
  const req = new Request("http://localhost/api/resume-sources");
  await routeApi("/api/resume-sources", req, context);
  await routeApi("/api/application-preparation/details", req, context);
  expect(PreparationService).toHaveBeenCalledOnce();
  expect(PreparationService).toHaveBeenCalledWith(acp, broadcast);
  expect(handlePreparation).toHaveBeenCalledTimes(2);
});

test("only accepts mutations over POST", async () => {
  const response = await routeApi("/api/acp/cancel", new Request("http://localhost/api/acp/cancel"), { acp, broadcast });
  expect(response.status).toBe(404);
  expect(acp.cancel).not.toHaveBeenCalled();
});

test("routes workspace backups with a busy check covering agents, preparations, diagnostics and sign-in", async () => {
  vi.mocked(handleWorkspaceBackup).mockResolvedValue(ok);
  const req = new Request("http://localhost/api/workspace-backup/create", { method: "POST" });
  const context: Parameters<typeof routeApi>[2] = { acp: { ...acp, isRunning: false }, broadcast };
  expect(await routeApi("/api/workspace-backup/create", req, context)).toBe(ok);
  const { busy, broadcast: notify } = vi.mocked(handleWorkspaceBackup).mock.calls[0]![2];
  expect(notify).toBe(broadcast);
  expect(busy()).toBe(false);
  vi.mocked(chromeLoginOpening).mockReturnValueOnce(true);
  expect(busy()).toBe(true);
  vi.mocked(integrationTesting).mockReturnValueOnce(true);
  expect(busy()).toBe(true);
  context.preparation = { isBusy: true } as PreparationService;
  expect(busy()).toBe(true);
  context.acp = { ...acp, isRunning: true };
  expect(busy()).toBe(true);
});

test.each(["portal-filler", "work-tracker-portal-filler"])("rejects unmanaged %s runs that bypass document approval", async skill => {
  const req = new Request("http://localhost/api/acp/run", { method: "POST", body: JSON.stringify({ skill }) });
  const response = await routeApi("/api/acp/run", req, { acp, broadcast });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("Use Apply") });
  expect(acp.run).not.toHaveBeenCalled();
});

test("creates one batch queue on the shared preparation service, waiting while the agent is in use", async () => {
  vi.mocked(handleBatches).mockResolvedValue(ok);
  const context: Parameters<typeof routeApi>[2] = { acp: { ...acp, isRunning: false }, broadcast };
  const req = new Request("http://localhost/api/preparation-batches");
  expect(await routeApi("/api/preparation-batches", req, context)).toBe(ok);
  expect(await routeApi("/api/preparation-batches/pause", req, context)).toBe(ok);
  expect(PreparationQueue).toHaveBeenCalledOnce();
  expect(handleBatches).toHaveBeenCalledWith("/api/preparation-batches/pause", req, context.queue);
  const [service, agentBusy, notify, pollMs] = vi.mocked(PreparationQueue).mock.calls[0]!;
  expect([service, notify, pollMs]).toEqual([context.preparation, broadcast, 0]);
  expect(agentBusy()).toBe(false);
  vi.mocked(chromeLoginOpening).mockReturnValueOnce(true);
  expect(agentBusy()).toBe(true);
  vi.mocked(integrationTesting).mockReturnValueOnce(true);
  expect(agentBusy()).toBe(true);
  context.acp = { ...acp, isRunning: true };
  expect(agentBusy()).toBe(true);
});

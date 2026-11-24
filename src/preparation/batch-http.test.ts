import { beforeEach, expect, test, vi } from "vitest";
import { handleBatches } from "./batch-http.ts";
import { PreparationError } from "./sources.ts";
import type { PreparationQueue } from "./batch-queue.ts";
import { ensureProfileImported } from "../profile/import.ts";
vi.mock("./sources.ts", async (original) => ({ ...(await original<typeof import("./sources.ts")>()), sourcesConfig: vi.fn(() => ({ profileDir: "/profile" })) }));
vi.mock("../profile/import.ts", () => ({ ensureProfileImported: vi.fn() }));

const queue = { state: vi.fn(), preview: vi.fn(), create: vi.fn(), add: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), retry: vi.fn(), adjust: vi.fn() };
const call = (path: string, body?: string, method = body === undefined ? "GET" : "POST") =>
  handleBatches(`/api/preparation-batches${path}`, new Request("http://local", { method, ...(body === undefined ? {} : { body }) }), queue as unknown as PreparationQueue);
beforeEach(() => { for (const fn of Object.values(queue)) fn.mockReset().mockReturnValue({ id: "batch" }); });

test("reports the queue and dispatches each operation with its JSON body", async () => {
  const state = await call("");
  expect([state.status, await state.json()]).toEqual([200, { id: "batch" }]);
  expect((await call("/review/batch%201")).status).toBe(200);
  expect(queue.state).toHaveBeenLastCalledWith("batch 1");
  expect((await call("/create", '{"provider":"agent"}')).status).toBe(201);
  expect(queue.create).toHaveBeenCalledWith({ provider: "agent" });
  expect(ensureProfileImported).toHaveBeenCalledWith("/profile");
  for (const operation of ["preview", "add", "pause", "resume", "cancel", "retry", "adjust"] as const) {
    const response = await call(`/${operation}`, '{"batchId":"batch"}');
    expect([response.status, await response.json()]).toEqual([200, { id: "batch" }]);
    expect(queue[operation]).toHaveBeenCalledWith({ batchId: "batch" });
  }
});

test("rejects unknown paths, other methods, invalid bodies and maps errors", async () => {
  expect((await call("/unknown", "{}")).status).toBe(404);
  expect((await call("/create", undefined, "GET")).status).toBe(405);
  const invalid = await call("/create", "[]");
  expect([invalid.status, await invalid.json()]).toEqual([400, { error: "Expected a JSON object." }]);
  queue.retry.mockImplementation(() => { throw new PreparationError("No failed items to retry.", 409); });
  expect((await call("/retry", "{}")).status).toBe(409);
  queue.cancel.mockRejectedValue("unexpected");
  const failed = await call("/cancel", "{}");
  expect([failed.status, await failed.json()]).toEqual([500, { error: "unexpected" }]);
});

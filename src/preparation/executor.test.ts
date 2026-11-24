import { beforeEach, expect, test, vi } from "vitest";
import { deferred } from "../test/doubles.ts";
import { ExecutionSlot } from "./executor.ts";

const acp = { run: vi.fn(), cancel: vi.fn(), isRunning: false };
let slot: ExecutionSlot;
beforeEach(() => { acp.isRunning = false; acp.run.mockReset(); slot = new ExecutionSlot(acp); });

test("one execution at a time, whoever started it, and Launch runs count as busy", async () => {
  const work = deferred<void>();
  const fail = vi.fn();
  const done = vi.fn();
  slot.start("variant-1", "variant", () => work.promise, fail, done);
  expect(slot.isBusy).toBe(true);
  expect(slot.activeId).toBe("variant-1");
  expect(slot.activeFor("variant")).toBe("variant-1");
  expect(slot.activeFor("preparation")).toBeUndefined();
  expect(() => slot.assertIdle()).toThrow(expect.objectContaining({ status: 409, message: "Finish or cancel the active execution first." }));
  work.resolve();
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(fail).not.toHaveBeenCalled();
  expect(slot.isBusy).toBe(false);
  acp.isRunning = true;
  expect(() => slot.assertIdle()).toThrow("active execution");
});

test("a failure reports whether the execution was cancelled", async () => {
  const fail = vi.fn();
  slot.start("r", "preparation", async () => { throw new Error("broken"); }, fail, vi.fn());
  await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(new Error("broken"), false));
  slot.start("r", "preparation", signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")))), fail, vi.fn());
  await slot.cancel();
  expect(acp.cancel).toHaveBeenCalled();
  expect(fail).toHaveBeenLastCalledWith(new Error("stopped"), true);
});

test("hold occupies the slot while its result is awaited", async () => {
  const work = deferred<string>();
  const result = slot.hold("preview", "preparation", () => work.promise);
  expect(slot.activeFor("preparation")).toBe("preview");
  work.resolve("pdf");
  await expect(result).resolves.toBe("pdf");
  expect(slot.isBusy).toBe(false);
  await expect(slot.hold("preview", "preparation", async () => { throw new Error("no"); })).rejects.toThrow("no");
  expect(slot.isBusy).toBe(false);
  await slot.close();
});

test("runAgent passes the request through and maps the agent outcome", async () => {
  const signal = new AbortController().signal;
  acp.run.mockResolvedValueOnce({ status: "completed" });
  await expect(slot.runAgent("agent", null, "resume-tailor", { runId: "r" }, signal)).resolves.toBe(true);
  expect(acp.run).toHaveBeenCalledWith("agent", "resume-tailor", { runId: "r" }, undefined);
  acp.run.mockResolvedValueOnce({ status: "waiting_for_sign_in" });
  await expect(slot.runAgent("agent", "model", "resume-tailor", {}, signal)).resolves.toBe(false);
  expect(acp.run).toHaveBeenLastCalledWith("agent", "resume-tailor", {}, "model");
  acp.run.mockResolvedValueOnce({ status: "error", message: "Agent crashed" });
  await expect(slot.runAgent("agent", null, "s", {}, signal)).rejects.toThrow("Agent crashed");
  acp.run.mockResolvedValueOnce({ status: "error" });
  await expect(slot.runAgent("agent", null, "s", {}, signal)).rejects.toThrow("Agent execution failed.");
  acp.run.mockResolvedValueOnce({ status: "cancelled" });
  await expect(slot.runAgent("agent", null, "s", {}, signal)).rejects.toThrow("Cancelled");
  const aborted = new AbortController();
  aborted.abort();
  acp.run.mockResolvedValueOnce({ status: "completed" });
  await expect(slot.runAgent("agent", null, "s", {}, aborted.signal)).rejects.toThrow("Cancelled");
});

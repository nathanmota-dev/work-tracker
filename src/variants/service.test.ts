import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { deferred } from "../test/doubles.ts";
import { snapshotSources, type SourcesSnapshot } from "../preparation/sources.ts";
import { ExecutionSlot } from "../preparation/executor.ts";
import { generateVariant, type GenerationHooks } from "./generate.ts";
import { updateVariant } from "./store.ts";
import { currentSourceVersion, VariantService } from "./service.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));
vi.mock("../preparation/sources.ts", async original => ({ ...(await original<typeof import("../preparation/sources.ts")>()), snapshotSources: vi.fn() }));
vi.mock("./generate.ts", () => ({ generateVariant: vi.fn() }));

let d: Database;
let listener: (event: Record<string, unknown>) => void;
const acp = { run: vi.fn(), cancel: vi.fn(), isRunning: false, subscribe: vi.fn((fn: typeof listener) => { listener = fn; return () => {}; }) };
const broadcast = vi.fn();
const snapshot = { version: "v1" } as SourcesSnapshot;
const input = { name: "Back-End · C#", role: "backend", stacks: ["C#"], provider: "opencode" };
let slot: ExecutionSlot;
let service: VariantService;
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  vi.mocked(snapshotSources).mockReturnValue(snapshot);
  acp.isRunning = false;
  slot = new ExecutionSlot(acp);
  service = new VariantService(acp, broadcast, slot);
});
const idle = () => vi.waitFor(() => expect(slot.isBusy).toBe(false));

test("generates in the shared slot, records agent events and reports the source version", async () => {
  const work = deferred<boolean>();
  vi.mocked(generateVariant).mockImplementation(async (id, _snapshot, _signal, hooks: GenerationHooks) => {
    hooks.phase("tailoring");
    listener({ type: "acp-update", runId: id });
    listener({ type: "acp-update", runId: "other" });
    return work.promise;
  });
  const variant = service.generate(input);
  expect(variant).toMatchObject({ status: "generating", origin: "generated", provider: "opencode" });
  expect(generateVariant).toHaveBeenCalledWith(variant.id, snapshot, expect.any(AbortSignal), expect.any(Object));
  expect(() => service.generate(input)).toThrow("active execution");
  expect(slot.activeFor("variant")).toBe(variant.id);
  expect(service.get(variant.id)).toMatchObject({ phase: "tailoring", events: [{ type: "acp-update", runId: variant.id }] });
  work.resolve(true);
  await idle();
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "activity_log" });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "resume_variants", variantId: variant.id });
  expect(currentSourceVersion()).toBe("v1");
  vi.mocked(snapshotSources).mockImplementationOnce(() => { throw new Error("No sources"); });
  expect(currentSourceVersion()).toBeNull();
});

test("the agent call runs the resume-tailor skill and records a sign-in wait", async () => {
  vi.mocked(generateVariant).mockImplementation((_id, _snapshot, _signal, hooks) => hooks.agent("/m.json", "fix"));
  acp.run.mockResolvedValueOnce({ status: "waiting_for_sign_in" });
  const variant = service.generate({ ...input, model: "large" });
  await idle();
  expect(acp.run).toHaveBeenCalledWith("opencode", "resume-tailor", { runId: variant.id, manifestPath: "/m.json", extra: "fix" }, "large");
  expect(service.get(variant.id).status).toBe("waiting_for_sign_in");
  await service.cancel({ id: variant.id });
  expect(acp.cancel).toHaveBeenCalled();
  expect(service.get(variant.id)).toMatchObject({ status: "cancelled", error: null });
  await expect(service.cancel({ id: variant.id })).rejects.toThrow("not active");
});

test("a failure is recorded and a cancellation leaves no PDF", async () => {
  vi.mocked(generateVariant).mockRejectedValueOnce(new Error("Compilation failed"));
  const failed = service.generate(input);
  await idle();
  expect(service.get(failed.id)).toMatchObject({ status: "failed", error: "Compilation failed", pdf: null });
  vi.mocked(generateVariant).mockImplementationOnce((_id, _snapshot, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Cancelled")))));
  const held = service.generate(input);
  await service.cancel({ id: held.id });
  expect(service.get(held.id)).toMatchObject({ status: "cancelled", error: null, pdf: null });
});

test("regenerates generated variants only, with the stored agent unless another is chosen", async () => {
  vi.mocked(generateVariant).mockResolvedValue(true);
  const variant = service.generate(input);
  await idle();
  updateVariant(variant.id, { status: "failed", error: "old", events_json: '[{"type":"old"}]' });
  expect(service.regenerate({ id: variant.id })).toMatchObject({ status: "generating", error: null, events: [], provider: "opencode" });
  await idle();
  service.regenerate({ id: variant.id, provider: "claude-code", model: "" });
  await idle();
  expect(service.get(variant.id)).toMatchObject({ provider: "claude-code", model: null });
  d.exec(`UPDATE resume_variants SET origin = 'imported' WHERE id = '${variant.id}'`);
  expect(() => service.regenerate({ id: variant.id })).toThrow("cannot be regenerated");
  d.exec(`UPDATE resume_variants SET origin = 'generated', provider = NULL, status = 'failed' WHERE id = '${variant.id}'`);
  expect(() => service.regenerate({ id: variant.id })).toThrow("Select an agent.");
  service.archive({ id: variant.id });
  expect(() => service.regenerate({ id: variant.id })).toThrow("Restore this saved resume");
});

test("edits, archives and lists variants; a restart interrupts generations", async () => {
  vi.mocked(generateVariant).mockResolvedValue(true);
  const variant = service.generate(input);
  await idle();
  expect(service.update({ id: variant.id, name: "Renamed", role: "fullstack", stacks: "C#, React" })).toMatchObject({ name: "Renamed", role: "fullstack", stacks: ["C#", "React"] });
  updateVariant(variant.id, { status: "generating" });
  expect(() => service.archive({ id: variant.id })).toThrow("Cancel this generation");
  new VariantService(acp, broadcast, slot).close();
  expect(service.get(variant.id).status).toBe("interrupted");
  expect(service.archive({ id: variant.id }).archivedAt).toBeTruthy();
  expect(service.list()).toEqual([]);
  expect(service.list({ includeArchived: true })).toHaveLength(1);
  service.close();
});

test("Apply, the batch queue and variants share one execution slot", async () => {
  const { PreparationService } = await import("../preparation/service.ts");
  const preparation = new PreparationService(acp, broadcast, slot);
  const work = deferred<boolean>();
  vi.mocked(generateVariant).mockReturnValueOnce(work.promise);
  service.generate(input);
  expect(preparation.isBusy).toBe(true);
  expect(() => preparation.generate({ jobId: 1, provider: "opencode" })).toThrow(expect.objectContaining({ status: 409 }));
  await expect(preparation.cancel()).rejects.toThrow("not active");
  work.resolve(true);
  await idle();
  const held = deferred<void>();
  slot.start("run", "preparation", () => held.promise, vi.fn(), vi.fn());
  expect(() => service.generate(input)).toThrow(expect.objectContaining({ status: 409 }));
  held.resolve();
  await idle();
});

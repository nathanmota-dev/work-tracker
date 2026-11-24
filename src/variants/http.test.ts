import { beforeEach, expect, test, vi } from "vitest";
import { ensureProfileImported } from "../profile/import.ts";
import { PreparationError } from "../preparation/sources.ts";
import { importVariantPdf } from "./import.ts";
import { handleVariants } from "./http.ts";
import type { VariantService } from "./service.ts";

vi.mock("../profile/import.ts", () => ({ ensureProfileImported: vi.fn() }));
vi.mock("../preparation/sources.ts", async original => ({ ...(await original<typeof import("../preparation/sources.ts")>()), sourcesConfig: vi.fn(() => ({ profileDir: "/profile" })) }));
vi.mock("./import.ts", () => ({ importVariantPdf: vi.fn() }));

const service = { list: vi.fn(), get: vi.fn(), generate: vi.fn(), regenerate: vi.fn(), update: vi.fn(), archive: vi.fn(), cancel: vi.fn() };
const broadcast = vi.fn();
const call = (path: string, body = '{"id":"v"}', method = "POST", query = "") =>
  handleVariants(`/api/${path}`, new Request(`http://local/api/${path}${query}`, { method, ...(method === "POST" ? { body } : {}) }), service as unknown as VariantService, broadcast);
beforeEach(() => { for (const fn of Object.values(service)) fn.mockReset().mockReturnValue({ id: "v" }); });

test("lists variants, with archived ones on request", async () => {
  expect(await (await call("resume-variants", "", "GET")).json()).toEqual({ id: "v" });
  expect(service.list).toHaveBeenLastCalledWith({ includeArchived: false });
  await call("resume-variants", "", "GET", "?archived=true");
  expect(service.list).toHaveBeenLastCalledWith({ includeArchived: true });
});

test.each([
  ["resume-variants/generate", "generate", 202],
  ["resume-variants/regenerate", "regenerate", 202],
  ["resume-variants/update", "update", 200],
  ["resume-variants/archive", "archive", 200],
  ["resume-variants/cancel", "cancel", 200],
] as const)("dispatches %s", async (path, method, status) => {
  expect((await call(path)).status).toBe(status);
  expect(service[method]).toHaveBeenCalledWith({ id: "v" });
  expect(vi.mocked(ensureProfileImported).mock.calls).toEqual(["generate", "regenerate"].includes(method) ? [["/profile"]] : []);
});

test("imports a PDF and announces the new variant", async () => {
  vi.mocked(importVariantPdf).mockResolvedValue("new");
  const response = await call("resume-variants/import", '{"path":"/a.pdf"}');
  expect(response.status).toBe(201);
  expect(importVariantPdf).toHaveBeenCalledWith({ path: "/a.pdf" });
  expect(service.get).toHaveBeenCalledWith("new");
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "resume_variants", variantId: "new" });
});

test("reports errors like the other preparation routes", async () => {
  expect((await call("resume-variants/missing")).status).toBe(404);
  expect((await call("resume-variants/generate", "", "GET")).status).toBe(405);
  expect((await call("resume-variants/generate", "[]")).status).toBe(400);
  service.archive.mockImplementation(() => { throw new PreparationError("Busy", 409); });
  const response = await call("resume-variants/archive");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Busy" });
});

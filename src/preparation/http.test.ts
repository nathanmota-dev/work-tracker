import { beforeEach, expect, test, vi } from "vitest";
import { handlePreparation } from "./http.ts";
import { PreparationError } from "./sources.ts";
import { writeBaseResume } from "../resume/base.ts";
import { pdfBytes } from "./store.ts";
import { ensureProfileImported } from "../profile/import.ts";
import type { PreparationService } from "./service.ts";
vi.mock("./sources.ts", async (original) => ({
  ...(await original<typeof import("./sources.ts")>()),
  sourcesConfig: vi.fn(() => ({ profileDir: "/profile" })),
}));
vi.mock("../resume/base.ts", () => ({ BASE_RESUME_FILE: "resume.tex", writeBaseResume: vi.fn() }));
vi.mock("./store.ts", () => ({ pdfBytes: vi.fn() }));
vi.mock("../profile/import.ts", () => ({ ensureProfileImported: vi.fn() }));
const service = {
  isBusy: false,
  sourcesState: vi.fn(),
  preview: vi.fn(),
  details: vi.fn(),
  description: vi.fn(),
  generate: vi.fn(),
  fill: vi.fn(),
  approve: vi.fn(),
  retry: vi.fn(),
  submitted: vi.fn(),
  useVariant: vi.fn(),
  useBase: vi.fn(),
  cancel: vi.fn(),
};
const call = (path: string, body = "{}", method = "POST") =>
  handlePreparation(
    `/api/${path}`,
    new Request("http://local", {
      method,
      ...(method === "POST" ? { body } : {}),
    }),
    service as unknown as PreparationService,
  );
beforeEach(() => {
  service.isBusy = false;
  for (const fn of Object.values(service))
    if (typeof fn === "function") fn.mockReset().mockReturnValue({ ok: true });
});
test.each([
  ["resume-sources/preview", "preview", 200],
  ["application-preparation/details", "details", 200],
  ["application-preparation/description", "description", 200],
  ["application-preparation/generate", "generate", 202],
  ["application-preparation/approve", "approve", 200],
  ["application-preparation/fill", "fill", 202],
  ["application-preparation/retry", "retry", 202],
  ["application-preparation/submitted", "submitted", 200],
  ["application-preparation/use-variant", "useVariant", 201],
  ["application-preparation/use-base", "useBase", 201],
] as const)("dispatches %s", async (path, method, status) => {
  expect((await call(path, '{"jobId":1}')).status).toBe(status);
  expect(service[method]).toHaveBeenCalledOnce();
  if (!["preview"].includes(method))
    expect(service[method]).toHaveBeenCalledWith({ jobId: 1 });
  // Generation reads the profile folder's PDFs first; other operations never import.
  expect(vi.mocked(ensureProfileImported).mock.calls).toEqual(["generate", "retry"].includes(method) ? [["/profile"]] : []);
});
test("reads the sources and the base resume's generated LaTeX; nothing saves them", async () => {
  expect((await call("resume-sources", "", "GET")).status).toBe(200);
  vi.mocked(writeBaseResume).mockReturnValue("\\documentclass{article}");
  expect(await (await call("resume-sources/latex", "", "GET")).json()).toEqual({ file: "resume.tex", text: "\\documentclass{article}" });
  vi.mocked(writeBaseResume).mockImplementation(() => { throw new PreparationError("Upload your resume data.", 409); });
  const missing = await call("resume-sources/latex", "", "GET");
  expect([missing.status, await missing.json()]).toEqual([409, { error: "Upload your resume data." }]);
  expect((await call("resume-sources", '{"engine":"pdflatex"}')).status).toBe(404);
});
test.each(["{", "null", "[]", '"string"'])(
  "rejects invalid object body %s",
  async (body) => {
    expect((await call("application-preparation/generate", body)).status).toBe(
      400,
    );
    expect(service.generate).not.toHaveBeenCalled();
  },
);
test("handles cancellation IDs, PDF bytes and response headers", async () => {
  await call("application-preparation/cancel");
  expect(service.cancel).toHaveBeenLastCalledWith(undefined);
  await call("application-preparation/cancel", '{"runId":"r"}');
  expect(service.cancel).toHaveBeenLastCalledWith("r");
  vi.mocked(pdfBytes).mockReturnValue(Buffer.from("%PDF-fixture"));
  const response = await call(
    "application-preparation/pdf",
    '{"artifactId":"p"}',
  );
  expect(await response.text()).toBe("%PDF-fixture");
  expect(pdfBytes).toHaveBeenCalledWith("p");
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("preserves domain errors, reports unexpected failures and rejects unknown routes/methods", async () => {
  expect((await call("missing")).status).toBe(404);
  expect(
    (await call("application-preparation/details", "", "GET")).status,
  ).toBe(405);
  service.details.mockImplementation(() => {
    throw new PreparationError("missing", 404);
  });
  expect((await call("application-preparation/details")).status).toBe(404);
  service.details.mockImplementation(() => {
    throw new Error("broken");
  });
  const response = await call("application-preparation/details");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "broken" });
});

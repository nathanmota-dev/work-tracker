import { beforeEach, expect, test, vi } from "vitest";
import { handleCompanyResearch } from "./http.ts";
import { getCompanyResearch, invalidateCompanyResearch } from "./store.ts";

vi.mock("./store.ts", async (original) => ({
  ...(await original<typeof import("./store.ts")>()),
  getCompanyResearch: vi.fn(),
  invalidateCompanyResearch: vi.fn(),
}));

const broadcast = vi.fn();
beforeEach(() => {
  vi.mocked(getCompanyResearch).mockReset().mockReturnValue(null);
  vi.mocked(invalidateCompanyResearch).mockReset().mockReturnValue(true);
});
const call = (path: string, init?: RequestInit) => handleCompanyResearch(path.split("?")[0]!, new Request(`http://localhost${path}`, init), broadcast);
const post = (body: unknown) => call("/api/company-research/invalidate", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("reads the cached research of a company, stale or not", async () => {
  vi.mocked(getCompanyResearch).mockReturnValueOnce({ entry: null, fresh: false, ageDays: 40 });
  const response = await call("/api/company-research?company=Acme%20Corp");
  expect(await response.json()).toMatchObject({ company_key: "acme-corp", found: true, fresh: false, age_days: 40 });
  expect(getCompanyResearch).toHaveBeenCalledWith("Acme Corp", { allowStale: true });
  expect(await (await call("/api/company-research?company=Globex")).json()).toMatchObject({ found: false, entry: null });
});

test.each(["/api/company-research", "/api/company-research?company=%20"])("rejects a read without company: %s", async (path) => {
  const response = await call(path);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "company is required" });
});

test("invalidates a company and broadcasts only when something was removed", async () => {
  expect(await (await post({ company: "Acme Corp" })).json()).toEqual({ removed: true });
  expect(invalidateCompanyResearch).toHaveBeenCalledWith("Acme Corp");
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "company_research" });
  broadcast.mockClear();
  vi.mocked(invalidateCompanyResearch).mockReturnValueOnce(false);
  expect(await (await post({ company: "Acme Corp" })).json()).toEqual({ removed: false });
  expect(broadcast).not.toHaveBeenCalled();
});

test.each([{}, { company: 4 }, "not json"])("rejects an invalidation without company: %j", async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(invalidateCompanyResearch).not.toHaveBeenCalled();
});

test("rethrows unexpected failures and answers 404 for other routes", async () => {
  vi.mocked(getCompanyResearch).mockImplementationOnce(() => { throw new Error("disk"); });
  await expect(call("/api/company-research?company=Acme")).rejects.toThrow("disk");
  expect((await call("/api/company-research", { method: "DELETE" })).status).toBe(404);
  expect((await call("/api/company-research/invalidate")).status).toBe(404);
  expect((await call("/api/company-research/other", { method: "POST", body: "{}" })).status).toBe(404);
});

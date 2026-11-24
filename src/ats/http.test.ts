import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { currentSourceVersion } from "../variants/service.ts";
import { handleAts } from "./http.ts";
import { AtsError, readBest, readJob } from "./store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(() => "db") }));
vi.mock("../variants/service.ts", () => ({ currentSourceVersion: vi.fn() }));
vi.mock("./store.ts", async (original) => ({ ...(await original<typeof import("./store.ts")>()), readBest: vi.fn(() => [{ job_id: 1 }]), readJob: vi.fn(() => ({ job_id: 4 })) }));

beforeEach(() => { vi.mocked(db).mockReturnValue("db" as never); });
const call = (path: string, method = "GET") => handleAts(path, new Request(`http://localhost${path}`, { method }));

test("serves the best resume per job and one job's scores, refreshed on read", async () => {
  expect(await (await call("/api/ats/best")).json()).toEqual([{ job_id: 1 }]);
  expect(readBest).toHaveBeenCalledWith("db", currentSourceVersion);
  expect(await (await call("/api/ats/jobs/4")).json()).toEqual({ job_id: 4 });
  expect(readJob).toHaveBeenCalledWith("db", 4, currentSourceVersion);
});

test("rejects other paths and methods and reports store errors", async () => {
  expect((await call("/api/ats/jobs/x")).status).toBe(404);
  expect((await call("/api/ats/best", "POST")).status).toBe(405);
  vi.mocked(readJob).mockImplementationOnce(() => { throw new AtsError("Job not found.", 404); });
  const missing = await call("/api/ats/jobs/9");
  expect([missing.status, await missing.json()]).toEqual([404, { error: "Job not found." }]);
  vi.mocked(readBest).mockImplementationOnce(() => { throw new Error("boom"); });
  expect(() => call("/api/ats/best")).toThrow("boom");
});

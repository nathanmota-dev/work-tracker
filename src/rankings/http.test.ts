import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { rankingCandidates } from "./candidates.ts";
import { handleRankings, rankingAll } from "./http.ts";
import { listRankings } from "./list.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(() => "db"), now: () => "now" }));
vi.mock("./candidates.ts", async (original) => ({ ...(await original<typeof import("./candidates.ts")>()), rankingCandidates: vi.fn() }));
vi.mock("./list.ts", () => ({ listRankings: vi.fn() }));

beforeEach(() => {
  vi.mocked(db).mockReturnValue("db" as never);
  vi.mocked(listRankings).mockReturnValue([]);
  vi.mocked(rankingCandidates).mockReturnValue({
    limit: 10, all: false, eligible: 1, deferred: 0, expired: 0, already_ranked: 0,
    items: [{ job_id: 1, title: "Engineer", company: "Acme", link: null, linkedin_job_id: null, deadline: null, closing_soon: false,
      description: "Posting text", guard_verdict: "clean", previous_status: null, fetch_attempts: 0 }],
  });
});
const call = (path: string, method = "GET") => handleRankings(path.split("?")[0]!, new Request(`http://localhost${path}`, { method }));

test("lists rankings with the derived state", async () => {
  expect(await (await call("/api/rankings")).json()).toEqual([]);
  expect(listRankings).toHaveBeenCalledWith("db");
});

test("previews candidates with counts and without posting text", async () => {
  const body = (await (await call("/api/rankings/candidates?token=x")).json()) as { items: Record<string, unknown>[] };
  expect(rankingCandidates).toHaveBeenLastCalledWith("db", { limit: 10, all: false, jobIds: undefined });
  expect(body.items).toEqual([expect.objectContaining({ job_id: 1, has_description: true })]);
  expect(body.items[0]).not.toHaveProperty("description");
  await call("/api/rankings/candidates?limit=5&all=true&job_ids=3,4");
  expect(rankingCandidates).toHaveBeenLastCalledWith("db", { limit: 5, all: true, jobIds: [3, 4] });
});

test.each(["limit=0", "limit=x", "all=maybe", "job_ids=1,,2"])("rejects the query %s", async (query) => {
  const response = await call(`/api/rankings/candidates?${query}`);
  expect(response.status).toBe(400);
  expect(rankingCandidates).not.toHaveBeenCalled();
});

test("answers 404 and 405 for unknown paths and writes, and rethrows unexpected errors", async () => {
  expect((await call("/api/rankings/other")).status).toBe(404);
  expect((await call("/api/rankings", "POST")).status).toBe(405);
  vi.mocked(listRankings).mockImplementationOnce(() => { throw new Error("db down"); });
  await expect(async () => call("/api/rankings")).rejects.toThrow("db down");
});

test.each([[null, false], ["", false], ["0", false], ["false", false], ["1", true], ["true", true]])("all=%j reads as %s", (value, expected) => {
  expect(rankingAll(value)).toBe(expected);
});

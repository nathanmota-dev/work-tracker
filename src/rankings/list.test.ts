import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import { byRank, listRankings, rankingState } from "./list.ts";
import { saveRanking } from "./store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-20T12:00:00.000Z" }));

const today = "2026-11-20";
let d: Database;
beforeEach(async () => {
  d = await memoryDatabase();
});
const job = (title: string, deadline: string | null = null) => insertJob(d, { title, deadline, link: `https://jobs.example.test/${title}` });
const score = (jobId: number, value: number) =>
  saveRanking({ jobId, status: "scored", technical: value, experience: value, career: value, strengths: ["Fit"], gaps: ["Gap"] }, d);

test("derives expiry and closing soon from the deadline at read time without writing", () => {
  expect(rankingState("scored", "2026-11-19", today)).toEqual({ status: "expired", expired_reason: "deadline", closing_soon: false });
  expect(rankingState(null, "2026-11-19", today)).toEqual({ status: "expired", expired_reason: "deadline", closing_soon: false });
  expect(rankingState("scored", today, today)).toEqual({ status: "scored", expired_reason: null, closing_soon: true });
  expect(rankingState("scored", "2026-11-27", today)).toMatchObject({ closing_soon: true });
  expect(rankingState("scored", "2026-11-28", today)).toMatchObject({ closing_soon: false });
  expect(rankingState("expired", null, today)).toEqual({ status: "expired", expired_reason: "posting", closing_soon: false });
  // A job without a deadline (or with an unreadable one) is never inferred to be expired.
  expect(rankingState(null, null, today)).toEqual({ status: null, expired_reason: null, closing_soon: false });
  expect(rankingState("unreachable", "ASAP", today)).toEqual({ status: "unreachable", expired_reason: null, closing_soon: false });
});

test("lists ranked jobs by score with closing soon as the tie-breaker, plus unranked passed deadlines", () => {
  const plain = job("Plain");
  const urgent = job("Urgent", "2026-11-25");
  const top = job("Top");
  const passed = job("Passed", "2026-11-01");
  const lapsed = job("Lapsed", "2026-11-02");
  const unreachable = job("Unreachable");
  job("Unranked");
  job("Later", "2026-12-31");
  score(plain, 70); score(urgent, 70); score(top, 90); score(lapsed, 95);
  saveRanking({ jobId: unreachable, status: "unreachable", fetch_error: "404 Not Found" }, d);
  const list = listRankings(d, today);
  expect(list.map((row) => row.title)).toEqual(["Top", "Urgent", "Plain", expect.any(String), expect.any(String), expect.any(String)]);
  expect(list.slice(3).map((row) => row.title).sort()).toEqual(["Lapsed", "Passed", "Unreachable"]);
  expect(list.find((row) => row.job_id === lapsed)).toMatchObject({ status: "expired", expired_reason: "deadline", overall: 95 });
  expect(list.find((row) => row.job_id === passed)).toMatchObject({ status: "expired", expired_reason: "deadline", overall: null, strengths: [], fetch_attempts: 0, ranked_at: null });
  expect(list.find((row) => row.job_id === urgent)).toMatchObject({ closing_soon: true, strengths: ["Fit"], gaps: ["Gap"] });
  expect(list.find((row) => row.job_id === unreachable)).toMatchObject({ status: "unreachable", fetch_attempts: 1, last_error: "404 Not Found" });
  // Correcting the deadline is reflected on the next read; nothing was written.
  d.query("UPDATE jobs SET deadline = NULL WHERE id = ?").run(lapsed);
  expect(listRankings(d, today).find((row) => row.job_id === lapsed)).toMatchObject({ status: "scored", overall: 95 });
  expect(d.query("SELECT COUNT(*) AS n FROM job_rankings").get()).toEqual({ n: 5 });
});

test("orders scored rows first, then by closing soon and the sooner deadline", () => {
  const rows = [
    { id: 1, status: "unreachable", overall: null, closing_soon: false, deadline: null },
    { id: 2, status: "scored", overall: 60, closing_soon: false, deadline: "2026-12-10" },
    { id: 3, status: "scored", overall: 60, closing_soon: false, deadline: "2026-12-01" },
    { id: 4, status: "scored", overall: 60, closing_soon: true, deadline: "2026-11-21" },
    { id: 5, status: "scored", overall: 60, closing_soon: false, deadline: null },
    { id: 6, status: "expired", overall: 99, closing_soon: false, deadline: null },
  ] as const;
  expect(byRank([...rows]).map((row) => row.id)).toEqual([4, 3, 2, 5, 1, 6]);
});

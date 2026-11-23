import { expect, it } from "vitest"
import { byScore, candidatesPath, previewText, rankingLabel, runSummary } from "./ranking"

it("labels every ranking state as text", () => {
  expect(rankingLabel({ ranking_status: "scored", ranking_overall: 78, ranking_verdict: "Strong Fit" })).toBe("78 · Strong fit")
  expect(rankingLabel({ status: "scored", overall: 52, verdict: "Moderate Fit" })).toBe("52 · Moderate fit")
  expect(rankingLabel({ ranking_status: "expired", ranking_expired_reason: "posting" })).toBe("Expired")
  expect(rankingLabel({ ranking_status: "expired", ranking_expired_reason: "deadline" })).toBe("Expired (deadline passed)")
  expect(rankingLabel({ ranking_status: "unreachable", ranking_attempts: 2 })).toBe("Unreachable (attempt 2)")
  expect(rankingLabel({ status: "unreachable", fetch_attempts: 0 })).toBe("Unreachable (attempt 1)")
  expect(rankingLabel({ ranking_status: "gave_up" })).toBe("Check manually")
  expect(rankingLabel({ ranking_status: null })).toBeNull()
})

it("sorts by score with closing soon as the tie-breaker and unscored rows after", () => {
  const rows = [
    { id: 1, ranking_status: null },
    { id: 2, ranking_status: "scored", ranking_overall: 60 },
    { id: 3, ranking_status: "scored", ranking_overall: 60, closing_soon: true },
    { id: 4, ranking_status: "scored", ranking_overall: 80 },
    { id: 5, ranking_status: "expired", ranking_overall: 99 },
  ]
  expect(byScore(rows).map(row => row.id)).toEqual([4, 3, 2, 1, 5])
})

it("builds the candidate preview path and describes the plan", () => {
  expect(candidatesPath({})).toBe("rankings/candidates")
  expect(candidatesPath({ all: true })).toBe("rankings/candidates?all=true")
  expect(candidatesPath({ jobIds: ["3", 4], all: true })).toBe("rankings/candidates?all=true&job_ids=3,4")
  const base = { limit: 10, all: false, eligible: 12, deferred: 2, expired: 0, already_ranked: 0, items: Array.from({ length: 10 }, (_, id) => ({ job_id: id })) }
  expect(previewText(base)).toBe("10 roles will be ranked, 2 deferred.")
  expect(previewText({ ...base, items: [{ job_id: 1 }], deferred: 0, expired: 1, already_ranked: 3 })).toBe("1 role will be ranked, 0 deferred. Skipped: 3 already ranked, 1 expired by deadline.")
  expect(previewText({ ...base, items: [], deferred: 0 })).toBe("Nothing new to rank.")
})

it("summarizes only the rankings the run stored", () => {
  const run = { jobIds: [1, 2, 3, 4], deferred: 2, expired: 1, startedAt: "2026-11-20T12:00:00.000Z" }
  const rankings = [
    { job_id: 1, status: "scored", ranked_at: "2026-11-20T12:01:00.000Z" },
    { job_id: 2, status: "unreachable", ranked_at: "2026-11-20T12:02:00.000Z" },
    { job_id: 3, status: "gave_up", ranked_at: "2026-11-20T12:03:00.000Z" },
    { job_id: 4, status: "scored", ranked_at: "2026-11-19T12:00:00.000Z" },
    { job_id: 9, status: "scored", ranked_at: "2026-11-20T12:04:00.000Z" },
  ]
  expect(runSummary(run, rankings)).toBe("Ranked 1 · 2 unreachable · 1 expired · 2 deferred. Run again to continue.")
  expect(runSummary({ ...run, deferred: 0, expired: 0 }, rankings.slice(0, 1))).toBe("Ranked 1 · 0 unreachable · 0 expired · 0 deferred.")
})

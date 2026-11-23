import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { prepareSkill } from "@/lib/agent"
import { RankNewRoles, RankSelected, RankingRunSummary, RankingScore } from "./job-ranking-action"

const agent = vi.hoisted(() => ({ state: { completion: null as { skill: string; id: number } | null } }))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn(), useAgent: () => agent.state }))

const request = vi.fn()
const preview = (fields: Record<string, unknown> = {}) => ({ limit: 10, all: false, eligible: 12, deferred: 2, expired: 1, already_ranked: 0,
  items: Array.from({ length: 10 }, (_, index) => ({ job_id: index + 1 })), ...fields })
beforeEach(() => {
  request.mockReset()
  vi.mocked(prepareSkill).mockReset()
  agent.state = { completion: null }
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), connectionStatus: async () => true, getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {} }
})

it("shows the score, retry states and the closing soon marker as text", () => {
  const { rerender } = render(<RankingScore row={{ ranking_status: "scored", ranking_overall: 78, ranking_verdict: "Strong Fit", closing_soon: true }} />)
  expect(screen.getByText("78 · Strong fit")).toHaveAttribute("title", expect.stringContaining("posting text only"))
  expect(screen.getByText("🔥 Closing soon")).toBeInTheDocument()
  rerender(<RankingScore row={{ ranking_status: "unreachable", ranking_attempts: 1 }} />)
  expect(screen.getByText("Unreachable (attempt 1)")).toBeInTheDocument()
  rerender(<RankingScore row={{}} />)
  expect(screen.getByText("—")).toBeInTheDocument()
})

it("previews the selection, says how many are deferred and opens the skill in context", async () => {
  request.mockResolvedValue(preview())
  render(<RankSelected jobs={[{ id: 3 }, { id: 4 }]} />)
  fireEvent.click(screen.getByRole("button", { name: "Rank selected" }))
  expect(await screen.findByRole("status", { name: "Ranking plan" })).toHaveTextContent("10 roles will be ranked, 2 deferred. Skipped: 1 expired by deadline.")
  expect(request).toHaveBeenCalledWith("rankings/candidates?job_ids=3,4", undefined)
  expect(prepareSkill).toHaveBeenCalledWith("job-ranking", { jobIds: "3,4" })
})

it("ranks new roles or everything again, and opens nothing when there is nothing to rank", async () => {
  request.mockResolvedValueOnce(preview({ items: [], eligible: 0, deferred: 0, expired: 0, already_ranked: 4 }))
  render(<RankNewRoles />)
  expect(screen.getByText("Triage scores from the posting text only.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Rank new roles" }))
  expect(await screen.findByRole("status", { name: "Ranking plan" })).toHaveTextContent("Nothing new to rank. Skipped: 4 already ranked.")
  expect(request).toHaveBeenLastCalledWith("rankings/candidates", undefined)
  expect(prepareSkill).not.toHaveBeenCalled()
  request.mockResolvedValueOnce(preview())
  fireEvent.click(screen.getByRole("button", { name: "Rank all again" }))
  await vi.waitFor(() => expect(prepareSkill).toHaveBeenCalledWith("job-ranking", { jobIds: "", all: "true" }))
  expect(request).toHaveBeenLastCalledWith("rankings/candidates?all=true", undefined)
  request.mockRejectedValueOnce(new Error("Backend is starting."))
  fireEvent.click(screen.getByRole("button", { name: "Rank new roles" }))
  expect(await screen.findByText("Backend is starting.")).toBeInTheDocument()
})

it("summarizes a completed run from the rankings it stored", async () => {
  request.mockResolvedValueOnce(preview({ items: [{ job_id: 1 }, { job_id: 2 }, { job_id: 3 }], deferred: 2, expired: 1 }))
  render(<RankSelected jobs={[{ id: 1 }]} />)
  fireEvent.click(screen.getByRole("button", { name: "Rank selected" }))
  await vi.waitFor(() => expect(prepareSkill).toHaveBeenCalled())
  const later = new Date(Date.now() + 1000).toISOString()
  request.mockResolvedValueOnce([
    { job_id: 1, status: "scored", ranked_at: later },
    { job_id: 2, status: "unreachable", ranked_at: later },
    { job_id: 3, status: "scored", ranked_at: "2000-01-01T00:00:00.000Z" },
  ])
  const summary = render(<RankingRunSummary />)
  expect(screen.queryByRole("status", { name: "Ranking summary" })).not.toBeInTheDocument()
  agent.state = { completion: { skill: "job-ranking", id: 7 } }
  await act(async () => summary.rerender(<RankingRunSummary />))
  expect(await screen.findByRole("status", { name: "Ranking summary" })).toHaveTextContent("Ranked 1 · 1 unreachable · 1 expired · 2 deferred. Run again to continue.")
  expect(request).toHaveBeenLastCalledWith("rankings", undefined)
})

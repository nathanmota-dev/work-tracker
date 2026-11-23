import { render, screen, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { RankingDetail } from "./ranking-detail"

const request = vi.fn()
beforeEach(() => {
  request.mockReset()
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), connectionStatus: async () => true, getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {} }
})

it("shows the three scores, strengths, gaps, date and triage note as plain text", async () => {
  request.mockResolvedValue([{
    job_id: 4, status: "scored", technical: 80, experience: 70, career: 75, overall: 75, verdict: "Strong Fit",
    strengths: ["<b>React</b> match"], gaps: ["No Kubernetes"], ranked_at: "2026-11-20T12:00:00.000Z", last_error: null,
  }])
  render(<RankingDetail jobId={4} />)
  const section = await screen.findByRole("region", { name: "Triage ranking" })
  expect(section).toHaveTextContent("Triage: 75 · Strong fit")
  expect(within(section).getByText("Technical").nextSibling).toHaveTextContent("80")
  expect(within(section).getByText("Career alignment").nextSibling).toHaveTextContent("75")
  expect(within(section).getByText("<b>React</b> match")).toBeInTheDocument()
  expect(section.querySelector("b")).toBeNull()
  expect(section).toHaveTextContent("No Kubernetes")
  expect(section).toHaveTextContent("Ranked")
  expect(section).toHaveTextContent("from the posting text only")
})

it("explains retry states and renders nothing for an unranked job", async () => {
  request.mockResolvedValue([{ job_id: 2, status: "gave_up", fetch_attempts: 4, last_error: "LinkedIn login wall", strengths: [], gaps: [] }])
  const { rerender } = render(<RankingDetail jobId={2} />)
  const section = await screen.findByRole("region", { name: "Triage ranking" })
  expect(section).toHaveTextContent("Triage: Check manually")
  expect(section).toHaveTextContent("Last read: LinkedIn login wall")
  expect(section).toHaveTextContent("It may still be live")
  expect(section).not.toHaveTextContent("Technical")
  rerender(<RankingDetail jobId={9} />)
  expect(screen.queryByRole("region", { name: "Triage ranking" })).not.toBeInTheDocument()
})

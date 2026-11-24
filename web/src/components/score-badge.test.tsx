import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { ScoreBadge } from "./score-badge"
import { ResumeMatchBadge, ScoreOnlyBadge } from "./resume-match-detail"
import { atsLabel, verdictTone } from "@/lib/ats"

it.each([["strong", "good", "Strong match"], ["partial", "warn", "Partial match"], ["weak", "bad", "Weak match"]] as const)("shows the %s band as text with its tone", (band, tone, label) => {
  render(<ResumeMatchBadge match={{ score: 82, band, label: "Back-End · C#" }} />)
  const badge = screen.getByText("82 · Back-End · C#").parentElement!
  expect(badge).toHaveAttribute("data-tone", tone)
  expect(badge).toHaveTextContent(label)
})

it("reads Not enough keywords instead of 0, and a dash without a score", () => {
  const { unmount } = render(<ScoreOnlyBadge match={{ score: null, band: null }} />)
  expect(screen.getByText("Not enough keywords")).toHaveAttribute("data-tone", "none")
  unmount()
  render(<ResumeMatchBadge match={undefined} />)
  expect(screen.getByText("—")).toBeInTheDocument()
  expect(atsLabel({ score: null, label: "Base resume" })).toBe("Not enough keywords")
})

it("colors triage verdicts without changing their text", () => {
  expect(["Strong Fit", "Good Fit", "Moderate Fit", "Weak Fit", "Poor Fit", undefined].map(verdictTone)).toEqual(["good", "good", "warn", "bad", "bad", "none"])
  render(<ScoreBadge tone="warn">55 · Moderate fit</ScoreBadge>)
  expect(screen.getByText("55 · Moderate fit")).toHaveAttribute("data-tone", "warn")
})

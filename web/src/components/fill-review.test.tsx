import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { FillReviewPanel } from "@/components/fill-review"
import { answerCorrectionHref, type FillReview } from "@/lib/fill-review"
import type { PreparationRun } from "@/lib/preparation"

let review: FillReview
beforeEach(() => {
  localStorage.clear()
  window.location.hash = "/apply?jobId=7&applicationId=3"
  review = {
    applicationId: 3, runId: "run-1", portal: "greenhouse", portalLabel: "Greenhouse", reviewUrl: "https://boards.greenhouse.io/example/jobs/1",
    document: { versionId: "pdf-1-abcdef", pdfHash: "hash-1", usedAt: "2026-10-01T10:00:00.000Z" }, fillStatus: "filled", submitted: false, submittedAt: null,
    items: [
      { label: "Email", key: "email", answer: "candidate@example.com", result: "filled", reason: null, reasonText: null, correctionKey: "email" },
      { label: "Resume", key: "resume", answer: "", result: "filled", reason: null, reasonText: null, correctionKey: null },
      { label: "Phone", key: "phone", answer: null, result: "pending", reason: "no-stored-answer", reasonText: "No saved answer for this field. Add one in Answers, then fill again.", correctionKey: "phone" },
      { label: "Gender", key: "eeo_gender", answer: null, result: "pending", reason: "eeo-human-only", reasonText: "Demographic question. Answer it yourself.", correctionKey: null },
    ],
    filled: 2, pending: 2, instruction: "Work Tracker never submits.",
  }
})

it("shows a readable checklist with the portal, the PDF used and correction links", () => {
  const onFillAgain = vi.fn()
  render(<FillReviewPanel review={review} fillBlocked={false} onFillAgain={onFillAgain} />)
  expect(screen.getByText("Greenhouse · 2 filled · 2 pending")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Open the portal to review" })).toBeInTheDocument()
  expect(screen.getByText(/PDF version pdf-1-ab used on .* · SHA-256 hash-1/)).toBeInTheDocument()
  const list = within(screen.getByRole("list", { name: "Fill checklist" }))
  expect(list.getByText("Answer used: candidate@example.com")).toBeInTheDocument()
  expect(list.getByText("Answer used: (empty)")).toBeInTheDocument()
  expect(list.getByText("Demographic question. Answer it yourself.")).toBeInTheDocument()
  expect(list.getByRole("link", { name: "Add answer for Phone" })).toHaveAttribute("href", "#/answers?field=phone&returnTo=%2Fapply%3FjobId%3D7%26applicationId%3D3")
  expect(list.getByRole("link", { name: "Correct answer for Email" })).toHaveAttribute("href", expect.stringContaining("field=email"))
  expect(list.queryByRole("link", { name: /Gender/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Fill again with the approved PDF" }))
  expect(onFillAgain).toHaveBeenCalledOnce()
  expect(screen.getByText("Work Tracker never submits.")).toBeInTheDocument()
})

it("completes the checklist without confirming the submission and keeps the review per fill", () => {
  const { unmount } = render(<FillReviewPanel review={review} fillBlocked onFillAgain={vi.fn()} />)
  expect(screen.getByRole("button", { name: "Fill again with the approved PDF" })).toBeDisabled()
  expect(screen.getByText("2 pending fields to complete in the portal.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "Completed Phone in the portal" }))
  expect(screen.getByText("1 pending field to complete in the portal.")).toBeInTheDocument()
  unmount()
  render(<FillReviewPanel review={review} fillBlocked onFillAgain={vi.fn()} />)
  expect(screen.getByRole("checkbox", { name: "Completed Phone in the portal" })).toBeChecked()
  fireEvent.click(screen.getByRole("checkbox", { name: "Completed Gender in the portal" }))
  expect(screen.getByText(/^Checklist complete\. The application is not submitted yet/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "Completed Gender in the portal" }))
  expect(screen.getByText("1 pending field to complete in the portal.")).toBeInTheDocument()
})

it("starts a new review for a new fill and survives unavailable storage", () => {
  localStorage.setItem("work-tracker-fill-review-v1:3:run-1:2026-10-01T10:00:00.000Z", "not json")
  const { rerender } = render(<FillReviewPanel review={review} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByRole("checkbox", { name: "Completed Phone in the portal" })).not.toBeChecked()
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full") })
  fireEvent.click(screen.getByRole("checkbox", { name: "Completed Phone in the portal" }))
  expect(screen.getByRole("checkbox", { name: "Completed Phone in the portal" })).toBeChecked()
  setItem.mockRestore()
  rerender(<FillReviewPanel review={{ ...review, document: null }} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByRole("checkbox", { name: "Completed Phone in the portal" })).not.toBeChecked()
  expect(screen.getByText("The PDF version used was not recorded for this fill.")).toBeInTheDocument()
})

it("distinguishes a confirmed submission and previous results of an unfinished fill", () => {
  const run = { phase: "filling", status: "running" } as PreparationRun
  const { rerender } = render(<FillReviewPanel review={review} run={run} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByText("A new portal fill is running. This is the previous recorded result.")).toBeInTheDocument()
  rerender(<FillReviewPanel review={review} run={{ ...run, status: "failed" }} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByText(/latest portal fill did not finish.*nothing new was filled or submitted/)).toBeInTheDocument()
  rerender(<FillReviewPanel review={{ ...review, submitted: true, submittedAt: "2026-10-02T12:00:00.000Z" }} run={{ ...run, status: "completed" }} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByText(`Marked as submitted on ${new Date("2026-10-02T12:00:00.000Z").toLocaleDateString()}.`)).toBeInTheDocument()
  expect(screen.queryByRole("status", { name: /did not finish/ })).not.toBeInTheDocument()
  expect(screen.queryByRole("link", { name: /Add answer/ })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Fill again with the approved PDF" })).not.toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: "Completed Phone in the portal" })).toBeDisabled()
  rerender(<FillReviewPanel review={{ ...review, submitted: true }} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByText("Marked as submitted.")).toBeInTheDocument()
  rerender(<FillReviewPanel review={{ ...review, items: [{ ...review.items[2]!, reason: "invalid-answer" }] }} fillBlocked={false} onFillAgain={vi.fn()} />)
  expect(screen.getByRole("link", { name: "Correct answer for Phone" })).toBeInTheDocument()
})

it("links corrections outside Apply without a return path", () => {
  expect(answerCorrectionHref("phone", "#/applications")).toBe("#/answers?field=phone")
})

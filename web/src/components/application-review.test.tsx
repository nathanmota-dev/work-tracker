import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApplicationReview } from "@/components/application-review"
import { publish } from "@/lib/api"
import { desktopDouble } from "@/test/doubles"
import type { ReviewItem } from "@/lib/application-board"

const item = (id: number, fields: Partial<ReviewItem> = {}): ReviewItem => ({
  id, job_id: null, job_exists: false, origin: "unknown", status: "submitted", submission_status: "submitted",
  applied_at: "2026-09-01T12:00:00.000Z", tracked: false, company_name: "Sent Corp", role_title: "Engineer",
  external_url: "https://sent.test", review_reason: "missing_stage", safe_fix: "track", decisions: ["track"],
  link_job: false, missing: [], candidates: [], related: [], ...fields,
})
let items: ReviewItem[]
let desktop: ReturnType<typeof desktopDouble>
beforeEach(() => {
  items = [
    item(1),
    item(2, { status: "weird", submission_status: "not_submitted", applied_at: null, company_name: null, role_title: null, review_reason: "unknown_status",
      safe_fix: null, decisions: ["mark_submitted", "mark_not_submitted"], link_job: true, missing: ["company_name", "applied_at"],
      candidates: [{ id: 5, title: null, company_name: null, link: null, archived_at: null, match: "link", application_id: null }, { id: 6, title: null, company_name: null, link: null, archived_at: null, match: "link", application_id: null }] }),
    item(3, { job_id: 9, job_exists: true, review_reason: "duplicate_job", safe_fix: null, decisions: ["keep_attempt"], related: [{ id: 1, attempt: null, submission_status: "not_submitted" }] }),
  ]
  desktop = desktopDouble()
  desktop.request.mockImplementation(async (path: string, body?: unknown) => {
    const input = body as { id?: number; decision?: string }
    if (path === "application-board/review") return { items: structuredClone(items) }
    if (path === "application-board/review/reconcile") {
      const fixed = items.filter((entry) => entry.safe_fix).map((entry) => entry.id)
      items = items.filter((entry) => !entry.safe_fix)
      return { fixed, items }
    }
    if (path === "application-board/review/resolve") {
      if (input.decision === "mark_submitted") throw new Error("Add the company name before tracking this application.")
      items = items.filter((entry) => entry.id !== input.id)
      return { item: input.decision === "mark_not_submitted" ? item(input.id!, { review_reason: "missing_job" }) : null }
    }
    if (path === "application-board/link/options") return { application_id: input.id, role_title: null, company_name: null, external_url: null, comp: null, missing: [], candidates: [] }
    return { application_id: input.id, job_id: 5, created_job: false, missing: [] }
  })
  window.desktop = desktop
})

it("starts as a banner and expands into the review on request", async () => {
  const onOpenChange = vi.fn()
  const { rerender } = render(<ApplicationReview open={false} onOpenChange={onOpenChange} />)
  expect(await screen.findByText("Needs review (3)")).toBeInTheDocument()
  expect(screen.getByText(/Open the review to decide each one/)).toBeInTheDocument()
  expect(screen.queryByRole("list", { name: "Applications to review" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Apply safe fixes (1)" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Review" }))
  expect(onOpenChange).toHaveBeenCalledWith(true)
  rerender(<ApplicationReview open onOpenChange={onOpenChange} />)
  expect(screen.getByRole("list", { name: "Applications to review" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Hide review" })).toHaveAttribute("aria-expanded", "true")
})

it("lists conflicts and missing data, then applies safe fixes on request", async () => {
  render(<ApplicationReview />)
  const panel = await screen.findByText("Needs review (3)")
  expect(panel).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Review" }))
  expect(screen.getByText("2 saved jobs match this link. Choose one with “Link job”.")).toBeInTheDocument()
  expect(screen.getByText(/Same job as #1 \(attempt \?, not submitted\)/)).toBeInTheDocument()
  expect(screen.getByText(/#2 · Unknown company · Untitled role/)).toBeInTheDocument()
  expect(screen.getByText(/· job #9$/)).toBeInTheDocument()
  expect(screen.getByLabelText("Company name")).toHaveAttribute("aria-invalid", "true")
  fireEvent.click(screen.getByRole("button", { name: "Apply safe fixes (1)" }))
  expect(await screen.findByText("1 application(s) reconciled. Their IDs and history are kept.")).toBeInTheDocument()
  expect(await screen.findByText("Needs review (2)")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /Apply safe fixes/ })).not.toBeInTheDocument()
})

it("keeps a failed decision visible and records the remaining issue of a resolved one", async () => {
  render(<ApplicationReview open />)
  const entry = within((await screen.findByText(/#2 · Unknown company/)).closest("li")!)
  fireEvent.change(entry.getByLabelText("Company name"), { target: { value: "Typed" } })
  fireEvent.change(entry.getByLabelText("Application date"), { target: { value: "2026-09-01T10:00" } })
  fireEvent.click(entry.getByRole("button", { name: "It was submitted" }))
  expect(await entry.findByRole("alert")).toHaveTextContent("Add the company name before tracking")
  expect(desktop.request).toHaveBeenCalledWith("application-board/review/resolve", expect.objectContaining({ id: 2, company_name: "Typed", applied_at: expect.stringMatching(/^2026-09-01T/) }))
  fireEvent.click(entry.getByRole("button", { name: "It was not submitted" }))
  expect(await screen.findByText("Application #2 still needs review: no saved job.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Keep as a separate attempt" }))
  expect(await screen.findByText("Application #3 reconciled.")).toBeInTheDocument()
})

it("links a job from the review and refreshes on changes", async () => {
  render(<ApplicationReview open />)
  fireEvent.click(await screen.findByRole("button", { name: "Link job" }))
  const dialog = within(await screen.findByRole("dialog"))
  fireEvent.change(await dialog.findByLabelText("Role title"), { target: { value: "Engineer" } })
  fireEvent.change(dialog.getByLabelText("Company name"), { target: { value: "Co" } })
  fireEvent.change(dialog.getByLabelText("Job link"), { target: { value: "https://co.test" } })
  fireEvent.click(dialog.getByRole("button", { name: "Link job" }))
  expect(await screen.findByText("Application #2 linked to its job.")).toBeInTheDocument()
  const calls = desktop.request.mock.calls.length
  act(() => publish({ type: "changed", table: "jobs" }))
  await waitFor(() => expect(desktop.request.mock.calls.length).toBeGreaterThan(calls))
})

it("renders nothing without flagged records and shows load errors", async () => {
  items = []
  const { container, unmount } = render(<ApplicationReview />)
  await waitFor(() => expect(desktop.request).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
  unmount()
  desktop.request.mockRejectedValue(new Error("review offline"))
  render(<ApplicationReview />)
  expect(await screen.findByRole("alert")).toHaveTextContent("review offline")
})

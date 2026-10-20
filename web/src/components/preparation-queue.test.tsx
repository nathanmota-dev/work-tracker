import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { PreparationQueue } from "@/components/preparation-queue"
import { publish } from "@/lib/api"
import type { PreparationBatch, PreparationBatchItem, PreparationQueueState } from "@/lib/preparation"
import { desktopDouble } from "@/test/doubles"

const item = (position: number, fields: Partial<PreparationBatchItem>): PreparationBatchItem => ({
  id: `item-${position}`, batchId: "batch-1", position, jobId: position, company: `Company ${position}`, title: "Engineer", applicationId: null, runId: null,
  phase: "queued", status: "pending", attempts: 0, holdsPortal: false, reviewRequired: false, retryable: false, extra: "", error: null, result: "pending", adjustment: null, updatedAt: "2026-10-19T12:00:00Z", ...fields,
})
const batch = (fields: Partial<PreparationBatch> = {}): PreparationBatch => ({
  id: "batch-1", status: "active", pauseReason: null, provider: "opencode", model: null, extra: "", sourceVersion: "v1", createdAt: "2026-10-19T12:00:00Z", updatedAt: "2026-10-19T12:00:00Z", counts: {}, summary: { prepared: 0, filled: 0, submitted: 0, failed: 0, cancelled: 0, pending: 5 },
  items: [
    item(1, { phase: "in_review", status: "waiting_for_user", holdsPortal: true, applicationId: 11, runId: "run-1", attempts: 2 }),
    item(2, { phase: "tailoring", status: "failed", retryable: true, error: "Synthetic agent failure", runId: "run-2" }),
    item(3, { phase: "filling", status: "interrupted", retryable: true, reviewRequired: true, runId: "run-3" }),
    item(4, { phase: "ready_for_review", status: "waiting_for_user", runId: "run-4" }),
    item(5, { phase: "queued", status: "cancelled" }),
  ],
  ...fields,
})
let state: PreparationQueueState
let desktop: ReturnType<typeof desktopDouble>
beforeEach(() => {
  state = { batches: [batch()], portal: { batchId: "batch-1", itemId: "item-1", applicationId: 11, jobId: 1, label: "Company 1 · Engineer" }, busy: false }
  desktop = desktopDouble()
  desktop.connectionStatus.mockResolvedValue(true)
  desktop.request.mockImplementation(async (path: string) => path === "preparation-batches" ? structuredClone(state) : { ok: true })
  window.desktop = desktop
})
const row = (name: string) => screen.getByRole("listitem", { name })

it("renders nothing without batches", async () => {
  state.batches = []
  const { container } = render(<PreparationQueue />)
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches", undefined))
  expect(container).toBeEmptyDOMElement()
})

it("shows each item's position, phase, status and the portal reservation", async () => {
  render(<PreparationQueue />)
  expect(await screen.findByRole("status")).toHaveTextContent("The browser portal is reserved for Company 1 · Engineer.")
  expect(screen.getByText("5 jobs · 1 ready for review · 1 form in review · 2 need attention · 1 cancelled · opencode")).toBeInTheDocument()
  expect(within(row("1. Company 1 · Engineer")).getByText("Form in review · needs you")).toBeInTheDocument()
  expect(within(row("1. Company 1 · Engineer")).getByText("Attempt 2")).toBeInTheDocument()
  expect(within(row("1. Company 1 · Engineer")).getByText("holds the portal")).toBeInTheDocument()
  expect(within(row("1. Company 1 · Engineer")).getByText(/submit it there yourself/)).toBeInTheDocument()
  expect(within(row("2. Company 2 · Engineer")).getByText("Synthetic agent failure")).toBeInTheDocument()
  expect(within(row("4. Company 4 · Engineer")).getByText(/approve the resume/)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open Company 1 · Engineer in Apply" })).toHaveAttribute("href", "#/apply?jobId=1&applicationId=11&runId=run-1")
  expect(screen.getByRole("link", { name: "Open Company 5 · Engineer in Apply" })).toHaveAttribute("href", "#/apply?jobId=5")
  expect(screen.queryByRole("button", { name: "Cancel Company 5 · Engineer" })).not.toBeInTheDocument()
})

it("pauses, retries failed items, cancels and refreshes the queue", async () => {
  render(<PreparationQueue />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Pause" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/pause", { batchId: "batch-1" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry failed" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Retry failed" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/retry", { batchId: "batch-1" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry Company 2 · Engineer" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Retry Company 2 · Engineer" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/retry", { batchId: "batch-1", itemId: "item-2", reviewed: false }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel Company 4 · Engineer" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Cancel Company 4 · Engineer" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/cancel", { batchId: "batch-1", itemId: "item-4" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel batch" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Cancel batch" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/cancel", { batchId: "batch-1" }))
  expect(desktop.request.mock.calls.filter(([path]) => path === "preparation-batches").length).toBeGreaterThan(1)
})

it("fills again after an unknown outcome only once the portal was reviewed", async () => {
  render(<PreparationQueue />)
  const retry = await screen.findByRole("button", { name: "Retry Company 3 · Engineer" })
  await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled())
  expect(retry).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this portal/ }))
  fireEvent.click(retry)
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/retry", { batchId: "batch-1", itemId: "item-3", reviewed: true }))
})

it("explains pauses after a restart, resumes and reports failed operations", async () => {
  state.portal = null
  state.batches = [batch({ status: "paused", pauseReason: "restart", model: "fast", items: [item(1, { phase: "tailoring", status: "waiting_for_sign_in", retryable: true }), item(2, { phase: "waiting_for_fill", status: "pending" }), item(3, { status: "waiting_for_decision", phase: "compiling" })] }),
    batch({ id: "batch-2", status: "paused", pauseReason: "user", items: [item(1, { batchId: "batch-2", jobId: 9, phase: "submitted", status: "completed" })] }), batch({ id: "batch-3", status: "completed", items: [item(1, { batchId: "batch-3", jobId: 10, status: "running", phase: "preparing" })] })]
  desktop.request.mockImplementation(async (path: string) => {
    if (path === "preparation-batches") return structuredClone(state)
    throw new Error("Batch not found.")
  })
  render(<PreparationQueue />)
  expect(await screen.findByText("paused after restart")).toBeInTheDocument()
  expect(screen.getByText(/The app closed while this batch was active/)).toBeInTheDocument()
  expect(screen.getByText(/no other item starts until you resume/)).toBeInTheDocument()
  expect(screen.getByText("3 jobs · 1 in progress · 1 waiting to fill · 1 need attention · opencode · fast")).toBeInTheDocument()
  expect(screen.getByText("1 job · 1 submitted · opencode")).toBeInTheDocument()
  expect(screen.getByText(/Complete sign-in in the browser/)).toBeInTheDocument()
  expect(screen.getByText(/waiting for your permission decision/)).toBeInTheDocument()
  expect(screen.getByText(/no other form is waiting/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Retry Company 1 · Engineer" })).toHaveTextContent("Retry after sign-in")
  expect(screen.getAllByRole("button", { name: "Cancel batch" })).toHaveLength(2)
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Resume" })[0]).toBeEnabled())
  fireEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]!)
  expect(await screen.findByRole("alert")).toHaveTextContent("Batch not found.")
  publish({ type: "changed", table: "preparation_batches" })
  await waitFor(() => expect(desktop.request.mock.calls.filter(([path]) => path === "preparation-batches").length).toBeGreaterThan(1))
})

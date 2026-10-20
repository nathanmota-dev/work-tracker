import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApplyPage } from "@/routes/apply"
import { AgentPermissions } from "./agent-permissions"
import { publish } from "@/lib/api"
import { validateWorkspaceSearch } from "@/lib/workspace-search"
import { reviewSummary } from "../../../src/preparation/batch-review"
import type { PreparationBatchItem, PreparationDetails, PreparationQueueState } from "@/lib/preparation"
import { desktopDouble, deferred } from "@/test/doubles"
const search = vi.hoisted(() => ({ batchId: "batch", itemId: "i1", pendingOnly: false } as Record<string, unknown>))
vi.mock("@tanstack/react-router", () => ({ useSearch: () => search }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title, artifact }: { title: string; artifact?: { id: string } }) => <section aria-label={title}>{artifact?.id ?? "empty"}</section> }))
const item = (n: number, fields: Partial<PreparationBatchItem> = {}): PreparationBatchItem => ({
  id: `i${n}`, batchId: "batch", position: n, jobId: n, applicationId: n, runId: `r${n}`, title: `Role ${n}`, company: `Company ${n}`,
  phase: "ready_for_review", status: "waiting_for_user", attempts: 1, holdsPortal: false, reviewRequired: false, retryable: false,
  extra: "", error: null, updatedAt: "2026-10-20", result: "prepared", adjustment: null, ...fields,
})
let state: PreparationQueueState
let desktop: ReturnType<typeof desktopDouble>
let details: Record<number, PreparationDetails>
const batch = () => state.batches[0]!
function preparation(n: number): PreparationDetails {
  return {
    job: { id: n, title: `Role ${n}`, company_name: `Company ${n}`, description: "React role", archived_at: null, link: `https://example.test/${n}` }, busy: false, applicationStatus: "draft", uploadedRunId: `r${n}`, journey: null,
    runs: [{ id: `r${n}`, job_id: n, application_id: n, status: "completed", phase: "review", artifacts: [{ id: `base-${n}`, kind: "base", pages: 1, warnings: [] }, { id: `pdf-${n}`, kind: "tailored", pages: 1, warnings: [] }], events: [], recovery: { checkpoints: ["compiled"], retryFrom: null, reviewRequired: false, summary: null }, report: "Synthetic report", provider: "fake", model: null, error: null, created_at: "2026-10-20", updated_at: "2026-10-20" }],
    documents: [{ id: `pdf-${n}`, runId: `r${n}`, applicationId: n, pdfHash: `hash-${n}`, sourceVersion: "v1", text: `Tailored ${n}`, baseText: `Base ${n}`, description: "React role", extra: "", data: null, approvedAt: null, createdAt: "2026-10-20", usedAt: null, submittedAt: null }],
  }
}
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
  Object.assign(search, { batchId: "batch", itemId: "i1", pendingOnly: false })
  window.location.hash = "/apply?batchId=batch&itemId=i1&pdfTab=tailored&workspaceTab=report"
  state = { batches: [{ id: "batch", status: "active", pauseReason: null, provider: "fake", model: null, extra: "Common", sourceVersion: "v1", createdAt: "2026-10-20", updatedAt: "2026-10-20", counts: {}, summary: reviewSummary([]), items: [item(1), item(2, { phase: "in_review", holdsPortal: true, result: "filled" }), item(3, { phase: "tailoring", status: "failed", retryable: true, error: "Synthetic failure", result: "failed" }), item(4, { status: "cancelled", result: "cancelled" }), item(5, { phase: "submitted", status: "completed", result: "submitted" })] }], portal: null, busy: false }
  batch().summary = reviewSummary(batch().items)
  details = Object.fromEntries([1, 2, 3, 4, 5].map(n => [n, preparation(n)]))
  details[2]!.applicationStatus = "filled"
  details[2]!.documents![0]!.approvedAt = "2026-10-20"
  details[2]!.fill = { applicationId: 2, runId: "r2", portal: "generic", portalLabel: "Synthetic portal 2", reviewUrl: "https://example.test/2", document: { versionId: "pdf-2", pdfHash: "hash-2", usedAt: "2026-10-20" }, fillStatus: "filled", submitted: false, submittedAt: null, items: [{ label: "Phone 2", key: "phone", answer: null, result: "pending", reason: "no-stored-answer", reasonText: "No saved phone", correctionKey: "phone" }], filled: 0, pending: 1, instruction: "Review in the browser." }
  desktop = desktopDouble(); desktop.connectionStatus.mockResolvedValue(true)
  desktop.request.mockImplementation(async (path, body) => {
    if (path.startsWith("preparation-batches/review/")) return structuredClone(state)
    if (path === "application-preparation/details") return structuredClone(details[(body as { jobId: number }).jobId])
    if (path === "jobs") return Object.values(details).map(value => value.job)
    if (path === "acp/providers") return { providers: [{ id: "fake", displayName: "Fake", models: [] }], default: "fake" }
    if (path === "integrations/status") return { entries: [], dependencies: [], backend: true }
    if (path === "resume-sources") return { config: { projectDir: "/sources" }, dependencies: [], preview: null, warnings: [] }
    if (path === "acp/permissions") return { pending: [], rules: [], sessionRules: [], history: [] }
    return { ok: true }
  })
  window.desktop = desktop
})
function follow(link: HTMLElement, rerender: (ui: React.ReactNode) => void) {
  const href = link.getAttribute("href")!
  const params = new URLSearchParams(href.split("?")[1])
  for (const key of Object.keys(search)) delete search[key]
  Object.assign(search, validateWorkspaceSearch("apply", Object.fromEntries(params)))
  window.location.hash = href
  rerender(<ApplyPage />)
}

it("navigates mixed items with the correct PDF and checklist, and restores per-item adjustment and field context", async () => {
  const view = render(<ApplyPage />)
  await screen.findByText("pdf-1")
  expect(screen.getByLabelText("Batch results")).toHaveTextContent("prepared1filled1submitted1failed1cancelled1pending0")
  fireEvent.change(screen.getByRole("textbox", { name: "Document adjustment" }), { target: { value: "Emphasize React" } })
  const next = screen.getByRole("link", { name: "Next item" })
  expect(next.getAttribute("href")).toContain("pdfTab=tailored")
  follow(next, view.rerender)
  await screen.findByText("pdf-2")
  expect(screen.queryByText("pdf-1")).not.toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Fill checklist" })).toHaveTextContent("Phone 2")
  fireEvent.click(screen.getByRole("checkbox", { name: "Completed Phone 2 in the portal" }))
  expect(screen.getByRole("link", { name: "Add answer for Phone 2" }).getAttribute("href")).toContain("returnTo=%2Fapply%3FbatchId%3Dbatch%26itemId%3Di2")
  follow(screen.getByRole("link", { name: "Previous item" }), view.rerender)
  await screen.findByText("pdf-1")
  expect(screen.getByRole("textbox", { name: "Document adjustment" })).toHaveValue("Emphasize React")
  follow(screen.getByRole("link", { name: "Next item" }), view.rerender)
  await screen.findByText("pdf-2")
  expect(screen.getByRole("checkbox", { name: "Completed Phone 2 in the portal" })).toBeChecked()
  follow(screen.getByRole("link", { name: "Show unfinished only" }), view.rerender)
  expect(within(screen.getByRole("navigation", { name: "Batch items" })).getAllByRole("link")).toHaveLength(3)
  // An event updates the totals without moving the selected item or losing its filter.
  batch().items[1] = { ...batch().items[1]!, result: "submitted", status: "completed", phase: "submitted" }
  batch().summary = reviewSummary(batch().items)
  act(() => publish({ type: "changed", table: "preparation_batches" }))
  await waitFor(() => expect(screen.getByLabelText("Batch results")).toHaveTextContent("submitted2"))
  expect(screen.getByRole("region", { name: "Selected batch item" })).toHaveTextContent("Item 2 of 5")
  expect(screen.getByRole("link", { name: "Show all items" })).toBeInTheDocument()
})

it("keeps a rejected adjustment draft and previous PDF, prevents duplicate requests and locks the queued old version", async () => {
  const original = desktop.request.getMockImplementation()!
  const saving = deferred<unknown>()
  let reject = true
  desktop.request.mockImplementation(async (path, body) => {
    if (path === "preparation-batches/adjust") {
      if (reject) { reject = false; throw Error("Synthetic storage failure") }
      await saving.promise
      batch().items[0] = { ...batch().items[0]!, phase: "queued", status: "pending", result: "pending", adjustment: "Emphasize React" }
      return batch()
    }
    return original(path, body)
  })
  render(<ApplyPage />)
  await screen.findByText("pdf-1")
  fireEvent.change(screen.getByRole("textbox", { name: "Document adjustment" }), { target: { value: "Emphasize React" } })
  fireEvent.click(screen.getByRole("button", { name: "Request adjustment" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic storage failure")
  expect(screen.getByRole("textbox", { name: "Document adjustment" })).toHaveValue("Emphasize React")
  const button = screen.getByRole("button", { name: "Request adjustment" })
  fireEvent.click(button); fireEvent.click(button)
  await act(async () => saving.resolve({}))
  await screen.findByText("Requested adjustment: Emphasize React")
  expect(desktop.request.mock.calls.filter(([path]) => path === "preparation-batches/adjust")).toHaveLength(2)
  expect(screen.getByText("pdf-1")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Approve this version" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Fill application" })).toBeDisabled()
})

it("requires portal review before retry, resumes pending work and reconnects to fresh batch results", async () => {
  search.itemId = "i3"
  batch().status = "paused"; batch().pauseReason = "restart"
  batch().items[2] = { ...batch().items[2]!, phase: "filling", status: "interrupted", reviewRequired: true }
  render(<ApplyPage />)
  expect(await screen.findByText(/The app restarted/)).toBeInTheDocument()
  const retry = screen.getByRole("button", { name: "Retry this item" })
  expect(retry).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this portal/ }))
  fireEvent.click(retry)
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/retry", { batchId: "batch", itemId: "i3", reviewed: true }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Resume pending work" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Resume pending work" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("preparation-batches/resume", { batchId: "batch" }))
  const reads = desktop.request.mock.calls.filter(([path]) => path.startsWith("preparation-batches/review/")).length
  act(() => publish({ type: "connection", live: true }))
  await waitFor(() => expect(desktop.request.mock.calls.filter(([path]) => path.startsWith("preparation-batches/review/")).length).toBeGreaterThan(reads))
})

it("shows a load failure and retry, rejects a foreign item and opens a batch without searching for its first job", async () => {
  desktop.request.mockRejectedValueOnce(Error("Synthetic unavailable batch"))
  const view = render(<ApplyPage />)
  expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic unavailable batch")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  await screen.findByText("pdf-1")
  search.itemId = "foreign"
  view.rerender(<ApplyPage />)
  expect(screen.getByRole("alert")).toHaveTextContent("Batch item not found")
  expect(screen.queryByText("pdf-1")).not.toBeInTheDocument()
  delete search.itemId
  view.rerender(<ApplyPage />)
  await screen.findByText("pdf-1")
})

it("reopens only the selected item's pending permission through the existing permission dialog", async () => {
  batch().items[0] = { ...batch().items[0]!, status: "waiting_for_decision", phase: "tailoring" }
  const original = desktop.request.getMockImplementation()!
  desktop.request.mockImplementation(async (path, body) => path === "acp/permissions" ? { pending: [{ id: "permission", runId: "r1", sessionId: "session", provider: "fake", title: "Synthetic permission", context: "Synthetic", rememberable: false, expiresAt: "2099-01-01", options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }] }] } : original(path, body))
  render(<><AgentPermissions /><ApplyPage /></>)
  await screen.findByRole("dialog")
  fireEvent.click(screen.getByRole("button", { name: "Decide later" }))
  fireEvent.click(screen.getByRole("button", { name: "Decide permission" }))
  const dialog = await screen.findByRole("dialog")
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow once" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("acp/permissions/answer", { id: "permission", runId: "r1", sessionId: "session", optionId: "allow", remember: "once" }))
})

it("keeps the previous PDF visible after a failed adjustment and prevents filling that older version", async () => {
  details[1]!.runs.unshift({ ...details[1]!.runs[0]!, id: "new-failed", status: "failed", artifacts: [], error: "Correction failed" })
  batch().items[0] = { ...batch().items[0]!, runId: "new-failed", phase: "tailoring", status: "failed", retryable: true, result: "failed" }
  render(<ApplyPage />)
  await screen.findByText("pdf-1")
  expect(screen.getByText(/Showing the previous validated resume/)).toHaveTextContent("Retry this item")
  expect(screen.getByRole("button", { name: "Approve this version" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Fill application" })).toBeDisabled()
})

it("does not expose a different execution's document or checklist before a queued item starts", async () => {
  batch().items[1] = { ...batch().items[1]!, runId: null, applicationId: null, phase: "queued", status: "pending", result: "pending" }
  search.itemId = "i2"
  render(<ApplyPage />)
  await screen.findByRole("region", { name: "Selected batch item" })
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("application-preparation/details", { jobId: 2, applicationId: undefined }))
  expect(screen.queryByText("pdf-2")).not.toBeInTheDocument()
  expect(screen.queryByRole("list", { name: "Fill checklist" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Fill application" })).toBeDisabled()
})

it("keeps an initially selected item after it finishes even when the batch link had no item ID", async () => {
  delete search.itemId
  render(<ApplyPage />)
  await screen.findByText("pdf-1")
  batch().items[0] = { ...batch().items[0]!, status: "completed", phase: "submitted", result: "submitted" }
  act(() => publish({ type: "changed", table: "preparation_batches" }))
  await waitFor(() => expect(screen.getByRole("region", { name: "Selected batch item" })).toHaveTextContent("Submission confirmed"))
  expect(screen.getByRole("region", { name: "Selected batch item" })).toHaveTextContent("Item 1 of 5")
})

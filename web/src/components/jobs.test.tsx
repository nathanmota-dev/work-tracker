import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobsPage } from "@/routes/jobs"
import { publish, type Row } from "@/lib/api"

const request = vi.fn()
let jobs: Row[]
beforeEach(() => {
  jobs = [
    { id: 1, title: "Engineer", company_name: "Acme", status: "saved", archived_at: null },
    { id: 2, title: "Old role", company_name: "Other", status: "applied", archived_at: "2026-01-01T12:00:00Z" },
  ]
  request.mockReset().mockImplementation(async (path: string, body?: { id: number }) => {
    if (path === "jobs") return structuredClone(jobs)
    const job = jobs.find((row) => row.id === body?.id)!
    if (path === "jobs/archive") job.archived_at = "2026-10-11T12:00:00Z"
    if (path === "jobs/restore") job.archived_at = null
    if (path === "jobs/delete") jobs = jobs.filter((row) => row.id !== body?.id)
    return { ok: true }
  })
  window.desktop = {
    request,
    readPdf: vi.fn(),
    savePdf: vi.fn(),
    chooseSource: vi.fn(),
    connectionStatus: async () => true,
    getVersion: async () => "1",
    openExternal: vi.fn(),
    onEvent: () => () => {},
  }
})
const tab = (name: string) => fireEvent.keyDown(screen.getByRole("tab", { name }), { key: "Enter" })

it("shows active roles by default and archives/restores directly from the list", async () => {
  render(<JobsPage />)
  expect(await screen.findByText("Engineer")).toBeInTheDocument()
  expect(screen.queryByText("Old role")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Archive Engineer" }))
  await screen.findByRole("tab", { name: "New (0)" })
  expect(request).toHaveBeenCalledWith("jobs/archive", { id: 1 })
  tab("Archived (2)")
  expect(screen.getByText("Old role")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Restore Engineer" }))
  await screen.findByRole("tab", { name: "Archived (1)" })
  expect(request).toHaveBeenCalledWith("jobs/restore", { id: 1 })
  tab("New (1)")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
})

it("keeps archived details readable and disables application preparation until restored", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  tab("Archived (1)")
  fireEvent.click(screen.getByRole("button", { name: "View Old role" }))
  const details = within(screen.getByRole("dialog"))
  expect(details.getByText("applied")).toBeInTheDocument()
  expect(details.getByRole("button", { name: "Apply" })).toBeDisabled()
  expect(details.getByRole("button", { name: "Assess fit" })).toBeDisabled()
  fireEvent.click(details.getByRole("button", { name: "Restore Old role" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await screen.findByRole("tab", { name: "New (2)" })
  tab("New (2)")
  fireEvent.click(screen.getByRole("button", { name: "View Old role" }))
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" })).toBeEnabled()
})

it("requires explicit deletion confirmation, supports cancellation and refreshes after deletion", async () => {
  render(<JobsPage />)
  fireEvent.click(await screen.findByRole("button", { name: "Delete Engineer" }))
  expect(screen.getByRole("dialog")).toHaveTextContent("permanently removes")
  expect(request).not.toHaveBeenCalledWith("jobs/delete", expect.anything())
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "View Engineer" }))
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Engineer" }))
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
  fireEvent.click(screen.getByRole("button", { name: "Delete job" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(request).toHaveBeenCalledWith("jobs/delete", { id: 1 })
  await screen.findByText("No opportunities yet")
})

it("keeps failed deletions reviewable and allows retry", async () => {
  render(<JobsPage />)
  fireEvent.click(await screen.findByRole("button", { name: "Delete Engineer" }))
  request.mockRejectedValueOnce(new Error("Archive this linked job to preserve history."))
  fireEvent.click(screen.getByRole("button", { name: "Delete job" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Archive this linked job")
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Delete job" })).toBeEnabled()
  fireEvent.click(screen.getByRole("button", { name: "Delete job" }))
  await screen.findByText("No opportunities yet")
})

it("preserves rows after failed archiving and prevents duplicate actions while saving", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  let reject!: (error: Error) => void
  request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  fireEvent.click(screen.getByRole("button", { name: "Archive Engineer" }))
  expect(screen.getByRole("button", { name: "Archive Engineer" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Delete Engineer" })).toBeDisabled()
  await act(async () => reject(new Error("Archive failed")))
  expect(screen.getByRole("alert")).toHaveTextContent("Archive failed")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Archive Engineer" })).toBeEnabled()
})

it("refreshes archive state in an open details dialog after a backend event", async () => {
  render(<JobsPage />)
  fireEvent.click(await screen.findByRole("button", { name: "View Engineer" }))
  jobs[0].archived_at = "2026-10-11T12:00:00Z"
  act(() => publish({ type: "changed", table: "jobs" }))
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" })).toBeDisabled())
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore Engineer" })).toBeInTheDocument()
})

it("shows the linked application with its step and contextual next action", async () => {
  jobs = [
    { id: 1, title: "Engineer", company_name: "Acme", archived_at: null, shortlisted_at: "2026-01-01", application_id: 9, application_phase: "prepared", application_view: "preparation", application_origin: "preparation" },
    { id: 3, title: "Tracked role", company_name: "Beta", archived_at: null, shortlisted_at: "2026-01-01", application_id: 11, application_phase: "submitted", application_view: "tracking", application_origin: "manual" },
  ]
  window.location.hash = ""
  render(<JobsPage />)
  await screen.findByRole("tab", { name: "Shortlist (2)" })
  tab("Shortlist (2)")
  const row = async (title: string) => within((await screen.findByText(title)).closest("tr")!)
  expect((await row("Engineer")).getByText("Prepared")).toBeInTheDocument()
  expect((await row("Tracked role")).getByText("Submitted")).toBeInTheDocument()
  expect((await row("Tracked role")).getByRole("button", { name: "View application" })).toBeInTheDocument()
  fireEvent.click((await row("Engineer")).getByRole("button", { name: "Continue application" }))
  expect(window.location.hash).toBe("#/apply?jobId=1&applicationId=9")
  fireEvent.click(screen.getByRole("button", { name: "View Tracked role" }))
  const details = within(screen.getByRole("dialog"))
  expect(details.getByText("Application #11 · Manual · Submitted")).toBeInTheDocument()
  fireEvent.click(details.getByRole("button", { name: "View application" }))
  expect(window.location.hash).toBe("#/apply?jobId=3&applicationId=11")
  expect(details.getByRole("link", { name: "Open board" })).toHaveAttribute("href", "#/applications?view=board&highlight=11")
  expect(details.getByRole("link", { name: "View in Applications" })).toHaveAttribute("href", "#/applications")
})

it("moves a new role to the shortlist only after explicit triage", async () => {
  const original = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: { id: number }) => {
    if (path === "jobs/shortlist") jobs.find(row => row.id === body?.id)!.shortlisted_at = "2026-10-30"
    return original(path, body)
  })
  render(<JobsPage />)
  fireEvent.click(await screen.findByRole("button", { name: "Move to shortlist" }))
  await screen.findByRole("tab", { name: "Shortlist (1)" })
  tab("Shortlist (1)")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith("jobs/shortlist", { id: 1 })
})

it("archives selected new roles and keeps failed bulk actions retryable", async () => {
  jobs.push({ id: 3, title: "Another", company_name: "Acme", status: "saved" })
  render(<JobsPage />)
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Engineer" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Another" }))
  request.mockRejectedValueOnce(new Error("Archive unavailable"))
  fireEvent.click(screen.getByRole("button", { name: "Archive selected" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Archive unavailable")
  expect(screen.getByRole("checkbox", { name: "Select Engineer" })).toBeChecked()
  expect(request).not.toHaveBeenCalledWith("jobs/archive", { id: 3 })
  fireEvent.click(screen.getByRole("button", { name: "Archive selected" }))
  await screen.findByRole("tab", { name: "Archived (3)" })
  expect(request).toHaveBeenCalledWith("jobs/archive", { id: 3 })
})

it("collapses failed jobs in New, shows each requirements verdict and checks requirements from the detail and a selection", async () => {
  const prepareSkill = vi.spyOn(await import("@/lib/agent"), "prepareSkill").mockImplementation(() => {})
  jobs = [
    { id: 1, title: "Engineer", company_name: "Acme", status: "saved", archived_at: null, gate_verdict: "pass", gate_unverified: true },
    { id: 3, title: "Russian role", company_name: "Acme", status: "saved", archived_at: null, gate_verdict: "fail", gate_unverified: false },
  ]
  const fallback = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: { id: number }) => (path === "gates/jobs/3"
    ? { gate: { verdict: "fail", unverified: false, language: { status: "fail", summary: "Requires a language you do not declare: Russian.", findings: [{ verdict: "fail", note: "Requires Russian.", quote: "Fluent Russian required" }] }, eligibility: { status: "off", summary: "Set your work eligibility to enable the eligibility gate.", findings: [] } } }
    : fallback(path, body)))
  render(<JobsPage />)
  expect(await screen.findByText("Pass (unverified)")).toBeInTheDocument()
  expect(screen.queryByText("Russian role")).not.toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "New (2)" })).toBeInTheDocument()
  expect(screen.getByRole("status", { name: "Failed jobs" })).toHaveTextContent("(1 hidden)")
  fireEvent.click(screen.getByRole("checkbox", { name: /Hide failed/ }))
  expect(screen.getByText("Fail")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Russian role" }))
  fireEvent.click(screen.getByRole("button", { name: "Check requirements" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("requirements-check", { jobIds: "3" })
  fireEvent.click(screen.getByRole("button", { name: "View Russian role" }))
  const details = within(screen.getByRole("dialog"))
  expect(await details.findByRole("status", { name: "Requirements check" })).toHaveTextContent("Fluent Russian required")
  expect(details.queryByText("gate_verdict")).not.toBeInTheDocument()
  fireEvent.click(details.getByRole("button", { name: "Check requirements" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("requirements-check", { jobIds: "3" })
  prepareSkill.mockRestore()
})

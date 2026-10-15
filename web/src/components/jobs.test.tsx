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
  await screen.findByRole("tab", { name: "Active (0)" })
  expect(request).toHaveBeenCalledWith("jobs/archive", { id: 1 })
  tab("Archived (2)")
  expect(screen.getByText("Old role")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Restore Engineer" }))
  await screen.findByRole("tab", { name: "Archived (1)" })
  expect(request).toHaveBeenCalledWith("jobs/restore", { id: 1 })
  tab("Active (1)")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
})

it("keeps archived details readable and disables application preparation until restored", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  tab("Archived (1)")
  fireEvent.click(screen.getByRole("button", { name: "View Old role" }))
  const details = within(screen.getByRole("dialog"))
  expect(details.getByText("applied")).toBeInTheDocument()
  expect(details.getByRole("button", { name: "Prepare application" })).toBeDisabled()
  expect(details.getByRole("button", { name: "Assess fit" })).toBeDisabled()
  fireEvent.click(details.getByRole("button", { name: "Restore Old role" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await screen.findByRole("tab", { name: "Active (2)" })
  tab("Active (2)")
  fireEvent.click(screen.getByRole("button", { name: "View Old role" }))
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Prepare application" })).toBeEnabled()
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
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Prepare application" })).toBeDisabled())
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore Engineer" })).toBeInTheDocument()
})

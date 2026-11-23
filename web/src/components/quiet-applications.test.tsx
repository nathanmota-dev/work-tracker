import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { QuietApplications } from "./quiet-applications"
import { publish } from "@/lib/api"
import type { QuietApplication, QuietApplications as Scan } from "@/lib/application-board"
import { desktopDouble } from "@/test/doubles"

const item = (id: number, company_name: string, days_quiet: number): QuietApplication => ({
  id, company_name, role_title: `${company_name} role`, stage_name: "Applied", stage_category: "applied",
  applied_at: "2026-07-01T12:00:00.000Z", last_activity_at: "2026-07-01T12:00:00.000Z", days_quiet,
})
let scans: Record<string, Scan>
beforeEach(() => {
  scans = {
    "application-board/quiet": {
      days: 60,
      items: [item(1, "Acme", 90), item(2, "Globex", 61)],
      skipped: [{ id: 3, company_name: "Initech", role_title: null, reason: 'Unreadable date: applied_at "soon"' }],
    },
    "application-board/quiet?days=80": { days: 80, items: [item(1, "Acme", 90)], skipped: [] },
  }
  window.desktop = desktopDouble()
  vi.mocked(window.desktop.request).mockImplementation(async (path: string, body?: unknown) => {
    if (path === "application-board/quiet/resolve") {
      const { ids } = body as { ids: number[] }
      scans["application-board/quiet"] = { days: 60, items: [], skipped: [] }
      return { resolved: ids.filter((id) => id !== 2), skipped: ids.includes(2) ? [{ id: 2, reason: "No longer quiet" }] : [] }
    }
    return scans[path] ?? { days: 60, items: [], skipped: [] }
  })
})
afterEach(() => {
  delete window.desktop
})
const open = async () => {
  render(<QuietApplications />)
  expect(await screen.findByText("2 applications quiet for 60+ days")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Review quiet applications" }))
  return within(await screen.findByRole("dialog", { name: "Quiet applications" }))
}

it("shows no banner while nothing is quiet", async () => {
  scans["application-board/quiet"] = { days: 60, items: [], skipped: [] }
  render(<QuietApplications />)
  await waitFor(() => expect(window.desktop!.request).toHaveBeenCalledWith("application-board/quiet", undefined))
  expect(screen.queryByText(/quiet for/)).not.toBeInTheDocument()
})

it("lists quiet applications and reports the ones with unreadable dates", async () => {
  const dialog = await open()
  const table = within(await dialog.findByRole("table", { name: "Quiet applications" }))
  expect(table.getAllByRole("row").map((row) => row.textContent)).toEqual([
    "CompanyRoleStageSubmittedDays quiet",
    expect.stringMatching(/^AcmeAcme roleApplied.*2026.*90$/),
    expect.stringMatching(/^GlobexGlobex roleApplied.*61$/),
  ])
  expect(dialog.getByRole("list", { name: "Applications with unreadable dates" })).toHaveTextContent('Initech: Unreadable date: applied_at "soon". It is left open.')
  expect(dialog.getByRole("button", { name: "Close selected as No response" })).toBeDisabled()
})

it("rescans with a valid threshold and rejects one below the minimum", async () => {
  const dialog = await open()
  const field = dialog.getByLabelText("Days without activity")
  fireEvent.change(field, { target: { value: "5" } })
  expect(dialog.getByRole("alert")).toHaveTextContent("Use a whole number of at least 7 days.")
  expect(window.desktop!.request).not.toHaveBeenCalledWith("application-board/quiet?days=5", undefined)
  fireEvent.change(field, { target: { value: "80" } })
  await waitFor(() => expect(dialog.queryByText("Globex")).not.toBeInTheDocument())
  expect(dialog.getByText("Acme")).toBeInTheDocument()
  expect(dialog.queryByRole("alert")).not.toBeInTheDocument()
})

it("selects rows, confirms the count and shows what was closed and skipped", async () => {
  const dialog = await open()
  await dialog.findByRole("table", { name: "Quiet applications" })
  fireEvent.click(dialog.getByRole("checkbox", { name: "Select all" }))
  expect(dialog.getByRole("checkbox", { name: "Select Globex" })).toBeChecked()
  fireEvent.click(dialog.getByRole("checkbox", { name: "Select Globex" }))
  expect(dialog.getByRole("checkbox", { name: "Select all" })).not.toBeChecked()
  fireEvent.click(dialog.getByRole("checkbox", { name: "Select Globex" }))
  fireEvent.click(dialog.getByRole("button", { name: "Close selected as No response" }))
  const confirm = within(dialog.getByRole("group", { name: "Confirm closing" }))
  expect(confirm.getByText(/Close 2 applications as No response\?/)).toBeInTheDocument()
  fireEvent.click(confirm.getByRole("button", { name: "Keep open" }))
  expect(window.desktop!.request).not.toHaveBeenCalledWith("application-board/quiet/resolve", expect.anything())
  fireEvent.click(dialog.getByRole("button", { name: "Close selected as No response" }))
  fireEvent.click(dialog.getByRole("button", { name: "Close 2 applications" }))
  expect(await dialog.findByText("Closed 1 application as No response.")).toBeInTheDocument()
  expect(window.desktop!.request).toHaveBeenCalledWith("application-board/quiet/resolve", { ids: [1, 2], days: 60 })
  expect(dialog.getByRole("list", { name: "Skipped applications" })).toHaveTextContent("Globex: No longer quiet")
  expect(await dialog.findByText("No submitted application is quiet for this long.")).toBeInTheDocument()
  fireEvent.click(dialog.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("keeps the selection and shows the error when closing fails, and follows live changes", async () => {
  const dialog = await open()
  await dialog.findByRole("table", { name: "Quiet applications" })
  vi.mocked(window.desktop!.request).mockRejectedValueOnce(new Error("Backend unavailable."))
  fireEvent.click(dialog.getByRole("checkbox", { name: "Select Acme" }))
  fireEvent.click(dialog.getByRole("button", { name: "Close selected as No response" }))
  fireEvent.click(dialog.getByRole("button", { name: "Close 1 application" }))
  expect(await dialog.findByText("Backend unavailable.")).toBeInTheDocument()
  expect(dialog.getByRole("checkbox", { name: "Select Acme" })).toBeChecked()
  scans["application-board/quiet"] = { days: 60, items: [item(2, "Globex", 61)], skipped: [] }
  act(() => publish({ type: "changed", table: "application_events" }))
  expect(await screen.findByText("1 application quiet for 60+ days")).toBeInTheDocument()
})

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobsPage } from "@/routes/jobs"
import { publish, type Row } from "@/lib/api"

const request = vi.fn()
let jobs: Row[]
let best: unknown[]
beforeEach(() => {
  best = []
  jobs = [
    { id: 1, title: "Engineer", company_name: "Acme", status: "saved", archived_at: null },
    { id: 2, title: "Old role", company_name: "Other", status: "applied", archived_at: "2026-01-01T12:00:00Z" },
  ]
  request.mockReset().mockImplementation(async (path: string, body?: { id: number }) => {
    if (path === "jobs") return structuredClone(jobs)
    if (path === "ats/best") return structuredClone(best)
    if (path.startsWith("ats/jobs/")) return { job_id: 1, keywords: [], documents: [] }
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

type Scope = Pick<typeof screen, "getByRole">
/** Opens a card's or the details' ⋯ menu and picks one of its items. */
const menu = async (title: string, item: string, scope: Scope = screen) => {
  fireEvent.keyDown(scope.getByRole("button", { name: `More actions for ${title}` }), { key: "Enter" })
  fireEvent.click(await screen.findByRole("menuitem", { name: item }))
}
/** Picks an option of a filter pill, such as Sort. */
const choose = async (label: RegExp, option: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: label }), { key: "Enter" })
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }))
}
const open = (title: string) => fireEvent.click(screen.getByRole("button", { name: `View details of ${title}` }))
const details = () => within(screen.getByRole("dialog"))
const card = (title: string) => within(screen.getByRole("article", { name: title }))
const order = () => screen.getAllByRole("article").map(item => item.getAttribute("aria-label"))

it("shows active roles by default and archives/restores from the card menu", async () => {
  render(<JobsPage />)
  expect(await screen.findByText("Engineer")).toBeInTheDocument()
  expect(screen.queryByText("Old role")).not.toBeInTheDocument()
  await menu("Engineer", "Archive")
  await screen.findByRole("tab", { name: "New (0)" })
  expect(request).toHaveBeenCalledWith("jobs/archive", { id: 1 })
  tab("Archived (2)")
  expect(screen.getByText("Old role")).toBeInTheDocument()
  await menu("Engineer", "Restore")
  await screen.findByRole("tab", { name: "Archived (1)" })
  expect(request).toHaveBeenCalledWith("jobs/restore", { id: 1 })
  tab("New (1)")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
})

it("keeps archived details readable and disables application preparation until restored", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  tab("Archived (1)")
  open("Old role")
  expect(details().getByText("Archived")).toBeInTheDocument()
  expect(details().getByRole("button", { name: "Apply" })).toBeDisabled()
  expect(details().getByRole("button", { name: "Assess fit" })).toBeDisabled()
  await menu("Old role", "Restore", details())
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await screen.findByRole("tab", { name: "New (2)" })
  tab("New (2)")
  open("Old role")
  expect(details().getByRole("button", { name: "Apply" })).toBeEnabled()
})

it("requires explicit deletion confirmation, supports cancellation and refreshes after deletion", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  await menu("Engineer", "Delete")
  expect(screen.getByRole("dialog")).toHaveTextContent("permanently removes")
  expect(request).not.toHaveBeenCalledWith("jobs/delete", expect.anything())
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  open("Engineer")
  await menu("Engineer", "Delete", details())
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
  fireEvent.click(screen.getByRole("button", { name: "Delete job" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(request).toHaveBeenCalledWith("jobs/delete", { id: 1 })
  await screen.findByText("No roles yet")
})

it("keeps failed deletions reviewable and allows retry", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  await menu("Engineer", "Delete")
  request.mockRejectedValueOnce(new Error("Archive this linked job to preserve history."))
  fireEvent.click(screen.getByRole("button", { name: "Delete job" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Archive this linked job")
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Delete job" })).toBeEnabled()
  fireEvent.click(screen.getByRole("button", { name: "Delete job" }))
  await screen.findByText("No roles yet")
})

it("preserves cards after failed archiving and prevents duplicate actions while saving", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  let reject!: (error: Error) => void
  request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  await menu("Engineer", "Archive")
  await waitFor(() => expect(screen.getByRole("button", { name: "More actions for Engineer" })).toBeDisabled())
  expect(screen.getByRole("checkbox", { name: "Select Engineer" })).toBeDisabled()
  await act(async () => reject(new Error("Archive failed")))
  expect(screen.getByRole("alert")).toHaveTextContent("Archive failed")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "More actions for Engineer" })).toBeEnabled()
})

it("refreshes archive state in open details after a backend event", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  open("Engineer")
  jobs[0].archived_at = "2026-10-11T12:00:00Z"
  act(() => publish({ type: "changed", table: "jobs" }))
  await waitFor(() => expect(details().getByRole("button", { name: "Apply" })).toBeDisabled())
  await menu("Engineer", "Restore", details())
  expect(request).toHaveBeenCalledWith("jobs/restore", { id: 1 })
})

it("shows the linked application on the card and its next action in the details", async () => {
  jobs = [
    { id: 1, title: "Engineer", company_name: "Acme", archived_at: null, shortlisted_at: "2026-01-01", application_id: 9, application_phase: "prepared", application_view: "preparation", application_origin: "preparation" },
    { id: 3, title: "Tracked role", company_name: "Beta", archived_at: null, shortlisted_at: "2026-01-01", application_id: 11, application_phase: "submitted", application_view: "tracking", application_origin: "manual" },
  ]
  window.location.hash = ""
  render(<JobsPage />)
  await screen.findByRole("tab", { name: "Shortlist (2)" })
  tab("Shortlist (2)")
  expect((await screen.findByRole("article", { name: "Engineer" })) && card("Engineer").getByText("Prepared")).toBeInTheDocument()
  expect(card("Tracked role").getByText("Submitted")).toBeInTheDocument()
  open("Engineer")
  fireEvent.click(details().getByRole("button", { name: "Continue application" }))
  expect(window.location.hash).toBe("#/apply?jobId=1&applicationId=9")
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  open("Tracked role")
  expect(details().getByText("Application #11 · Manual · Submitted")).toBeInTheDocument()
  fireEvent.click(details().getByRole("button", { name: "View application" }))
  expect(window.location.hash).toBe("#/apply?jobId=3&applicationId=11")
  expect(details().getByRole("link", { name: "Open board" })).toHaveAttribute("href", "#/applications?view=board&highlight=11")
  expect(details().getByRole("link", { name: "View in Applications" })).toHaveAttribute("href", "#/applications")
})

it("moves a new role to the shortlist only after explicit triage", async () => {
  const original = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: { id: number }) => {
    if (path === "jobs/shortlist") jobs.find(row => row.id === body?.id)!.shortlisted_at = "2026-10-30"
    return original(path, body)
  })
  render(<JobsPage />)
  await screen.findByText("Engineer")
  await menu("Engineer", "Move to shortlist")
  await screen.findByRole("tab", { name: "Shortlist (1)" })
  tab("Shortlist (1)")
  expect(screen.getByText("Engineer")).toBeInTheDocument()
  open("Engineer")
  expect(details().getByRole("button", { name: "Apply" })).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith("jobs/shortlist", { id: 1 })
})

it("archives selected new roles from the selection bar and keeps failed bulk actions retryable", async () => {
  jobs.push({ id: 3, title: "Another", company_name: "Acme", status: "saved" })
  render(<JobsPage />)
  expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Engineer" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Another" }))
  const bar = within(screen.getByRole("toolbar", { name: "Selection actions" }))
  expect(bar.getByRole("status")).toHaveTextContent("2 selected")
  request.mockRejectedValueOnce(new Error("Archive unavailable"))
  fireEvent.click(bar.getByRole("button", { name: "Archive" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Archive unavailable")
  expect(screen.getByRole("checkbox", { name: "Select Engineer" })).toBeChecked()
  expect(request).not.toHaveBeenCalledWith("jobs/archive", { id: 3 })
  fireEvent.click(within(screen.getByRole("toolbar", { name: "Selection actions" })).getByRole("button", { name: "Archive" }))
  await screen.findByRole("tab", { name: "Archived (3)" })
  expect(request).toHaveBeenCalledWith("jobs/archive", { id: 3 })
  expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument()
})

it("selects every filtered role and clears the selection from the bar", async () => {
  jobs.push({ id: 3, title: "Another", company_name: "Acme", status: "saved" })
  render(<JobsPage />)
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Engineer" }))
  const bar = () => within(screen.getByRole("toolbar", { name: "Selection actions" }))
  fireEvent.click(bar().getByRole("button", { name: "Select all 2" }))
  expect(bar().getByRole("status")).toHaveTextContent("2 selected")
  expect(screen.getByRole("checkbox", { name: "Select Another" })).toBeChecked()
  fireEvent.click(bar().getByRole("button", { name: "Clear selection" }))
  expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument()
})

it("searches and filters by work type and score band", async () => {
  jobs = [
    { id: 1, title: "Frontend", company_name: "Acme", archived_at: null, work_type: "Remote", description: "React and TypeScript" },
    { id: 3, title: "Backend", company_name: "Beta", archived_at: null, work_type: "On-site", ranking_status: "scored", ranking_overall: 85, ranking_verdict: "Strong Fit" },
  ]
  render(<JobsPage />)
  await screen.findByText("Frontend")
  fireEvent.change(screen.getByRole("searchbox", { name: "Search opportunities" }), { target: { value: "react" } })
  expect(order()).toEqual(["Frontend"])
  expect(screen.getByText(/1 of 2 roles/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
  await choose(/^Work type/, "On-site")
  expect(order()).toEqual(["Backend"])
  await choose(/^Work type/, "Any")
  await choose(/^Score/, "Strong")
  expect(order()).toEqual(["Backend"])
  await choose(/^Score/, "Not scored")
  expect(order()).toEqual(["Frontend"])
  await choose(/^Score/, "Weak")
  expect(screen.getByText("No matching roles")).toBeInTheDocument()
})

it("shows the triage score on each card, sorts by score and keeps the triage note in the details", async () => {
  jobs = [
    { id: 1, title: "Plain", company_name: "Acme", archived_at: null, ranking_status: null },
    { id: 3, title: "Middle", company_name: "Acme", archived_at: null, ranking_status: "scored", ranking_overall: 60, ranking_verdict: "Good Fit" },
    { id: 4, title: "Urgent", company_name: "Acme", archived_at: null, ranking_status: "scored", ranking_overall: 60, ranking_verdict: "Good Fit", closing_soon: true },
    { id: 5, title: "Top", company_name: "Acme", archived_at: null, ranking_status: "scored", ranking_overall: 82, ranking_verdict: "Strong Fit" },
    { id: 6, title: "Blocked", company_name: "Acme", archived_at: null, ranking_status: "gave_up", ranking_attempts: 4 },
    { id: 7, title: "Broken", company_name: "Acme", archived_at: null, ranking_status: "unreachable", ranking_attempts: 1 },
    { id: 8, title: "Closed", company_name: "Acme", archived_at: null, ranking_status: "expired", ranking_expired_reason: "deadline" },
  ]
  render(<JobsPage />)
  await screen.findByText("Plain")
  const top = card("Top").getByRole("meter", { name: "Fit score" })
  expect(top).toHaveAttribute("aria-valuenow", "82")
  expect(top).toHaveAttribute("data-tone", "good")
  expect(card("Middle").getByRole("meter", { name: "Fit score" })).toHaveAttribute("data-tone", "good")
  expect(card("Urgent").getByText("Closing soon")).toBeInTheDocument()
  // Nothing to show yet: the card leaves the bar out instead of an empty track.
  expect(card("Plain").queryByRole("meter")).not.toBeInTheDocument()
  expect(card("Blocked").getByText("Check manually")).toBeInTheDocument()
  expect(card("Broken").getByText("Unreachable (attempt 1)")).toBeInTheDocument()
  expect(card("Closed").getByText("Expired (deadline passed)")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Rank roles/ })).toBeInTheDocument()
  await choose(/^Sort/, "Highest score")
  expect(order().slice(0, 3)).toEqual(["Top", "Urgent", "Middle"])
  await choose(/^Sort/, "Recently saved")
  expect(order()[0]).toBe("Plain")
  open("Top")
  expect(details().getByRole("meter", { name: "Fit score" })).toHaveAttribute("title", expect.stringMatching(/Triage score from the posting text only/))
  for (const key of ["ranking overall", "ranking status", "ranking verdict", "closing soon"]) expect(details().queryByText(key)).not.toBeInTheDocument()
})

it("lists failed jobs with the rest, shows the requirements verdict in the details and checks requirements from the detail and a selection", async () => {
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
  expect(await screen.findByText("Russian role")).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "New (2)" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Russian role" }))
  fireEvent.click(within(screen.getByRole("toolbar", { name: "Selection actions" })).getByRole("button", { name: "Check requirements" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("requirements-check", { jobIds: "3" })
  open("Russian role")
  expect(details().getByText("Fail")).toBeInTheDocument()
  expect(await details().findByRole("status", { name: "Requirements check" })).toHaveTextContent("Fluent Russian required")
  expect(details().queryByText("gate_verdict")).not.toBeInTheDocument()
  fireEvent.click(details().getByRole("button", { name: "Check requirements" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("requirements-check", { jobIds: "3" })
  prepareSkill.mockRestore()
})

it("falls back to the best resume match on the card, sorts by it and shows it in the details", async () => {
  jobs = [
    { id: 1, title: "Plain", company_name: "Acme", archived_at: null },
    { id: 3, title: "Node role", company_name: "Acme", archived_at: null, ranking_status: "scored", ranking_overall: 50, ranking_verdict: "Moderate Fit" },
    { id: 4, title: "C# role", company_name: "Acme", archived_at: null },
    { id: 5, title: "Vague role", company_name: "Acme", archived_at: null },
  ]
  best = [
    { job_id: 3, document_key: "variant:n", variant_id: "n", label: "Back-End · Node.js", score: 55, band: "partial" },
    { job_id: 4, document_key: "variant:c", variant_id: "c", label: "Back-End · C#", score: 90, band: "strong" },
    { job_id: 5, document_key: "variant:c", variant_id: "c", label: "Back-End · C#", score: null, band: null },
  ]
  render(<JobsPage />)
  const match = await screen.findByRole("meter", { name: "Resume match" })
  expect(match).toHaveAttribute("aria-valuenow", "90")
  expect(match).toHaveAttribute("data-tone", "good")
  expect(card("Node role").getByRole("meter", { name: "Fit score" })).toHaveAttribute("data-tone", "warn")
  expect(card("Vague role").queryByRole("meter")).not.toBeInTheDocument()
  await choose(/^Sort/, "Best resume match")
  expect(order()).toEqual(["C# role", "Node role", "Plain", "Vague role"])
  open("C# role")
  expect(details().getByRole("meter", { name: "Resume match" })).toHaveAttribute("aria-valuenow", "90")
  expect(details().getByText("90 · Back-End · C#")).toBeInTheDocument()
  expect(details().queryByText("ats match")).not.toBeInTheDocument()
})

it("opens Discover opportunities as its own view and returns to the cards", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  fireEvent.click(screen.getByRole("button", { name: "Discover opportunities" }))
  expect(screen.getByRole("heading", { name: "Discover opportunities" })).toBeInTheDocument()
  // Finding jobs with the agent comes first, then the direct search and the role assessment.
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Find jobs", "Search LinkedIn", "Assess a role"])
  expect(screen.getByRole("button", { name: "Find jobs with agent" })).toBeDisabled()
  expect(screen.queryByRole("article", { name: "Engineer" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Back to jobs" }))
  expect(screen.getByRole("article", { name: "Engineer" })).toBeInTheDocument()
})

it("adds a job from the side panel and cancels without saving", async () => {
  render(<JobsPage />)
  await screen.findByText("Engineer")
  fireEvent.click(screen.getByRole("button", { name: "Add job" }))
  const form = within(screen.getByRole("dialog"))
  expect(form.getByRole("heading", { name: "Add job" })).toBeInTheDocument()
  expect(form.getByRole("heading", { name: "Role" })).toBeInTheDocument()
  expect(form.getByRole("button", { name: "Import" })).toBeDisabled()
  expect(form.getByText("More details")).toBeInTheDocument()
  fireEvent.click(form.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(request).not.toHaveBeenCalledWith("jobs/create", expect.anything())
})

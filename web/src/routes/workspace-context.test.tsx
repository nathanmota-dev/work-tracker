import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Outlet, RouterProvider } from "@tanstack/react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { createAppRouter } from "@/router"
import { AgentPanel } from "@/components/agent-panel"
import { setAgentPanelOpen } from "@/lib/agent"
import { publish, type Row } from "@/lib/api"

vi.mock("@/components/ui/select-control", () => ({ SelectControl: (props: React.ComponentProps<"select">) => <select {...props} /> }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: () => <div>PDF fixture</div> }))
const request = vi.fn()
let jobs: Row[]
beforeEach(() => {
  setAgentPanelOpen(false)
  window.scrollTo = vi.fn()
  localStorage.clear()
  jobs = Array.from({ length: 32 }, (_, index) => ({ id: index + 1, title: `Engineer ${index + 1}`, company_name: "Example", description: `Description ${index + 1}`, status: "saved" }))
  request.mockReset().mockImplementation(async (path: string, body?: { jobId?: number }) => {
    if (path === "acp/permissions") return { pending: [] }
    if (path === "jobs") return structuredClone(jobs)
    if (path === "application-preparation/details") return { job: jobs.find(job => job.id === body?.jobId), runs: [], busy: false }
    if (path === "acp/providers") return { providers: [{ id: "fake", displayName: "Fixture", models: ["test"] }], default: "fake" }
    if (path === "resume-sources") return { config: {}, dependencies: [], warnings: [] }
    if (path === "integrations/status") return { entries: [], dependencies: [] }
    if (path === "search/jobs") return jobs.map(job => ({ ...job, link: `https://example.com/${job.id}` }))
    return []
  })
  window.desktop = { request, connectionStatus: async () => true, onEvent: () => () => {}, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), getVersion: async () => "1", openExternal: vi.fn() }
})
async function mount(path: string) {
  window.location.hash = path
  const router = createAppRouter(() => <><Outlet /><AgentPanel /></>)
  const view = render(<RouterProvider router={router} />)
  await act(() => router.load())
  return { router, view }
}
async function go(router: ReturnType<typeof createAppRouter>, href: string) {
  await act(() => router.navigate({ href }))
}

it("Jobs → Apply → back restores filters, page and selected details from the URL", async () => {
  const { router } = await mount("/jobs?q=Engineer&page=1&status=saved&selected=20")
  expect(await screen.findByRole("dialog")).toHaveTextContent("Engineer 20")
  expect(screen.getByText("32 results · Page 2 of 3")).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Prepare application" }))
  await screen.findByRole("heading", { name: "Apply" })
  await screen.findByLabelText("Additional context")
  act(() => router.history.back())
  expect(await screen.findByRole("dialog")).toHaveTextContent("Engineer 20")
  expect(screen.getByLabelText("Search Opportunities")).toHaveValue("Engineer")
  expect(screen.getByLabelText("Filter by status")).toHaveValue("saved")
  expect(screen.getByText("32 results · Page 2 of 3")).toBeInTheDocument()
  expect(router.state.location.search).toMatchObject({ page: 1, selected: "20", q: "Engineer" })
})

it("restores the right draft after switching jobs, application attempts and remounting", async () => {
  const { router, view } = await mount("/apply?jobId=1&applicationId=10")
  fireEvent.change(await screen.findByLabelText("Additional context"), { target: { value: "First context" } })
  fireEvent.change(screen.getByLabelText("Job description"), { target: { value: "Unsaved first description" } })
  await go(router, "/apply?jobId=2&applicationId=20")
  expect(await screen.findByLabelText("Additional context")).toHaveValue("")
  expect(screen.getByLabelText("Job description")).toHaveValue("Description 2")
  fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Second context" } })
  await go(router, "/apply?jobId=1&applicationId=11")
  expect(await screen.findByLabelText("Additional context")).toHaveValue("")
  await go(router, "/apply?jobId=1&applicationId=10")
  expect(await screen.findByLabelText("Additional context")).toHaveValue("First context")
  expect(screen.getByLabelText("Job description")).toHaveValue("Unsaved first description")
  jobs[0].description = "Background description"
  act(() => publish({ type: "changed", table: "jobs" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/details", { jobId: 1, applicationId: 10 }))
  expect(screen.getByLabelText("Job description")).toHaveValue("Unsaved first description")
  view.unmount()
  await mount("/apply?jobId=1&applicationId=10")
  expect(await screen.findByLabelText("Additional context")).toHaveValue("First context")
  expect(screen.getByLabelText("Job description")).toHaveValue("Unsaved first description")
})

it("removes deleted jobs while keeping archived selections reviewable and preserving drafts", async () => {
  const draft = JSON.stringify({ extra: "Keep for archived role" })
  localStorage.setItem("work-tracker-context-v1:apply:job:2:application:job", draft)
  const { router } = await mount('/jobs?selected=1&selection=%5B%221%22%2C%222%22%2C%223%22%5D')
  await screen.findByRole("dialog")
  jobs = jobs.filter(job => job.id !== 1)
  jobs.find(job => job.id === 2)!.archived_at = "2026-01-01"
  act(() => publish({ type: "changed", table: "jobs" }))
  await waitFor(() => {
    expect(router.state.location.search.selection).toEqual(["3"])
    expect(router.state.location.search.selected ?? "").toBe("")
  })
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByText("1 selected")).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole("tab", { name: "Archived (1)" }), { key: "Enter" })
  expect(await screen.findByRole("checkbox", { name: "Select Engineer 2" })).not.toBeChecked()
  expect(router.state.location.search.selection ?? []).toEqual([])
  expect(localStorage.getItem("work-tracker-context-v1:apply:job:2:application:job")).toBe(draft)
})

it("Search assessment keeps results, pagination and selection while the panel opens", async () => {
  const { router } = await mount("/jobs?keywords=Engineer&location=Remote&maxPages=2")
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Engineer 1" }))
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  await waitFor(() => expect(screen.getByText("32 results · Page 2 of 3")).toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "View Engineer 20" }))
  fireEvent.click(await screen.findByRole("button", { name: "Assess fit" }))
  const panel = await screen.findByRole("dialog", { name: "Agent task" })
  expect(router.state.location.pathname).toBe("/jobs")
  fireEvent.change(within(panel).getByLabelText("Additional context"), { target: { value: "Assessment context" } })
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }))
  expect(screen.getByText("1 selected")).toBeInTheDocument()
  expect(screen.getByText("32 results · Page 2 of 3")).toBeInTheDocument()
  expect(screen.getByLabelText("Keywords")).toHaveValue("Engineer")
  expect(request.mock.calls.filter(([path]) => path === "search/jobs")).toHaveLength(0)
  await go(router, "/profile")
  act(() => setAgentPanelOpen(true))
  expect(await screen.findByLabelText("Additional context")).toHaveValue("Assessment context")
  act(() => setAgentPanelOpen(false))
  await go(router, "/launch?skill=deep-scout&query=other&target=other")
  expect(await screen.findByLabelText("Role, keywords or job URL")).toHaveValue("other")
  fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Console context" } })
  await go(router, "/launch?skill=deep-scout&query=another&target=another")
  expect(await screen.findByLabelText("Additional context")).toHaveValue("")
  await go(router, "/launch?skill=deep-scout&query=other&target=other")
  expect(await screen.findByLabelText("Additional context")).toHaveValue("Console context")
})

it("uses route defaults for invalid URLs in Jobs, Search, Apply and Launch", async () => {
  const { router } = await mount("/jobs?page=-1&view=bad&status=bad&q=%5B%5D")
  expect(await screen.findByLabelText("Search Opportunities")).toHaveValue("")
  expect(screen.getByText("32 results · Page 1 of 3")).toBeInTheDocument()
  await go(router, "/search?kind=jobs&maxPages=-5&workType=office")
  expect(await screen.findByLabelText("Pages to search")).toHaveValue(1)
  expect(screen.getByLabelText("Work arrangement")).toHaveValue("")
  await go(router, "/apply?jobId=-2&applicationId=oops&pdfTab=bad")
  expect(await screen.findByLabelText("Saved job")).toHaveValue("")
  await go(router, "/launch?skill=bad")
  expect(await screen.findByLabelText("Skill")).toHaveValue("job-scout")
})

it("redirects legacy job search links and preserves criteria on return", async () => {
  const { router } = await mount("/search?kind=jobs&keywords=Engineer&location=Remote&maxPages=2&workType=remote")
  expect(router.state.location.pathname).toBe("/jobs")
  expect(await screen.findByLabelText("Keywords")).toHaveValue("Engineer")
  expect(screen.getByLabelText("Location")).toHaveValue("Remote")
  expect(screen.getByLabelText("Pages to search")).toHaveValue(2)
  await go(router, "/profile")
  act(() => router.history.back())
  expect(await screen.findByLabelText("Keywords")).toHaveValue("Engineer")
  expect(screen.getByLabelText("Work arrangement")).toHaveValue("remote")
})

it("Apply checklist → Answers correction → back keeps the review, and completing it never confirms the submission", async () => {
  const pending = (label: string, key: string, reason: string, correctionKey: string | null) => ({ label, key, answer: null, result: "pending", reason, reasonText: `${label} needs you.`, correctionKey })
  const fill = { applicationId: 10, runId: "run-1", portal: "lever", portalLabel: "Lever", reviewUrl: null, document: null, fillStatus: "filled", submitted: false, submittedAt: null, filled: 0, pending: 2, instruction: "Work Tracker never submits.",
    items: [pending("Phone", "phone", "no-stored-answer", "phone"), pending("Gender", "eeo_gender", "eeo-human-only", null)] }
  const original = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: { jobId?: number }) => path === "application-preparation/details"
    ? { job: jobs[0], runs: [], busy: false, applicationStatus: "filled", fill, journey: { id: 10, fill_status: "filled", submission_status: "not_submitted" } } : original(path, body))
  const { router } = await mount("/apply?jobId=1&applicationId=10")
  fireEvent.click(await screen.findByRole("checkbox", { name: "Completed Gender in the portal" }))
  await go(router, screen.getByRole("link", { name: "Add answer for Phone" }).getAttribute("href")!.slice(1))
  expect(await screen.findByRole("dialog")).toHaveTextContent("Add an answer")
  expect(router.state.location.search).toMatchObject({ field: "phone", returnTo: "/apply?jobId=1&applicationId=10" })
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await go(router, screen.getByRole("link", { name: "Back to the application checklist" }).getAttribute("href")!.slice(1))
  expect(await screen.findByRole("checkbox", { name: "Completed Gender in the portal" })).toBeChecked()
  expect(screen.getByText("1 pending field to complete in the portal.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "Completed Phone in the portal" }))
  expect(screen.getByText(/^Checklist complete\. The application is not submitted yet/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "I submitted in the browser" })).toBeInTheDocument()
  expect(request).not.toHaveBeenCalledWith("application-preparation/submitted", expect.anything())
  await go(router, "/answers?returnTo=https%3A%2F%2Fexample.com")
  expect(await screen.findByRole("heading", { name: "Answers" })).toBeInTheDocument()
  expect(screen.queryByRole("link", { name: "Back to the application checklist" })).not.toBeInTheDocument()
})

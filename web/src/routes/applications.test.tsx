import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApplicationsPage } from "./applications"
import { useApi, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
import { prepareSkill } from "@/lib/agent"
import { desktopDouble } from "@/test/doubles"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
vi.mock("@/lib/preparation", () => ({ openApply: vi.fn() }))
vi.mock("@/lib/agent", async (original) => ({ ...(await original<typeof import("@/lib/agent")>()), prepareSkill: vi.fn() }))
// Radix Select measures and scrolls its listbox; jsdom implements neither.
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.hasPointerCapture = vi.fn(() => false)
/** Picks an option of a filter pill, such as Origin or Sort. */
async function choose(label: RegExp, option: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: label }), { key: "Enter" })
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }))
}
const card = (title: string) => within(screen.getByRole("article", { name: title }))
const view = (title: string) => fireEvent.click(screen.getByRole("button", { name: `View details of ${title}` }))
let rows: Row[]
const refresh = vi.fn()
beforeEach(() => {
  rows = [
    {
      id: 2,
      job_id: 7,
      job_title: "Engineer",
      company_name: "Acme",
      status: "draft",
      keyword_score: 0,
      applied_at: null,
      external_url: "https://portal.invalid",
    },
    { id: 3, job_title: "Designer", keyword_score: null },
  ]
  vi.mocked(useApi).mockImplementation(() => ({
    data: rows,
    loading: false,
    error: "",
    refresh,
  }))
  vi.mocked(openApply).mockClear()
  refresh.mockClear()
  window.desktop = desktopDouble()
})
afterEach(() => {
  delete window.desktop
})
it("shows the keyword match only when scored and marks unsubmitted applications", () => {
  render(<ApplicationsPage />)
  expect(card("Engineer").getByText("Match 0")).toBeInTheDocument()
  expect(card("Designer").queryByText(/^Match/)).not.toBeInTheDocument()
  expect(screen.getAllByText("Not submitted")).toHaveLength(2)
  expect(card("Engineer").getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuetext", "Draft, step 1 of 4")
})
it("opens details/portal and prepares the selected application", async () => {
  render(<ApplicationsPage />)
  expect(screen.queryByRole("button", { name: "Tailor a resume" })).not.toBeInTheDocument()
  view("Engineer")
  const dialog = within(screen.getByRole("dialog"))
  expect(screen.getByRole("dialog")).toHaveTextContent("Acme")
  fireEvent.click(dialog.getByRole("button", { name: "Open portal" }))
  await waitFor(() =>
    expect(window.desktop!.openExternal).toHaveBeenCalledWith(
      "https://portal.invalid/",
    ),
  )
  fireEvent.click(dialog.getByRole("button", { name: "Prepare application" }))
  expect(openApply).toHaveBeenCalledWith(7, 2)
})
it("links the job of a manual application before opening its detail and hides unsafe links", async () => {
  rows = [
    { id: 3, job_title: "No target" },
    { id: 4, job_title: "Unsafe", external_url: "javascript:bad" },
  ]
  vi.mocked(window.desktop!.request).mockImplementation(async (path: string) =>
    path === "application-board/link/options"
      ? { application_id: 3, role_title: "No target", company_name: "Manual Co", external_url: "https://manual.co/job", comp: null, missing: ["description"], candidates: [] }
      : path === "application-board/link"
        ? { application_id: 3, job_id: 12, created_job: true, missing: [] }
        : { items: [] },
  )
  render(<ApplicationsPage />)
  view("Unsafe")
  expect(
    screen.queryByRole("button", { name: "Open portal" }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  view("No target")
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Prepare application" }))
  const dialog = within(await screen.findByRole("dialog", { name: "Prepare this application" }))
  expect(await dialog.findByLabelText("Role title")).toHaveValue("No target")
  expect(openApply).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole("button", { name: "Link and open the application" }))
  await waitFor(() => expect(openApply).toHaveBeenCalledWith(12, 3))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})
it("shows empty/error states and retries", () => {
  rows = []
  const instance = render(<ApplicationsPage />)
  expect(screen.getByText("No applications yet")).toBeInTheDocument()
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    loading: false,
    error: "applications offline",
    refresh,
  })
  instance.rerender(<ApplicationsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})
it("splits manual and generated records into views with origin, step and next action", async () => {
  rows = [
    { id: 10, job_id: 1, job_title: "Draft role", origin: "preparation", phase: "draft", view: "preparation" },
    { id: 11, job_id: 2, job_title: "Filled role", origin: "agent", phase: "filled", view: "preparation" },
    { id: 12, job_title: "Manual role", origin: "manual", phase: "submitted", view: "tracking", applied_at: "2026-10-01T12:00:00Z" },
    { id: 13, job_title: "Closed role", origin: "manual", phase: "submitted", view: "archived" },
    { id: 14, job_title: "Legacy role", origin: "unknown", phase: "submitted", view: "preparation" },
  ]
  render(<ApplicationsPage />)
  expect(screen.getByRole("heading", { name: "Applications", level: 1 })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "All (5)" })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "Preparation (3)" })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "Tracking (1)" })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "Archived (1)" })).toBeInTheDocument()
  expect(card("Draft role").getByText("Apply")).toBeInTheDocument()
  expect(card("Filled role").getByText("Agent")).toBeInTheDocument()
  expect(card("Manual role").getByText("Manual")).toBeInTheDocument()
  fireEvent.click(card("Filled role").getByRole("button", { name: "Submit in Apply" }))
  expect(openApply).toHaveBeenCalledWith(2, 11)
  expect(card("Manual role").getByRole("link", { name: "Open board" })).toHaveAttribute("href", "#/applications?view=board&highlight=12")
  expect(card("Closed role").getByRole("link", { name: "Reopen on board" })).toHaveAttribute("href", "#/applications?view=board&tab=archived&highlight=13")
  expect(card("Legacy role").getByTitle("Resolve in Needs review")).toHaveTextContent("Needs review")
  await choose(/^Origin/, "Manual")
  expect(screen.queryByText("Draft role")).not.toBeInTheDocument()
  expect(screen.getByText("Manual role")).toBeInTheDocument()
  expect(screen.getByText("Closed role")).toBeInTheDocument()
  await choose(/^Step/, "Submitted")
  expect(screen.getByText("Closed role")).toBeInTheDocument()
  await choose(/^Origin/, "Any")
  expect(screen.getByText("Legacy role")).toBeInTheDocument()
  expect(screen.queryByText("Filled role")).not.toBeInTheDocument()
})
it("keeps view tabs keyboard reachable and explains each view", () => {
  rows = [
    { id: 12, job_title: "Manual role", origin: "manual", phase: "submitted", view: "tracking" },
    { id: 10, job_id: 1, job_title: "Draft role", origin: "preparation", phase: "draft", view: "preparation" },
  ]
  render(<ApplicationsPage />)
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Tracking (1)" }))
  fireEvent.keyDown(screen.getByRole("tab", { name: "Tracking (1)" }), { key: "Enter" })
  expect(screen.getByText(/Active on the board\./)).toBeInTheDocument()
  expect(screen.queryByText("Draft role")).not.toBeInTheDocument()
  view("Manual role")
  expect(screen.getByRole("dialog")).toHaveTextContent("Manual · Submitted · Tracking")
})

it("switches between list and board layouts and keeps manual registration in both", () => {
  rows = [
    { id: 10, job_id: 1, job_title: "Draft role", company_name: "Draft Co", origin: "preparation", phase: "draft", view: "preparation" },
  ]
  render(<ApplicationsPage />)
  expect(screen.getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true")
  expect(screen.queryByRole("button", { name: "Manage stages" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "New application" }))
  expect(screen.getByRole("dialog")).toHaveTextContent("Company name")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  fireEvent.click(screen.getByRole("radio", { name: "Board" }))
  expect(screen.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("button", { name: "Manage stages" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "New application" })).toBeInTheDocument()
  expect(screen.queryByRole("tab", { name: "All (1)" })).not.toBeInTheDocument()
})
it("filters the list to records that need review while the review is open", async () => {
  rows = [
    { id: 20, job_title: "Legacy role", origin: "unknown", phase: "submitted", view: "preparation", review_reason: "missing_stage" },
    { id: 21, job_id: 1, job_title: "Clean role", origin: "preparation", phase: "draft", view: "preparation" },
  ]
  vi.mocked(window.desktop!.request).mockImplementation(async (path: string) =>
    path === "application-board/review"
      ? { items: [{ id: 20, company_name: "Legacy Co", role_title: "Legacy role", review_reason: "missing_stage", origin: "unknown", status: "submitted", submission_status: "submitted", applied_at: null, job_id: null, job_exists: false, related: [], candidates: [], missing: [], decisions: ["track"], link_job: false, safe_fix: false }] }
      : {},
  )
  render(<ApplicationsPage />)
  expect(await screen.findByText("Needs review (1)")).toBeInTheDocument()
  expect(screen.getByText("Clean role")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Review" }))
  expect(screen.getByRole("list", { name: "Applications to review" })).toBeInTheDocument()
  expect(screen.queryByText("Clean role")).not.toBeInTheDocument()
  expect(screen.getByRole("article", { name: "Legacy role" })).toBeInTheDocument()
})
it("shows the quiet-applications banner in both list and board layouts", () => {
  const quiet = { days: 60, items: [{ id: 30, company_name: "Quiet Co", role_title: "Quiet role", stage_name: "Applied", stage_category: "applied", applied_at: null, last_activity_at: "2026-07-01T00:00:00.000Z", days_quiet: 90 }], skipped: [] }
  vi.mocked(useApi).mockImplementation(((path: string) => ({
    data: path === "application-board/quiet" ? quiet : rows,
    loading: false,
    error: "",
    refresh,
  })) as typeof useApi)
  render(<ApplicationsPage />)
  expect(screen.getByText("1 application quiet for 60+ days")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("radio", { name: "Board" }))
  expect(screen.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true")
  expect(screen.getByText("1 application quiet for 60+ days")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Review quiet applications" })).toBeInTheDocument()
})
it("highlights pending deadlines and sorts applications by them", async () => {
  rows = [
    { id: 4, job_title: "Undated", keyword_score: null },
    { id: 5, job_title: "Overdue draft", keyword_score: null, deadline: "2026-11-20", deadline_level: "overdue", deadline_days: -3 },
    { id: 6, job_title: "Sent", keyword_score: null, deadline: "2026-11-10", deadline_level: "none", deadline_days: null },
  ]
  render(<ApplicationsPage />)
  expect(card("Overdue draft").getByText("Overdue")).toBeInTheDocument()
  const order = () => screen.getAllByRole("article").map((article) => article.getAttribute("aria-label"))
  expect(order()).toEqual(["Undated", "Overdue draft", "Sent"])
  await choose(/^Sort/, "Deadline first")
  expect(order()).toEqual(["Sent", "Overdue draft", "Undated"])
})
it("shows follow-ups due and drafts one in place through the agent panel", async () => {
  const candidates = {
    days: 10,
    follow_ups: [{ id: 30, company_name: "Quiet Co", role_title: "Quiet role", stage_name: "Applied", last_activity_at: "2026-11-01T00:00:00.000Z", days_quiet: 12, sent_count: 1, has_draft: true }],
    thank_yous: [{ id: 31, company_name: "Interview Co", role_title: null, stage_name: "Technical interview", stage_event_id: 77, occurred_at: "2026-11-20T00:00:00.000Z" }],
  }
  let due = candidates
  vi.mocked(useApi).mockImplementation(((path: string) => ({
    data: path === "followups/candidates" ? due : rows,
    loading: false,
    error: "",
    refresh,
  })) as typeof useApi)
  const { rerender } = render(<ApplicationsPage />)
  expect(screen.getByText("1 follow-up due · 1 thank-you note due")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Review follow-ups due" }))
  const dialog = within(screen.getByRole("dialog", { name: "Follow-ups due" }))
  expect(dialog.getByText("Applied · quiet for 12 days · 1 of 2 follow-ups sent")).toBeInTheDocument()
  expect(dialog.getByText("Draft saved")).toBeInTheDocument()
  fireEvent.click(dialog.getByRole("button", { name: "Draft follow-up for Quiet Co — Quiet role" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("followup", { applicationId: "30", kind: "follow_up" })
  expect(screen.queryByRole("dialog", { name: "Follow-ups due" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Review follow-ups due" }))
  fireEvent.click(screen.getByRole("button", { name: "Draft thank-you for Interview Co" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("followup", { applicationId: "31", kind: "thank_you", stage: "Technical interview", stageEventId: "77" })
  due = { days: 10, follow_ups: [], thank_yous: [] }
  rerender(<ApplicationsPage />)
  expect(screen.queryByText(/due$/)).not.toBeInTheDocument()
})

import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DashboardOverview } from "./dashboard-overview"
import { useApi } from "@/lib/api"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock("@/components/metric-chart", () => ({
  MetricChart: ({ rows }: { rows: unknown[] }) => (
    <p>Chart points: {rows.length}</p>
  ),
}))
let records: Record<string, unknown>, errors: Record<string, string>
const refresh = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"))
  records = {
    overview: {
      jobs: 2,
      applications: 9,
      recruiters: 4,
      score: 80,
      journey: {
        total: 9,
        phases: { draft: 4, prepared: 1, filled: 1, submitted: 3 },
        views: { preparation: 7, tracking: 1, archived: 1 },
        origins: { preparation: 5, manual: 2, agent: 1, unknown: 1 },
        overlaps: { ready_resumes: 2, needs_input: 0, submitted_archived: 1, submitted_untracked: 1 },
      },
    },
    metrics: [{ score: 80 }],
    interviews: [],
    activity: [],
  }
  errors = {}
  refresh.mockClear()
  vi.mocked(useApi).mockImplementation((path) => ({
    data: records[path],
    error: errors[path] ?? "",
    loading: false,
    refresh,
  }))
})
afterEach(() => vi.useRealTimers())
it("shows counters, navigation and empty activity/calendar", () => {
  render(<DashboardOverview />)
  expect(screen.getByRole("link", { name: /^Saved opportunities 2/ })).toHaveAttribute("href", "#/jobs")
  expect(screen.getByRole("link", { name: /^Submitted applications 3/ })).toHaveAttribute("href", "#/applications")
  expect(screen.getByRole("link", { name: /^Recruiter connections 4/ })).toHaveAttribute("href", "#/contacts")
  expect(screen.getByRole("link", { name: /^Profile score 80/ })).toHaveAttribute("href", "#/profile")
  expect(screen.getByText("7 still in preparation")).toBeInTheDocument()
  expect(screen.getByText("Chart points: 1")).toBeInTheDocument()
  expect(screen.getByText("A clear calendar")).toBeInTheDocument()
  expect(screen.getByText("A fresh start")).toBeInTheDocument()
})
it("lists pending deadlines with a discreet empty state", () => {
  const { unmount } = render(<DashboardOverview />)
  expect(screen.getByText("No deadlines in the next 7 days.")).toBeInTheDocument()
  unmount()
  ;(records.overview as Record<string, unknown>).deadlines = [
    { kind: "job", id: 1, title: "Closing role", company: "Acme", deadline: "2026-10-17", level: "soon", days_left: 3 },
  ]
  render(<DashboardOverview />)
  expect(screen.getByRole("link", { name: "Closing role" })).toHaveAttribute("href", "/jobs")
  expect(screen.getByText("Due in 3 days")).toBeInTheDocument()
})
it("filters interviews and limits upcoming conversations and activity", () => {
  records.interviews = [
    { id: -1, company: "Past", scheduled_at: "2026-01-01" },
    { id: -2, company: "Closed", scheduled_at: "2027-01-01", status: "closed" },
    { id: -3, company: "Invalid", scheduled_at: "bad" },
    { id: -4, company: "Unscheduled" },
    ...Array.from({ length: 5 }, (_, id) => ({
      id,
      company: `Future ${id}`,
      scheduled_at: "2027-01-01",
    })),
  ]
  records.activity = Array.from({ length: 6 }, (_, id) => ({
    id,
    summary: `Activity ${id}`,
  }))
  render(<DashboardOverview />)
  expect(screen.getByText("Future 3")).toBeInTheDocument()
  for (const text of [
    "Past",
    "Closed",
    "Invalid",
    "Unscheduled",
    "Future 4",
    "Activity 5",
  ])
    expect(screen.queryByText(text)).not.toBeInTheDocument()
  expect(screen.getByText("Activity 4")).toBeInTheDocument()
  expect(screen.getAllByText(/^In 7\d days$/)).toHaveLength(4)
})
it("names the skill behind each activity", () => {
  records.activity = [
    { id: 1, summary: "Found roles", skill: "job-scout", ts: "2026-10-14T10:00:00Z" },
    { id: 2, summary: "Prepared Acme", skill: "work-tracker-resume-tailor", kind: "resume", ts: "2026-10-12T10:00:00Z" },
    { id: 3, summary: "Synced", skill: "recruiter-sync", ts: "2026-10-13T10:00:00Z" },
  ]
  render(<DashboardOverview />)
  expect(screen.getByText("Discover opportunities")).toBeInTheDocument()
  expect(screen.getByText("Tailor your resume")).toBeInTheDocument()
  expect(screen.getByText("Recruiter sync")).toBeInTheDocument()
  expect(screen.getByText("Today")).toBeInTheDocument()
  expect(screen.getByText("2 days ago")).toBeInTheDocument()
})
it("shows independent query errors and retries the failed section", () => {
  errors.metrics = "metrics offline"
  render(<DashboardOverview />)
  expect(screen.getByRole("alert")).toHaveTextContent("metrics offline")
  expect(screen.getByText("A clear calendar")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})
it("separates drafts from submitted applications and offers the next step", () => {
  render(<DashboardOverview />)
  for (const [name, href] of [
    ["4 drafts", "#/applications?status=draft"],
    ["1 prepared", "#/applications?status=prepared"],
    ["1 filled", "#/applications?status=filled"],
    ["3 submitted", "#/applications?status=submitted"],
  ])
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href)
  expect(screen.getByText("7 in preparation · 1 on the board · 1 archived")).toBeInTheDocument()
  expect(screen.getByText(/1 submitted and archived · 1 submitted but not on the board yet/)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Submit filled applications" })).toHaveAttribute("href", "#/applications")
})
it.each([
  [{ draft: 0, prepared: 2, filled: 0, submitted: 0 }, { preparation: 2, tracking: 0, archived: 0 }, "Continue preparing", "#/applications"],
  [{ draft: 0, prepared: 0, filled: 0, submitted: 1 }, { preparation: 0, tracking: 1, archived: 0 }, "Open board", "#/applications?view=board"],
  [{ draft: 0, prepared: 0, filled: 0, submitted: 0 }, { preparation: 0, tracking: 0, archived: 0 }, "Apply from your shortlist", "#/jobs?view=shortlist"],
])("points to the next journey step %#", (phases, views, name, href) => {
  const overview = records.overview as { journey: Record<string, unknown> }
  overview.journey = {
    ...overview.journey,
    phases,
    views,
    overlaps: { ready_resumes: 0, needs_input: 0, submitted_archived: 0, submitted_untracked: 0 },
  }
  render(<DashboardOverview />)
  expect(screen.getByRole("link", { name })).toHaveAttribute("href", href)
})
it("links quiet applications to Applications only when some are quiet", () => {
  const instance = render(<DashboardOverview />)
  expect(screen.queryByText(/quiet for 60\+ days/)).not.toBeInTheDocument()
  records.overview = { ...(records.overview as object), quiet: 2 }
  instance.rerender(<DashboardOverview />)
  expect(screen.getByRole("link", { name: "2 applications quiet for 60+ days" })).toHaveAttribute("href", "/applications")
  records.overview = { ...(records.overview as object), quiet: 1 }
  instance.rerender(<DashboardOverview />)
  expect(screen.getByRole("link", { name: "1 application quiet for 60+ days" })).toBeInTheDocument()
})

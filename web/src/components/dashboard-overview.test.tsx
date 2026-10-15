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
    overview: { jobs: 2, applications: 3, recruiters: 4, score: 80 },
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
  expect(screen.getByRole("link", { name: "2" })).toHaveAttribute(
    "href",
    "/jobs",
  )
  expect(screen.getByRole("link", { name: "3" })).toHaveAttribute(
    "href",
    "/applications",
  )
  expect(screen.getByText("Chart points: 1")).toBeInTheDocument()
  expect(screen.getByText("A clear calendar")).toBeInTheDocument()
  expect(screen.getByText("A fresh start")).toBeInTheDocument()
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
})
it("shows independent query errors and retries the failed section", () => {
  errors.metrics = "metrics offline"
  render(<DashboardOverview />)
  expect(screen.getByRole("alert")).toHaveTextContent("metrics offline")
  expect(screen.getByText("A clear calendar")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})

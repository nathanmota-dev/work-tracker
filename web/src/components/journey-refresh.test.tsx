import { act, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { DashboardOverview } from "@/components/dashboard-overview"
import { ApplicationBoardPage } from "@/routes/application-board"
import { ApplicationsPage } from "@/routes/applications"
import { JobsPage } from "@/routes/jobs"
import { publish } from "@/lib/api"
import type { ApplicationSummary } from "@/lib/application-journey"

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock("@/components/metric-chart", () => ({ MetricChart: () => null }))
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
  DragOverlay: () => null,
  useDraggable: () => ({ ref: () => {}, handleRef: () => {}, isDragging: false }),
  useDroppable: () => ({ ref: () => {}, isDropTarget: false }),
}))

const at = "2026-10-10T12:00:00.000Z"
let submitted: boolean
const summary = (): ApplicationSummary => ({
  total: 1,
  phases: { draft: 0, prepared: 0, filled: submitted ? 0 : 1, submitted: submitted ? 1 : 0 },
  views: { preparation: submitted ? 0 : 1, tracking: submitted ? 1 : 0, archived: 0 },
  origins: { preparation: 1, manual: 0, agent: 0, unknown: 0 },
  overlaps: { ready_resumes: 1, needs_input: 0, submitted_archived: 0, submitted_untracked: 0 },
})
/** One application that the confirmation in Apply moves from filled to submitted. */
async function serve(path: string) {
  const phase = submitted ? "submitted" : "filled"
  const view = submitted ? "tracking" : "preparation"
  switch (path) {
    case "jobs":
      return [{ id: 7, title: "Platform Engineer", company_name: "Acme", application_id: 3, application_phase: phase, application_view: view, application_origin: "preparation" }]
    case "applications":
      return [{ id: 3, job_id: 7, job_title: "Platform Engineer", company_name: "Acme", origin: "preparation", phase, view, applied_at: submitted ? at : null }]
    case "applications/summary":
      return summary()
    case "overview":
      return { jobs: 1, applications: 1, recruiters: 0, score: null, journey: summary() }
    case "application-board":
      return {
        stages: [{ id: 1, key: "applied", name: "Applied", category: "applied", position: 0, is_archived: false, created_at: at, updated_at: at }],
        applications: submitted
          ? [{ id: 3, job_id: 7, origin: "preparation", attempt: 1, submission_status: "submitted", submitted_at: at, company_name: "Acme", external_url: "https://example.com/role", role_title: "Platform Engineer", role_type: null, stack: [], comp: null, company_url: null, notes: null, applied_at: at, current_stage_id: 1, tracking_status: "active", archive_reason: null, archived_at: null, created_at: at, updated_at: at }]
          : [],
      }
    case "application-board/review":
      return { items: [] }
    default:
      return []
  }
}
const request = vi.fn()
beforeEach(() => {
  submitted = false
  request.mockReset().mockImplementation(serve)
  window.desktop = {
    request,
    readPdf: vi.fn(),
    savePdf: vi.fn(),
    connectionStatus: async () => true,
    openExternal: vi.fn(),
    onEvent: () => () => {},
  }
})

it("a submission confirmation event refreshes Jobs, Applications, the board and the dashboard", async () => {
  const jobs = within(render(<JobsPage />).container)
  const list = within(render(<ApplicationsPage />).container)
  const board = within(render(<ApplicationBoardPage />).container)
  const dashboard = within(render(<DashboardOverview />).container)
  expect(within((await jobs.findByText("Platform Engineer")).closest("tr")!).getByText("Filled")).toBeInTheDocument()
  expect(await list.findByRole("tab", { name: "Tracking (0)" })).toBeInTheDocument()
  expect(await board.findByText(/1 application is still in preparation/)).toBeInTheDocument()
  expect(await dashboard.findByRole("link", { name: "0 submitted" })).toBeInTheDocument()

  submitted = true
  act(() => publish({ type: "changed", table: "applications" }))

  await waitFor(() =>
    expect(within(jobs.getByText("Platform Engineer").closest("tr")!).getByText("Submitted")).toBeInTheDocument(),
  )
  expect(await list.findByRole("tab", { name: "Tracking (1)" })).toBeInTheDocument()
  expect(list.getByRole("tab", { name: "Preparation (0)" })).toBeInTheDocument()
  expect(await board.findByRole("tab", { name: "Active (1)" })).toBeInTheDocument()
  await waitFor(() => expect(board.queryByText(/still in preparation/)).not.toBeInTheDocument())
  expect(await dashboard.findByRole("link", { name: "1 submitted" })).toBeInTheDocument()
  expect(dashboard.getByRole("link", { name: "0 filled" })).toBeInTheDocument()
  expect(screen.queryByText(/reload/i)).not.toBeInTheDocument()
})

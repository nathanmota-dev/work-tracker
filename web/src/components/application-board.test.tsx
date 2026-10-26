import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { ApplicationBoardPage } from "@/routes/application-board"
import { CompanyIcon } from "@/components/application-card"
import { ApplicationStages } from "@/components/application-stages"
import { publish } from "@/lib/api"
import type {
  ApplicationBoard,
  ApplicationDetails,
  ApplicationStage,
  TrackedApplication,
} from "@/lib/application-board"

type DragEvent = {
  canceled: boolean
  operation: { source: { id: string }; target?: { id: string } }
}
let dragEnd: (event: DragEvent) => void
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode
    onDragEnd: (event: DragEvent) => void
  }) => {
    dragEnd = onDragEnd
    return children
  },
  DragOverlay: () => null,
  useDraggable: () => ({
    ref: () => {},
    handleRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ ref: () => {}, isDropTarget: false }),
}))
const request = vi.fn()
let board: ApplicationBoard
const at = "2026-10-10T12:00:00.000Z"
const initialStages: ApplicationStage[] = [
  {
    id: 1,
    key: "applied",
    name: "Applied",
    category: "applied",
    position: 0,
    is_archived: false,
    created_at: at,
    updated_at: at,
  },
  {
    id: 2,
    key: "technical",
    name: "Technical interview",
    category: "technical",
    position: 1,
    is_archived: false,
    created_at: at,
    updated_at: at,
  },
]
const record = (id: number, company_name: string): TrackedApplication => ({
  id,
  job_id: null,
  origin: "manual",
  attempt: 1,
  submission_status: "submitted",
  submitted_at: at,
  company_name,
  external_url: "https://example.com/role",
  role_title: null,
  role_type: null,
  stack: [],
  comp: null,
  company_url: null,
  notes: null,
  applied_at: at,
  current_stage_id: 1,
  tracking_status: "active",
  archive_reason: null,
  archived_at: null,
  created_at: at,
  updated_at: at,
})
async function serve(path: string, body?: unknown) {
  const input = body as Partial<TrackedApplication> & {
    stage_id: number
    reason: "rejected"
    note?: string
  }
  if (path === "application-board") return structuredClone(board)
  if (path === "application-board/details") {
    const application = board.applications.find((item) => item.id === input.id)!
    const details: ApplicationDetails = {
      application,
      events: [
        {
          id: 1,
          application_id: application.id,
          event_type: "created",
          from_stage_id: null,
          to_stage_id: 1,
          stage_name: "Applied",
          stage_category: "applied",
          occurred_at: at,
          reason: null,
          note: null,
        },
      ],
    }
    return structuredClone(details)
  }
  if (path === "application-board/create") {
    const created = {
      ...record(3, input.company_name!),
      ...input,
      updated_at: "2026-10-10T13:00:00.000Z",
    }
    board.applications.push(created)
    return structuredClone(created)
  }
  const application = board.applications.find((item) => item.id === input.id)
  if (!application) throw new Error("Not found")
  if (path === "application-board/update") Object.assign(application, input)
  if (path === "application-board/move")
    application.current_stage_id = input.stage_id
  if (path === "application-board/archive")
    Object.assign(application, {
      tracking_status: "archived",
      archive_reason: input.reason,
      archived_at: at,
    })
  if (path === "application-board/reopen")
    Object.assign(application, {
      tracking_status: "active",
      archive_reason: null,
      archived_at: null,
    })
  application.updated_at = "2026-10-10T13:00:00.000Z"
  return structuredClone(application)
}
beforeEach(() => {
  board = {
    stages: structuredClone(initialStages),
    applications: [
      record(1, "São José"),
      { ...record(2, "Other"), role_type: "back_end", stack: ["Python"] },
    ],
  }
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
describe("application board", () => {
  it("creates a manual application with just company and job link", async () => {
    render(<ApplicationBoardPage />)
    fireEvent.click(
      await screen.findByRole("button", { name: "New application" }),
    )
    const form = within(screen.getByRole("dialog"))
    fireEvent.change(form.getByLabelText("Company name"), {
      target: { value: "New Co" },
    })
    fireEvent.change(form.getByLabelText("Job link"), {
      target: { value: "https://new.co/role" },
    })
    expect(form.getByLabelText("Compensation")).not.toBeRequired()
    fireEvent.click(form.getByRole("button", { name: "Save application" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
    expect(await screen.findByText("New Co")).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith(
      "application-board/create",
      expect.objectContaining({
        company_name: "New Co",
        external_url: "https://new.co/role",
        role_type: null,
        stack: [],
        comp: "",
        request_id: expect.any(String),
      }),
    )
  })
  it("searches all companies and technologies and refreshes on backend changes", async () => {
    render(<ApplicationBoardPage />)
    await screen.findByText("São José")
    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "sao jose" },
    })
    expect(screen.getByText("São José")).toBeInTheDocument()
    expect(screen.queryByText("Other")).not.toBeInTheDocument()
    expect(screen.getByLabelText("1 of 2 applications")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "python" },
    })
    expect(screen.getByText("Other")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "" },
    })
    board.applications.push(record(3, "New from backend"))
    act(() => publish({ type: "changed", table: "applications" }))
    expect(await screen.findByText("New from backend")).toBeInTheDocument()
  })
  it("shows an application confirmed in Apply as soon as its board event arrives", async () => {
    render(<ApplicationBoardPage />)
    await screen.findByText("São José")
    board.applications.push({ ...record(4, "Prepared Corp"), job_id: 7, origin: "preparation" })
    act(() => publish({ type: "changed", table: "application_events" }))
    expect(await screen.findByText("Prepared Corp")).toBeInTheDocument()
  })
  it("moves to an empty column optimistically and restores a failed move", async () => {
    let reject!: (error: Error) => void
    request.mockImplementation((path, body) =>
      path === "application-board/move"
        ? new Promise((_resolve, no) => {
            reject = no
          })
        : serve(path, body),
    )
    render(<ApplicationBoardPage />)
    await screen.findByText("São José")
    act(() =>
      dragEnd({
        canceled: false,
        operation: {
          source: { id: "application:1" },
          target: { id: "stage:2" },
        },
      }),
    )
    expect(
      within(
        screen.getByRole("region", {
          name: "Technical interview applications",
        }),
      ).getByText("São José"),
    ).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith("application-board/move", {
      id: 1,
      stage_id: 2,
      expected_stage_id: 1,
    })
    await act(async () => reject(new Error("Save failed")))
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed")
    expect(
      within(
        screen.getByRole("region", { name: "Applied applications" }),
      ).getByText("São José"),
    ).toBeInTheDocument()
  })
  it("ignores canceled, outside and same-stage drops", async () => {
    render(<ApplicationBoardPage />)
    await screen.findByText("São José")
    act(() => {
      dragEnd({
        canceled: true,
        operation: {
          source: { id: "application:1" },
          target: { id: "stage:2" },
        },
      })
      dragEnd({
        canceled: false,
        operation: { source: { id: "application:1" } },
      })
      dragEnd({
        canceled: false,
        operation: {
          source: { id: "application:1" },
          target: { id: "stage:1" },
        },
      })
    })
    expect(
      request.mock.calls.filter(([path]) => path === "application-board/move"),
    ).toHaveLength(0)
  })
  it("requires archive confirmation and keeps closed applications searchable and reopenable", async () => {
    render(<ApplicationBoardPage />)
    await screen.findByText("São José")
    act(() =>
      dragEnd({
        canceled: false,
        operation: {
          source: { id: "application:1" },
          target: { id: "archive" },
        },
      }),
    )
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    )
    expect(
      request.mock.calls.filter(
        ([path]) => path === "application-board/archive",
      ),
    ).toHaveLength(0)
    fireEvent.click(
      screen.getByRole("button", { name: "Archive São José application" }),
    )
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Archive application",
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
    expect(screen.queryByText("São José")).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("tab", { name: "Archived (1)" }), {
      key: "Enter",
    })
    expect(await screen.findByText("São José")).toBeInTheDocument()
    expect(screen.getByText("Last stage: Applied")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reopen application" }))
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Active (2)" }),
      ).toBeInTheDocument(),
    )
    fireEvent.keyDown(screen.getByRole("tab", { name: "Active (2)" }), {
      key: "Enter",
    })
    expect(await screen.findByText("São José")).toBeInTheDocument()
  })
  it("shows the timeline and preserves edits after a failed save", async () => {
    render(<ApplicationBoardPage />)
    fireEvent.click(
      await screen.findByRole("button", { name: "View São José application" }),
    )
    expect(await screen.findByText("Registered in Applied")).toBeInTheDocument()
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit" }),
    )
    request.mockImplementation((path, body) =>
      path === "application-board/update"
        ? Promise.reject(new Error("Edit failed"))
        : serve(path, body),
    )
    fireEvent.change(screen.getByLabelText("Compensation"), {
      target: { value: "R$ 12k/month" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save application" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Edit failed")
    expect(screen.getByLabelText("Compensation")).toHaveValue("R$ 12k/month")
    request.mockImplementation(serve)
    fireEvent.click(screen.getByRole("button", { name: "Save application" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
    expect(await screen.findByText("R$ 12k/month")).toBeInTheDocument()
  })
  it("falls back to initials when the remote favicon is unavailable", () => {
    const { container } = render(
      <CompanyIcon application={record(1, "Acme")} />,
    )
    const image = container.querySelector("img")!
    expect(image.src).toBe("https://example.com/favicon.ico")
    fireEvent.error(image)
    expect(screen.getByText("AC")).toBeInTheDocument()
  })
  it("creates and reorders columns and keeps stage failures visible", async () => {
    const changed = vi.fn()
    request.mockImplementation(async (path, body) => {
      if (path === "application-board/stages/save")
        return {
          ...initialStages[1],
          id: 3,
          key: "dsa",
          name: "DSA",
          category: "assessment",
          position: 2,
        }
      if (path === "application-board/stages/reorder")
        return [
          initialStages[1],
          initialStages[0],
          {
            ...initialStages[1],
            id: 3,
            key: "dsa",
            name: "DSA",
            category: "assessment",
            position: 2,
          },
        ]
      if (path === "application-board/stages/set-archived")
        throw new Error("Move active applications first")
      return serve(path, body)
    })
    render(
      <ApplicationStages
        stages={initialStages}
        onClose={() => {}}
        onChanged={changed}
      />,
    )
    fireEvent.change(screen.getByLabelText("New stage name"), {
      target: { value: "DSA" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add stage" }))
    await screen.findByLabelText("Name for DSA")
    expect(request).toHaveBeenCalledWith("application-board/stages/save", {
      name: "DSA",
      category: "assessment",
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Move Technical interview up" }),
    )
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("application-board/stages/reorder", {
        ids: [2, 1, 3],
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Hide Technical interview" }),
      ).not.toBeDisabled(),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Hide Technical interview" }),
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Move active applications first",
    )
    expect(screen.getByRole("button", { name: "Hide Applied" })).toBeDisabled()
  })
})

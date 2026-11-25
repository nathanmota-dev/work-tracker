import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApplicationCards, type BoardContext } from "./application-cards"
import type { Row } from "@/lib/api"
import type { ApplicationStage, TrackedApplication } from "@/lib/application-board"
import { desktopDouble } from "@/test/doubles"

vi.mock("@/lib/workspace-state", () => ({ useWorkspaceState: () => ({ search: {}, update: vi.fn() }) }))

const stage = (id: number, name: string, position: number, is_archived = false) => ({ id, name, position, is_archived, key: name, category: "applied" }) as ApplicationStage
const board: BoardContext = {
  stages: [stage(3, "Offer", 3), stage(1, "Applied", 1), stage(2, "Interview", 2), stage(9, "Closed", 9, true)],
  records: new Map([
    [1, { id: 1, current_stage_id: 2 } as TrackedApplication],
    [2, { id: 2, current_stage_id: 1, archive_reason: "rejected" } as TrackedApplication],
    [3, { id: 3, current_stage_id: 3 } as TrackedApplication],
  ]),
}
const rows: Row[] = [
  { id: 1, job_title: "Tracked role", company_name: "Acme", phase: "submitted", view: "tracking", keyword_score: 82, portal: "Greenhouse", applied_at: "2026-11-02T12:00:00Z" },
  { id: 2, job_title: "Closed role", company_name: "Globex", phase: "submitted", view: "archived" },
  { id: 3, job_title: "Offer role", company_name: "Initech", phase: "submitted", view: "tracking" },
  { id: 4, job_id: 8, job_title: "Prepared role", company_name: "Umbrella", phase: "prepared", view: "preparation", review_reason: "missing_stage", external_url: "https://jobs.invalid/4" },
]
const progress = (title: string) => within(screen.getByRole("article", { name: title })).getByRole("progressbar")
let request: ReturnType<typeof desktopDouble>["request"]
beforeEach(() => {
  window.desktop = desktopDouble()
  request = window.desktop.request as typeof request
})

it("shows each application's journey: preparation step, board stage or where it closed", () => {
  render(<ApplicationCards rows={rows} board={board} onSelect={vi.fn()} onPrepare={vi.fn()} />)
  expect(progress("Tracked role")).toHaveAttribute("aria-valuetext", "Interview, step 2 of 3")
  expect(progress("Offer role")).toHaveAttribute("aria-valuetext", "Offer, step 3 of 3")
  expect(progress("Closed role")).toHaveAttribute("aria-valuetext", "Rejected · Applied, step 1 of 3")
  expect(progress("Prepared role")).toHaveAttribute("aria-valuetext", "Prepared, step 2 of 4")
  const tracked = within(screen.getByRole("article", { name: "Tracked role" }))
  expect(tracked.getByText("Match 82")).toBeInTheDocument()
  expect(tracked.getByText("Greenhouse portal")).toBeInTheDocument()
  expect(tracked.getByText("Applied 02/11/26")).toBeInTheDocument()
  expect(within(screen.getByRole("article", { name: "Closed role" })).getByText("Archived")).toBeInTheDocument()
  expect(within(screen.getByRole("article", { name: "Prepared role" })).getByText("Needs review")).toBeInTheDocument()
})

it("filters by view and search, and acts from the card menu", async () => {
  const onSelect = vi.fn(), onPrepare = vi.fn()
  render(<ApplicationCards rows={rows} board={board} onSelect={onSelect} onPrepare={onPrepare} />)
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Tracking (2)" }))
  expect(screen.queryByRole("article", { name: "Prepared role" })).not.toBeInTheDocument()
  expect(screen.getByText(/Active on the board\./)).toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole("tab", { name: "All (4)" }))
  const menu = async (title: string, item: string) => {
    fireEvent.keyDown(screen.getByRole("button", { name: `More actions for ${title}` }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: item }))
  }
  await menu("Prepared role", "View details")
  expect(onSelect).toHaveBeenCalledWith(rows[3])
  await menu("Prepared role", "Prepare application")
  expect(onPrepare).toHaveBeenCalledWith(rows[3])
  await menu("Prepared role", "Open portal")
  await waitFor(() => expect(window.desktop!.openExternal).toHaveBeenCalledWith("https://jobs.invalid/4"))
  await menu("Prepared role", "Advance to next step")
  request.mockRejectedValueOnce(new Error("Board offline")).mockResolvedValueOnce({ ok: true })
  fireEvent.click(screen.getByRole("button", { name: "Yes, I submitted it" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Board offline")
  fireEvent.click(screen.getByRole("button", { name: "Yes, I submitted it" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(request).toHaveBeenLastCalledWith("application-board/submit", { id: 4 })
})

it("explains an empty view", () => {
  render(<ApplicationCards rows={[]} board={board} onSelect={vi.fn()} onPrepare={vi.fn()} />)
  expect(screen.getByText("No applications yet")).toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Archived (0)" }))
  expect(screen.getByText("No archived applications")).toBeInTheDocument()
})

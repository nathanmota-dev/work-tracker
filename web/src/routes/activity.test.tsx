import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ActivityPage } from "./activity"
import { date, useApi, type Row } from "@/lib/api"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
let rows: Row[]
const refresh = vi.fn()
beforeEach(() => {
  rows = []
  refresh.mockClear()
  vi.mocked(useApi).mockImplementation(() => ({
    data: rows,
    error: "",
    loading: false,
    refresh,
  }))
})
it("formats the recorded timestamp, status, skill and summary", () => {
  rows = [
    {
      id: 1,
      ts: "2026-10-14T12:00:00Z",
      kind: "profile_audit",
      skill: "profile-optimizer",
      summary: "Profile audited",
    },
  ]
  render(<ActivityPage />)
  expect(screen.getByText(date(rows[0]!.ts))).toBeInTheDocument()
  expect(screen.getByText("profile audit")).toBeInTheDocument()
  expect(screen.getByText("profile-optimizer")).toBeInTheDocument()
  expect(screen.getByText("Profile audited")).toBeInTheDocument()
})
it("paginates and resets pagination when filtering activity", () => {
  rows = Array.from({ length: 16 }, (_, id) => ({
    id,
    summary: `Activity ${id}`,
  }))
  render(<ActivityPage />)
  expect(screen.queryByText("Activity 15")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText("Activity 15")).toBeInTheDocument()
  fireEvent.change(screen.getByRole("textbox", { name: "Search Activity" }), {
    target: { value: "Activity 0" },
  })
  expect(screen.getByText("Activity 0")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
})
it("shows loading, empty and error states and retries", () => {
  const instance = render(<ActivityPage />)
  expect(screen.getByText("No activity yet")).toBeInTheDocument()
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    loading: true,
    error: "",
    refresh,
  })
  instance.rerender(<ActivityPage />)
  expect(screen.getByRole("status")).toHaveAccessibleName("Loading workspace")
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    loading: false,
    error: "activity offline",
    refresh,
  })
  instance.rerender(<ActivityPage />)
  expect(screen.getByRole("alert")).toHaveTextContent("activity offline")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})

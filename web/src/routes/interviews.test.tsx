import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InterviewsPage } from "./interviews"
import { useApi, type Row } from "@/lib/api"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
let rows: Row[]
const refresh = vi.fn()
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(
    new Date("2026-10-14T12:00:00Z").getTime(),
  )
  rows = []
  refresh.mockClear()
  vi.mocked(useApi).mockImplementation(() => ({
    data: rows,
    error: "",
    loading: false,
    refresh,
  }))
})
afterEach(() => vi.restoreAllMocks())
const stat = (label: string) => screen.getByText(label).parentElement!
it("counts future active interviews and distinct companies and selects the next conversation", () => {
  rows = [
    {
      id: 1,
      company: "Acme",
      scheduled_at: "2026-10-14T12:00:00Z",
      status: "scheduled",
    },
    { id: 2, company: "Acme", scheduled_at: "2027-01-01", status: "scheduled" },
    { id: 3, company: "Other", scheduled_at: "2027-01-01", status: "closed" },
    { id: 4, company: "Past", scheduled_at: "2026-01-01" },
    { id: 5, company: "Invalid", scheduled_at: "bad" },
  ]
  render(<InterviewsPage />)
  expect(within(stat("Upcoming")).getByText("2")).toBeInTheDocument()
  expect(within(stat("Companies")).getByText("4")).toBeInTheDocument()
  expect(within(stat("Total interviews")).getByText("5")).toBeInTheDocument()
  expect(
    within(stat("Next conversation")).getByText("Acme"),
  ).toBeInTheDocument()
})
it("opens/closes details and searches records", () => {
  rows = [
    { id: 1, company: "Acme", notes: "Discuss architecture" },
    { id: 2, company: "Other" },
  ]
  render(<InterviewsPage />)
  fireEvent.change(screen.getByRole("textbox", { name: "Search Interviews" }), {
    target: { value: "Acme" },
  })
  expect(
    screen.queryByRole("button", { name: "View Other" }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "View Acme" }))
  expect(screen.getByRole("dialog")).toHaveTextContent("Discuss architecture")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})
it("shows an empty calendar and retries failures", () => {
  const instance = render(<InterviewsPage />)
  expect(screen.getByText("Nothing scheduled yet")).toBeInTheDocument()
  expect(screen.getByText("No interviews yet")).toBeInTheDocument()
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    error: "interviews offline",
    loading: false,
    refresh,
  })
  instance.rerender(<InterviewsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})

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
import { desktopDouble } from "@/test/doubles"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
vi.mock("@/lib/preparation", () => ({ openApply: vi.fn() }))
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
it("distinguishes zero/missing scores and unsubmitted applications", () => {
  render(<ApplicationsPage />)
  expect(screen.getByText("0%")).toBeInTheDocument()
  expect(
    within(
      screen.getByRole("button", { name: "View Designer" }).closest("tr")!,
    ).getAllByText("—").length,
  ).toBeGreaterThan(0)
  expect(screen.getAllByText("Not submitted")).toHaveLength(2)
})
it("opens details/portal and prepares the selected application", async () => {
  render(<ApplicationsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Tailor a resume" }))
  expect(openApply).toHaveBeenCalledWith()
  fireEvent.click(screen.getByRole("button", { name: "View Engineer" }))
  expect(screen.getByRole("dialog")).toHaveTextContent("Acme")
  fireEvent.click(screen.getByRole("button", { name: "Open portal" }))
  await waitFor(() =>
    expect(window.desktop!.openExternal).toHaveBeenCalledWith(
      "https://portal.invalid/",
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "Prepare application" }))
  expect(openApply).toHaveBeenCalledWith(7, 2)
})
it("disables preparation when neither job nor portal exists and hides unsafe links", () => {
  rows = [
    { id: 3, job_title: "No target" },
    { id: 4, job_title: "Unsafe", external_url: "javascript:bad" },
  ]
  render(<ApplicationsPage />)
  fireEvent.click(screen.getByRole("button", { name: "View No target" }))
  expect(
    screen.getByRole("button", { name: "Prepare application" }),
  ).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: "Open portal" }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  fireEvent.click(screen.getByRole("button", { name: "View Unsafe" }))
  expect(
    screen.queryByRole("button", { name: "Open portal" }),
  ).not.toBeInTheDocument()
})
it("shows empty/error states and retries", () => {
  rows = []
  const instance = render(<ApplicationsPage />)
  expect(screen.getByText("No automatic applications yet")).toBeInTheDocument()
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

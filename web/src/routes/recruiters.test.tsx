import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { RecruitersPage } from "./recruiters"
import { publish, request, useApi } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
import { deferred } from "@/test/doubles"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
  request: vi.fn(),
  publish: vi.fn(),
}))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn() }))
const refresh = vi.fn()
beforeEach(() => {
  vi.mocked(useApi).mockImplementation((path) => ({
    data:
      path === "recruiters"
        ? [
            {
              id: 1,
              name: "Ana",
              username: "ana",
              company: "Acme",
              status: "pending",
            },
          ]
        : [{ id: 2, name: "Bruno", action: "followup", company: "Other" }],
    loading: false,
    error: "",
    refresh,
  }))
  vi.mocked(request)
    .mockReset()
    .mockResolvedValue({ changes: [{ name: "Accepted Ana" }] })
  vi.mocked(publish).mockClear()
  vi.mocked(prepareSkill).mockClear()
  refresh.mockClear()
})
it("renders contacts, followups, details and skill actions", () => {
  render(<RecruitersPage />)
  expect(screen.queryByText("Bruno")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "View Ana" }))
  expect(screen.getByRole("dialog")).toHaveTextContent("Acme")
  expect(
    screen.getByRole("button", { name: "View LinkedIn" }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  fireEvent.click(screen.getByRole("button", { name: "Find recruiters" }))
  expect(prepareSkill).toHaveBeenCalledWith("recruiter-outreach")
  expect(screen.queryByRole("button", { name: "Review follow-ups" })).not.toBeInTheDocument()
})
it("previews before applying and invalidates records only after successful apply", async () => {
  render(<RecruitersPage />)
  fireEvent.click(
    screen.getByRole("button", { name: "Preview connection sync" }),
  )
  expect(await screen.findByText(/Accepted Ana/)).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith("recruiters/sync", { apply: false })
  expect(publish).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole("button", { name: "Apply accepted connections" }),
  )
  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 connections updated",
  )
  expect(request).toHaveBeenLastCalledWith("recruiters/sync", { apply: true })
  expect(publish).toHaveBeenCalledWith({ type: "changed" })
  expect(screen.queryByText("Connection sync preview")).not.toBeInTheDocument()
})
it("shows no changes and allows dismissing the preview", async () => {
  vi.mocked(request).mockResolvedValue({ changes: [] })
  render(<RecruitersPage />)
  fireEvent.click(
    screen.getByRole("button", { name: "Preview connection sync" }),
  )
  expect(await screen.findByText("You’re up to date")).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Apply accepted connections" }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
  expect(screen.queryByText("Connection sync preview")).not.toBeInTheDocument()
})
it("disables repeated sync while pending and recovers from failure", async () => {
  const pending = deferred<unknown>()
  vi.mocked(request).mockReturnValueOnce(pending.promise)
  render(<RecruitersPage />)
  fireEvent.click(
    screen.getByRole("button", { name: "Preview connection sync" }),
  )
  expect(
    screen.getByRole("button", { name: "Checking LinkedIn…" }),
  ).toBeDisabled()
  pending.reject(new Error("offline"))
  expect(await screen.findByRole("alert")).toHaveTextContent("offline")
  expect(publish).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole("button", { name: "Preview connection sync" }),
  )
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  )
})

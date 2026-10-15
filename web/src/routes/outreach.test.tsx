import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { OutreachPage } from "./outreach"
import { useApi } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn() }))
let data: {
  funnel: Record<string, number>
  due: Record<string, unknown>[]
  blocked: Record<string, unknown>[]
  budget: Record<string, unknown>
}
const refresh = vi.fn()
beforeEach(() => {
  data = {
    funnel: { invited: 3, engaged: 1 },
    due: [
      {
        id: 1,
        person_name: null,
        person_username: "ana-slug",
        company_name: null,
        company_urn: "urn:acme",
        state: "accepted",
        actionKind: "followup",
        actionReason: "due today",
      },
    ],
    blocked: [{ company_name: null, company_urn: "urn:blocked", count: 2 }],
    budget: {
      credits_remaining: 0,
      credits_used_this_cycle: 5,
      reserve_floor: 1,
      plan: "career",
      inmail_monthly_allotment: 5,
      inmail_rollover_cap: 15,
    },
  }
  refresh.mockClear()
  vi.mocked(prepareSkill).mockClear()
  vi.mocked(useApi).mockImplementation(() => ({
    data,
    error: "",
    loading: false,
    refresh,
  }))
})
it("shows credit data, fallbacks, cooldowns and proportional funnel values", () => {
  render(<OutreachPage />)
  expect(screen.getByText("ana-slug")).toBeInTheDocument()
  expect(screen.getByText("urn:acme")).toBeInTheDocument()
  expect(screen.getByText("urn:blocked")).toBeInTheDocument()
  expect(screen.getByText("5 used this cycle")).toBeInTheDocument()
  expect(screen.getByText(/career plan/)).toHaveTextContent("15 rollover cap")
  const invited = screen.getByText("invited").parentElement!.parentElement!
  expect(invited.querySelector('[style*="width"]')).toHaveStyle({
    width: "75%",
  })
  fireEvent.click(screen.getByRole("button", { name: "Review next actions" }))
  expect(prepareSkill).toHaveBeenCalledWith("outreach-tracker")
})
it("handles a zero total and empty due/blocked queues", () => {
  data.funnel = { invited: 0 }
  data.due = []
  data.blocked = []
  render(<OutreachPage />)
  expect(screen.getByText("No next actions yet")).toBeInTheDocument()
  expect(screen.getByText("No companies in cooldown yet")).toBeInTheDocument()
  const invited = screen.getByText("invited").parentElement!.parentElement!
  expect(invited.querySelector('[style*="width"]')).toHaveStyle({ width: "0%" })
})
it("reports errors and retries", () => {
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    loading: false,
    error: "outreach offline",
    refresh,
  })
  render(<OutreachPage />)
  expect(screen.getByRole("alert")).toHaveTextContent("outreach offline")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})

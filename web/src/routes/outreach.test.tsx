import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { OutreachPage, reasonText } from "./outreach"
import { useApi } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn(), skills: [] }))
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
it("shows due actions first as cards, with credits, cooldowns and the funnel folded below", () => {
  render(<OutreachPage />)
  const card = within(screen.getByRole("article", { name: "ana-slug" }))
  expect(card.getByText("urn:acme")).toBeInTheDocument()
  expect(card.getByText("Send a follow-up")).toBeInTheDocument()
  expect(card.getByText("Accepted")).toBeInTheDocument()
  expect(card.getByText("Due today")).toBeInTheDocument()
  fireEvent.click(card.getByRole("button", { name: "Review" }))
  expect(prepareSkill).toHaveBeenCalledWith("outreach-tracker")
  expect(screen.getByText("Outreach health").nextElementSibling).toHaveTextContent("1 active · 3 invited · 0 InMail credits · 1 in cooldown")
  expect(screen.getByText("urn:blocked")).toBeInTheDocument()
  expect(screen.getByText("5 used this cycle")).toBeInTheDocument()
  expect(screen.getByText(/career plan/)).toHaveTextContent("15 rollover cap")
  const bar = (label: string) => screen.getByText(label).parentElement!.parentElement!.querySelector('[style*="width"]')
  expect(bar("Invited")).toHaveStyle({ width: "100%" })
  expect(bar("Engaged")).toHaveStyle({ width: "33.33333333333333%" })
  fireEvent.click(screen.getByRole("button", { name: "Review follow-ups" }))
  expect(prepareSkill).toHaveBeenCalledTimes(2)
})
it("hides its own header inside Contacts", () => {
  render(<OutreachPage embedded />)
  expect(screen.queryByRole("button", { name: "Review follow-ups" })).not.toBeInTheDocument()
})
it("handles a zero total and empty due/blocked queues", () => {
  data.funnel = { invited: 0 }
  data.due = []
  data.blocked = []
  render(<OutreachPage />)
  expect(screen.getByText("Nothing due today")).toBeInTheDocument()
  expect(screen.getByText("No company is in cooldown.")).toBeInTheDocument()
  expect(screen.getByText("Invited").parentElement!.parentElement!.querySelector('[style*="width"]')).toHaveStyle({ width: "0%" })
})
it("writes action reasons as sentences", () => {
  expect(reasonText("invite unaccepted for 30d (≥ 7d)")).toBe("Invite not accepted after 30 days")
  expect(reasonText("no reply 1d after follow-up (≥ 1d)")).toBe("No reply 1 day after follow-up")
  expect(reasonText(null)).toBe("")
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

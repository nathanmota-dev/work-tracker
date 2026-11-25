import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContactsHub, ProfileHub, AgentHub } from "./hubs"
import { validateWorkspaceSearch } from "@/lib/workspace-search"

// Embedded pages keep their real Page wrapper, so the hub layout is exercised.
const { page } = vi.hoisted(() => ({
  page: async (title: string, content: string) => {
    const { Page } = await import("@/components/workspace-ui")
    return () => <Page title={title} description={`${title} description`}>{content}</Page>
  },
}))
vi.mock("./profile", async () => ({ ProfilePage: await page("LinkedIn profile", "LinkedIn content") }))
vi.mock("./answers", async () => ({ AnswersPage: await page("Questions", "Questions content") }))
vi.mock("./profile-overview", () => ({ ProfileOverview: () => <div>Profile overview</div> }))
vi.mock("./recruiters", async () => ({
  RecruitersPage: await page("Recruiters", "People content"),
  useRecruiterSync: () => ({}),
  RecruiterActions: () => <button type="button">Find recruiters</button>,
}))
vi.mock("./outreach", async () => ({ OutreachPage: await page("Outreach", "Follow-ups content") }))
vi.mock("./search", async () => ({ SearchPage: await page("Find people", "People search") }))
vi.mock("./launch", async () => ({ LaunchPage: await page("Agent console", "Console content") }))
vi.mock("./activity", async () => ({ ActivityPage: await page("Activity", "History content") }))
vi.mock("@/components/deal-breakers", () => ({ DealBreakers: () => <div>Deal-breakers configuration</div> }))
vi.mock("@/components/agent-indicator", () => ({ AgentIndicator: () => null }))

describe("hub search parameters", () => {
  it("preserves people search criteria and answer return context", () => {
    expect(validateWorkspaceSearch("contacts", { tab: "people", keywords: "Engineer", company: "Acme" })).toMatchObject({ tab: "people", keywords: "Engineer", company: "Acme" })
    expect(validateWorkspaceSearch("profile", { tab: "answers", field: "email", returnTo: "/apply?jobId=1" })).toEqual({ tab: "answers", field: "email", returnTo: "/apply?jobId=1" })
    expect(validateWorkspaceSearch("launch", { tab: "history", query: "draft" })).toMatchObject({ tab: "history", query: "draft" })
    expect(validateWorkspaceSearch("profile", { tab: "deal-breakers" })).toMatchObject({ tab: "deal-breakers" })
  })
})

describe("hub layout", () => {
  it.each([
    [ContactsHub, "Contacts", "People", ["Recruiters"]],
    [ProfileHub, "Profile", "Profile", []],
    [AgentHub, "Agent", "Console", ["Agent console"]],
  ] as const)("renders one page with its sections stacked inside it", (Hub, title, tab, sections) => {
    render(<Hub />)
    const headings = screen.getAllByRole("heading", { level: 1 })
    expect(headings.map((heading) => heading.textContent)).toEqual([title])
    expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true")
    const hub = headings[0]!.closest("section")!
    for (const section of sections) {
      const region = screen.getByRole("region", { name: section })
      expect(hub).toContainElement(region)
      expect(within(region).getByRole("heading", { level: 2, name: section })).toBeInTheDocument()
    }
  })

  it("switches tabs within the same page, with each tab's header actions", () => {
    render(<ContactsHub />)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["People", "Follow-ups", "Find people"])
    expect(screen.getByRole("button", { name: "Find recruiters" })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Follow-ups" }))
    expect(screen.getByText("Follow-ups content")).toBeInTheDocument()
    expect(screen.queryByText("People content")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Find recruiters" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Review follow-ups" })).toBeInTheDocument()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Find people" }))
    expect(screen.getByText("People search")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review follow-ups" })).not.toBeInTheDocument()
  })

  it("opens on the profile and keeps questions, LinkedIn and deal-breakers as tabs", () => {
    render(<ProfileHub />)
    expect(screen.getByText("Profile overview")).toBeInTheDocument()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Profile", "Questions", "LinkedIn", "Deal-breakers"])
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Questions" }))
    expect(screen.getByText("Questions content")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "LinkedIn" }))
    expect(screen.getByText("LinkedIn content")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Deal-breakers" }))
    expect(screen.getByText("Deal-breakers configuration")).toBeInTheDocument()
  })
})

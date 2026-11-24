import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContactsHub, ProfileHub, AgentHub } from "./hubs"
import { validateWorkspaceSearch } from "@/lib/workspace-search"
import { prepareSkill } from "@/lib/agent"

// Embedded pages keep their real Page wrapper, so the hub layout is exercised.
const { page } = vi.hoisted(() => ({
  page: async (title: string, content: string) => {
    const { Page } = await import("@/components/workspace-ui")
    return () => <Page title={title} description={`${title} description`}>{content}</Page>
  },
}))
vi.mock("./profile", async () => ({ ProfilePage: await page("LinkedIn profile", "LinkedIn content") }))
vi.mock("./answers", async () => ({ AnswersPage: await page("Answers", "Answers content") }))
vi.mock("./recruiters", async () => ({ RecruitersPage: await page("Recruiters", "People content") }))
vi.mock("./outreach", async () => ({ OutreachPage: await page("Outreach", "Follow-ups content") }))
vi.mock("./search", async () => ({ SearchPage: await page("Find people", "People search") }))
vi.mock("./launch", async () => ({ LaunchPage: await page("Agent console", "Console content") }))
vi.mock("./activity", async () => ({ ActivityPage: await page("Activity", "History content") }))
vi.mock("@/components/resume-sources", () => ({ ResumeSources: () => <div>Resume configuration</div> }))
vi.mock("@/components/deal-breakers", () => ({ DealBreakers: () => <div>Deal-breakers configuration</div> }))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn() }))
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
    [ContactsHub, "Contacts", "People", ["Recruiters", "Find people"]],
    [ProfileHub, "Profile", "LinkedIn", ["LinkedIn profile"]],
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

  it("switches tabs within the same page", () => {
    render(<ContactsHub />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Follow-ups" }))
    expect(screen.getByText("Follow-ups content")).toBeInTheDocument()
    expect(screen.queryByText("People content")).not.toBeInTheDocument()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("explains the base resume and experience bank tabs", () => {
    render(<ProfileHub />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Base resume" }))
    expect(screen.getByRole("heading", { level: 2, name: "Base resume" })).toBeInTheDocument()
    expect(screen.getByText("Resume configuration")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Experiences" }))
    expect(screen.getByText("Capture what your resume leaves out")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Update experiences" }))
    expect(prepareSkill).toHaveBeenCalledWith("experience-bank")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Deal-breakers" }))
    expect(screen.getByText("Deal-breakers configuration")).toBeInTheDocument()
  })
})

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContactsHub, ProfileHub, AgentHub } from "./hubs"
import { validateWorkspaceSearch } from "@/lib/workspace-search"
vi.mock("./profile", () => ({ ProfilePage: () => <div>LinkedIn content</div> }))
vi.mock("./answers", () => ({ AnswersPage: () => <div>Answers content</div> }))
vi.mock("./recruiters", () => ({ RecruitersPage: () => <div>People content</div> }))
vi.mock("./outreach", () => ({ OutreachPage: () => <div>Follow-ups content</div> }))
vi.mock("./search", () => ({ SearchPage: () => <div>People search</div> }))
vi.mock("./launch", () => ({ LaunchPage: () => <div>Console content</div> }))
vi.mock("./activity", () => ({ ActivityPage: () => <div>History content</div> }))
vi.mock("@/components/resume-sources", () => ({ ResumeSources: () => <div>Resume configuration</div> }))
describe("hub search parameters", () => {
  it("preserves people search criteria and answer return context", () => {
    expect(validateWorkspaceSearch("contacts", { tab: "people", keywords: "Engineer", company: "Acme" })).toMatchObject({ tab: "people", keywords: "Engineer", company: "Acme" })
    expect(validateWorkspaceSearch("profile", { tab: "answers", field: "email", returnTo: "/apply?jobId=1" })).toEqual({ tab: "answers", field: "email", returnTo: "/apply?jobId=1" })
    expect(validateWorkspaceSearch("launch", { tab: "history", query: "draft" })).toMatchObject({ tab: "history", query: "draft" })
  })
  it.each([[ContactsHub, "People"], [ProfileHub, "LinkedIn"], [AgentHub, "Console"]])("renders default tab", (Component, label) => {
    render(<Component />)
    expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true")
    fireEvent.click(screen.getByRole("tab", { name: label }))
  })
})

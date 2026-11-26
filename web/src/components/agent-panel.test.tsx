import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AgentPanel, AgentCompletion, AgentExecution } from "./agent-panel"
import { AgentIndicator } from "./agent-indicator"
import { clearAgent, dismissAgentCompletion, prepareSkill, runAgent, setAgentPanelOpen } from "@/lib/agent"
import { publish } from "@/lib/api"
import { resetSkillInputsCache } from "@/lib/skill-inputs"

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, search, children, ...props }: React.PropsWithChildren<{ to: string; search?: Record<string, string> }>) =>
  <a href={search ? `${to}?${new URLSearchParams(search)}` : to} {...props}>{children}</a> }))
const request = vi.fn()
beforeEach(() => {
  localStorage.clear()
  resetSkillInputsCache()
  request.mockReset().mockImplementation(async path => {
    if (path === "answers") return []
    if (path === "acp/providers") return { default: "opencode", providers: [{ id: "opencode", displayName: "OpenCode", models: ["careful"] }] }
    if (path === "acp/permissions") return { pending: [] }
    return { ok: true }
  })
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), connectionStatus: async () => true, getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {} }
  publish({ type: "acp-status", status: "done" })
  clearAgent()
  dismissAgentCompletion()
  setAgentPanelOpen(false)
})

it("keeps contextual fields, saved defaults and conversation after closing the panel", async () => {
  localStorage.setItem("work-tracker-model", "careful")
  render(<><AgentPanel /><AgentIndicator /><AgentCompletion /></>)
  act(() => prepareSkill("job-scout", { query: "React", location: "Brazil" }))
  expect(await screen.findByRole("button", { name: "Remove React" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Remove Brazil" })).toBeInTheDocument()
  expect(screen.getByText("Advanced").parentElement).not.toHaveAttribute("open")
  fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Remote only" } })
  await waitFor(() => expect(screen.getByRole("button", { name: "Run agent" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("acp/run", { provider: "opencode", model: "careful", skill: "job-scout", params: { query: "React", location: "Brazil", extra: "Remote only" } }))
  act(() => { setAgentPanelOpen(false); publish({ type: "acp-update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Still working" } } }) })
  act(() => setAgentPanelOpen(true))
  expect(await screen.findByText("Still working")).toBeVisible()
  act(() => prepareSkill("profile-optimizer", { username: "ana" }))
  expect(screen.getByText(/An agent is already running/)).toHaveTextContent("Audit your profile")
  expect(screen.getByLabelText("LinkedIn username")).toHaveValue("ana")
  act(() => publish({ type: "acp-status", status: "done" }))
  expect(screen.getByRole("link", { name: "View new jobs" })).toHaveAttribute("href", "/jobs?view=new")
  fireEvent.click(screen.getByRole("link", { name: "View new jobs" }))
  expect(screen.queryByText("Agent task completed.")).not.toBeInTheDocument()
})

it("sends the saved effort when the selected agent supports it", async () => {
  localStorage.setItem("work-tracker-provider", "claude-code")
  localStorage.setItem("work-tracker-effort", "high")
  request.mockImplementation(async path => {
    if (path === "answers") return []
    if (path === "acp/providers") return { default: "opencode", providers: [{ id: "opencode", displayName: "OpenCode", models: [] }, { id: "claude-code", displayName: "Claude Code", models: ["sonnet"], efforts: ["low", "high"] }] }
    if (path === "acp/permissions") return { pending: [] }
    return { ok: true }
  })
  render(<AgentPanel />)
  act(() => prepareSkill("job-scout", { query: "Backend" }))
  expect(await screen.findByRole("slider", { name: "Effort" })).toHaveAttribute("aria-valuetext", "High")
  await waitFor(() => expect(screen.getByRole("button", { name: "Run agent" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("acp/run", { provider: "claude-code", effort: "high", skill: "job-scout", params: { query: "Backend" } }))
  localStorage.clear()
})

it.each([
  ["recruiter-outreach", "View recruiters", "/contacts?tab=people"],
  ["outreach-tracker", "Review outreach", "/contacts?tab=follow-ups"],
  ["profile-optimizer", "View profile", "/profile?tab=linkedin"],
])("links a finished %s run straight to its hub tab", async (skill, label, href) => {
  render(<AgentCompletion />)
  await act(() => runAgent("opencode", skill, {}))
  act(() => publish({ type: "acp-status", status: "done" }))
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href)
})

it("reflects running, permission, login, completion and failure globally", async () => {
  render(<AgentIndicator />)
  expect(screen.getByRole("status")).toHaveTextContent("Idle")
  await act(async () => { await runAgent("opencode", "job-scout", {}) })
  expect(screen.getByRole("status")).toHaveTextContent("Running")
  for (const status of ["waiting_for_permission", "waiting_for_sign_in"]) {
    act(() => publish({ type: "acp-status", status }))
    expect(screen.getByRole("status")).toHaveTextContent("Waiting")
  }
  act(() => publish({ type: "acp-status", status: "done" }))
  expect(screen.getByRole("status")).toHaveTextContent("Done")
  act(() => publish({ type: "acp-error", message: "Offline" }))
  expect(screen.getByRole("status")).toHaveTextContent("Error")
})

it("restores each skill's saved inputs, keeps them for the next run and leaves record context to its run", async () => {
  localStorage.setItem("work-tracker-launch-fields-v1:recruiter-outreach", JSON.stringify({ location: "Lisbon" }))
  const first = render(<AgentPanel />)
  act(() => prepareSkill("recruiter-outreach"))
  expect(await screen.findByRole("button", { name: "Remove Lisbon" })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Target company"), { target: { value: "Acme" } })
  fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Engineering only" } })
  first.unmount()
  clearAgent()
  render(<AgentPanel />)
  act(() => prepareSkill("recruiter-outreach"))
  expect(await screen.findByLabelText("Target company")).toHaveValue("Acme")
  expect(screen.getByLabelText("Additional context")).toHaveValue("Engineering only")
  await waitFor(() => expect(screen.getByRole("button", { name: "Run agent" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("acp/run", { provider: "opencode", skill: "recruiter-outreach", params: { company: "Acme", location: "Lisbon", extra: "Engineering only" } }))
  act(() => { publish({ type: "acp-status", status: "done" }); clearAgent(); prepareSkill("requirements-check", { jobIds: "7" }) })
  fireEvent.change(await screen.findByLabelText("Additional context"), { target: { value: "Only job 7" } })
  expect(localStorage.getItem("work-tracker-skill-inputs-v1:requirements-check")).toBeNull()
  expect(screen.getByLabelText("Saved job IDs")).toHaveValue("7")
})

it("adds the opening screen's instructions after the user's context", async () => {
  localStorage.setItem("work-tracker-skill-inputs-v1:job-scout", JSON.stringify({ query: "React", extra: "Brazil only" }))
  render(<AgentPanel />)
  act(() => prepareSkill("job-scout", { instructions: "Pages to search: 2." }))
  expect(await screen.findByLabelText("Additional context")).toHaveValue("Brazil only")
  await waitFor(() => expect(screen.getByRole("button", { name: "Run agent" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("acp/run", { provider: "opencode", skill: "job-scout", params: { query: "React", extra: "Brazil only\n\nPages to search: 2." } }))
  expect(screen.getByRole("link", { name: "Change the default agent" })).toHaveAttribute("href", "/launch?tab=setup")
})

it("keeps each screen to its own skills: their last conversation stays and other runs never show", async () => {
  await act(() => runAgent("opencode", "job-scout", { query: "React" }))
  act(() => publish({ type: "acp-status", status: "done" }))
  await act(() => runAgent("opencode", "outreach-tracker", {}))
  const jobs = render(<AgentExecution skills={["job-scout"]} />)
  expect(screen.getByText(/query: React/)).toBeInTheDocument()
  expect(screen.queryByText("Review follow-ups")).not.toBeInTheDocument()
  // Another skill's run only blocks; its status and Cancel belong to its own screen.
  expect(screen.getByRole("status")).toHaveTextContent("Your agent is busy with Review follow-ups")
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
  jobs.unmount()
  act(() => publish({ type: "acp-status", status: "done" }))
  const followups = render(<AgentExecution skills={["outreach-tracker"]} />)
  expect(screen.getByText("Review follow-ups")).toBeInTheDocument()
  expect(screen.queryByText(/query: React/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Clear" }))
  expect(screen.queryByText("Review follow-ups")).not.toBeInTheDocument()
  followups.unmount()
  render(<AgentExecution skills={["job-scout"]} />)
  expect(screen.getByText(/query: React/)).toBeInTheDocument()
})

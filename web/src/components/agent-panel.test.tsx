import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AgentPanel, AgentCompletion } from "./agent-panel"
import { AgentIndicator } from "./agent-indicator"
import { clearAgent, dismissAgentCompletion, prepareSkill, runAgent, setAgentPanelOpen } from "@/lib/agent"
import { publish } from "@/lib/api"

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...props }: React.PropsWithChildren<{ to: string }>) => <a href={to} {...props}>{children}</a> }))
const request = vi.fn()
beforeEach(() => {
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
  expect(await screen.findByLabelText("Role, keywords or job URL")).toHaveValue("React")
  expect(screen.getByLabelText("Location")).toHaveValue("Brazil")
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
  expect(screen.getByRole("link", { name: "View new jobs" })).toHaveAttribute("href", "/jobs")
  fireEvent.click(screen.getByRole("link", { name: "View new jobs" }))
  expect(screen.queryByText("Agent task completed.")).not.toBeInTheDocument()
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

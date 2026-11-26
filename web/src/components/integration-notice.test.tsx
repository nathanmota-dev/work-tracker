import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { AgentNotice, IntegrationNotice } from "./integration-notice"
import { desktopDouble } from "@/test/doubles"

let entry: { target: string; executable: boolean; diagnostic?: unknown }
let install: { name: string; state: string; message: string }[]
let agentReady: boolean
beforeEach(() => {
  entry = { target: "mcp/linkedin", executable: true }
  install = []
  agentReady = true
  const desktop = desktopDouble()
  desktop.request.mockImplementation(async path => {
    if (path === "integrations/status") return { backend: true, entries: [entry], install, dependencies: [] }
    if (path === "onboarding/status") return { agentReady, readyAgents: [], setupCompletedAt: "earlier", hidden: false, completedAt: null, complete: false, next: null, steps: [] }
  })
  window.desktop = desktop
})

it("stays silent while the MCP server works, unless an error already happened", async () => {
  render(<IntegrationNotice target="mcp/linkedin">Pending only.</IntegrationNotice>)
  render(<IntegrationNotice target="mcp/linkedin" always>Search failed.</IntegrationNotice>)
  expect(await screen.findByText(/Search failed\./)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Check LinkedIn MCP" })).toHaveAttribute("href", "#/settings?section=integrations&target=mcp%2Flinkedin")
  expect(screen.queryByText(/Pending only\./)).not.toBeInTheDocument()
})

it("points a missing, installing or failing MCP server at its settings", async () => {
  entry = { target: "mcp/linkedin", executable: false }
  install = [{ name: "linkedin", state: "installing", message: "Installing" }]
  const { unmount } = render(<IntegrationNotice target="mcp/linkedin">Needs LinkedIn.</IntegrationNotice>)
  expect(await screen.findByText(/Needs LinkedIn\. LinkedIn MCP is still installing\./)).toBeInTheDocument()
  unmount()
  entry = { target: "mcp/linkedin", executable: true, diagnostic: { checks: [{ stage: "auth", state: "authentication_required", message: "Sign in" }] } }
  install = []
  render(<IntegrationNotice target="mcp/linkedin">Needs LinkedIn.</IntegrationNotice>)
  expect(await screen.findByRole("link", { name: "Check LinkedIn MCP" })).toBeInTheDocument()
  expect(screen.queryByText(/still installing/)).not.toBeInTheDocument()
})

it("warns about the agent only while none passes its test", async () => {
  const { unmount } = render(<AgentNotice>May stop early.</AgentNotice>)
  await waitFor(() => expect(window.desktop!.request).toHaveBeenCalledWith("onboarding/status", undefined))
  expect(screen.queryByText(/May stop early\./)).not.toBeInTheDocument()
  unmount()
  agentReady = false
  render(<AgentNotice>May stop early.</AgentNotice>)
  expect(await screen.findByRole("link", { name: "Test your agent" })).toHaveAttribute("href", "#/launch?tab=setup")
})

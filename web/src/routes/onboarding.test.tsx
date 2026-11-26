import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Outlet, RouterProvider } from "@tanstack/react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { createAppRouter } from "@/router"
import { publish } from "@/lib/api"
import { forgetSetup, type OnboardingStatus } from "@/lib/onboarding"

vi.mock("@/components/ui/select-control", () => ({ SelectControl: (props: React.ComponentProps<"select">) => <select {...props} /> }))
const request = vi.fn()
let status: OnboardingStatus
let tested: boolean
const diagnostic = { target: "acp/claude-code", model: "", checkedAt: "2026-11-26T12:00:00.000Z", checks: [{ stage: "connection", state: "ready", message: "ACP session created." }] }
beforeEach(() => {
  forgetSetup()
  localStorage.clear()
  tested = false
  status = { agentReady: false, readyAgents: [], setupCompletedAt: null, hidden: false, completedAt: null, complete: false, next: "resume", steps: [{ id: "resume", optional: true, state: "pending", items: [] }] }
  request.mockReset().mockImplementation(async (path: string, body?: { target?: string; setupCompleted?: boolean }) => {
    if (path === "onboarding/status") return structuredClone(status)
    if (path === "onboarding/preferences") {
      if (body?.setupCompleted) status = { ...status, setupCompletedAt: "now" }
      return structuredClone(status)
    }
    if (path === "integrations/status") return { backend: true, dependencies: [], entries: [
      { target: "acp/claude-code", executable: true, ...(tested && { diagnostic }) },
      { target: "acp/opencode", executable: false },
    ] }
    if (path === "integrations") return { revision: "one", entries: [{ target: "acp/claude-code", command: "claude-code-acp", args: [], env: {} }, { target: "acp/opencode", command: "opencode", args: [], env: {} }] }
    if (path === "integrations/test") {
      tested = true
      status = { ...status, agentReady: true, readyAgents: [body!.target!] }
      return diagnostic
    }
    if (path === "acp/providers") return { providers: [], default: "opencode" }
    return []
  })
  window.desktop = { request, connectionStatus: async () => true, onEvent: () => () => {}, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), getVersion: async () => "1", openExternal: vi.fn() }
})
async function mount(path: string) {
  window.location.hash = path
  const router = createAppRouter(() => <main><h1>Workspace layout</h1><Outlet /></main>)
  render(<RouterProvider router={router} />)
  await act(() => router.load())
  return router
}
const next = () => screen.getByRole("button", { name: "Next" })

it("keeps the workspace behind the setup until an agent passes its test, then opens the Dashboard", async () => {
  const router = await mount("/dashboard")
  expect(await screen.findByRole("heading", { name: "Welcome to Work Tracker" })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe("/onboarding")
  expect(screen.queryByRole("heading", { name: "Workspace layout" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Get started" }))

  expect(await screen.findByRole("heading", { name: "Connect your agent" })).toBeInTheDocument()
  expect(next()).toBeDisabled()
  expect(screen.getByText("Test Claude Code or opencode to continue.")).toBeInTheDocument()
  const agents = screen.getByRole("radiogroup", { name: "Agent" })
  await waitFor(() => expect(within(agents).getByRole("radio", { name: /opencode/ })).toHaveTextContent("Not installed"))
  fireEvent.click(within(agents).getByRole("radio", { name: /opencode/ }))
  expect(localStorage.getItem("work-tracker-provider")).toBe("opencode")
  fireEvent.click(within(agents).getByRole("radio", { name: /Claude Code/ }))
  expect(localStorage.getItem("work-tracker-provider")).toBe("claude-code")
  expect(await screen.findByText("claude-code-acp")).toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: "Test agent" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("integrations/test", { target: "acp/claude-code", model: "" }))
  await waitFor(() => expect(next()).toBeEnabled())
  expect(within(agents).getByRole("radio", { name: /Claude Code/ })).toHaveTextContent("Ready")
  expect(screen.getByLabelText("Diagnostic results")).toHaveTextContent("ACP session created.")

  // Back returns one screen and keeps the passing test.
  fireEvent.click(screen.getByRole("button", { name: "Back" }))
  expect(screen.getByRole("heading", { name: "Welcome to Work Tracker" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Get started" }))
  for (const title of ["Find your next role", "Apply with confidence", "Keep it all moving"]) {
    fireEvent.click(next())
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument()
  }
  fireEvent.click(next())
  fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }))
  await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  expect(request).toHaveBeenCalledWith("onboarding/preferences", { setupCompleted: true })
  expect(await screen.findByRole("heading", { name: "Workspace layout" })).toBeInTheDocument()
})

it("reports a setup that could not be saved and stays on the last screen", async () => {
  status = { ...status, agentReady: true, readyAgents: ["acp/opencode"] }
  await mount("/onboarding")
  fireEvent.click(await screen.findByRole("button", { name: "Get started" }))
  await waitFor(() => expect(next()).toBeEnabled())
  for (let screenIndex = 0; screenIndex < 4; screenIndex++) fireEvent.click(next())
  request.mockRejectedValueOnce(new Error("Test Claude Code or opencode before finishing setup."))
  fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Test Claude Code or opencode before finishing setup.")
  expect(screen.getByRole("button", { name: "Go to Dashboard" })).toBeEnabled()
})

it("shows a failed test and lets the command be adjusted under Advanced", async () => {
  const reply = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: unknown) => path === "integrations/status"
    ? { backend: true, dependencies: [], entries: [{ target: "acp/claude-code", executable: true, diagnostic: { ...diagnostic, checks: [{ stage: "authentication", state: "authentication_required", message: "Sign in first." }] } }] }
    : reply(path, body))
  localStorage.setItem("work-tracker-provider", "claude-code")
  await mount("/onboarding")
  fireEvent.click(await screen.findByRole("button", { name: "Get started" }))
  expect(await screen.findByLabelText("Diagnostic results")).toHaveTextContent("authentication — Sign in first.")
  expect(screen.getByRole("radio", { name: /Claude Code/ })).toHaveTextContent("Test failed")
  expect(screen.getByText(/sign in to Claude Code once in a terminal/)).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Agent connection" })).not.toBeInTheDocument()
  const advanced = screen.getByText(/Advanced: change the command/).closest("details")!
  advanced.open = true
  fireEvent(advanced, new Event("toggle"))
  expect(await screen.findByText("Agent connection")).toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: "Test agent" })).toHaveLength(2)
})

it("opens the workspace once the setup is finished, and replays it only on request", async () => {
  status = { ...status, agentReady: true, readyAgents: ["acp/opencode"], setupCompletedAt: "earlier" }
  const router = await mount("/onboarding")
  await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  expect(await screen.findByRole("heading", { name: "Workspace layout" })).toBeInTheDocument()
  await act(() => router.navigate({ href: "/onboarding?replay=1" }))
  expect(await screen.findByRole("heading", { name: "Welcome to Work Tracker" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Get started" }))
  await waitFor(() => expect(next()).toBeEnabled())
  for (let screenIndex = 0; screenIndex < 4; screenIndex++) fireEvent.click(next())
  fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }))
  await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"))
  // A finished setup is not recorded again.
  expect(request).not.toHaveBeenCalledWith("onboarding/preferences", expect.anything())
})

it("waits for a starting backend, then follows the status it reports", async () => {
  let starting = true
  const reply = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "onboarding/status" && starting) throw new Error("Backend is starting. Please retry in a moment.")
    return reply(path, body)
  })
  await mount("/dashboard")
  expect(await screen.findByRole("status", { name: "Opening Work Tracker" })).toBeInTheDocument()
  starting = false
  act(() => publish({ type: "changed" }))
  expect(await screen.findByRole("heading", { name: "Welcome to Work Tracker" })).toBeInTheDocument()
})

it("opens the workspace when the backend cannot answer, so its banner can explain why", async () => {
  request.mockImplementation(async () => { throw new Error("The backend stopped.") })
  await mount("/dashboard")
  expect(await screen.findByRole("heading", { name: "Workspace layout" })).toBeInTheDocument()
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { IntegrationSettingsPanel } from "./integration-settings"
import { desktopDouble } from "@/test/doubles"
import { publish } from "@/lib/api"
import { act } from "react"
const settings = { revision: "one", entries: [{ target: "acp/opencode", command: "fixture-agent", args: ["[stored argument 1]"], env: { TOKEN: "[stored value]" } }, { target: "mcp/linkedin", command: "fixture-linkedin", args: [], env: {} }] }
let desktop: ReturnType<typeof desktopDouble>
let status: any
beforeEach(() => {
  window.location.hash = "#/settings?section=integrations"
  desktop = desktopDouble(); window.desktop = desktop
  status = { entries: [{ target: "acp/opencode", executable: true }], dependencies: [{ command: "latexmk", available: false }] }
  desktop.request.mockImplementation(async (path, body) => {
    if (path === "integrations") return body ? { ...settings, revision: "two" } : settings
    if (path === "integrations/status") return status
    if (path === "integrations/test") {
      status = { ...status, entries: [{ target: "acp/opencode", executable: true, diagnostic: { model: "", checkedAt: "2026-10-18T00:00:00Z", checks: [{ stage: "authentication", state: "authentication_required", message: "Sign in to this integration, then test again." }] } }] }
      return status.entries[0].diagnostic
    }
  })
})
it("retains hidden placeholders when editing and reports actual save outcomes", async () => {
  render(<IntegrationSettingsPanel scope="acp" />)
  const command = await screen.findByLabelText("Executable command")
  expect(screen.getByLabelText("Environment (JSON object)")).toHaveValue(JSON.stringify(settings.entries[0].env, null, 2))
  fireEvent.change(command, { target: { value: "new-agent" } })
  expect(screen.getByRole("button", { name: "Test agent" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Integration saved")
  expect(desktop.request).toHaveBeenCalledWith("integrations", { ...settings.entries[0], command: "new-agent", revision: "one" })
  fireEvent.change(command, { target: { value: "edited-again" } })
  const original = desktop.request.getMockImplementation()!
  desktop.request.mockImplementation((path, body) => { if (path === "integrations" && body) throw new Error("synthetic-private-token"); return original(path, body) })
  fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are preserved")
  expect(screen.queryByText(/synthetic-private-token/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Integration saved/)).not.toBeInTheDocument()
  expect(command).toHaveValue("edited-again")
})
it("rejects invalid JSON before saving and reloads settings", async () => {
  render(<IntegrationSettingsPanel scope="acp" />)
  await screen.findByLabelText("Executable command")
  fireEvent.change(screen.getByLabelText("Arguments (JSON array)"), { target: { value: "invalid" } })
  fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("valid JSON")
  expect(desktop.request).not.toHaveBeenCalledWith("integrations", expect.anything())
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }))
  await waitFor(() => expect(screen.getByLabelText("Arguments (JSON array)")).toHaveValue(JSON.stringify(settings.entries[0].args, null, 2)))
})
it("tests an agent and displays pending authentication", async () => {
  render(<IntegrationSettingsPanel scope="acp" />)
  fireEvent.click(await screen.findByRole("button", { name: "Test agent" }))
  expect(await screen.findByLabelText("Diagnostic results")).toHaveTextContent("authentication_required")
  expect(screen.getByText(/Complete provider sign-in/)).toBeInTheDocument()
  expect(screen.queryByText("LaTeX and PDF tools")).not.toBeInTheDocument()
})
it("lists only MCP servers in Settings and rechecks installed tools there", async () => {
  window.location.hash = "#/settings?section=integrations&target=acp%2Fopencode"
  render(<IntegrationSettingsPanel scope="mcp" />)
  expect(await screen.findByRole("combobox")).toHaveTextContent("Chrome MCP")
  expect(screen.getByText(/Chrome browser access and the LinkedIn MCP session are independent/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Recheck installed tools" }))
  expect(await screen.findByText(/latexmk: missing/)).toBeInTheDocument()
  status.dependencies = [{ command: "latexmk", available: true }]
  act(() => publish({ type: "changed", table: "integrations" }))
  expect(await screen.findByText("latexmk: available")).toBeInTheDocument()
})
it("opens the integration linked by an Apply blocker and hides a failed test's private error", async () => {
  window.location.hash = "#/settings?section=integrations&target=mcp%2Flinkedin"
  const original = desktop.request.getMockImplementation()!
  desktop.request.mockImplementation((path, body) => { if (path === "integrations/test") throw new Error("private-output"); return original(path, body) })
  render(<IntegrationSettingsPanel scope="mcp" />)
  expect(await screen.findByLabelText("Executable command")).toHaveValue("fixture-linkedin")
  expect(screen.queryByLabelText("Model to test (empty uses provider default)")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Test saved integration" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("diagnostic could not finish")
  expect(screen.queryByText(/private-output/)).not.toBeInTheDocument()
})
it("shows safe validation details from the backend without exposing arbitrary errors", async () => {
  const original = desktop.request.getMockImplementation()!
  desktop.request.mockImplementation((path, body) => { if (path === "integrations" && body) throw new Error("Arguments must be a JSON array of strings without null characters."); return original(path, body) })
  render(<IntegrationSettingsPanel scope="acp" />)
  await screen.findByLabelText("Executable command")
  fireEvent.change(screen.getByLabelText("Arguments (JSON array)"), { target: { value: "[1]" } })
  fireEvent.click(screen.getByRole("button", { name: "Save integration" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Arguments must be a JSON array of strings")
})
it("shows how the app installed the selected MCP and retries a failed installation", async () => {
  window.location.hash = "#/settings?section=integrations&target=mcp/linkedin"
  status = { ...status, entries: [{ target: "mcp/linkedin", executable: false }], install: [{ name: "linkedin", state: "failed", message: "LinkedIn MCP could not be downloaded. Check your internet connection, then try again." }, { name: "chrome", state: "ready", message: "Chrome MCP is installed." }] }
  render(<IntegrationSettingsPanel scope="mcp" />)
  expect(await screen.findByRole("alert")).toHaveTextContent("Installation: LinkedIn MCP could not be downloaded.")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("integrations/install", {}))
  status = { ...status, install: [{ name: "linkedin", state: "installing", message: "Installing LinkedIn MCP…" }] }
  await act(async () => publish({ type: "changed", table: "integrations" }))
  expect(await screen.findByText("Installation: Installing LinkedIn MCP…")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
})
it("opens the preferred agent in Agent setup unless a link names another one", async () => {
  window.location.hash = "#/launch?tab=setup"
  localStorage.setItem("work-tracker-provider", "claude-code")
  const view = render(<IntegrationSettingsPanel scope="acp" />)
  expect(await screen.findByRole("combobox")).toHaveTextContent("Claude Code ACP")
  expect(screen.queryByLabelText("Executable command")).not.toBeInTheDocument()
  view.unmount()
  window.location.hash = "#/launch?tab=setup&target=acp%2Fopencode"
  render(<IntegrationSettingsPanel scope="acp" />)
  expect(await screen.findByLabelText("Executable command")).toHaveValue("fixture-agent")
  localStorage.clear()
})

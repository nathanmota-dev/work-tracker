import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { AgentPermissions } from "./agent-permissions"
import { PermissionSettings } from "./permission-settings"
import { desktopDouble, deferred } from "@/test/doubles"
import { publish } from "@/lib/api"
import type { PermissionRequest, PermissionSnapshot } from "@/lib/permissions"
import { permissionDecision } from "@/lib/permissions"
const permission: PermissionRequest = {
  id: "p", runId: "r", sessionId: "s", provider: "opencode", tool: "get_jobs", title: "get_jobs", context: "Synthetic input",
  rememberable: true, status: "pending", createdAt: "2026-10-01", expiresAt: "2099-01-01",
  options: [{ optionId: "no", name: "Refuse", kind: "reject_once" }, { optionId: "exact", name: "Allow once", kind: "allow_once" }],
}
let data: PermissionSnapshot
let desktop: ReturnType<typeof desktopDouble>
beforeEach(() => {
  data = { pending: [permission], rules: [], sessionRules: [], history: [] }
  desktop = desktopDouble()
  desktop.connectionStatus.mockResolvedValue(true)
  desktop.request.mockImplementation(async () => data)
  window.desktop = desktop
})
it("shows an accessible permission dialogue, the exact choice and saving state", async () => {
  const result = deferred<unknown>()
  desktop.request.mockImplementation(async (path) => path === "acp/permissions/answer" ? result.promise : data)
  render(<AgentPermissions />)
  const dialog = await screen.findByRole("dialog", { name: "Agent tool permission" })
  expect(dialog).toHaveAccessibleDescription(expect.stringContaining("does not confirm sending"))
  fireEvent.click(screen.getByText("Request context"))
  expect(screen.getByText("Synthetic input")).toBeVisible()
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow once" }))
  expect(await screen.findByText("Saving decision…")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Refuse" })).toBeDisabled()
  expect(desktop.request).toHaveBeenCalledWith("acp/permissions/answer", { id: "p", runId: "r", sessionId: "s", optionId: "exact", remember: "once" })
  data = { ...data, pending: [] }
  await act(async () => result.resolve({ ok: true }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})
it("can defer without granting permission, refuse and recover from a failed answer", async () => {
  desktop.request.mockImplementation(async path => { if (path.endsWith("answer")) throw Error("Already answered"); return data })
  render(<AgentPermissions />)
  await screen.findByRole("dialog")
  fireEvent.click(screen.getByRole("button", { name: "Decide later" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(desktop.request.mock.calls.some(([path]) => path.endsWith("answer"))).toBe(false)
  fireEvent.click(screen.getByRole("button", { name: "Review permission" }))
  fireEvent.click(screen.getByRole("button", { name: "Refuse" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Already answered")
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(desktop.request).toHaveBeenLastCalledWith("acp/permissions/answer", expect.objectContaining({ optionId: "no", remember: "once" }))
})
it("hides pending controls on disconnect and never sends implicit approval", async () => {
  render(<AgentPermissions />)
  await screen.findByRole("dialog")
  act(() => publish({ type: "connection", live: false }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(desktop.request.mock.calls.every(([path]) => path === "acp/permissions")).toBe(true)
  data = { ...data, pending: [] }
  act(() => publish({ type: "connection", live: true }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})
it("cancels with no option and excludes remember controls for commands", async () => {
  data.pending = [{ ...permission, rememberable: false }]
  desktop.request.mockImplementation(async path => { if (path.endsWith("answer")) data = { ...data, pending: [] }; return data })
  render(<AgentPermissions />)
  await screen.findByRole("dialog")
  expect(screen.queryByLabelText("Remember this tool")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(desktop.request).toHaveBeenCalledWith("acp/permissions/answer", expect.objectContaining({ optionId: undefined, remember: "once" }))
})
it("lists, adds and revokes persisted and session rules with decision history", async () => {
  data.rules = [{ provider: "opencode", tool: "get_jobs" }]
  data.sessionRules = [{ provider: "opencode", tool: "read_file", sessionId: "s" }]
  data.history = [permission, { ...permission, id: "refused", status: "selected", optionId: "no", decidedAt: "2026-10-02" }]
  render(<PermissionSettings />)
  await screen.findByRole("button", { name: "Revoke get_jobs" })
  fireEvent.click(screen.getByText("Permission history"))
  expect(screen.getByText("get_jobs: Refused · Refuse")).toBeVisible()
  expect(screen.getByText("get_jobs: Waiting for decision")).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Revoke read_file" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("acp/permissions/rule", expect.objectContaining({ sessionId: "s", enabled: false })))
  fireEvent.change(screen.getByLabelText("Exact read-only tool name"), { target: { value: "list_pages" } })
  fireEvent.click(screen.getByRole("button", { name: "Add tool rule" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("acp/permissions/rule", { provider: "opencode", tool: "list_pages", enabled: true }))
})
it("keeps failed rule actions visible and formats cancelled and remembered history", async () => {
  desktop.request.mockImplementation(async path => { if (path.endsWith("rule")) throw Error("Disk full"); return data })
  render(<PermissionSettings />)
  await screen.findByText("No remembered tools.")
  expect(screen.getByText("No permission decisions yet.")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Exact read-only tool name"), { target: { value: "get_jobs" } })
  fireEvent.click(screen.getByRole("button", { name: "Add tool rule" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Disk full")
  expect(screen.getByLabelText("Exact read-only tool name")).toHaveValue("get_jobs")
  expect(permissionDecision({ ...permission, status: "cancelled", reason: "Disconnected" })).toContain("Cancelled · Disconnected")
  expect(permissionDecision({ ...permission, status: "selected", optionId: "exact", remember: "session" })).toContain("Allowed · Allow once · session rule")
})
it("makes permission snapshot failures visible and allows retry", async () => {
  desktop.request.mockRejectedValueOnce(Error("Snapshot unavailable"))
  render(<AgentPermissions />)
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load tool permissions")
  fireEvent.click(screen.getByRole("button", { name: "Retry permissions" }))
  expect(await screen.findByRole("dialog")).toBeInTheDocument()
})

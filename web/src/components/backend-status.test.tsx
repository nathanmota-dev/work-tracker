import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterAll, beforeEach, expect, it } from "vitest"
import { BackendStatus } from "./backend-status"
import { useApi } from "@/lib/api"
import { restartBackend } from "@/lib/backend"
import { desktopDouble } from "@/test/doubles"

// The event bridge is registered once per renderer; keep one desktop for the whole file.
const desktop = desktopDouble()
window.desktop = desktop
let listener: ((event: unknown) => void) | undefined
let registrations = 0
desktop.onEvent.mockImplementation(value => { listener = value; registrations++; return () => {} })
const forward = (event: unknown) => act(() => listener!(event))
const state = (status: string, patch: Record<string, unknown> = {}) => ({ type: "backend", state: { status, restarts: 0, failures: 0, logPath: "/home/candidate/.work-tracker/logs/backend.log", ...patch } })
beforeEach(() => {
  desktop.backendStatus.mockReset().mockResolvedValue(undefined)
  desktop.restartBackend.mockReset().mockResolvedValue(true)
  desktop.request.mockReset().mockResolvedValue([])
})
afterAll(() => { delete window.desktop })

it("stays hidden during a normal start and while the backend is ready", async () => {
  desktop.backendStatus.mockResolvedValue(state("starting").state)
  const { container } = render(<BackendStatus />)
  await waitFor(() => expect(desktop.backendStatus).toHaveBeenCalledOnce())
  forward(state("ready"))
  expect(container).toBeEmptyDOMElement()
})

it("shows an unexpected exit, restarts once and reloads open screens once after reconnecting", async () => {
  const screenData = renderHook(() => useApi("jobs"))
  render(<BackendStatus />)
  await waitFor(() => expect(desktop.request).toHaveBeenCalledTimes(1))
  forward(state("unavailable", { failures: 1, message: "The backend stopped unexpectedly (exit code 9)." }))
  forward({ type: "connection", live: false })
  const alert = screen.getByRole("alert")
  expect(alert).toHaveTextContent("Backend unavailable")
  expect(alert).toHaveTextContent("exit code 9")
  expect(alert).toHaveTextContent("will not be repeated")
  fireEvent.click(screen.getByRole("button", { name: "Restart backend" }))
  expect(desktop.restartBackend).toHaveBeenCalledOnce()
  forward(state("starting", { restarts: 1, failures: 1 }))
  expect(screen.getByRole("status")).toHaveTextContent("Restarting backend")
  forward(state("ready", { restarts: 1, failures: 1 }))
  forward({ type: "connection", live: true })
  forward({ type: "changed" })
  forward({ type: "hello" })
  await waitFor(() => expect(desktop.request).toHaveBeenCalledTimes(2))
  await act(async () => {})
  expect(desktop.request).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  // One renderer bridge, one reload per reconnect: listeners were not registered again.
  expect(registrations).toBe(1)
  expect(desktop.request.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  screenData.unmount()
})

it("reports a refused or failed restart without claiming recovery", async () => {
  desktop.backendStatus.mockResolvedValue(state("unavailable", { failures: 1, message: "Stopped." }).state)
  desktop.restartBackend.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("IPC closed"))
  render(<BackendStatus />)
  const button = await screen.findByRole("button", { name: "Restart backend" })
  fireEvent.click(button)
  expect(await screen.findByText(/could not be restarted/)).toBeVisible()
  fireEvent.click(button)
  expect(await screen.findByText("IPC closed")).toBeVisible()
  expect(screen.getByRole("alert")).toHaveTextContent("Backend unavailable")
})

it("stops offering restarts after repeated failures and shows the log path", () => {
  render(<BackendStatus />)
  forward(state("failed", { failures: 3, restarts: 2, message: "The backend could not start: Error: database is locked" }))
  const alert = screen.getByRole("alert")
  expect(alert).toHaveTextContent("Backend could not be recovered")
  expect(alert).toHaveTextContent("database is locked")
  expect(alert).toHaveTextContent("/home/candidate/.work-tracker/logs/backend.log")
  expect(screen.queryByRole("button", { name: "Restart backend" })).not.toBeInTheDocument()
})

it("needs the desktop bridge to restart", async () => {
  const restart = desktop.restartBackend
  Object.assign(desktop, { restartBackend: undefined })
  await expect(restartBackend()).rejects.toThrow("desktop app")
  Object.assign(desktop, { restartBackend: restart })
})

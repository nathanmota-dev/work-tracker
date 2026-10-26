import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterAll, beforeEach, expect, it, vi } from "vitest"
import { BackendStatus } from "./backend-status"
import { OFFLINE_AFTER_MS } from "@/lib/backend"
import { setTransport } from "@/lib/transport"
import { desktopDouble } from "@/test/doubles"

// The browser transport has no supervised process to query or restart.
const { backendStatus: _status, restartBackend: _restart, ...browser } = desktopDouble()
const reconnect = vi.fn()
let listener: ((event: unknown) => void) | undefined
browser.onEvent.mockImplementation(value => { listener = value; return () => {} })
setTransport({ ...browser, reconnect })
const connection = (live: boolean) => act(() => listener!({ type: "connection", live }))
beforeEach(() => {
  vi.useFakeTimers()
  browser.connectionStatus.mockResolvedValue(false)
  reconnect.mockReset()
})
afterAll(() => { setTransport(undefined); vi.useRealTimers() })

it("stays hidden while starting, then reports a server that never answered", async () => {
  const { container } = render(<BackendStatus />)
  await act(async () => {})
  expect(container).toBeEmptyDOMElement()
  await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_AFTER_MS) })
  const alert = screen.getByRole("alert")
  expect(alert).toHaveTextContent("Work Tracker server is not running")
  expect(alert).toHaveTextContent("work-tracker")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(reconnect).toHaveBeenCalledOnce()
  connection(true)
  expect(container).toBeEmptyDOMElement()
})

it("shows reconnecting after a drop, offline only once the drop lasts, and clears on reconnect", async () => {
  browser.connectionStatus.mockResolvedValue(true)
  const { container } = render(<BackendStatus />)
  await act(async () => {})
  expect(container).toBeEmptyDOMElement()
  connection(false)
  expect(screen.getByRole("status")).toHaveTextContent("Reconnecting to the server")
  await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_AFTER_MS - 1) })
  expect(screen.queryByRole("alert")).toBeNull()
  connection(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_AFTER_MS) })
  expect(container).toBeEmptyDOMElement()
  connection(false)
  await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_AFTER_MS) })
  expect(screen.getByRole("alert")).toHaveTextContent("not running")
})

it("prefers a pushed connection change over a slower initial status", async () => {
  let answer!: (live: boolean) => void
  browser.connectionStatus.mockReturnValue(new Promise(resolve => { answer = resolve }))
  const { container } = render(<BackendStatus />)
  connection(true)
  await act(async () => answer(false))
  expect(container).toBeEmptyDOMElement()
})

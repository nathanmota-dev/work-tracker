import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

// jsdom does not implement the observer used by drag-and-drop layout measurement.
vi.stubGlobal("ResizeObserver", class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
})

// Without the desktop bridge, a unit test must not reach a real server.
vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unmocked network I/O") }))
vi.stubGlobal("WebSocket", class {
  constructor() { throw new Error("Unmocked WebSocket") }
})

afterEach(() => {
  cleanup()
})

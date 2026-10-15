import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useIsMobile } from "./use-mobile"
let listener: () => void
const add = vi.fn(),
  remove = vi.fn()
beforeEach(() => {
  add.mockReset().mockImplementation((_event, callback) => {
    listener = callback
  })
  remove.mockReset()
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ addEventListener: add, removeEventListener: remove })),
  )
})
afterEach(() => vi.unstubAllGlobals())
it.each([
  [767, true],
  [768, false],
  [1024, false],
])("classifies width %s", (width, expected) => {
  vi.stubGlobal("innerWidth", width)
  const hook = renderHook(() => useIsMobile())
  expect(hook.result.current).toBe(expected)
  expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)")
})
it("updates on media changes and removes its listener", () => {
  vi.stubGlobal("innerWidth", 800)
  const hook = renderHook(() => useIsMobile())
  vi.stubGlobal("innerWidth", 600)
  act(() => listener())
  expect(hook.result.current).toBe(true)
  vi.stubGlobal("innerWidth", 768)
  act(() => listener())
  expect(hook.result.current).toBe(false)
  hook.unmount()
  expect(remove).toHaveBeenCalledWith("change", listener)
})

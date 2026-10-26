import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  date,
  openExternal,
  publish,
  request,
  subscribe,
  text,
  useApi,
  useConnection,
  webUrl,
} from "./api"
import { deferred, desktopDouble } from "@/test/doubles"
let desktop: ReturnType<typeof desktopDouble>
afterEach(() => {
  delete window.desktop
  vi.restoreAllMocks()
})
beforeEach(() => {
  desktop = desktopDouble()
  window.desktop = desktop
})
it("subscribes once to desktop events, filters malformed events and removes subscribers", () => {
  const first = vi.fn(),
    second = vi.fn()
  const stop = subscribe(first)
  const stopSecond = subscribe(second)
  expect(desktop.onEvent).toHaveBeenCalledOnce()
  const forward = desktop.onEvent.mock.calls[0]![0]
  forward(null)
  forward("bad")
  forward({ ignored: true })
  expect(first).not.toHaveBeenCalled()
  forward({ type: "changed", table: "jobs" })
  expect(first).toHaveBeenCalledWith({ type: "changed", table: "jobs" })
  expect(second).toHaveBeenCalledOnce()
  stop()
  stopSecond()
  publish({ type: "changed" })
  expect(first).toHaveBeenCalledOnce()
})
it("forwards request arguments and propagates missing bridge and request errors", async () => {
  desktop.request.mockResolvedValue({ ok: true })
  expect(await request("answer", { key: "name" })).toEqual({ ok: true })
  expect(desktop.request).toHaveBeenCalledWith("answer", { key: "name" })
  desktop.request.mockRejectedValue(new Error("offline"))
  await expect(request("jobs")).rejects.toThrow("offline")
  delete window.desktop
  await expect(request("jobs")).rejects.toThrow("Unmocked network I/O")
})
it("loads, refreshes, reports failures and recovers", async () => {
  const pending = deferred<unknown>()
  desktop.request
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue("recovered")
  const hook = renderHook(() => useApi<string>("jobs"))
  expect(hook.result.current.loading).toBe(true)
  await act(async () => pending.resolve("jobs"))
  expect(hook.result.current.data).toBe("jobs")
  expect(hook.result.current.loading).toBe(false)
  act(() => hook.result.current.refresh())
  await waitFor(() => expect(hook.result.current.error).toBe("offline"))
  act(() => hook.result.current.refresh())
  await waitFor(() => expect(hook.result.current.data).toBe("recovered"))
  expect(hook.result.current.error).toBe("")
})
it.each([
  ["overview", "applications"],
  ["metrics", "profile_metrics"],
  ["profile-snapshot", "profile_metrics"],
  ["answers", "applicant_answers"],
  ["activity", "activity_log"],
  ["outreach", "outreach_budget"],
  ["recruiters/due", "outreach_attempts"],
  ["applications", "jobs"],
  ["application-board", "application_events"],
  ["custom", "custom"],
])(
  "refreshes %s only for relevant tables and global changes",
  async (path, table) => {
    desktop.request.mockResolvedValue([])
    const hook = renderHook(() => useApi(path))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    desktop.request.mockClear()
    act(() => {
      publish({ type: "changed", table: "irrelevant" })
      publish({ type: "other" })
    })
    expect(desktop.request).not.toHaveBeenCalled()
    for (const event of [
      { type: "changed", table },
      { type: "changed", table: "unknown" },
      { type: "changed" },
    ]) {
      act(() => publish(event))
      await waitFor(() => expect(hook.result.current.loading).toBe(false))
    }
    expect(desktop.request).toHaveBeenCalledTimes(3)
  },
)
it("ignores stale results after path changes and unmount", async () => {
  const first = deferred<unknown>(),
    second = deferred<unknown>()
  desktop.request
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const hook = renderHook(({ path }) => useApi<string>(path), {
    initialProps: { path: "first" },
  })
  hook.rerender({ path: "second" })
  await act(async () => second.resolve("current"))
  await act(async () => first.resolve("stale"))
  expect(hook.result.current.data).toBe("current")
  hook.unmount()
  const calls = desktop.request.mock.calls.length
  act(() => publish({ type: "changed" }))
  expect(desktop.request).toHaveBeenCalledTimes(calls)
})
it("reads connection status and reacts to events without retaining listeners", async () => {
  desktop.connectionStatus.mockResolvedValue(true)
  const hook = renderHook(() => useConnection())
  await waitFor(() => expect(hook.result.current).toBe(true))
  act(() => publish({ type: "connection", live: false }))
  expect(hook.result.current).toBe(false)
  act(() => publish({ type: "connection", live: "true" }))
  expect(hook.result.current).toBe(false)
  hook.unmount()
})
it("formats values/dates and validates external URL protocols", async () => {
  for (const value of [null, undefined, ""]) expect(text(value)).toBe("—")
  expect(text(0)).toBe("0")
  expect(text({ x: 1 })).toBe('{"x":1}')
  expect(date(null)).toBe("Not scheduled")
  expect(date("bad")).toBe("bad")
  expect(date("2026-01-01")).toBe(
    new Date("2026-01-01").toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  )
  for (const url of ["javascript:alert(1)", "file:///tmp", "bad", null]) {
    expect(webUrl(url)).toBeUndefined()
    await openExternal(url)
  }
  expect(desktop.openExternal).not.toHaveBeenCalled()
  await openExternal("https://example.com")
  expect(desktop.openExternal).toHaveBeenCalledWith("https://example.com/")
  delete window.desktop
  const open = vi.spyOn(window, "open").mockReturnValue(null)
  await openExternal("http://example.com")
  expect(open).toHaveBeenCalledWith(
    "http://example.com/",
    "_blank",
    "noopener,noreferrer",
  )
})

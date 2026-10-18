import { act, fireEvent, renderHook } from "@testing-library/react"
import { expect, it } from "vitest"
import { useNavigationScroll } from "./workspace-scroll"

it("restores the navigation scroll after asynchronous content and forgets it on remount", async () => {
  const container = document.createElement("div")
  container.dataset.workspaceScroll = ""
  document.body.append(container)
  const view = renderHook(({ path }) => useNavigationScroll(path), { initialProps: { path: "/jobs" } })
  container.scrollTop = 320
  fireEvent.scroll(container)
  view.rerender({ path: "/apply" })
  expect(container.scrollTop).toBe(0)
  view.rerender({ path: "/jobs" })
  expect(container.scrollTop).toBe(320)
  container.scrollTop = 0
  await act(async () => { container.append(document.createElement("div")) })
  expect(container.scrollTop).toBe(320)
  fireEvent.wheel(container)
  container.scrollTop = 220
  await act(async () => { container.append(document.createElement("div")) })
  expect(container.scrollTop).toBe(220)
  view.unmount()
  const fresh = renderHook(() => useNavigationScroll("/jobs"))
  expect(container.scrollTop).toBe(0)
  fresh.unmount()
  container.remove()
})

it("tolerates layouts without a scroll container", () => {
  const view = renderHook(() => useNavigationScroll("/jobs"))
  view.unmount()
})

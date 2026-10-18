import { act, renderHook } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { useApplyContext } from "./apply-context"
import { useContextDraft } from "./context-draft"
import type { PreparationRun } from "./preparation"

beforeEach(() => localStorage.clear())
const completed = [{ id: "run-1", application_id: 101 }] as PreparationRun[]

it("carries the job draft into the application created by its own run", () => {
  const view = renderHook(({ runs }) => useApplyContext({ jobId: 1 }, "Saved description", runs), { initialProps: { runs: [] as PreparationRun[] } })
  act(() => view.result.current.setExtra("Original context"))
  act(() => view.result.current.setDescription("Unsaved description"))
  act(() => view.result.current.context.update(previous => ({ ...previous, runId: "run-1" })))
  view.rerender({ runs: completed })
  expect(view.result.current.extra).toBe("Original context")
  expect(view.result.current.description).toBe("Unsaved description")
  act(() => view.result.current.setExtra("Edited after generation"))
  view.unmount()
  const reopened = renderHook(() => useApplyContext({ jobId: 1, applicationId: 101 }, "Saved description"))
  expect(reopened.result.current.extra).toBe("Edited after generation")
  expect(reopened.result.current.descriptionDirty).toBe(true)
  const other = renderHook(() => useApplyContext({ jobId: 1, applicationId: 102 }, "Saved description", completed))
  expect(other.result.current.extra).toBe("")
})

it("adopts after details arrive and preserves an existing application's newer draft", () => {
  localStorage.setItem("work-tracker-context-v1:apply:job:1:application:job", JSON.stringify({ extra: "Job context", runId: "run-1" }))
  const view = renderHook(({ runs }) => useApplyContext({ jobId: 1, applicationId: 101 }, "", runs), { initialProps: { runs: [] as PreparationRun[] } })
  expect(view.result.current.extra).toBe("")
  view.rerender({ runs: completed })
  expect(view.result.current.extra).toBe("Job context")
  act(() => view.result.current.setExtra("Newer application context"))
  view.unmount()
  const reopened = renderHook(() => useApplyContext({ jobId: 1 }, "", completed))
  expect(reopened.result.current.extra).toBe("Newer application context")
})

it("keeps the draft in memory and reports failed adoption storage", () => {
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Disk full") })
  const view = renderHook(() => useContextDraft("new-application", { extra: "Preserved" }))
  expect(view.result.current.draft.extra).toBe("Preserved")
  expect(view.result.current.error).toContain("Could not save")
  act(() => view.result.current.update({ extra: "Retried" }))
  expect(view.result.current.error).toBe("")
  write.mockRestore()
})

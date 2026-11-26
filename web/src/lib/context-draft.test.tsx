import { act, renderHook } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { useContextDraft } from "./context-draft"
import { validateWorkspaceSearch } from "./workspace-search"

beforeEach(() => localStorage.clear())

it("restores drafts on remount and isolates jobs and application attempts", () => {
  const first = renderHook(({ scope }) => useContextDraft(scope), { initialProps: { scope: "job:1:app:2" } })
  act(() => first.result.current.update({ extra: "First role", description: "Unsaved description", descriptionDirty: true }))
  first.rerender({ scope: "job:2:app:3" })
  expect(first.result.current.draft).toEqual({ extra: "" })
  act(() => first.result.current.update({ extra: "Second role" }))
  first.rerender({ scope: "job:1:app:4" })
  expect(first.result.current.draft.extra).toBe("")
  first.unmount()
  const reopened = renderHook(() => useContextDraft("job:1:app:2"))
  expect(reopened.result.current.draft).toEqual({ extra: "First role", description: "Unsaved description", descriptionDirty: true })
})

it("retains edits and previous storage on write failure, then retries", () => {
  const view = renderHook(() => useContextDraft("job:1"))
  act(() => view.result.current.update({ extra: "Previous" }))
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Full") })
  act(() => view.result.current.update(previous => ({ ...previous, extra: "Unsaved" })))
  expect(view.result.current.draft.extra).toBe("Unsaved")
  expect(view.result.current.error).toContain("Could not save")
  expect(localStorage.getItem("work-tracker-context-v1:job:1")).toContain("Previous")
  act(() => view.result.current.update({ extra: "Retried" }))
  expect(view.result.current.error).toBe("")
  write.mockRestore()
})

it("handles corrupt drafts and unavailable storage without claiming restoration", () => {
  localStorage.setItem("work-tracker-context-v1:bad", "invalid json")
  const view = renderHook(() => useContextDraft("bad"))
  expect(view.result.current.error).toContain("Could not restore")
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("Denied") })
  view.rerender()
  const denied = renderHook(() => useContextDraft("denied"))
  expect(denied.result.current.error).toContain("Could not restore")
  read.mockRestore()
})

it("validates existing route controls and defaults malformed search parameters", () => {
  expect(validateWorkspaceSearch("jobs", { page: -4, view: "other", q: [], status: {}, selected: {}, selection: ["1", "2", "1", 3] }))
    .toMatchObject({ page: 0, view: "new", q: "", status: "", selected: "", selection: ["1", "2"], keywords: "", location: "", maxPages: 1, mode: "find" })
  expect(validateWorkspaceSearch("search", { kind: "bad", maxPages: 11, workType: "invalid", keywords: {} }))
    .toMatchObject({ kind: "people", maxPages: 1, workType: "", keywords: "" })
  for (const invalid of [true, null, {}, [], 1.5, "", "NaN", Infinity])
    expect(validateWorkspaceSearch("apply", { jobId: invalid, applicationId: invalid })).toMatchObject({ jobId: undefined, applicationId: undefined })
  expect(validateWorkspaceSearch("apply", { jobId: "7", applicationId: 2, pdfTab: "bad", workspaceTab: "bad" }))
    .toMatchObject({ jobId: 7, applicationId: 2, pdfTab: "base", workspaceTab: "activity" })
  expect(validateWorkspaceSearch("launch", { tab: "console", skill: "resume-tailor", query: "draft", target: 3 })).toEqual({ tab: "setup", target: "" })
  expect(validateWorkspaceSearch("other", {})).toEqual({})
})

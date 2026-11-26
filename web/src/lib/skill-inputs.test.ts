import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { readSkillInputs, resetSkillInputsCache, useSkillInputs, writeSkillInputs } from "./skill-inputs"

const request = vi.fn()
let answers: { key: string; value: string; language?: string }[] = []
beforeEach(() => {
  localStorage.clear()
  resetSkillInputsCache()
  answers = []
  request.mockReset().mockImplementation(async (path: string) => path === "answers" ? answers : { ok: true })
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), connectionStatus: async () => true, getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {} }
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

it("migrates what the Agent console saved and ignores malformed storage", () => {
  localStorage.setItem("work-tracker-launch-fields-v1:recruiter-outreach", JSON.stringify({ query: "", location: "Lisbon" }))
  localStorage.setItem("work-tracker-context-v1:launch:recruiter-outreach:", JSON.stringify({ extra: "Startups only" }))
  expect(readSkillInputs("recruiter-outreach")).toEqual({ location: "Lisbon", extra: "Startups only" })
  localStorage.setItem("work-tracker-skill-inputs-v1:experience-bank", "{bad")
  localStorage.setItem("work-tracker-launch-fields-v1:experience-bank", "1")
  expect(readSkillInputs("experience-bank")).toEqual({})
  localStorage.setItem("work-tracker-skill-inputs-v1:followup", JSON.stringify({ extra: 3, company: "Acme", other: "x" }))
  expect(readSkillInputs("followup")).toEqual({ company: "Acme" })
})

it("keeps edits synchronously and prefers saved inputs over the console's", () => {
  localStorage.setItem("work-tracker-launch-fields-v1:recruiter-outreach", JSON.stringify({ location: "Lisbon" }))
  writeSkillInputs("recruiter-outreach", { company: "Acme" })
  expect(JSON.parse(localStorage.getItem("work-tracker-skill-inputs-v1:recruiter-outreach")!)).toEqual({ location: "Lisbon", company: "Acme" })
  resetSkillInputsCache()
  localStorage.setItem("work-tracker-launch-fields-v1:recruiter-outreach", JSON.stringify({ location: "Porto" }))
  expect(readSkillInputs("recruiter-outreach")).toEqual({ location: "Lisbon", company: "Acme" })
})

it("shares a job search's role and location with the Profile answers", async () => {
  answers = [{ key: "desired_role", value: "Software Engineer, Full Stack" }, { key: "preferred_locations", value: "Remote", language: "en" }]
  localStorage.setItem("work-tracker-launch-fields-v1:job-scout", JSON.stringify({ query: "Old role", location: "São Paulo" }))
  const { result } = renderHook(() => useSkillInputs("job-scout"))
  await waitFor(() => expect(result.current.inputs.query).toBe("Software Engineer, Full Stack"))
  expect(result.current.inputs.location).toBe("São Paulo")
  vi.useFakeTimers()
  act(() => result.current.setInputs({ query: "Back-End " }))
  expect(result.current.inputs.query).toBe("Back-End ")
  await act(async () => { vi.advanceTimersByTime(600) })
  expect(request).toHaveBeenCalledWith("answer", { key: "desired_role", value: "Back-End", category: "profile" })
  expect(request).not.toHaveBeenCalledWith("answer", expect.objectContaining({ key: "preferred_locations" }))
})

it("does not share other skills' inputs with the Profile", () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useSkillInputs("recruiter-outreach"))
  act(() => result.current.setInputs({ location: "Berlin" }))
  vi.advanceTimersByTime(600)
  expect(result.current.inputs.location).toBe("Berlin")
  expect(request).not.toHaveBeenCalledWith("answer", expect.anything())
})

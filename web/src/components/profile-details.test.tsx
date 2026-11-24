import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfileDetails } from "./profile-details"
import { publish, request, subscribe, useApi } from "@/lib/api"
import { profileValue, resetProfileSync } from "@/lib/profile-details"
import { useWorkspaceState } from "@/lib/workspace-state"
import type { ProfileSourcesState } from "@/lib/profile-sources"
vi.mock("@/lib/api", () => ({ useApi: vi.fn(), request: vi.fn(), publish: vi.fn(), subscribe: vi.fn() }))
vi.mock("@/lib/workspace-state", () => ({ useWorkspaceState: vi.fn() }))

const refresh = vi.fn()
const update = vi.fn()
let answers: Record<string, unknown>[]
let sources: Partial<ProfileSourcesState>
beforeEach(() => {
  resetProfileSync()
  answers = [
    { key: "first_name", value: "Alex", language: "default", autofill_source: "linkedin" },
    { key: "email", value: "typed@example.com", language: "default", autofill_source: null },
    { key: "phone", value: "+351 912 345 678", language: "default", autofill_source: "resume" },
    { key: "notice_period", value: "Duas semanas", language: "pt-BR", autofill_source: null },
  ]
  sources = { about: { headline: "Senior Engineer", summary: "Builds web platforms.", currentCompany: "Northwind", skills: ["TypeScript", "React"], languages: [{ name: "English", level: "Native" }, { name: "Spanish", level: "" }], certifications: [] } }
  vi.mocked(useApi).mockImplementation(path => ({ data: path === "answers/variants" ? answers : sources, loading: false, error: "", refresh }) as ReturnType<typeof useApi>)
  vi.mocked(useWorkspaceState).mockReturnValue({ search: {}, update } as unknown as ReturnType<typeof useWorkspaceState>)
  vi.mocked(subscribe).mockReturnValue(() => {})
  vi.mocked(request).mockReset().mockResolvedValue({})
  vi.mocked(publish).mockReset()
  refresh.mockClear(); update.mockClear()
})

it("lists the details by section with their origin and what is still missing", () => {
  render(<ProfileDetails />)
  const personal = screen.getByRole("region", { name: "Personal information" })
  expect(within(personal).getByText("Alex")).toBeInTheDocument()
  expect(within(personal).getByText("From LinkedIn")).toBeInTheDocument()
  expect(within(personal).getByText("Added by you")).toBeInTheDocument()
  expect(within(personal).getByText("From your resume PDF")).toBeInTheDocument()
  expect(within(personal).getAllByText("Not found in your resume — add it")).toHaveLength(3)
  const manual = screen.getByRole("region", { name: "Needs your answer" })
  // A language variant is not the default answer.
  expect(within(manual).getAllByText("Add your answer before applying")).toHaveLength(4)
  expect(screen.getByRole("list", { name: "Skills" })).toHaveTextContent("TypeScriptReact")
  expect(screen.getByRole("list", { name: "Languages" })).toHaveTextContent("English · NativeSpanish")
  expect(screen.queryByRole("list", { name: "Certifications" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Edit Email" }))
  expect(update).toHaveBeenCalledWith({ tab: "answers", field: "email" })
})

it("imports and fills once per session when it opens, and again on request", async () => {
  const view = render(<ProfileDetails />)
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(request).toHaveBeenCalledWith("profile-sources/import", {})
  view.unmount()
  render(<ProfileDetails />)
  expect(request).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole("button", { name: "Update from resume" }))
  await waitFor(() => expect(publish).toHaveBeenCalledWith({ type: "changed", table: "applicant_answers" }))
  vi.mocked(request).mockRejectedValueOnce(new Error("Sources offline"))
  fireEvent.click(screen.getByRole("button", { name: "Update from resume" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Sources offline")
})

it("retries the automatic sync after a failure and hides the summary without one", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("offline"))
  sources = {}
  const view = render(<ProfileDetails />)
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(screen.queryByText("About you")).not.toBeInTheDocument()
  view.unmount()
  render(<ProfileDetails />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
})

it("reads a default answer and its origin", () => {
  expect(profileValue([{ key: "email", value: "  " }], "email")).toEqual({ value: "", origin: "" })
  expect(profileValue([{ key: "email", value: "a@example.com", autofill_source: "data" }], "email")).toEqual({ value: "a@example.com", origin: "From your data file" })
})

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfileSources } from "./profile-sources"
import { publish, request, subscribe, useApi } from "@/lib/api"
import { undecidedConflicts, type ProfileSourcesState } from "@/lib/profile-sources"
vi.mock("@/lib/api", () => ({ useApi: vi.fn(), request: vi.fn(), publish: vi.fn(), subscribe: vi.fn() }))

const refresh = vi.fn()
let state: ProfileSourcesState
const conflict = (key: string, chosen: "data" | "linkedin" | null) => ({ key, field: "work.start", label: `Northwind Labs ${key}: start date`, values: { data: "2024-07", linkedin: "2024-08" }, chosen })
beforeEach(() => {
  state = {
    profileDir: "/profile", dataFile: "/profile/resume-data.json",
    assets: [
      { file: "resume-data.json", kind: "data", status: "imported", warnings: [] },
      { file: "linkedin.pdf", kind: "linkedin", status: "imported", warnings: [] },
      { file: "scan.pdf", kind: "reference", status: "failed", warnings: ["The PDF has no extractable text."] },
      { file: "new.pdf", kind: null, status: "pending", warnings: [] },
    ],
    linkedin: { experiences: 1, education: 3, skills: 12, languages: 2, entries: [{ company: "Northwind Labs", title: "Engineer", start: "2022-12", end: "Present", location: "Lisbon", bullets: ["<b>Shipped</b> billing."] }, { company: "Contoso", title: "Intern", start: "", end: "", location: "", bullets: [] }] },
    conflicts: [conflict("a", "linkedin"), conflict("b", null)], personal: [], about: null,
    warnings: ["new.pdf has not been imported yet."],
  }
  vi.mocked(useApi).mockImplementation(() => ({ data: state, loading: false, error: "", refresh }) as ReturnType<typeof useApi>)
  vi.mocked(request).mockReset().mockResolvedValue(state)
  vi.mocked(subscribe).mockReturnValue(() => {})
  refresh.mockClear()
})

it("lists each file with its type and status and the extracted experience as text", () => {
  render(<ProfileSources />)
  const files = within(screen.getByRole("list", { name: "Profile files" })).getAllByRole("listitem").map(item => item.textContent)
  expect(files).toEqual(["resume-data.jsonData fileImported", "linkedin.pdfLinkedIn exportImported", "scan.pdfReference resumeCould not be readThe PDF has no extractable text.", "new.pdfPDFNot imported yet"])
  expect(screen.getByText("1 experiences · 3 education · 12 skills")).toBeInTheDocument()
  const roles = within(screen.getByRole("list", { name: "Extracted experiences" }))
  expect(roles.getByText("<b>Shipped</b> billing.")).toBeInTheDocument()
  expect(roles.getByText("2022-12 – Present · Lisbon")).toBeInTheDocument()
  expect(screen.getByText("new.pdf has not been imported yet.")).toBeInTheDocument()
})

it("decides a conflict, defers it and counts the decided ones", async () => {
  render(<ProfileSources />)
  expect(screen.getByText("1 of 2 conflicts decided")).toBeInTheDocument()
  const first = within(screen.getByRole("group", { name: "Northwind Labs a: start date" }))
  expect(first.getByRole("button", { name: "LinkedIn: 2024-08" })).toHaveAttribute("aria-pressed", "true")
  const second = within(screen.getByRole("group", { name: "Northwind Labs b: start date" }))
  expect(second.getByRole("button", { name: "Decide later" })).toHaveAttribute("aria-pressed", "true")
  fireEvent.click(second.getByRole("button", { name: "Data file: 2024-07" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("profile-sources/choice", { key: "b", source: "data" }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  fireEvent.click(first.getByRole("button", { name: "Decide later" }))
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("profile-sources/choice", { key: "a", source: null }))
})

it("imports again and shows failures", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("pdftotext missing"))
  render(<ProfileSources />)
  fireEvent.click(screen.getByRole("button", { name: "Reimport all" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("pdftotext missing")
  expect(request).toHaveBeenCalledWith("profile-sources/import", { force: true })
  expect(refresh).not.toHaveBeenCalled()
})

it("explains an empty or missing profile folder and refreshes after the sources change", () => {
  let listener: (event: { type: string }) => void = () => {}
  vi.mocked(subscribe).mockImplementation(fn => { listener = fn; return () => {} })
  state = { ...state, profileDir: "", assets: [], linkedin: null, conflicts: [], warnings: [] }
  render(<ProfileSources />)
  expect(screen.getByText("No files in your profile yet. Add your resume PDF, your LinkedIn PDF or your resume data.")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Add files" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "Reimport all" })).toBeNull()
  listener({ type: "other" })
  expect(refresh).not.toHaveBeenCalled()
  listener({ type: "resume-sources-changed" })
  expect(refresh).toHaveBeenCalledOnce()
  expect(publish).not.toHaveBeenCalled()
})

it("shows that files are being imported in the background", () => {
  state = { ...state, importing: true }
  render(<ProfileSources />)
  expect(screen.getByRole("status")).toHaveTextContent("Importing your files…")
})

it("counts undecided conflicts of any loaded state", () => {
  expect(undecidedConflicts(state).map(item => item.key)).toEqual(["b"])
  expect(undecidedConflicts(undefined)).toEqual([])
  expect(undecidedConflicts({ ok: true } as never)).toEqual([])
})

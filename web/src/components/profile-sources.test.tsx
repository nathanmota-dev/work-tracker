import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfileSources } from "./profile-sources"
import { publish, request, subscribe, useApi } from "@/lib/api"
import type { ProfileSourcesState } from "@/lib/profile-sources"
vi.mock("@/lib/api", () => ({ useApi: vi.fn(), request: vi.fn(), publish: vi.fn(), subscribe: vi.fn() }))

const refresh = vi.fn()
let state: ProfileSourcesState
beforeEach(() => {
  state = {
    profileDir: "/profile", source: { kind: "data", file: "resume-data.json" }, resume: { experience: [], education: [] },
    assets: [
      { file: "resume-data.json", kind: "data", status: "imported", warnings: [] },
      { file: "linkedin.pdf", kind: "linkedin", status: "imported", warnings: [] },
      { file: "scan.pdf", kind: "reference", status: "failed", warnings: ["The PDF has no extractable text."] },
      { file: "new.pdf", kind: null, status: "pending", warnings: [] },
    ],
    personal: [], about: null,
    warnings: ["new.pdf has not been imported yet."],
  }
  vi.mocked(useApi).mockImplementation(() => ({ data: state, loading: false, error: "", refresh }) as ReturnType<typeof useApi>)
  vi.mocked(request).mockReset().mockResolvedValue(state)
  vi.mocked(subscribe).mockReturnValue(() => {})
  refresh.mockClear()
})

it("lists each file with its type and status and names the file the profile is built from", () => {
  render(<ProfileSources />)
  const files = within(screen.getByRole("list", { name: "Profile files" })).getAllByRole("listitem").map(item => item.textContent)
  expect(files).toEqual(["resume-data.jsonData fileImported", "linkedin.pdfLinkedIn exportImported", "scan.pdfReference resumeCould not be readThe PDF has no extractable text.", "new.pdfPDFNot imported yet"])
  expect(screen.getByText(/Your profile and base resume are built from/)).toHaveTextContent("Your profile and base resume are built from resume-data.json (Data file). Other PDFs are reference text for tailored resumes.")
  expect(screen.getByText("new.pdf has not been imported yet.")).toBeInTheDocument()
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
  state = { ...state, profileDir: "", assets: [], source: null, warnings: [] }
  render(<ProfileSources />)
  expect(screen.getByText("No files in your profile yet. Add your resume PDF, your LinkedIn PDF or your resume data.")).toBeInTheDocument()
  expect(screen.getByText("Add your resume data (.json) or your LinkedIn PDF: your profile and your base resume are built from it.")).toBeInTheDocument()
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

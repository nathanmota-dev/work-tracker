import { render, screen, within } from "@testing-library/react"
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
    warnings: ["scan.pdf: The PDF has no extractable text.", "new.pdf has not been imported yet."],
  }
  vi.mocked(useApi).mockImplementation(() => ({ data: state, loading: false, error: "", refresh }) as ReturnType<typeof useApi>)
  vi.mocked(request).mockReset().mockResolvedValue(state)
  vi.mocked(subscribe).mockReturnValue(() => {})
  refresh.mockClear()
})

it("lists each file with its type and marks the profile source and the reference files", () => {
  render(<ProfileSources />)
  const files = within(screen.getByRole("list", { name: "Profile files" })).getAllByRole("listitem").map(item => item.textContent)
  expect(files).toEqual(["resume-data.jsonData fileProfile source", "linkedin.pdfLinkedIn exportReference", "scan.pdfReference resumeThe PDF has no extractable text.Could not be read", "new.pdfPDFNot imported yet"])
  expect(screen.getByText("new.pdf has not been imported yet.")).toBeInTheDocument()
  expect(screen.queryByText("scan.pdf: The PDF has no extractable text.")).toBeNull()
})

it("shows only the upload for an empty profile folder and refreshes after the sources change", () => {
  let listener: (event: { type: string }) => void = () => {}
  vi.mocked(subscribe).mockImplementation(fn => { listener = fn; return () => {} })
  state = { ...state, profileDir: "", assets: [], source: null, warnings: [] }
  render(<ProfileSources />)
  expect(screen.queryByRole("list", { name: "Profile files" })).toBeNull()
  expect(screen.getByRole("button", { name: "Upload profile files" })).toHaveAttribute("aria-disabled", "false")
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

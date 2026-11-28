import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ResumeSources } from "./resume-sources"
import { publish, request, useApi } from "@/lib/api"
import type { SourcesState } from "@/lib/preparation"
import { deferred } from "@/test/doubles"
vi.mock("@/lib/api", () => ({ useApi: vi.fn(), request: vi.fn(), publish: vi.fn() }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title }: { title: string }) => <h2>{title}</h2> }))

let state: SourcesState
const refresh = vi.fn(), onPreview = vi.fn()
const artifact = { id: "pdf", kind: "base", pages: 1, warnings: [] } as unknown as NonNullable<SourcesState["preview"]>
beforeEach(() => {
  state = {
    config: { projectDir: "/home/resume", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir: "/home/profile" },
    source: { kind: "data", file: "resume-data.json" }, version: "v1",
    dependencies: [{ command: "latexmk", available: true }], preview: null, warnings: [], busy: false,
  }
  vi.mocked(useApi).mockImplementation(() => ({ data: state, loading: false, error: "", refresh }) as ReturnType<typeof useApi>)
  vi.mocked(request).mockReset().mockResolvedValue(artifact)
  vi.mocked(publish).mockClear()
  refresh.mockClear()
  onPreview.mockClear()
})

it("names the profile file the base resume is built from and updates its PDF", async () => {
  render(<ResumeSources onPreview={onPreview} />)
  expect(screen.getByText(/Built from/)).toHaveTextContent("Built from resume-data.json (resume data). It is generated again whenever your profile changes.")
  expect(screen.queryByRole("textbox")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Update base PDF" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Base PDF ready (1 pages).")
  expect(request).toHaveBeenCalledWith("resume-sources/preview", {})
  expect(onPreview).toHaveBeenCalledWith(artifact)
  expect(publish).toHaveBeenCalledWith({ type: "resume-sources-changed" })
  expect(refresh).toHaveBeenCalled()
})

it("asks for a profile and missing tools before compiling", () => {
  state = { ...state, source: null, version: null, dependencies: [{ command: "latexmk", available: false }], warnings: ["profile.pdf: No summary."] }
  render(<ResumeSources friendly />)
  expect(screen.getByText(/Upload your resume data/)).toHaveTextContent("Upload your resume data (.json) or your LinkedIn PDF in Profile: your base resume is built from it.")
  expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "#/profile")
  expect(screen.getByRole("button", { name: "Update base PDF" })).toBeDisabled()
  expect(screen.getByText(/Install these tools/)).toHaveTextContent("latexmk")
  expect(screen.getByText("profile.pdf: No summary.")).toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
})

it("shows preview failures and cancels an active preview", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("LaTeX failed"))
  render(<ResumeSources />)
  fireEvent.click(screen.getByRole("button", { name: "Update base PDF" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("LaTeX failed")
  const pending = deferred<typeof artifact>()
  vi.mocked(request).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: true })
  fireEvent.click(screen.getByRole("button", { name: "Update base PDF" }))
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("application-preparation/cancel", { runId: "preview" }))
  pending.resolve(artifact)
  expect(await screen.findByRole("status")).toHaveTextContent("Base PDF ready")
})

it("compiles each profile version once when Base resume is open", async () => {
  const view = render(<ResumeSources friendly><p>Generated LaTeX panel</p></ResumeSources>)
  expect(screen.getByText("Generated LaTeX panel")).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Base resume PDF" })).toBeInTheDocument()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  await screen.findByRole("status")
  vi.mocked(request).mockRejectedValue(new Error("LaTeX failed"))
  view.rerender(<ResumeSources friendly />)
  expect(request).toHaveBeenCalledTimes(1)
  state = { ...state, version: "v2" }
  view.rerender(<ResumeSources friendly />)
  expect(await screen.findByRole("alert")).toHaveTextContent("LaTeX failed")
  expect(request).toHaveBeenCalledTimes(2)
  view.rerender(<ResumeSources friendly />)
  expect(request).toHaveBeenCalledTimes(2)
  state = { ...state, preview: artifact, version: "v3" }
  view.rerender(<ResumeSources friendly />)
  expect(request).toHaveBeenCalledTimes(2)
})

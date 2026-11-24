import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ResumeSources } from "./resume-sources"
import { publish, request, useApi } from "@/lib/api"
import type { SourcesState } from "@/lib/preparation"
import { deferred, desktopDouble } from "@/test/doubles"
vi.mock("@/lib/api", () => ({
  useApi: vi.fn(),
  request: vi.fn(),
  publish: vi.fn(),
}))
vi.mock("@/components/pdf-viewer", () => ({
  PdfViewer: ({ title }: { title: string }) => <h2>{title}</h2>,
}))
vi.mock("@/components/ui/select-control", () => ({
  SelectControl: (props: React.ComponentProps<"select">) => (
    <select {...props} />
  ),
}))
let state: SourcesState
let desktop: ReturnType<typeof desktopDouble>
const refresh = vi.fn(),
  onPreview = vi.fn()
const artifact = { id: "pdf", kind: "base", pages: 1, warnings: [] } as unknown as NonNullable<SourcesState["preview"]>
beforeEach(() => {
  state = {
    config: {
      projectDir: "/project",
      mainFile: "resume.tex",
      dataFile: "",
      engine: "pdflatex",
      profileDir: "",
    },
    dependencies: [{ command: "latexmk", available: true }],
    preview: null,
    warnings: [],
    busy: false,
  }
  vi.mocked(useApi).mockImplementation(
    () =>
      ({ data: state, loading: false, error: "", refresh }) as ReturnType<
        typeof useApi
      >,
  )
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path) =>
      path === "resume-sources" ? state : artifact,
    )
  vi.mocked(publish).mockClear()
  refresh.mockClear()
  onPreview.mockClear()
  desktop = desktopDouble()
  window.desktop = desktop
})
afterEach(() => {
  delete window.desktop
})
it("loads settings and preserves unsaved edits across background refreshes", () => {
  const instance = render(<ResumeSources />)
  expect(screen.getByLabelText("LaTeX project folder")).toHaveValue("/project")
  expect(screen.getByRole("button", { name: "Save sources" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Main .tex file"), {
    target: { value: "draft.tex" },
  })
  expect(screen.getByRole("button", { name: "Update base PDF" })).toBeDisabled()
  state.config.mainFile = "remote.tex"
  instance.rerender(<ResumeSources />)
  expect(screen.getByLabelText("Main .tex file")).toHaveValue("draft.tex")
})
it("handles source selection, cancelled picker and picker errors", async () => {
  desktop.chooseSource
    .mockResolvedValueOnce("/new")
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("/profile")
    .mockRejectedValueOnce(new Error("picker failed"))
  render(<ResumeSources />)
  fireEvent.click(screen.getAllByRole("button", { name: "Browse" })[0]!)
  await waitFor(() =>
    expect(screen.getByLabelText("LaTeX project folder")).toHaveValue("/new"),
  )
  fireEvent.click(screen.getAllByRole("button", { name: "Browse" })[1]!)
  await waitFor(() => expect(desktop.chooseSource).toHaveBeenCalledWith("data"))
  expect(screen.getByLabelText("Optional data file (.json)")).toHaveValue("")
  fireEvent.click(screen.getAllByRole("button", { name: "Browse" })[2]!)
  await waitFor(() =>
    expect(screen.getByLabelText("Profile folder")).toHaveValue("/profile"),
  )
  expect(desktop.chooseSource).toHaveBeenLastCalledWith("folder")
  fireEvent.click(screen.getAllByRole("button", { name: "Browse" })[1]!)
  expect(await screen.findByRole("alert")).toHaveTextContent("picker failed")
})
it("saves a draft, generates its preview and emits refresh notifications", async () => {
  render(<ResumeSources onPreview={onPreview} />)
  fireEvent.change(screen.getByLabelText("Main .tex file"), {
    target: { value: "main.tex" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save sources" }))
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Sources saved and base PDF ready",
  )
  expect(request).toHaveBeenCalledWith(
    "resume-sources",
    expect.objectContaining({ mainFile: "main.tex", profileDir: "" }),
  )
  expect(request).toHaveBeenCalledWith("resume-sources/preview", {})
  expect(onPreview).toHaveBeenCalledWith(artifact)
  expect(publish).toHaveBeenCalledWith({ type: "resume-sources-changed" })
  expect(refresh).toHaveBeenCalledTimes(2)
})
it("saves without compiling when dependencies are missing and exposes warnings", async () => {
  state.dependencies[0]!.available = false
  state.warnings = ["Check your template"]
  render(<ResumeSources />)
  expect(screen.getByText("Check your template")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Update base PDF" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Compiler"), {
    target: { value: "xelatex" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save sources" }))
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Resume sources saved",
  )
  expect(request).toHaveBeenCalledTimes(1)
})
it("blocks source actions while another execution is active", () => {
  state.busy = true
  render(<ResumeSources />)
  fireEvent.change(screen.getByLabelText("Main .tex file"), {
    target: { value: "main.tex" },
  })
  expect(screen.getByRole("button", { name: "Save sources" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Update base PDF" })).toBeDisabled()
})
it("shows preview failures, enables retry and cancels an active preview", async () => {
  const pending = deferred<unknown>()
  vi.mocked(request)
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ok: true })
  render(<ResumeSources onPreview={onPreview} />)
  fireEvent.click(screen.getByRole("button", { name: "Update base PDF" }))
  fireEvent.click(await screen.findByRole("button", { name: "Cancel preview" }))
  expect(request).toHaveBeenCalledWith("application-preparation/cancel", {
    runId: "preview",
  })
  pending.reject(new Error("compile failed"))
  expect(await screen.findByRole("alert")).toHaveTextContent("compile failed")
  expect(screen.getByRole("button", { name: "Update base PDF" })).toBeEnabled()
  fireEvent.click(screen.getByRole("button", { name: "Update base PDF" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Base PDF ready")
  expect(onPreview).toHaveBeenCalledWith(artifact)
})
it("keeps the draft after save failure", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("save failed"))
  render(<ResumeSources />)
  fireEvent.change(screen.getByLabelText("Main .tex file"), {
    target: { value: "draft.tex" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save sources" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("save failed")
  expect(screen.getByLabelText("Main .tex file")).toHaveValue("draft.tex")
  expect(screen.getByRole("button", { name: "Save sources" })).toBeEnabled()
})
it("shows each source by name only and saves a source chosen from the summary", async () => {
  state.config = { ...state.config, projectDir: "/home/me/cv/latex", dataFile: "/home/me/cv/data/resume-data.json", profileDir: "/home/me/cv/data/" }
  state.preview = artifact
  render(<ResumeSources friendly />)
  expect(screen.getByText("Advanced: paths and compiler")).toBeInTheDocument()
  const summary = screen.getByRole("list", { name: "Selected sources" })
  expect(summary).toHaveTextContent("LaTeX resumeresume.tex")
  expect(summary).toHaveTextContent("Resume dataresume-data.json")
  expect(summary).toHaveTextContent("Profile folderdata")
  expect(summary.textContent).not.toContain("/home/me")
  desktop.chooseSource.mockResolvedValueOnce("/home/me/other")
  fireEvent.click(screen.getByRole("button", { name: "Change Profile folder" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("resume-sources", { ...state.config, profileDir: "/home/me/other" }))
  expect(desktop.chooseSource).toHaveBeenCalledWith("folder")
})
it("offers to choose missing sources and keeps them when the picker is cancelled", async () => {
  state.config = { ...state.config, projectDir: "", dataFile: "" }
  render(<ResumeSources friendly />)
  expect(screen.getByRole("list", { name: "Selected sources" })).toHaveTextContent("Optional: only the LaTeX is used")
  desktop.chooseSource.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("no picker"))
  fireEvent.click(screen.getByRole("button", { name: "Choose Resume data" }))
  await waitFor(() => expect(desktop.chooseSource).toHaveBeenCalledWith("data"))
  fireEvent.click(screen.getByRole("button", { name: "Choose LaTeX resume" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("no picker")
  expect(request).not.toHaveBeenCalled()
})
it("keeps the technical view outside Base resume, and there shows the base PDF", () => {
  state.preview = artifact
  const { rerender } = render(<ResumeSources />)
  expect(screen.queryByRole("heading", { name: "Base resume PDF" })).toBeNull()
  expect(screen.queryByRole("list", { name: "Selected sources" })).toBeNull()
  expect(screen.queryByText("Advanced: paths and compiler")).toBeNull()
  rerender(<ResumeSources friendly />)
  expect(screen.getByRole("heading", { name: "Base resume PDF" })).toBeInTheDocument()
  // A profile change leaves no preview for the new version: it is not compiled again here.
  state.preview = null
  rerender(<ResumeSources friendly />)
  expect(request).not.toHaveBeenCalled()
})
it("compiles a missing base PDF once when Base resume opens", async () => {
  const { rerender } = render(<ResumeSources friendly />)
  expect(await screen.findByRole("status")).toHaveTextContent("Base PDF ready (1 pages).")
  rerender(<ResumeSources friendly />)
  expect(request).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledWith("resume-sources/preview", {})
  render(<ResumeSources />)
  expect(request).toHaveBeenCalledOnce()
})

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useBlocker, useSearch } from "@tanstack/react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { ResumeDetailPage } from "@/routes/resume-detail"
import { desktopWith, variant } from "@/test/variants"
vi.mock("@tanstack/react-router", async original => ({ ...(await original<typeof import("@tanstack/react-router")>()), useSearch: vi.fn(), useBlocker: vi.fn() }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title, artifact, download }: { title: string; artifact?: { id: string } | null; download?: boolean }) => <section aria-label={title} data-download={String(download)}>{artifact?.id}</section> }))
// CodeMirror needs a real layout; a textarea with the same contract stands in for it.
vi.mock("@/components/latex-code-editor", () => ({
  LatexCodeEditor: ({ label, value, onChange, readOnly, focus }: { label: string; value: string; onChange: (value: string) => void; readOnly?: boolean; focus?: { line: number } }) =>
    <textarea aria-label={label} value={value} readOnly={readOnly} data-line={focus?.line} onChange={event => onChange(event.target.value)} />,
}))

type Blocker = { shouldBlockFn: () => boolean; enableBeforeUnload: () => boolean }
let variants: ReturnType<typeof variant>[]
let desktop: ReturnType<typeof desktopWith>
let blocker: { status: "idle" | "blocked"; proceed: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }
const latex = { mainFile: "resume.tex", files: [{ name: "resume.tex", text: "\\section{Old}" }, { name: "sections/work.tex", text: "Work" }] }
beforeEach(() => {
  vi.mocked(useSearch).mockReturnValue({ id: "v2" })
  blocker = { status: "idle", proceed: vi.fn(), reset: vi.fn() }
  vi.mocked(useBlocker).mockImplementation(() => blocker as never)
  const source = { jobId: 7, applicationId: 3, documentVersionId: "d1", company: "Acme", title: "Full Stack .NET/Angular" }
  variants = [variant(), variant({ id: "v2", name: "Full Stack .NET/Angular", role: "fullstack", stacks: ["C#", "Angular"], source, pdf: { id: "pdf-v2", kind: "variant", pages: 1, warnings: [] } })]
  desktop = desktopWith({ "resume-variants?archived=true": () => structuredClone(variants), "resume-variants/latex": () => structuredClone(latex), "resume-variants/save-latex": () => variants[1] })
})
const editor = (name = "resume.tex") => screen.findByRole("textbox", { name: `LaTeX of ${name}` })
const blockerOptions = () => vi.mocked(useBlocker).mock.lastCall![0] as unknown as Blocker

it("splits the page into the LaTeX editor and details beside the PDF, with Save and Download on top", async () => {
  render(<ResumeDetailPage />)
  expect(await screen.findByRole("heading", { level: 1, name: "Full Stack .NET/Angular" })).toBeInTheDocument()
  expect(await editor()).toHaveValue("\\section{Old}")
  expect(desktop.request).toHaveBeenCalledWith("resume-variants/latex", { id: "v2" })
  const pdf = screen.getByRole("region", { name: "Full Stack .NET/Angular PDF" })
  expect(pdf).toHaveTextContent("pdf-v2")
  expect(pdf).toHaveAttribute("data-download", "false")
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Download" }))
  expect(desktop.savePdf).toHaveBeenCalledWith("pdf-v2")
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Details" }), { button: 0 })
  const details = await screen.findByRole("article", { name: "Full Stack .NET/Angular" })
  expect(within(details).getByRole("link", { name: "Open application" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Back to Resumes" })).toHaveAttribute("href", "#/resumes")
})

it("saves the changed files with the button or Ctrl+S and guards unsaved changes", async () => {
  render(<ResumeDetailPage />)
  fireEvent.change(await editor(), { target: { value: "\\section{New}" } })
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  expect(blockerOptions().shouldBlockFn()).toBe(true)
  expect(blockerOptions().enableBeforeUnload()).toBe(true)
  fireEvent.keyDown(window, { key: "s", ctrlKey: true })
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("resume-variants/save-latex", { id: "v2", files: [{ name: "resume.tex", text: "\\section{New}" }] }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled())
  expect(blockerOptions().shouldBlockFn()).toBe(false)
  // Another file of the project, picked from the list.
  fireEvent.change(screen.getByRole("combobox", { name: "LaTeX file" }), { target: { value: "sections/work.tex" } })
  fireEvent.change(await editor("sections/work.tex"), { target: { value: "More work" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() => expect(desktop.request).toHaveBeenLastCalledWith("resume-variants/save-latex", { id: "v2", files: [{ name: "sections/work.tex", text: "More work" }] }))
})

it("shows compilation errors that open their file at the line, keeping the edit saved", async () => {
  desktop.request.mockImplementation(async (path: string) => {
    if (path === "resume-variants/save-latex") throw new Error("LaTeX could not compile the resume. Your changes are saved.\n./sections/work.tex:4: Undefined control sequence.")
    return path === "resume-variants/latex" ? structuredClone(latex) : structuredClone(variants)
  })
  render(<ResumeDetailPage />)
  fireEvent.change(await editor(), { target: { value: "\\oops" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  const alert = await screen.findByRole("alert")
  expect(alert).toHaveTextContent("LaTeX could not compile the resume. Your changes are saved.")
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  fireEvent.click(within(alert).getByRole("button", { name: /sections\/work\.tex:4 Undefined control sequence\./ }))
  expect(await editor("sections/work.tex")).toHaveAttribute("data-line", "4")
})

it("asks before leaving with unsaved changes", async () => {
  blocker.status = "blocked"
  render(<ResumeDetailPage />)
  const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" })
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }))
  expect(blocker.reset).toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }))
  expect(blocker.proceed).toHaveBeenCalled()
})

it("an imported resume has no LaTeX, and an archived or generating one is read-only", async () => {
  desktop.request.mockImplementation(async (path: string) => {
    if (path === "resume-variants/latex") throw new Error("This resume has no LaTeX source to edit.")
    return structuredClone(variants)
  })
  const { unmount } = render(<ResumeDetailPage />)
  expect(await screen.findByText("No LaTeX source")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Download" })).toBeEnabled()
  unmount()
  desktopWith({ "resume-variants?archived=true": () => [{ ...variants[1], archivedAt: "2026-11-02T00:00:00.000Z" }], "resume-variants/latex": () => structuredClone(latex) })
  render(<ResumeDetailPage />)
  expect(await editor()).toHaveAttribute("readonly")
})

it("reports a failed load with a retry, and explains a resume without a PDF yet and an unknown one", async () => {
  desktop.request.mockImplementation(async (path: string) => {
    if (path === "resume-variants/latex") throw new Error("Disk error")
    return structuredClone(variants)
  })
  variants[1] = variant({ id: "v2", name: "Generating", status: "generating", pdf: null })
  const { unmount } = render(<ResumeDetailPage />)
  expect(await screen.findByText("No PDF yet")).toBeInTheDocument()
  expect(await screen.findByText("Disk error")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Download" })).toBeDisabled()
  desktop.request.mockImplementation(async (path: string) => path === "resume-variants/latex" ? structuredClone(latex) : structuredClone(variants))
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })))
  expect(await editor()).toHaveAttribute("readonly")
  unmount()
  vi.mocked(useSearch).mockReturnValue({ id: "missing" })
  render(<ResumeDetailPage />)
  expect(await screen.findByText("Saved resume not found")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Back to Resumes" })).toBeInTheDocument()
})

it("opens the base resume as the default, with its sources beside its PDF", async () => {
  vi.mocked(useSearch).mockReturnValue({ id: "base" })
  desktopWith({ "resume-sources": { config: { projectDir: "/latex", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir: "" }, dependencies: [], preview: { id: "pdf-base", kind: "preview", pages: 1, warnings: [] }, warnings: [], busy: false } })
  render(<ResumeDetailPage />)
  expect(screen.getByRole("heading", { level: 1, name: "Base resume" })).toBeInTheDocument()
  expect(await screen.findByRole("region", { name: "Base resume PDF" })).toHaveTextContent("pdf-base")
  expect(screen.getByRole("link", { name: "Back to Resumes" })).toHaveAttribute("href", "#/resumes")
})

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApplyPage } from "@/routes/apply"
import { LaunchPage } from "@/routes/launch"
import { publish } from "@/lib/api"
const search = vi.hoisted(() => ({ jobId: 7, applicationId: 3, runId: undefined as string | undefined }))
vi.mock("@tanstack/react-router", () => ({ useSearch: () => search }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title, artifact }: { title: string; artifact?: { id: string } }) => <section aria-label={title}>{artifact?.id ?? "empty"}</section> }))
const request = vi.fn()
const artifacts = [{ id: "base-1", kind: "base", pages: 1, warnings: [] }, { id: "pdf-1", kind: "tailored", pages: 1, warnings: [] }]
let details: Record<string, any>
let source: Record<string, any>
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
  search.jobId = 7; search.applicationId = 3; search.runId = undefined
  details = { job: { id: 7, title: "React Engineer", company_name: "Example", description: "React role", archived_at: null, link: "https://example.com" }, runs: [{ id: "run-1", job_id: 7, application_id: 3, status: "completed", phase: "review", artifacts, events: [], report: "Emphasized React", created_at: "2026-01-01" }], busy: false, applicationStatus: "draft" }
  source = { config: { projectDir: "/sources", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" }, dependencies: [{ command: "latexmk", available: true }], preview: artifacts[0], warnings: [], busy: false }
  request.mockReset().mockImplementation(async (path: string) => {
    if (path === "integrations/status") return { entries: [], dependencies: [], backend: true }
    if (path === "jobs") return [{ id: 7, title: "React Engineer", company_name: "Example" }]
    if (path === "answers") return []
    if (path === "acp/providers") return { providers: [{ id: "opencode", displayName: "OpenCode", models: [] }], default: "opencode" }
    if (path === "resume-sources") return source
    if (path === "resume-sources/preview") return { id: "base-current", kind: "base", pages: 1, warnings: [] }
    if (path === "application-preparation/details") return structuredClone(details)
    if (path === "application-preparation/generate") return { id: "run-2" }
    return { ok: true }
  })
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), getVersion: async () => "1", connectionStatus: async () => true, openExternal: vi.fn(), onEvent: () => () => {} }
})
it("shows both PDFs and starts generation for the selected job without Launch", async () => {
  render(<ApplyPage />)
  expect(await screen.findByText("pdf-1")).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/generate", expect.objectContaining({ jobId: 7, applicationId: 3, provider: "opencode" })))
  expect(window.location.hash).toContain("/apply?")
  expect(window.location.hash).toContain("runId=run-2")
  expect(request).not.toHaveBeenCalledWith("acp/run", expect.anything())
})
it("fills using the displayed run and exposes the report", async () => {
  render(<ApplyPage />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-1", extra: "" }))
  fireEvent.keyDown(screen.getByRole("tab", { name: "Report" }), { key: "Enter" })
  expect(await screen.findByText("Emphasized React")).toBeInTheDocument()
})
it("blocks generation and filling for an archived job", async () => {
  details.job.archived_at = "2026-01-01"
  render(<ApplyPage />)
  await screen.findByText("Restore this job in Jobs before preparing an application.")
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Fill application" })).toBeDisabled()
})
it("updates the persisted activity after a backend event and reports execution failures", async () => {
  render(<ApplyPage />)
  await screen.findByText("pdf-1")
  details.runs[0].events = [{ type: "acp-update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Selecting React projects" } } }]
  details.runs[0].error = "Compilation failed"
  act(() => publish({ type: "changed", table: "application_runs", runId: "run-1" }))
  expect(await screen.findByText("Selecting React projects")).toBeInTheDocument()
  expect(screen.getByText("Compilation failed")).toBeInTheDocument()
})
it("Launch omits tailoring and retains portal filling", async () => {
  render(<LaunchPage />)
  const selector = await screen.findByLabelText("Skill")
  fireEvent.keyDown(selector, { key: "Enter" })
  expect(await screen.findByRole("option", { name: "Prepare an application" })).toBeInTheDocument()
  expect(screen.queryByRole("option", { name: "Tailor your resume" })).not.toBeInTheDocument()
})

it("keeps cancellation available while waiting for browser sign-in", async () => {
  details.runs[0].status = "waiting_for_sign_in"
  details.runs[0].phase = "filling"
  render(<ApplyPage />)
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/cancel", { runId: "run-1", extra: "" }))
})

it("shows an explicitly refreshed base PDF when an older execution is selected", async () => {
  render(<ApplyPage />)
  await screen.findByText("pdf-1")
  fireEvent.click(screen.getByText("Resume sources", { selector: "summary" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Update base PDF" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Update base PDF" }))
  expect(await screen.findByText("base-current")).toBeInTheDocument()
  expect(screen.getByText("pdf-1")).toBeInTheDocument()
})

it("selects the validated PDF run when filling after a failed newer execution", async () => {
  details.runs.unshift({ ...details.runs[0], id: "failed-run", status: "failed", artifacts: [], error: "Compilation failed" })
  render(<ApplyPage />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-1", extra: "" }))
  await waitFor(() => expect(window.location.hash).toContain("runId=run-1"))
})

it("confirms the submission, shows feedback and refreshes the application", async () => {
  details.applicationStatus = "filled"
  details.uploadedRunId = "run-1"
  render(<ApplyPage />)
  const confirm = await screen.findByRole("button", { name: "I submitted in the browser" })
  request.mockImplementation(async (path: string) => {
    if (path === "application-preparation/submitted") {
      Object.assign(details, { applicationStatus: "submitted", journey: { id: 3, submission_status: "submitted", submitted_at: "2026-10-17T10:00:00.000Z" } })
      return { ok: true, alreadySubmitted: false, applicationId: 3, submittedAt: "2026-10-17T10:00:00.000Z" }
    }
    if (path === "application-preparation/details") return structuredClone(details)
    return { ok: true }
  })
  fireEvent.click(confirm)
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/submitted", { runId: "run-1", applicationId: 3 }))
  expect(await screen.findByText(/Submission confirmed/)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open the application board" })).toHaveAttribute("href", "#/application-board")
  await waitFor(() => expect(screen.queryByRole("button", { name: "I submitted in the browser" })).not.toBeInTheDocument())
  expect(screen.getByRole("button", { name: "Fill application" })).toBeDisabled()
})

it("reports a repeated confirmation as already confirmed", async () => {
  details.applicationStatus = "filled"
  details.uploadedRunId = "run-1"
  render(<ApplyPage />)
  request.mockImplementation(async (path: string) => path === "application-preparation/submitted" ? { ok: true, alreadySubmitted: true, applicationId: 3, submittedAt: "2026-10-01" } : path === "application-preparation/details" ? structuredClone(details) : { ok: true })
  fireEvent.click(await screen.findByRole("button", { name: "I submitted in the browser" }))
  expect(await screen.findByText(/already confirmed/)).toBeInTheDocument()
})

it("shows a failed confirmation without false success and allows a retry", async () => {
  details.applicationStatus = "filled"
  details.uploadedRunId = "run-1"
  const original = request.getMockImplementation()!
  let failures = 1
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "application-preparation/submitted" && failures-- > 0) throw new Error("This execution belongs to another application.")
    if (path === "application-preparation/submitted") return { ok: true, alreadySubmitted: false, applicationId: 3, submittedAt: "2026-10-17" }
    return original(path, body)
  })
  render(<ApplyPage />)
  fireEvent.click(await screen.findByRole("button", { name: "I submitted in the browser" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("belongs to another application")
  expect(screen.queryByText(/Submission confirmed/)).not.toBeInTheDocument()
  const retry = screen.getByRole("button", { name: "I submitted in the browser" })
  await waitFor(() => expect(retry).toBeEnabled())
  fireEvent.click(retry)
  expect(await screen.findByText(/Submission confirmed/)).toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("shows the original submission date when reopening a submitted application", async () => {
  Object.assign(details, { applicationStatus: "submitted", journey: { id: 3, submission_status: "submitted", submitted_at: "2026-10-01T12:00:00.000Z" } })
  render(<ApplyPage />)
  expect(await screen.findByText(new RegExp(`Submitted on ${new Date("2026-10-01T12:00:00.000Z").toLocaleDateString()}`))).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "I submitted in the browser" })).not.toBeInTheDocument()
})

it("updates Apply after a diagnostic retry and opens the matching correction", async () => {
  const original = request.getMockImplementation()!
  let blocked = true
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "integrations/status") return { entries: [{ target: "acp/opencode", executable: true, diagnostic: { model: "", checks: blocked ? [{ stage: "authentication", state: "authentication_required", message: "Sign in to this integration, then test again." }] : [] } }], dependencies: [] }
    if (path === "integrations/test") { blocked = false; return { checks: [] } }
    return original(path, body)
  })
  render(<ApplyPage />)
  const correction = await screen.findAllByRole("link", { name: "Correct opencode ACP" })
  expect(correction[0]).toHaveAttribute("href", "#/settings?section=integrations&target=acp%2Fopencode")
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Test availability again" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled())
  expect(screen.getByText("pdf-1")).toBeInTheDocument()
})

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApplyPage } from "@/routes/apply"
import { publish } from "@/lib/api"
const search = vi.hoisted(() => ({ jobId: 7 as number | undefined, applicationId: 3 as number | undefined, runId: undefined as string | undefined }))
vi.mock("@tanstack/react-router", () => ({ useSearch: () => search }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title, artifact }: { title: string; artifact?: { id: string } }) => <section aria-label={title}>{artifact?.id ?? "empty"}</section> }))
const request = vi.fn()
const artifacts = [{ id: "base-1", kind: "base", pages: 1, warnings: [] }, { id: "pdf-1", kind: "tailored", pages: 1, warnings: [] }]
let details: Record<string, any>
let source: Record<string, any>
beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
  search.jobId = 7; search.applicationId = 3; search.runId = undefined
  details = { job: { id: 7, title: "React Engineer", company_name: "Example", description: "React role", archived_at: null, link: "https://example.com" }, runs: [{ id: "run-1", job_id: 7, application_id: 3, status: "completed", phase: "review", artifacts, events: [], report: "Emphasized React", created_at: "2026-01-01" }], busy: false, applicationStatus: "draft" }
  details.documents = [{ id: "pdf-1", runId: "run-1", applicationId: 3, pdfHash: "hash", sourceVersion: "sources-1", text: "Tailored experience", baseText: "Original experience", description: "React role", extra: "", data: null, approvedAt: "2026-01-01", createdAt: "2026-01-01", usedAt: null, submittedAt: null }]
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
/** Open a step's view from the stepper, once the application has loaded. */
async function openStep(label: string) {
  const nav = await screen.findByRole("navigation", { name: "Application progress" })
  fireEvent.click(within(nav).getByRole("button", { name: new RegExp(`^${label}`) }))
}
it("shows the tailored PDF and starts generation for the selected job without Launch", async () => {
  render(<ApplyPage />)
  await openStep("Resume")
  expect(await screen.findByRole("region", { name: "Tailored resume PDF" })).toHaveTextContent("pdf-1")
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
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-1", extra: "", versionId: "pdf-1", provider: "opencode" }))
  await openStep("Resume")
  fireEvent.click(await screen.findByText("Tailoring report"))
  expect(await screen.findByText("Emphasized React")).toBeInTheDocument()
})
it("blocks generation and filling for an archived job", async () => {
  details.job.archived_at = "2026-01-01"
  render(<ApplyPage />)
  await openStep("Job description")
  await screen.findByText("Restore this job in Jobs before preparing an application.")
  await openStep("Resume")
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
  await openStep("Fill portal")
  expect(screen.getByRole("button", { name: "Fill application" })).toBeDisabled()
})
it("updates the running generation's activity after a backend event and reports execution failures", async () => {
  details.runs[0].status = "running"
  render(<ApplyPage />)
  await openStep("Resume")
  await screen.findByRole("heading", { name: "Agent workspace" })
  details.runs[0].events = [{ type: "acp-update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Selecting React projects" } } }]
  details.runs[0].error = "Compilation failed"
  act(() => publish({ type: "changed", table: "application_runs", runId: "run-1" }))
  expect(await screen.findByText("Selecting React projects")).toBeInTheDocument()
  expect(screen.getByText("Compilation failed")).toBeInTheDocument()
})
it("keeps cancellation available while waiting for browser sign-in", async () => {
  details.runs[0].status = "waiting_for_sign_in"
  details.runs[0].phase = "filling"
  render(<ApplyPage />)
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/cancel", { runId: "run-1", extra: "" }))
})

it("links base resume configuration to Resumes", async () => {
  source.config.projectDir = ""
  render(<ApplyPage />)
  await openStep("Resume")
  fireEvent.click(await screen.findByRole("button", { name: "Base resume" }))
  const links = await screen.findAllByRole("link", { name: "Configure resume sources" })
  for (const link of links) expect(link).toHaveAttribute("href", "#/resume?id=base")
  expect(screen.queryByRole("button", { name: "Update base PDF" })).not.toBeInTheDocument()
})

it("selects the validated PDF run when filling after a failed newer execution", async () => {
  details.runs.unshift({ ...details.runs[0], id: "failed-run", status: "failed", artifacts: [], error: "Compilation failed" })
  render(<ApplyPage />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-1", extra: "", versionId: "pdf-1", provider: "opencode" }))
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
  expect(screen.getByRole("link", { name: "View it on the board" })).toHaveAttribute("href", "#/applications?view=board&highlight=3")
  await waitFor(() => expect(screen.queryByRole("button", { name: "I submitted in the browser" })).not.toBeInTheDocument())
  await openStep("Fill portal")
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

it("updates Apply after a diagnostic retry in Agent setup and links the matching correction", async () => {
  const original = request.getMockImplementation()!
  let blocked = true
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "integrations/status") return { entries: [{ target: "acp/opencode", executable: true, diagnostic: { model: "", checks: blocked ? [{ stage: "authentication", state: "authentication_required", message: "Sign in to this integration, then test again." }] : [] } }], dependencies: [] }
    return original(path, body)
  })
  render(<ApplyPage />)
  const correction = await screen.findAllByRole("link", { name: "Correct opencode ACP" })
  expect(correction[0]).toHaveAttribute("href", "#/launch?tab=setup&target=acp%2Fopencode")
  await openStep("Resume")
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
  blocked = false
  act(() => publish({ type: "changed", table: "integrations" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled())
  expect(screen.getByRole("region", { name: "Tailored resume PDF" })).toHaveTextContent("pdf-1")
})
it("continues an interrupted fill in the same run only after the portal was reviewed", async () => {
  details.runs[0].status = "interrupted"
  details.runs[0].phase = "filling"
  details.runs[0].recovery = { checkpoints: ["sources", "compiled"], retryFrom: "filling", reviewRequired: true, summary: "The app closed during portal filling." }
  render(<ApplyPage />)
  expect(await screen.findByText("The app closed during portal filling.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "I reviewed the portal in the browser" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill again" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill again" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/retry", { runId: "run-1", extra: "", reviewed: true, provider: "opencode" }))
  expect(window.location.hash).toContain("runId=run-1")
})

it("fills an unapproved resume and keeps approval optional, with PDF text changes and failures", async () => {
  details.documents[0].approvedAt = null
  details.documents[0].extra = "Emphasize React"
  const original = request.getMockImplementation()!
  let fail = true
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "application-preparation/approve") {
      if (fail) { fail = false; throw new Error("PDF changed. Generate again.") }
      details.documents[0].approvedAt = "2026-01-02"
      return details.documents[0]
    }
    return original(path, body)
  })
  render(<ApplyPage />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  await openStep("Resume")
  expect(await screen.findByLabelText("Document text comparison")).toBeInTheDocument()
  expect(screen.getByLabelText("Document text comparison").querySelector("ins")).toHaveTextContent("Tailored experience")
  expect(screen.getByLabelText("Document text comparison").querySelector("del")).toHaveTextContent("Original experience")
  expect(screen.queryByRole("button", { name: "Approve this resume" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Approve this version" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("PDF changed")
  await waitFor(() => expect(screen.getByRole("button", { name: "Approve this version" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Approve this version" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/approve", { runId: "run-1", versionId: "pdf-1" }))
  expect(await screen.findByRole("button", { name: "Version approved" })).toBeDisabled()
})

it("switches version comparisons and shows approval, portal use and frozen submission", async () => {
  details.documents[0].usedAt = "2026-01-02"
  details.documents[0].submittedAt = "2026-01-03"
  details.documents.push({ ...details.documents[0], id: "pdf-older", runId: "run-older", text: "Earlier experience" })
  render(<ApplyPage />)
  await openStep("Resume")
  expect(await screen.findByText(/Version pdf-1 · Submitted/)).toBeInTheDocument()
  expect(screen.getByText(/Approved on/)).toBeInTheDocument()
  expect(screen.getByText(/Used in portal on/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Compare document with"), { target: { value: "pdf-older" } })
  expect(screen.getByLabelText("Document text comparison").querySelector("del")).toHaveTextContent("Earlier experience")
  fireEvent.change(screen.getByLabelText("Compare document with"), { target: { value: "base" } })
  expect(screen.getByLabelText("Document text comparison").querySelector("del")).toHaveTextContent("Original experience")
  fireEvent.change(screen.getByLabelText("Execution history"), { target: { value: "run-1" } })
  expect(window.location.hash).toContain("runId=run-1")
})
it("approves and confirms one result while another execution, such as a batch item, is running", async () => {
  details.busy = true
  details.documents[0].approvedAt = null
  render(<ApplyPage />)
  await openStep("Resume")
  const approve = await screen.findByRole("button", { name: "Approve this version" })
  await waitFor(() => expect(approve).toBeEnabled())
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
  fireEvent.click(approve)
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/approve", { runId: "run-1", versionId: "pdf-1" }))
})

const step = (name: string) => screen.getByRole("listitem", { name: new RegExp(`^${name}: `) })
it("titles the detail Application, without a job selector, and walks the stepper through each phase", async () => {
  const documents = details.documents
  const runs = details.runs
  Object.assign(details, { runs: [], documents: [] })
  const { unmount } = render(<ApplyPage />)
  expect(await screen.findByRole("heading", { name: "Application", level: 1 })).toBeInTheDocument()
  expect(screen.queryByLabelText("Saved job")).not.toBeInTheDocument()
  await screen.findByRole("navigation", { name: "Application progress" })
  expect(step("1. Job description")).toHaveAccessibleName("1. Job description: Done")
  expect(step("2. Resume")).toHaveAttribute("aria-current", "step")
  expect(step("3. Fill portal")).toHaveAccessibleName("3. Fill portal: Next")
  unmount()
  Object.assign(details, { runs, documents })
  details.documents[0].approvedAt = null
  const approved = render(<ApplyPage />)
  await waitFor(() => expect(step("3. Fill portal")).toHaveAttribute("aria-current", "step"))
  expect(step("2. Resume")).toHaveAccessibleName("2. Resume: Done")
  approved.unmount()
  Object.assign(details, { applicationStatus: "filled", uploadedRunId: "run-1" })
  const filled = render(<ApplyPage />)
  await waitFor(() => expect(step("4. Confirm submission")).toHaveAttribute("aria-current", "step"))
  filled.unmount()
  Object.assign(details, { applicationStatus: "submitted", journey: { id: 3, submission_status: "submitted", submitted_at: "2026-10-01T12:00:00.000Z" } })
  render(<ApplyPage />)
  await waitFor(() => expect(step("4. Confirm submission")).toHaveAccessibleName("4. Confirm submission: Done"))
  expect(screen.queryByRole("listitem", { current: "step" })).not.toBeInTheDocument()
})
it("marks the current step as blocked with its readiness reason", async () => {
  details.job.description = null
  details.runs = []
  details.documents = []
  render(<ApplyPage />)
  await waitFor(() => expect(step("1. Job description")).toHaveAccessibleName("1. Job description: Blocked"))
  expect(step("1. Job description")).toHaveTextContent("This job needs a description.")
  expect(step("2. Resume")).toHaveAccessibleName("2. Resume: Next")
})
it("shows an empty state that links to the Jobs shortlist when no job is chosen", () => {
  search.jobId = undefined
  search.applicationId = undefined
  render(<ApplyPage />)
  expect(screen.getByRole("heading", { name: "Application", level: 1 })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open the Jobs shortlist" })).toHaveAttribute("href", "#/jobs?view=shortlist")
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalledWith("application-preparation/details", expect.anything())
})
const savedResume = { id: "v1", name: "Back-End · C#, .NET", role: "backend", stacks: ["C#", ".NET"], status: "ready", archivedAt: null, pdf: { id: "pdf-v1", kind: "variant", pages: 1, warnings: [] } }
it("fills with the selected saved resume, without a use or approval button", async () => {
  const base = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: unknown) => path === "resume-variants" ? [savedResume] : path === "application-preparation/use-variant" ? { id: "run-saved", application_id: 3 } : base(path, body))
  render(<ApplyPage />)
  await openStep("Resume")
  fireEvent.click(await screen.findByRole("button", { name: savedResume.name }))
  expect(screen.getByRole("region", { name: `${savedResume.name} PDF` })).toHaveTextContent("pdf-v1")
  expect(screen.getByRole("button", { name: savedResume.name })).toHaveAttribute("aria-pressed", "true")
  expect(screen.queryByRole("button", { name: /Use this resume|Approve/ })).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalledWith("application-preparation/use-variant", expect.anything())
  await openStep("Fill portal")
  expect(screen.getByText(/the saved resume you chose/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/use-variant", { jobId: 7, applicationId: 3, variantId: "v1" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-saved", extra: "", provider: "opencode" }))
  await waitFor(() => expect(window.location.hash).toContain("runId=run-saved"))
  expect(request).not.toHaveBeenCalledWith("application-preparation/generate", expect.anything())
})
it("shows the saved resume in use on its own card, without a document review", async () => {
  const base = request.getMockImplementation()!
  details.runs[0].provider = "saved-resume"
  details.documents[0].variant = { id: "v1", name: savedResume.name, role: "backend", stacks: ["C#", ".NET"] }
  request.mockImplementation(async (path: string, body?: unknown) => path === "resume-variants" ? [savedResume] : base(path, body))
  render(<ApplyPage />)
  await openStep("Resume")
  const card = await screen.findByRole("button", { name: savedResume.name })
  await waitFor(() => expect(card).toHaveAttribute("aria-pressed", "true"))
  expect(card).toHaveTextContent("This application")
  expect(screen.getByRole("region", { name: `${savedResume.name} PDF` })).toHaveTextContent("pdf-1")
  expect(screen.queryByLabelText("Document text comparison")).not.toBeInTheDocument()
})
it("reports a refused saved resume and does not fill", async () => {
  const base = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "resume-variants") return [savedResume]
    if (path === "application-preparation/use-variant") throw new Error("This saved resume is archived.")
    return base(path, body)
  })
  render(<ApplyPage />)
  await openStep("Resume")
  fireEvent.click(await screen.findByRole("button", { name: savedResume.name }))
  await openStep("Fill portal")
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  expect(await screen.findByText("This saved resume is archived.")).toBeInTheDocument()
  expect(request).not.toHaveBeenCalledWith("application-preparation/fill", expect.anything())
})
it("offers a saved resume next to generation and fills it with the selected agent", async () => {
  details.runs[0].provider = "saved-resume"
  render(<ApplyPage />)
  await openStep("Resume")
  expect(await screen.findByRole("heading", { name: "Choose a resume" })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: "Generate a tailored resume" })).toBeInTheDocument()
  await openStep("Fill portal")
  expect(screen.getByText(/the saved resume you chose/)).toBeInTheDocument()
  expect(await screen.findByText(/Runs with OpenCode/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-1", extra: "", versionId: "pdf-1", provider: "opencode" }))
})
it("shows a failed fill's error and recovery inside the Fill portal step", async () => {
  details.runs[0] = { ...details.runs[0], status: "failed", phase: "filling", error: "Unknown ACP provider", recovery: { checkpoints: ["compiled"], retryFrom: "filling", reviewRequired: true, summary: "Portal filling failed." } }
  render(<ApplyPage />)
  await openStep("Fill portal")
  expect(await screen.findByText("Unknown ACP provider")).toBeInTheDocument()
  expect(screen.getByText("Portal filling failed.")).toBeInTheDocument()
  await openStep("Resume")
  expect(await screen.findByRole("heading", { name: "Choose a resume" })).toBeInTheDocument()
  expect(screen.queryByText("Unknown ACP provider")).toBeNull()
})
it("opens the current step first and each step's view from the stepper", async () => {
  render(<ApplyPage />)
  const nav = await screen.findByRole("navigation", { name: "Application progress" })
  expect(await screen.findByRole("button", { name: "Fill application" })).toBeInTheDocument()
  expect(within(nav).getByRole("button", { name: /^Fill portal/ })).toHaveAttribute("aria-pressed", "true")
  await openStep("Job description")
  expect(screen.getByRole("textbox", { name: "Job description" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Fill application" })).not.toBeInTheDocument()
  expect(within(nav).getByRole("button", { name: /^Job description/ })).toHaveAttribute("aria-pressed", "true")
  await openStep("Confirm submission")
  expect(screen.getByRole("heading", { name: "Confirm submission" })).toBeInTheDocument()
})
it("fills with the base resume as it is and opens its execution", async () => {
  const base = request.getMockImplementation()!
  request.mockImplementation(async (path: string, body?: unknown) => path === "application-preparation/use-base" ? { id: "run-base", application_id: 3 } : base(path, body))
  render(<ApplyPage />)
  await openStep("Resume")
  fireEvent.click(await screen.findByRole("button", { name: "Base resume" }))
  await openStep("Fill portal")
  expect(screen.getByText(/\(your base resume as it is\)/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "Fill application" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Fill application" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/use-base", { jobId: 7, applicationId: 3 }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("application-preparation/fill", { runId: "run-base", extra: "", provider: "opencode" }))
  await waitFor(() => expect(window.location.hash).toContain("runId=run-base"))
})
it("names the base resume in the Fill portal step", async () => {
  details.runs[0].provider = "base-resume"
  render(<ApplyPage />)
  await openStep("Fill portal")
  expect(await screen.findByText(/\(your base resume as it is\)/)).toBeInTheDocument()
})

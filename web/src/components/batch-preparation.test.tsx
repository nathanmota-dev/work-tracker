import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { BatchPreparation } from "./batch-preparation"
import type { Row } from "@/lib/api"
vi.mock("@/components/ui/select-control", () => ({ SelectControl: (props: React.ComponentProps<"select">) => <select {...props} /> }))
const request = vi.fn()
const created = vi.fn()
let jobs: Row[]
let excluded: boolean
beforeEach(() => {
  jobs = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Role ${i + 1}`, company_name: "Synthetic", link: `https://example.test/${i}`, description: "React" }))
  excluded = false; created.mockReset()
  request.mockReset().mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (path === "acp/providers") return { default: "fixture", providers: [{ id: "fixture", displayName: "Fixture", models: ["fast"] }, { id: "second", displayName: "Second", models: [] }] }
    if (path === "resume-sources") return { config: { projectDir: "/fixture", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" }, dependencies: [], warnings: [] }
    if (path === "preparation-batches/preview") return { selected: jobs.length, eligible: jobs.length - Number(excluded), excluded: Number(excluded), items: jobs.map((job, i) => ({ jobId: job.id, title: job.title, company: job.company_name, eligible: !excluded || i !== 0, reasons: excluded && i === 0 ? ["is missing description"] : [], missing: excluded && i === 0 ? ["description"] : [] })) }
    if (path === "preparation-batches/create") return { id: "batch", items: body?.items }
    if (path === "jobs/update") { excluded = false; return { job: { ...jobs[0], ...body }, missing: [] } }
    throw new Error(`Unexpected ${path}`)
  })
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), connectionStatus: async () => true, openExternal: vi.fn(), onEvent: () => () => {} }
})
async function review() {
  render(<BatchPreparation jobs={jobs} onCreated={created} />)
  fireEvent.click(screen.getByRole("button", { name: "Prepare selected" }))
  return screen.findByText(/selected · .* eligible · .* excluded/)
}
it("reviews five jobs and shares one agent/model/resume while allowing only context overrides", async () => {
  await review()
  expect(screen.getByText("5 selected · 5 eligible · 0 excluded")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Batch model"), { target: { value: "fast" } })
  fireEvent.change(screen.getByLabelText("Shared context"), { target: { value: "Common" } })
  fireEvent.change(screen.getByLabelText("Context for Role 2"), { target: { value: "Override" } })
  fireEvent.click(screen.getByRole("button", { name: "Create batch (5)" }))
  await screen.findByText("Batch created with 5 jobs.")
  expect(request).toHaveBeenCalledWith("preparation-batches/create", {
    requestId: expect.any(String), provider: "fixture", model: "fast", extra: "Common",
    items: jobs.map((job, i) => ({ jobId: job.id, extra: i === 1 ? "Override" : "" })),
  })
  expect(created).toHaveBeenCalledOnce()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open preparation queue" })).toHaveAttribute("href", "#/apply")
})
it("keeps errors reviewable, locks double clicks and retries the same request ID after an unknown result", async () => {
  await review()
  let reject!: (error: Error) => void
  request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const create = screen.getByRole("button", { name: "Create batch (5)" })
  fireEvent.click(create); fireEvent.click(create)
  expect(create).toBeDisabled()
  await act(async () => reject(new Error("Connection lost")))
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost")
  expect(screen.queryByText(/Batch created/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Create batch (5)" }))
  await screen.findByText("Batch created with 5 jobs.")
  const calls = request.mock.calls.filter(([path]) => path === "preparation-batches/create")
  expect(calls).toHaveLength(2)
  expect(calls[0][1].requestId).toBe(calls[1][1].requestId)
})
it("corrects an incomplete job and refreshes eligibility while preserving context", async () => {
  excluded = true; jobs[0].description = ""
  await review()
  expect(screen.getByText("5 selected · 4 eligible · 1 excluded")).toBeInTheDocument()
  expect(screen.getByText("Excluded: is missing description.")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Shared context"), { target: { value: "Keep me" } })
  fireEvent.click(screen.getByRole("button", { name: "Correct Role 1" }))
  fireEvent.change(screen.getByLabelText("Job description"), { target: { value: "Fixed React role" } })
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await screen.findByText("5 selected · 5 eligible · 0 excluded")
  expect(screen.getByLabelText("Shared context")).toHaveValue("Keep me")
  fireEvent.change(screen.getByLabelText("Batch agent"), { target: { value: "second" } })
  expect(screen.getByLabelText("Batch model")).toHaveValue("")
  fireEvent.click(screen.getByRole("button", { name: "Refresh eligibility" }))
  await screen.findByText("5 selected · 5 eligible · 0 excluded")
  fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }))
  expect(created).not.toHaveBeenCalled()
})
it("shows preview failure with retry and closes without creating a batch", async () => {
  const implementation = request.getMockImplementation()!
  let failed = true
  request.mockImplementation((path, body) => path === "preparation-batches/preview" && failed ? Promise.reject(new Error("Preview unavailable")) : implementation(path, body))
  render(<BatchPreparation jobs={jobs} onCreated={created} />)
  fireEvent.click(screen.getByRole("button", { name: "Prepare selected" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Preview unavailable")
  expect(screen.getByRole("button", { name: "Create batch (0)" })).toBeDisabled()
  failed = false
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  await screen.findByText("5 selected · 5 eligible · 0 excluded")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

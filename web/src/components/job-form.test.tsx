import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobsPage } from "@/routes/jobs"
import { JobForm } from "@/components/job-form"
import type { Row } from "@/lib/api"

let jobs: Row[]
const request = vi.fn()
beforeEach(() => {
  jobs = []
  request.mockReset().mockImplementation(async (path: string, body: Row) => {
    if (path === "jobs") return structuredClone(jobs)
    const existing = jobs.find(job => job.link && job.link === body.link)
    const job = path === "jobs/update" ? { ...jobs.find(job => job.id === body.id), ...body } : existing ?? { ...body, id: jobs.length + 1 }
    if (!existing || path === "jobs/update") jobs = [...jobs.filter(row => row.id !== job.id), job]
    return { job, existing: !!existing && path !== "jobs/update", missing: [] }
  })
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), connectionStatus: async () => true,
    openExternal: vi.fn(), onEvent: () => () => {} }
})
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

it("saves a draft after correcting a failure, edits it and opens preparation without running an agent", async () => {
  render(<JobsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Add job" }))
  expect(screen.getByRole("button", { name: "Save job" })).toBeDisabled()
  fill("Role title", "External Engineer")
  fill("Company name", "Synthetic Corp")
  expect(screen.getByText("Missing for preparation: job link, job description.")).toBeInTheDocument()
  request.mockRejectedValueOnce(new Error("Enter a valid job URL"))
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid job URL")
  expect(jobs).toHaveLength(0)
  expect(screen.getByLabelText("Role title")).toHaveValue("External Engineer")
  fill("Job link", "https://careers.test/42")
  fill("Job description", "Build systems")
  expect(screen.queryByText(/Missing for preparation/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await screen.findByRole("button", { name: "Edit job" })
  expect(screen.getByText("Job saved.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Edit job" }))
  expect(screen.getByLabelText("Role title")).toHaveValue("External Engineer")
  fill("Role title", "Updated Engineer")
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await screen.findByRole("button", { name: "Edit job" })
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Prepare application" }))
  expect(window.location.hash).toBe("#/apply?jobId=1")
  expect(request.mock.calls.some(([path]) => path === "acp/run")).toBe(false)
  expect(jobs).toHaveLength(1)
  expect(jobs[0].title).toBe("Updated Engineer")
})

it("reports an existing job without adding a duplicate and allows cancelling the form", async () => {
  jobs = [{ id: 9, title: "Saved Engineer", company_name: "Synthetic Corp", link: "https://careers.test/42" }]
  render(<JobsPage />)
  await screen.findByText("Saved Engineer")
  fireEvent.click(screen.getByRole("button", { name: "Add job" }))
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Add job" }))
  fill("Role title", "Duplicate")
  fill("Company name", "Synthetic Corp")
  fill("Job link", "https://careers.test/42")
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  expect(await screen.findByText("Job #9 already exists. Its saved content was preserved.")).toBeInTheDocument()
  expect(jobs).toHaveLength(1)
  expect(within(screen.getByRole("dialog")).getByRole("heading")).toHaveTextContent("Saved Engineer")
})

it("accepts a LinkedIn source ID for description retrieval and submits optional text fields", async () => {
  const onSaved = vi.fn()
  render(<JobForm onClose={vi.fn()} onSaved={onSaved} />)
  fill("Role title", "Engineer"); fill("Company name", "Corp"); fill("Job link", "https://linkedin.com/jobs/view/42")
  expect(screen.queryByText(/Missing for preparation/)).not.toBeInTheDocument()
  fill("Job link", "https://jobs.test/42"); fill("Source", "linkedin"); fill("Source job ID", "42")
  fill("Requirements (JSON)", '["React"]'); fill("Location", "Remote")
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(request).toHaveBeenCalledWith("jobs/create", expect.objectContaining({ source: "linkedin", source_job_id: "42", requirements_json: '["React"]', location: "Remote" }))
})

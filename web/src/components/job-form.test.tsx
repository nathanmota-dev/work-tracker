import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobsPage } from "@/routes/jobs"
import { JobForm } from "@/components/job-form"
import type { Row } from "@/lib/api"
// The Get started checklist reads its own status; these flows cover other requests.
vi.mock("@/components/get-started", () => ({ NextStepHint: ({ fallback }: { fallback?: string }) => <>{fallback}</>, SetupNotice: () => null }))

let jobs: Row[]
const request = vi.fn()
beforeEach(() => {
  jobs = []
  request.mockReset().mockImplementation(async (path: string, body: Row) => {
    if (path === "jobs") return structuredClone(jobs)
    if (path.startsWith("ats/")) return []
    const existing = jobs.find(job => job.link && job.link === body.link)
    const job = path === "jobs/update" ? { ...jobs.find(job => job.id === body.id), ...body } : existing ?? { ...body, id: jobs.length + 1 }
    if (!existing || path === "jobs/update") jobs = [...jobs.filter(row => row.id !== job.id), job]
    return { job, existing: !!existing && path !== "jobs/update", missing: [] }
  })
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), connectionStatus: async () => true,
    getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {} }
})
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

const choose = async (label: RegExp, option: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: label }), { key: "Enter" })
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }))
}

it("saves a draft after correcting a failure, edits it and opens preparation without running an agent", async () => {
  render(<JobsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Add job" }))
  expect(screen.getByRole("button", { name: "Save job" })).toBeDisabled()
  fill("Role title", "External Engineer")
  fill("Company name", "Synthetic Corp")
  expect(screen.getByText("Missing for preparation: job link, job description.")).toBeInTheDocument()
  await waitFor(() => expect(request).toHaveBeenCalledWith("ats/best", undefined))
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
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }))
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
  expect(within(screen.getByRole("dialog")).getByRole("heading", { level: 2 })).toHaveTextContent("Saved Engineer")
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

it("saves an application deadline and sorts the list by it", async () => {
  jobs = [
    { id: 1, title: "Undated Engineer", company_name: "Synthetic Corp", scouted_at: "2026-11-03" },
    { id: 2, title: "Later Engineer", company_name: "Synthetic Corp", deadline: "2026-12-20", deadline_level: "upcoming", deadline_days: 27, scouted_at: "2026-11-02" },
    { id: 3, title: "Late Engineer", company_name: "Synthetic Corp", deadline: "2026-11-20", deadline_level: "overdue", deadline_days: -3, scouted_at: "2026-11-01" },
  ]
  render(<JobsPage />)
  await screen.findByText("Undated Engineer")
  expect(screen.getByText("Overdue")).toBeInTheDocument()
  expect(screen.getByText("Due in 27 days")).toBeInTheDocument()
  const titles = () => screen.getAllByRole("article").map(card => card.getAttribute("aria-label"))
  const before = titles()
  await choose(/^Sort/, "Soonest deadline")
  expect(titles()).toEqual(["Late Engineer", "Later Engineer", "Undated Engineer"])
  await choose(/^Sort/, "Recently saved")
  expect(titles()).toEqual(before)
  fireEvent.click(screen.getByRole("button", { name: "Add job" }))
  expect(screen.getByLabelText("Application deadline")).toHaveAttribute("type", "date")
  fill("Role title", "Dated Engineer")
  fill("Company name", "Synthetic Corp")
  fill("Application deadline", "2026-12-01")
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await screen.findByRole("button", { name: "Edit job" })
  expect(request).toHaveBeenCalledWith("jobs/create", expect.objectContaining({ title: "Dated Engineer", deadline: "2026-12-01" }))
})

const link = "https://careers.test/quick"
const imported = {
  fields: { title: "Imported Engineer", company_name: "Page Corp", work_type: "Remote", deadline: "2026-12-01", description: "Build systems" },
  description_source: "<div><p>Build systems</p></div>",
}

it("imports a job link into the form and saves the published description when it is untouched", async () => {
  const onSaved = vi.fn()
  render(<JobForm onClose={vi.fn()} onSaved={onSaved} />)
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled()
  fill("Location", "Typed location")
  fill("Job link", link)
  request.mockResolvedValueOnce(imported)
  fireEvent.click(screen.getByRole("button", { name: "Import" }))
  expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Save job" })).toBeDisabled()
  expect(await screen.findByText(/^Imported role title, company name, work type, application deadline, job description\./)).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith("jobs/import", { url: link })
  expect(screen.getByLabelText("Role title")).toHaveValue("Imported Engineer")
  expect(screen.getByLabelText("Location")).toHaveValue("Typed location")
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(request).toHaveBeenCalledWith("jobs/create", expect.objectContaining({
    title: "Imported Engineer", link, location: "Typed location", description: imported.description_source,
  }))
})

it("explains a failed import, clears earlier imported values and saves an edited description as typed", async () => {
  const onSaved = vi.fn()
  render(<JobForm onClose={vi.fn()} onSaved={onSaved} />)
  fill("Job link", link)
  request.mockRejectedValueOnce(new Error("This page doesn't publish job data."))
  fireEvent.keyDown(screen.getByLabelText("Job link"), { key: "Enter" })
  expect(await screen.findByRole("alert")).toHaveTextContent("This page doesn't publish job data.")
  request.mockResolvedValueOnce(imported)
  fireEvent.keyDown(screen.getByLabelText("Job link"), { key: "Enter" })
  await screen.findByText(/^Imported /)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  fill("Company name", "Corrected Corp")
  request.mockResolvedValueOnce({ fields: { title: "Second Engineer", description: "Second role" } })
  fireEvent.click(screen.getByRole("button", { name: "Import" }))
  await screen.findByText(/^Imported role title, job description\./)
  expect(screen.getByLabelText("Company name")).toHaveValue("Corrected Corp")
  expect(screen.getByLabelText("Work type")).toHaveValue("")
  expect(screen.getByLabelText("Application deadline")).toHaveValue("")
  fill("Job description", "My own notes")
  fireEvent.click(screen.getByRole("button", { name: "Save job" }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(request).toHaveBeenCalledWith("jobs/create", expect.objectContaining({ description: "My own notes", status: "saved" }))
})

it("offers no import when editing and ignores Enter on the link", () => {
  render(<JobForm job={{ id: 3, title: "Saved", company_name: "Corp", link }} onClose={vi.fn()} onSaved={vi.fn()} />)
  expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByLabelText("Job link"), { key: "Enter" })
  expect(request).not.toHaveBeenCalled()
})

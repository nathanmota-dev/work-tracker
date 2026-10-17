import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobLinkDialog } from "@/components/job-link-dialog"
import { desktopDouble } from "@/test/doubles"
import type { JobCandidate, JobLinkOptions } from "@/lib/application-board"

const candidate = (id: number, fields: Partial<JobCandidate> = {}): JobCandidate => ({
  id, title: "Engineer", company_name: "Example Corp", link: "https://jobs.example.test/role", archived_at: null,
  match: "link", application_id: null, ...fields,
})
let options: JobLinkOptions
let desktop: ReturnType<typeof desktopDouble>
const link = vi.fn()
beforeEach(() => {
  options = { application_id: 4, role_title: null, company_name: "Example Corp", external_url: "https://jobs.example.test/role", comp: null, missing: ["role_title", "description"], candidates: [] }
  link.mockReset().mockResolvedValue({ application_id: 4, job_id: 9, created_job: true, missing: [] })
  desktop = desktopDouble()
  desktop.request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "application-board/link/options") return structuredClone(options)
    return link(body)
  })
  window.desktop = desktop
})
const open = (onLinked = vi.fn()) => {
  render(<JobLinkDialog applicationId={4} title="Prepare this application" onClose={vi.fn()} onLinked={onLinked} />)
  return onLinked
}

it("flags missing data and creates the job once it is corrected", async () => {
  const onLinked = open()
  const dialog = within(await screen.findByRole("dialog"))
  expect(await dialog.findByLabelText("Company name")).toHaveValue("Example Corp")
  expect(dialog.getByText("Missing for preparation: role title, job description.")).toBeInTheDocument()
  expect(dialog.getByRole("button", { name: "Link job" })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText("Role title"), { target: { value: "Engineer" } })
  fireEvent.change(dialog.getByLabelText("Job description"), { target: { value: "Build it." } })
  expect(dialog.queryByText(/Missing for preparation/)).not.toBeInTheDocument()
  fireEvent.change(dialog.getByLabelText("Compensation"), { target: { value: "R$ 1" } })
  fireEvent.click(dialog.getByRole("button", { name: "Link job" }))
  await waitFor(() => expect(onLinked).toHaveBeenCalledWith({ application_id: 4, job_id: 9, created_job: true, missing: [] }))
  expect(link).toHaveBeenCalledWith({ id: 4, create: true, role_title: "Engineer", company_name: "Example Corp", external_url: "https://jobs.example.test/role", comp: "R$ 1", description: "Build it." })
})

it("asks for a choice between plausible jobs and shows conflicts without linking", async () => {
  options.candidates = [candidate(1), candidate(2, { match: "linkedin_id", link: null, archived_at: "2026-01-01" }), candidate(3, { application_id: 8, title: null, company_name: null })]
  const onLinked = open()
  const dialog = within(await screen.findByRole("dialog"))
  expect(await dialog.findByText("Several saved jobs match this application. Choose the right one.")).toBeInTheDocument()
  expect(dialog.getByRole("button", { name: "Link job" })).toBeDisabled()
  expect(dialog.getByText(/Already linked to application #8/)).toBeInTheDocument()
  expect(dialog.getByText("#3 · Unknown company · Untitled role")).toBeInTheDocument()
  expect(dialog.getByText(/Same LinkedIn job ID/)).toBeInTheDocument()
  const radios = dialog.getAllByRole("radio")
  expect(radios[2]).toBeDisabled()
  fireEvent.click(radios[1]!)
  link.mockRejectedValueOnce(new Error("Job #2 already has application #5."))
  fireEvent.click(dialog.getByRole("button", { name: "Link job" }))
  expect(await dialog.findByRole("alert")).toHaveTextContent("Job #2 already has application #5.")
  expect(onLinked).not.toHaveBeenCalled()
  fireEvent.click(radios[0]!)
  fireEvent.click(dialog.getByRole("button", { name: "Link job" }))
  await waitFor(() => expect(onLinked).toHaveBeenCalled())
  expect(link).toHaveBeenLastCalledWith({ id: 4, job_id: 1, description: undefined })
})

it("reports a loading failure and retries", async () => {
  desktop.request.mockRejectedValueOnce(new Error("offline"))
  open()
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }))
  expect(await screen.findByLabelText("Role title")).toBeInTheDocument()
})

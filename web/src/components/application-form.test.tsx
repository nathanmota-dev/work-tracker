import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ApplicationForm } from "@/components/application-form"
import { desktopDouble } from "@/test/doubles"
vi.mock("@/components/ui/select-control", () => ({
  SelectControl: (props: React.ComponentProps<"select">) => <select {...props} />,
}))

const jobs = [
  { id: 7, title: "Platform Engineer", company_name: "Saved Co", link: "https://saved.co/job", comp: "R$ 9k", archived_at: null },
  { id: 8, title: "Old", company_name: "Archived Co", link: null, archived_at: "2026-01-01" },
]
let desktop: ReturnType<typeof desktopDouble>
beforeEach(() => {
  desktop = desktopDouble()
  desktop.request.mockImplementation(async (path: string, body?: unknown) =>
    path === "jobs" ? jobs : { id: 3, ...(body as object) },
  )
  window.desktop = desktop
})

it("links a saved job, filling only empty fields, and sends its local ID", async () => {
  const onSaved = vi.fn()
  render(<ApplicationForm onClose={vi.fn()} onSaved={onSaved} />)
  const picker = await screen.findByRole("combobox", { name: "Saved job" })
  await waitFor(() => expect(picker).toBeEnabled())
  expect(screen.queryByRole("option", { name: /Archived Co/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Role title"), { target: { value: "Typed role" } })
  fireEvent.change(picker, { target: { value: "7" } })
  expect(screen.getByLabelText("Company name")).toHaveValue("Saved Co")
  expect(screen.getByLabelText("Job link")).toHaveValue("https://saved.co/job")
  expect(screen.getByLabelText("Compensation")).toHaveValue("R$ 9k")
  expect(screen.getByLabelText("Role title")).toHaveValue("Typed role")
  fireEvent.click(screen.getByRole("button", { name: "Save application" }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(desktop.request).toHaveBeenCalledWith("application-board/create", expect.objectContaining({ job_id: 7, company_name: "Saved Co", role_title: "Typed role" }))
})

it("keeps an unlinked registration and hides the picker when editing", async () => {
  const onSaved = vi.fn()
  const { unmount } = render(<ApplicationForm onClose={vi.fn()} onSaved={onSaved} />)
  const picker = await screen.findByRole("combobox", { name: "Saved job" })
  await waitFor(() => expect(picker).toBeEnabled())
  fireEvent.change(picker, { target: { value: "7" } })
  fireEvent.change(picker, { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Save application" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("application-board/create", expect.objectContaining({ job_id: null })))
  unmount()
  desktop.request.mockResolvedValue([])
  render(<ApplicationForm onClose={vi.fn()} onSaved={onSaved} />)
  expect(await screen.findByRole("option", { name: "No saved jobs" })).toBeInTheDocument()
})

it("sends a manual application deadline", async () => {
  const onSaved = vi.fn()
  render(<ApplicationForm onClose={vi.fn()} onSaved={onSaved} />)
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Saved job" })).toBeEnabled())
  fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Dated Co" } })
  fireEvent.change(screen.getByLabelText("Job link"), { target: { value: "https://dated.co/job" } })
  const deadline = screen.getByLabelText("Application deadline")
  expect(deadline).toHaveAttribute("type", "date")
  fireEvent.change(deadline, { target: { value: "2026-12-01" } })
  fireEvent.click(screen.getByRole("button", { name: "Save application" }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(desktop.request).toHaveBeenCalledWith("application-board/create", expect.objectContaining({ company_name: "Dated Co", deadline: "2026-12-01" }))
})

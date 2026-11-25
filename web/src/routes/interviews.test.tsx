import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InterviewsPage } from "./interviews"
import { request, useApi, type Row } from "@/lib/api"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
  request: vi.fn(),
}))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))
let rows: Row[]
const refresh = vi.fn()
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"))
  rows = []
  refresh.mockClear()
  vi.mocked(request).mockReset().mockResolvedValue({ id: 9 })
  vi.mocked(useApi).mockImplementation(() => ({ data: rows, error: "", loading: false, refresh }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
const card = (name: string) => within(screen.getByRole("article", { name }))
const titles = () => screen.getAllByRole("article").map(article => article.getAttribute("aria-label"))

it("splits interviews into upcoming, past and closed tabs and highlights the next conversation", () => {
  rows = [
    { id: 1, company: "Acme", scheduled_at: "2026-10-16T12:00:00Z", status: "scheduled", stage: "hiring-manager", notes: "Bring the roadmap" },
    { id: 2, company: "Later", scheduled_at: "2027-01-01T12:00:00Z", status: "scheduled", stage: "technical" },
    { id: 3, company: "Other", scheduled_at: "2027-01-01", status: "closed" },
    { id: 4, company: "Past", scheduled_at: "2026-01-01", status: "scheduled" },
    { id: 5, company: "Undated", status: "scheduled" },
    { id: 6, company: "Finished", scheduled_at: "2026-11-01", status: "done" },
  ]
  render(<InterviewsPage />)
  const next = within(screen.getByRole("region", { name: "Next conversation" }))
  expect(next.getByText("Acme")).toBeInTheDocument()
  expect(next.getByText("In 2 days")).toBeInTheDocument()
  expect(next.getByRole("link", { name: /Prep/ })).toHaveAttribute("href", "#/interview-prep?q=Acme")
  expect(screen.getByRole("tab", { name: "Upcoming (3)" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("tab", { name: "Past (2)" })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "Closed (1)" })).toBeInTheDocument()
  expect(titles()).toEqual(["Acme", "Later", "Undated"])
  expect(card("Acme").getByText("Hiring manager")).toBeInTheDocument()
  expect(card("Acme").getByText("Bring the roadmap")).toBeInTheDocument()
  expect(card("Undated").getByText("Date not set")).toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Past (2)" }))
  expect(titles()).toEqual(["Finished", "Past"])
  expect(card("Finished").getByText("Done")).toBeInTheDocument()
  expect(card("Past").queryByRole("link", { name: /Prep/ })).not.toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Closed (1)" }))
  expect(titles()).toEqual(["Other"])
})

it("searches, opens the details sheet and sorts by company", () => {
  rows = [
    { id: 1, company: "Zeta", scheduled_at: "2026-10-15T12:00:00Z", status: "scheduled", notes: "Discuss architecture" },
    { id: 2, company: "Alpha", scheduled_at: "2026-10-20T12:00:00Z", status: "scheduled" },
  ]
  render(<InterviewsPage />)
  expect(titles()).toEqual(["Zeta", "Alpha"])
  fireEvent.pointerDown(screen.getByRole("button", { name: "Sort: Soonest first" }), { button: 0, ctrlKey: false })
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Company" }))
  expect(titles()).toEqual(["Alpha", "Zeta"])
  fireEvent.change(screen.getByRole("searchbox", { name: "Search interviews" }), { target: { value: "architecture" } })
  expect(titles()).toEqual(["Zeta"])
  expect(screen.getByText("Upcoming interviews").parentElement).toHaveTextContent("1 of 2")
  fireEvent.click(screen.getByRole("button", { name: "View details of Zeta" }))
  const sheet = within(screen.getByRole("dialog"))
  expect(sheet.getByText("Discuss architecture")).toBeInTheDocument()
  expect(sheet.getByRole("link", { name: /Prepare/ })).toHaveAttribute("href", "#/interview-prep?q=Zeta")
  fireEvent.click(sheet.getByRole("button", { name: "Close" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole("searchbox", { name: "Search interviews" }), { target: { value: "nothing" } })
  expect(screen.getByText("No matching interviews")).toBeInTheDocument()
})

it("adds an interview by hand", async () => {
  render(<InterviewsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Add interview" }))
  const form = within(screen.getByRole("dialog", { name: "Add interview" }))
  expect(form.getByRole("button", { name: "Save interview" })).toBeDisabled()
  fireEvent.change(form.getByLabelText("Company"), { target: { value: "Acme" } })
  fireEvent.change(form.getByLabelText("Date and time"), { target: { value: "2026-10-20T15:30" } })
  fireEvent.change(form.getByLabelText("Stage"), { target: { value: "final" } })
  fireEvent.change(form.getByLabelText("What to remember"), { target: { value: "Meet the CTO" } })
  fireEvent.click(form.getByRole("button", { name: "Save interview" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("interviews/create", {
    company: "Acme", stage: "final", status: "scheduled", notes: "Meet the CTO", scheduled_at: new Date("2026-10-20T15:30").toISOString(),
  }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(refresh).toHaveBeenCalled()
})

it("edits, completes and deletes an interview from its menu", async () => {
  const row = { id: 3, company: "Acme", scheduled_at: "2026-10-16T12:00:00Z", status: "scheduled", stage: "technical", notes: "" }
  rows = [row]
  render(<InterviewsPage />)
  const menu = () => fireEvent.pointerDown(card("Acme").getByRole("button", { name: "More actions for Acme" }), { button: 0, ctrlKey: false })
  menu()
  fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as done" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("interviews/update", { ...row, status: "done" }))
  menu()
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }))
  const form = within(await screen.findByRole("dialog", { name: "Edit interview" }))
  expect(form.getByLabelText("Company")).toHaveValue("Acme")
  fireEvent.change(form.getByLabelText("Company"), { target: { value: "Acme Labs" } })
  fireEvent.click(form.getByRole("button", { name: "Save interview" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("interviews/update", expect.objectContaining({ id: 3, company: "Acme Labs", stage: "technical" })))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  menu()
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete interview" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("interviews/delete", { id: 3 }))
  vi.mocked(request).mockRejectedValueOnce(new Error("Interview not found."))
  menu()
  fireEvent.click(await screen.findByRole("menuitem", { name: "Close process" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Interview not found.")
})

it("shows an empty calendar and retries failures", () => {
  const instance = render(<InterviewsPage />)
  expect(screen.getByText("A clear calendar")).toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "Next conversation" })).not.toBeInTheDocument()
  vi.mocked(useApi).mockReturnValue({ data: undefined, error: "interviews offline", loading: false, refresh })
  instance.rerender(<InterviewsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})

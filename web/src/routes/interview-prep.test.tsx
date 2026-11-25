import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InterviewPrepPage } from "./interview-prep"
import { request, useApi, useConnection } from "@/lib/api"
import { cancelAgent, clearAgent, runAgent, useAgent } from "@/lib/agent"

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  request: vi.fn(),
  useApi: vi.fn(),
  useConnection: vi.fn(),
}))
vi.mock("@/lib/agent", async (original) => ({
  ...(await original<typeof import("@/lib/agent")>()),
  cancelAgent: vi.fn(),
  clearAgent: vi.fn(),
  runAgent: vi.fn(),
  useAgent: vi.fn(),
}))
vi.mock("@/components/agent-conversation", () => ({
  AgentConversation: ({ messages }: { messages: { text: string }[] }) =>
    <div>{messages.map((message, index) => <p key={index}>{message.text}</p>)}</div>,
}))
vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) => <input aria-label="Date" type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />,
}))
vi.mock("@/components/ui/select-control", () => ({
  SelectControl: (props: React.ComponentProps<"select">) => <select {...props} />,
}))

const providers = {
  default: "alpha",
  providers: [
    { id: "alpha", displayName: "Alpha", models: ["a1"] },
    { id: "beta", displayName: "Beta", models: ["b1"], efforts: ["low", "high"] },
  ],
}
const applications = [
  { id: 4, company_name: "Acme", job_title: "Backend Engineer", tracking_status: "active" },
  { id: 5, company_name: "Old Co", job_title: "Archived role", tracking_status: "archived" },
  { id: 6, company_name: "Globex", job_title: "Platform Engineer", tracking_status: null },
]
const packs = [
  { id: 2, application_id: 4, stage: "Final round", body_md: "## Likely questions\n\n- Why Acme?\n- Biggest outage", scheduled_at: "2026-12-01", format: "Video", interviewers: "Ana, VP", created_at: "2026-11-20" },
  { id: 1, application_id: 6, stage: "Recruiter screen", body_md: "Earlier pack", scheduled_at: null, created_at: "2026-11-10" },
]
const idle = { running: false, status: "Ready", messages: [], draft: null, current: null }
/** Opens the build form from the page header. */
function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "Build pack" }))
  return within(screen.getByRole("dialog", { name: "Build a preparation pack" }))
}
let apps: unknown
let stored: unknown
let research: Record<string, unknown>
const refreshResearch = vi.fn()
beforeEach(() => {
  apps = applications
  stored = packs
  research = { "company-research?company=Acme": { found: true, fresh: true, age_days: 3 } }
  refreshResearch.mockReset()
  vi.mocked(request).mockReset().mockResolvedValue({ removed: true })
  vi.mocked(useApi).mockImplementation((key: string) => ({
    data: key === "applications" ? apps : key === "acp/providers" ? providers : key.startsWith("interview-preps") ? stored : research[key],
    error: "", loading: false, refresh: key.startsWith("company-research") ? refreshResearch : vi.fn(),
  }) as never)
  vi.mocked(useConnection).mockReturnValue(true)
  vi.mocked(useAgent).mockReturnValue(idle as never)
  vi.mocked(runAgent).mockReset().mockResolvedValue(undefined)
  vi.mocked(cancelAgent).mockReset().mockResolvedValue(undefined)
  vi.mocked(clearAgent).mockReset()
})

describe("InterviewPrepPage", () => {
  it("lists open applications only and runs the skill with the filled details", () => {
    render(<InterviewPrepPage />)
    const form = openForm()
    expect(form.getByRole("option", { name: "Acme — Backend Engineer" })).toBeInTheDocument()
    expect(form.getByRole("option", { name: "Globex — Platform Engineer" })).toBeInTheDocument()
    expect(form.queryByRole("option", { name: /Archived role/ })).not.toBeInTheDocument()
    fireEvent.change(form.getByLabelText("Application"), { target: { value: "6" } })
    fireEvent.change(form.getByLabelText("Stage"), { target: { value: "Final round" } })
    fireEvent.change(form.getByLabelText("Date"), { target: { value: "2026-12-01" } })
    fireEvent.change(form.getByLabelText("Format"), { target: { value: "video" } })
    fireEvent.change(form.getByLabelText("Interviewers"), { target: { value: "Ana, VP" } })
    fireEvent.change(form.getByLabelText("Additional context"), { target: { value: "Focus on systems design" } })
    fireEvent.change(form.getByLabelText("Agent"), { target: { value: "beta" } })
    fireEvent.click(form.getByRole("button", { name: "Run agent" }))
    expect(runAgent).toHaveBeenCalledWith(
      "beta",
      "interview-prep",
      { applicationId: "6", stage: "Final round", date: "2026-12-01", format: "video", interviewers: "Ana, VP", extra: "Focus on systems design" },
      undefined,
      undefined,
    )
    // Running closes the form; the progress shows on the page.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("selects the first open application by default and omits empty context", () => {
    render(<InterviewPrepPage />)
    fireEvent.click(openForm().getByRole("button", { name: "Run agent" }))
    expect(vi.mocked(runAgent).mock.calls[0][2]).toMatchObject({ applicationId: "4", stage: "Recruiter screen" })
    expect(vi.mocked(runAgent).mock.calls[0][2]).not.toHaveProperty("extra")
  })

  it("shows every saved pack as a card with its application, filters them and opens one", () => {
    render(<InterviewPrepPage />)
    const cards = screen.getAllByRole("article")
    expect(cards.map(card => card.getAttribute("aria-label"))).toEqual(["Backend Engineer", "Platform Engineer"])
    const latest = within(cards[0])
    expect(latest.getByText("Acme")).toBeInTheDocument()
    expect(latest.getByText("Final round")).toBeInTheDocument()
    expect(latest.getByText("Why Acme? · Biggest outage")).toBeInTheDocument()
    expect(latest.getByText("Ana, VP")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search packs" }), { target: { value: "globex" } })
    expect(screen.getAllByRole("article").map(card => card.getAttribute("aria-label"))).toEqual(["Platform Engineer"])
    fireEvent.change(screen.getByRole("searchbox", { name: "Search packs" }), { target: { value: "" } })
    fireEvent.click(within(screen.getAllByRole("article")[0]).getByRole("button", { name: "Open pack" }))
    const sheet = within(screen.getByRole("dialog", { name: "Backend Engineer · Final round" }))
    expect(sheet.getByRole("heading", { name: "Likely questions" })).toBeInTheDocument()
    fireEvent.click(sheet.getByRole("button", { name: "Build again" }))
    const form = within(screen.getByRole("dialog", { name: "Build a preparation pack" }))
    expect(form.getByLabelText("Application")).toHaveValue("4")
    expect(form.getByLabelText("Stage")).toHaveValue("Final round")
  })

  it("explains when nothing is stored or tracked yet", () => {
    stored = []
    const { unmount } = render(<InterviewPrepPage />)
    expect(screen.getByText("No preparation pack yet")).toBeInTheDocument()
    unmount()
    apps = []
    render(<InterviewPrepPage />)
    expect(screen.getByText("No applications to prepare for")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Build pack" })).toBeDisabled()
  })

  it("does not start while the live connection is missing", () => {
    vi.mocked(useConnection).mockReturnValue(false)
    render(<InterviewPrepPage />)
    const form = openForm()
    expect(form.getByRole("button", { name: "Run agent" })).toBeDisabled()
    expect(form.getByText("Waiting for the live connection before starting a run.")).toBeInTheDocument()
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("shows how old the cached company research is and refreshes it on request", async () => {
    render(<InterviewPrepPage />)
    openForm()
    expect(screen.getByText("Company research cached 3 days ago")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(request).toHaveBeenCalledWith("company-research/invalidate", { company: "Acme" })
    await waitFor(() => expect(refreshResearch).toHaveBeenCalled())
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled()
  })

  it("labels today, one day, expired and unknown ages and follows the selected company", () => {
    research = {
      "company-research?company=Acme": { found: true, fresh: true, age_days: 0 },
      "company-research?company=Globex": { found: true, fresh: false, age_days: 1 },
    }
    render(<InterviewPrepPage />)
    const form = openForm()
    expect(screen.getByText("Company research cached today")).toBeInTheDocument()
    fireEvent.change(form.getByLabelText("Application"), { target: { value: "6" } })
    expect(screen.getByText("Company research cached 1 day ago (expired)")).toBeInTheDocument()
    research["company-research?company=Globex"] = { found: true, fresh: false, age_days: null }
    fireEvent.change(form.getByLabelText("Application"), { target: { value: "4" } })
    fireEvent.change(form.getByLabelText("Application"), { target: { value: "6" } })
    expect(screen.getByText("Company research cached on an unknown date (expired)")).toBeInTheDocument()
  })

  it("stays silent without cached research or company and reports a failed refresh", async () => {
    research = { "company-research?company=Acme": { found: false, fresh: false, age_days: null } }
    const { unmount } = render(<InterviewPrepPage />)
    openForm()
    expect(screen.queryByText(/Company research cached/)).not.toBeInTheDocument()
    unmount()
    apps = [{ id: 8, company_name: null, job_title: "Untitled", tracking_status: "active" }]
    const second = render(<InterviewPrepPage />)
    openForm()
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument()
    second.unmount()
    apps = applications
    research = { "company-research?company=Acme": { found: true, fresh: true, age_days: 5 } }
    vi.mocked(request).mockRejectedValueOnce(new Error("Backend unavailable.")).mockRejectedValueOnce("offline")
    render(<InterviewPrepPage />)
    openForm()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("Backend unavailable.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("offline")).toBeInTheDocument()
    expect(refreshResearch).not.toHaveBeenCalled()
  })

  it("shows the run's progress only for an interview-prep run and cancels it", () => {
    vi.mocked(useAgent).mockReturnValue({ ...idle, running: true, status: "Running", current: { skill: "job-scout", params: {} }, messages: [{ text: "Searching" }] } as never)
    const other = render(<InterviewPrepPage />)
    expect(screen.queryByText("Building your pack")).not.toBeInTheDocument()
    other.unmount()
    vi.mocked(useAgent).mockReturnValue({ ...idle, running: true, status: "Running", current: { skill: "interview-prep", params: {} }, messages: [{ text: "Drafting questions" }] } as never)
    render(<InterviewPrepPage />)
    expect(screen.getByText("Building your pack")).toBeInTheDocument()
    expect(screen.getByText("Drafting questions")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Build pack" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(cancelAgent).toHaveBeenCalled()
  })
})

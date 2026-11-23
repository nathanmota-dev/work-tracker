import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InterviewPrepPage } from "./interview-prep"
import { useApi, useConnection } from "@/lib/api"
import { cancelAgent, clearAgent, runAgent, useAgent } from "@/lib/agent"

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
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
  { id: 2, stage: "Final round", body_md: "## Likely questions\n\nWhy Acme?", scheduled_at: "2026-12-01", created_at: "2026-11-20" },
  { id: 1, stage: "Recruiter screen", body_md: "Earlier pack", scheduled_at: null, created_at: "2026-11-10" },
]
const idle = { running: false, status: "Ready", messages: [], draft: null }
let apps: unknown
let stored: unknown
beforeEach(() => {
  apps = applications
  stored = packs
  vi.mocked(useApi).mockImplementation((key: string) => ({
    data: key === "applications" ? apps : key === "acp/providers" ? providers : key.startsWith("interview-preps") ? stored : undefined,
    error: "", loading: false, refresh: vi.fn(),
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
    expect(screen.getByRole("option", { name: "Acme — Backend Engineer" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Globex — Platform Engineer" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Archived role/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Application"), { target: { value: "6" } })
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "Final round" } })
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-01" } })
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "video" } })
    fireEvent.change(screen.getByLabelText("Interviewers"), { target: { value: "Ana, VP" } })
    fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Focus on systems design" } })
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "beta" } })
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    expect(runAgent).toHaveBeenCalledWith(
      "beta",
      "interview-prep",
      { applicationId: "6", stage: "Final round", date: "2026-12-01", format: "video", interviewers: "Ana, VP", extra: "Focus on systems design" },
      undefined,
      undefined,
    )
  })

  it("selects the first open application by default and omits empty context", () => {
    render(<InterviewPrepPage />)
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    expect(vi.mocked(runAgent).mock.calls[0][2]).toMatchObject({ applicationId: "4", stage: "Recruiter screen" })
    expect(vi.mocked(runAgent).mock.calls[0][2]).not.toHaveProperty("extra")
  })

  it("shows saved packs newest first with the latest expanded", () => {
    render(<InterviewPrepPage />)
    expect(screen.getByText("Final round")).toBeInTheDocument()
    expect(screen.getByText("Recruiter screen", { selector: "summary" })).toBeInTheDocument()
    expect(screen.getByText("Why Acme?")).toBeInTheDocument()
  })

  it("explains when nothing is stored or tracked yet", () => {
    stored = []
    const { unmount } = render(<InterviewPrepPage />)
    expect(screen.getByText("No preparation pack yet")).toBeInTheDocument()
    unmount()
    apps = []
    render(<InterviewPrepPage />)
    expect(screen.getByText("No applications to prepare for")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Run agent" })).not.toBeInTheDocument()
  })

  it("does not start while the live connection is missing", () => {
    vi.mocked(useConnection).mockReturnValue(false)
    render(<InterviewPrepPage />)
    expect(screen.getByRole("button", { name: "Run agent" })).toBeDisabled()
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("cancels a running agent", () => {
    vi.mocked(useAgent).mockReturnValue({ ...idle, running: true, status: "Running" } as never)
    render(<InterviewPrepPage />)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(cancelAgent).toHaveBeenCalled()
  })
})

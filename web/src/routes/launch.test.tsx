import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LaunchPage } from "./launch"
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
    { id: "alpha", displayName: "Alpha", models: ["a1", "a2"] },
    { id: "beta", displayName: "Beta", models: ["b1"], efforts: ["low", "high"] },
  ],
}
const idle = { running: false, status: "Ready", messages: [], draft: null }
beforeEach(() => {
  localStorage.clear()
  vi.mocked(useApi).mockImplementation((key: string) => ({
    data: key === "answers" ? [{ key: "linkedin_username", value: "candidate" }] : providers,
    error: "",
    loading: false,
    refresh: vi.fn(),
  }) as never)
  vi.mocked(useConnection).mockReturnValue(true)
  vi.mocked(useAgent).mockReturnValue(idle as never)
  vi.mocked(runAgent).mockReset().mockResolvedValue(undefined)
  vi.mocked(cancelAgent).mockReset().mockResolvedValue(undefined)
  vi.mocked(clearAgent).mockReset()
})

afterEach(() => localStorage.clear())

const addTag = (label: string, text: string) => {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: "Enter" })
}

describe("LaunchPage", () => {
  it("launches a selected skill with its fields, provider, and optional model", async () => {
    localStorage.setItem("work-tracker-provider", "alpha")
    localStorage.setItem("work-tracker-model", "a2")
    render(<LaunchPage />)
    expect(screen.queryByRole("option", { name: "Tailor your resume" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "job-scout" } })
    addTag("Role, keywords or job URL", "  Staff engineer ")
    addTag("Location", "Remote")
    fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Prefer climate work" } })
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith("alpha", "job-scout", {
      query: "Staff engineer", location: "Remote", extra: "Prefer climate work",
    }, "a2", undefined))
  })

  it("offers effort only for providers that support it and sends the selected level", async () => {
    localStorage.setItem("work-tracker-provider", "beta")
    localStorage.setItem("work-tracker-effort", "high")
    render(<LaunchPage />)
    expect(screen.getByRole("slider", { name: "Effort" })).toHaveAttribute("aria-valuetext", "High")
    fireEvent.keyDown(screen.getByRole("slider", { name: "Effort" }), { key: "ArrowLeft" })
    addTag("Role, keywords or job URL", "Backend")
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith("beta", "job-scout", { query: "Backend" }, undefined, "low"))
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "alpha" } })
    expect(screen.queryByRole("slider", { name: "Effort" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "beta" } })
    expect(screen.getByRole("slider", { name: "Effort" })).toHaveAttribute("aria-valuetext", "Default")
  })

  it("opens Apply for document review before portal filling", async () => {
    render(<LaunchPage />)
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "portal-filler" } })
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    expect(window.location.hash).toBe("#/apply")
    expect(runAgent).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Application URL"), { target: { value: "https://jobs.example/apply" } })
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    expect(window.location.hash).toBe("#/apply")
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("supports disconnected and unavailable provider states and retries loading", () => {
    vi.mocked(useConnection).mockReturnValue(false)
    const view = render(<LaunchPage />)
    expect(screen.getByText("Waiting for the live connection before starting a run.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run agent" })).toBeDisabled()
    vi.mocked(useApi).mockImplementation((key: string) => ({
      data: key === "answers" ? [] : undefined,
      error: "",
      loading: true,
      refresh: vi.fn(),
    }) as never)
    view.rerender(<LaunchPage />)
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading workspace")
    vi.mocked(useApi).mockImplementation((key: string) => ({
      data: key === "answers" ? [] : undefined,
      error: "provider discovery failed",
      loading: false,
      refresh: vi.fn(),
    }) as never)
    view.rerender(<LaunchPage />)
    expect(screen.getByRole("alert")).toHaveTextContent("provider discovery failed")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  })

  it("clears a completed conversation and cancels a running or sign-in-waiting agent", () => {
    vi.mocked(useAgent).mockReturnValue({ ...idle, messages: [{ id: "1", role: "agent", text: "Done" }] } as never)
    const view = render(<LaunchPage />)
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(clearAgent).toHaveBeenCalledOnce()
    vi.mocked(useAgent).mockReturnValue({ ...idle, running: true, status: "Running" } as never)
    view.rerender(<LaunchPage />)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(cancelAgent).toHaveBeenCalledOnce()
    vi.mocked(useAgent).mockReturnValue({ ...idle, status: "Waiting for sign-in" } as never)
    view.rerender(<LaunchPage />)
    expect(screen.getByRole("button", { name: "Retry after sign-in" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(cancelAgent).toHaveBeenCalledTimes(2)
  })

  it("restores role and location from the last search of each skill", async () => {
    const first = render(<LaunchPage />)
    addTag("Role, keywords or job URL", "Backend engineer")
    addTag("Location", "Brazil")
    fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Remote only" } })
    first.unmount()
    render(<LaunchPage />)
    expect(screen.getByText("Backend engineer")).toBeInTheDocument()
    expect(screen.getByText("Brazil")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove Brazil" }))
    fireEvent.click(screen.getByRole("button", { name: "Run agent" }))
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith("alpha", "job-scout", { query: "Backend engineer", extra: "Remote only" }, undefined, undefined))
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "recruiter-outreach" } })
    expect(screen.getByLabelText("Location")).toHaveValue("")
  })
})

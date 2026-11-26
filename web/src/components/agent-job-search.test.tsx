import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AgentJobSearch } from "./agent-job-search"
import { dismissAgentCompletion, prepareSkill, runAgent } from "@/lib/agent"
import { readSkillInputs, resetSkillInputsCache } from "@/lib/skill-inputs"
vi.mock("@/components/get-started", () => ({ SetupNotice: () => null }))
vi.mock("@/components/agent-panel", async (original) => ({
  ...await original<typeof import("@/components/agent-panel")>(),
  AgentExecution: ({ fill }: { fill?: boolean }) => <div>{fill ? "Filled agent workspace" : "Agent workspace"}</div>,
}))
const state = vi.hoisted(() => ({ agent: { running: false, completion: null as null | { id: number; skill: string }, jobOutcomes: [] as unknown[] } }))
vi.mock("@/lib/agent", async (original) => ({ ...await original<typeof import("@/lib/agent")>(), prepareSkill: vi.fn(), runAgent: vi.fn(), dismissAgentCompletion: vi.fn(), useAgent: () => state.agent }))
const request = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetSkillInputsCache()
  state.agent = { running: false, completion: null, jobOutcomes: [] }
  request.mockImplementation(async (path: string) => path === "answers" ? []
    : path === "acp/providers" ? { default: "opencode", providers: [{ id: "opencode", displayName: "OpenCode", models: [] }, { id: "claude-code", displayName: "Claude Code", models: ["sonnet"] }] }
    : { ok: true })
  window.desktop = { request, connectionStatus: async () => true, onEvent: () => () => {}, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), getVersion: async () => "1", openExternal: vi.fn() }
})
const addTag = (label: string, value: string) => {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: "Enter" })
}

it("runs the agent in place with the saved criteria and the default agent, and handles its completion once", async () => {
  localStorage.setItem("work-tracker-provider", "claude-code")
  localStorage.setItem("work-tracker-model", "sonnet")
  const complete = vi.fn()
  const view = render(<AgentJobSearch onResults={complete} />)
  expect(screen.getByText("Filled agent workspace")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Find jobs with agent" })).toBeDisabled()
  addTag("Roles", "Software Engineer")
  addTag("Location", "Remote")
  // Every criterion is needed before the run can start.
  expect(await screen.findByText(/Runs with Claude Code · sonnet/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Find jobs with agent" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Junior roles only" } })
  await waitFor(() => expect(screen.getByRole("button", { name: "Find jobs with agent" })).toBeEnabled())
  expect(screen.getByText(/Runs with Claude Code · sonnet/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Find jobs with agent" }))
  // No side panel: the run starts here, without a page limit.
  expect(prepareSkill).not.toHaveBeenCalled()
  expect(runAgent).toHaveBeenCalledWith("claude-code", "job-scout", {
    query: "Software Engineer", location: "Remote", extra: expect.stringMatching(/^Junior roles only\n\nSave discovered jobs for triage/),
  }, "sonnet", undefined)
  expect(readSkillInputs("job-scout")).toEqual({ query: "Software Engineer", location: "Remote", extra: "Junior roles only" })
  expect(screen.queryByLabelText("Pages to search")).not.toBeInTheDocument()
  state.agent = { running: false, completion: { id: 1, skill: "job-scout" }, jobOutcomes: [{ key: "1", status: "saved", job: { id: 1, title: "Engineer" } }, { key: "2", status: "existing", job: { id: 2, title: "Existing" } }] }
  view.rerender(<AgentJobSearch onResults={complete} />)
  expect(screen.getByText("1 saved · 1 already saved · 0 failed")).toBeInTheDocument()
  expect(complete).toHaveBeenCalledExactlyOnceWith([1], state.agent.jobOutcomes)
  expect(dismissAgentCompletion).toHaveBeenCalledOnce()
  view.rerender(<AgentJobSearch onResults={complete} />)
  expect(complete).toHaveBeenCalledTimes(1)
})

it("restores the last criteria and stays disabled while the agent runs", () => {
  localStorage.setItem("work-tracker-skill-inputs-v1:job-scout", JSON.stringify({ query: "Back-End", location: "São Paulo", extra: "Brazil only" }))
  state.agent = { ...state.agent, running: true }
  render(<AgentJobSearch onResults={vi.fn()} />)
  expect(screen.getByText("Back-End")).toBeInTheDocument()
  expect(screen.getByText("São Paulo")).toBeInTheDocument()
  expect(screen.getByLabelText("Additional context")).toHaveValue("Brazil only")
  expect(screen.getByRole("button", { name: "Agent is running…" })).toBeDisabled()
  expect(screen.getByRole("link", { name: "Change in Agent setup" })).toHaveAttribute("href", "#/launch?tab=setup")
})

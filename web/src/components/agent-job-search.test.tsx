import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AgentJobSearch } from "./agent-job-search"
import { prepareSkill } from "@/lib/agent"
import { readSkillInputs, resetSkillInputsCache } from "@/lib/skill-inputs"
vi.mock("@/components/get-started", () => ({ SetupNotice: () => null }))

const state = vi.hoisted(() => ({ agent: { running: false, completion: null as null | { id: number; skill: string }, jobOutcomes: [] as unknown[] } }))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn(), useAgent: () => state.agent }))
const request = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetSkillInputsCache()
  state.agent = { running: false, completion: null, jobOutcomes: [] }
  request.mockImplementation(async (path: string) => path === "answers" ? [] : { ok: true })
  window.desktop = { request, connectionStatus: async () => true, onEvent: () => () => {}, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), getVersion: async () => "1", openExternal: vi.fn() }
})
const addTag = (label: string, value: string) => {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: "Enter" })
}

it("opens the agent with the saved criteria and handles its completion once", () => {
  const complete = vi.fn()
  const view = render(<AgentJobSearch onResults={complete} />)
  expect(screen.getByRole("button", { name: "Find jobs with agent" })).toBeDisabled()
  addTag("Roles", "Software Engineer")
  addTag("Location", "Remote")
  fireEvent.change(screen.getByLabelText("Additional context"), { target: { value: "Junior roles only" } })
  fireEvent.click(screen.getByRole("button", { name: "Find jobs with agent" }))
  // The panel reads role, location and context from the same saved inputs; no page limit applies.
  expect(prepareSkill).toHaveBeenCalledWith("job-scout", { instructions: expect.stringContaining("Save discovered jobs for triage") })
  expect(readSkillInputs("job-scout")).toEqual({ query: "Software Engineer", location: "Remote", extra: "Junior roles only" })
  expect(screen.queryByLabelText("Pages to search")).not.toBeInTheDocument()
  state.agent = { running: false, completion: { id: 1, skill: "job-scout" }, jobOutcomes: [{ key: "1", status: "saved", job: { id: 1, title: "Engineer" } }, { key: "2", status: "existing", job: { id: 2, title: "Existing" } }] }
  view.rerender(<AgentJobSearch onResults={complete} />)
  expect(screen.getByText("1 saved · 1 already saved · 0 failed")).toBeInTheDocument()
  expect(complete).toHaveBeenCalledExactlyOnceWith([1], state.agent.jobOutcomes)
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
  expect(screen.getByRole("button", { name: "Find jobs with agent" })).toBeDisabled()
})

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobDiscovery } from "./job-discovery"
import { readSkillInputs, resetSkillInputsCache } from "@/lib/skill-inputs"
import { LINKEDIN_SEARCH } from "./job-discovery"
// The Get started checklist and the integration notices read their own status; these flows cover other requests.
vi.mock("@/components/get-started", () => ({ NextStepHint: ({ fallback }: { fallback?: string }) => <>{fallback}</> }))
vi.mock("@/components/integration-notice", () => ({ IntegrationNotice: () => null }))

const state = vi.hoisted(() => ({ agent: { completion: null as null | { id: number; skill: string }, jobOutcomes: [] as unknown[] } }))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn(), useAgent: () => state.agent }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: (props: React.ComponentProps<"select">) => <select {...props} /> }))
const request = vi.fn()
// Answers load for the shared job search criteria; other requests take the queued replies in order.
let replies: (() => unknown)[] = []
const reply = (value: unknown) => replies.push(() => value)
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetSkillInputsCache()
  replies = []
  request.mockImplementation(async (path: string) => path === "answers" ? [] : replies.shift()?.())
  state.agent = { completion: null, jobOutcomes: [] }
  window.desktop = { request, connectionStatus: async () => true, onEvent: () => () => {}, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), getVersion: async () => "1", openExternal: vi.fn() }
})
const enter = () => {
  fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: " React " } })
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Brazil" } })
  fireEvent.change(screen.getByLabelText("Work arrangement"), { target: { value: "remote" } })
  fireEvent.change(screen.getByLabelText("Pages to search"), { target: { value: "2" } })
}
it("searches and saves all results, reports each outcome and highlights only new jobs", async () => {
  reply({ jobs: [{ title: "New", company: "Acme" }, { title: "Old", company: "Acme" }, {}] })
  reply({ results: [{ key: "0", status: "saved", job: { id: 1, title: "New" } }, { key: "1", status: "existing", job: { id: 2, title: "Old", archived_at: "date" } }, { key: "2", status: "failed", error: "Missing title" }] })
  const complete = vi.fn()
  render(<JobDiscovery onResults={complete} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByText("1 saved · 1 already saved · 1 failed")).toBeInTheDocument()
  expect(screen.getByText("Old: Already saved (archived)")).toBeInTheDocument()
  expect(screen.getByText(/Failed — Missing title/)).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith("search/jobs", expect.objectContaining({ keywords: "React", location: "Brazil", workType: "remote", maxPages: 2 }))
  // The new IDs and every outcome, so Jobs can highlight new cards and keep the summary.
  expect(complete).toHaveBeenCalledWith([1], expect.arrayContaining([expect.objectContaining({ status: "failed", error: "Missing title" })]))
})
it("keeps an explanation on screen when a search has nothing to save", async () => {
  reply("React Engineer at Example Company")
  const complete = vi.fn()
  render(<JobDiscovery onResults={complete} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByText(/No savable results/)).toHaveTextContent("React Engineer at Example Company")
  expect(complete).not.toHaveBeenCalled()
})
it("keeps errors retryable and displays unstructured output", async () => {
  replies.push(() => { throw new Error("Offline") })
  reply("No matching jobs")
  render(<JobDiscovery onResults={vi.fn()} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline")
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByText("No savable results. No matching jobs")).toBeInTheDocument()
})
it("disables duplicate requests until search settles", async () => {
  let resolve!: (value: unknown) => void
  replies.push(() => new Promise(done => { resolve = done }))
  render(<JobDiscovery onResults={vi.fn()} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(screen.getByRole("button", { name: "Searching LinkedIn…" })).toBeDisabled()
  await act(async () => resolve([]))
  await waitFor(() => expect(screen.getByRole("button", { name: "Search LinkedIn" })).toBeEnabled())
})
it("restores the last search criteria after leaving the screen", async () => {
  const first = render(<JobDiscovery onResults={vi.fn()} />)
  enter()
  first.unmount()
  resetSkillInputsCache()
  render(<JobDiscovery onResults={vi.fn()} />)
  expect(screen.getByText("Brazil")).toBeInTheDocument()
  // The direct search keeps its own criteria, apart from the agent's job search.
  expect(readSkillInputs(LINKEDIN_SEARCH)).toMatchObject({ location: "Brazil", workType: "remote", maxPages: "2" })
  expect(readSkillInputs("job-scout")).toEqual({})
  expect(screen.getByLabelText("Work arrangement")).toHaveValue("remote")
  expect(screen.getByLabelText("Pages to search")).toHaveValue(2)
})

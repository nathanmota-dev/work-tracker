import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { JobDiscovery } from "./job-discovery"
import { prepareSkill } from "@/lib/agent"

const state = vi.hoisted(() => ({ agent: { completion: null as null | { id: number; skill: string }, jobOutcomes: [] as unknown[] } }))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn(), useAgent: () => state.agent }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: (props: React.ComponentProps<"select">) => <select {...props} /> }))
const request = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
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
  request.mockResolvedValueOnce({ jobs: [{ title: "New", company: "Acme" }, { title: "Old", company: "Acme" }, {}] })
    .mockResolvedValueOnce({ results: [{ key: "0", status: "saved", job: { id: 1, title: "New" } }, { key: "1", status: "existing", job: { id: 2, title: "Old", archived_at: "date" } }, { key: "2", status: "failed", error: "Missing title" }] })
  const complete = vi.fn()
  render(<JobDiscovery onResults={complete} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByText("1 saved · 1 already saved · 1 failed")).toBeInTheDocument()
  expect(screen.getByText("Old: Already saved (archived)")).toBeInTheDocument()
  expect(screen.getByText(/Failed — Missing title/)).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith("search/jobs", expect.objectContaining({ keywords: "React", location: "Brazil", workType: "remote", maxPages: 2 }))
  expect(complete).toHaveBeenCalledWith([1])
})
it("passes the same criteria to the panel and handles its completion once", async () => {
  const complete = vi.fn()
  const view = render(<JobDiscovery onResults={complete} />)
  enter()
  fireEvent.click(screen.getByLabelText("Assess fit with agent"))
  fireEvent.click(screen.getByRole("button", { name: "Search with agent" }))
  expect(prepareSkill).toHaveBeenCalledWith("job-scout", expect.objectContaining({ query: "React", location: "Brazil", extra: expect.stringContaining("Work arrangement: remote. Pages to search: 2.") }))
  expect(request).not.toHaveBeenCalled()
  state.agent = { completion: { id: 1, skill: "job-scout" }, jobOutcomes: [{ key: "1", status: "saved", job: { id: 1, title: "Engineer" } }, { key: "2", status: "existing", job: { id: 2, title: "Existing" } }] }
  view.rerender(<JobDiscovery onResults={complete} />)
  expect(await screen.findByText("1 saved · 1 already saved · 0 failed")).toBeInTheDocument()
  expect(complete).toHaveBeenCalledExactlyOnceWith([1])
  view.rerender(<JobDiscovery onResults={complete} />)
  expect(complete).toHaveBeenCalledTimes(1)
})
it("keeps errors retryable and displays unstructured output", async () => {
  request.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce("No matching jobs")
  render(<JobDiscovery onResults={vi.fn()} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline")
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findByText("No savable results. No matching jobs")).toBeInTheDocument()
})
it("disables duplicate requests until search settles", async () => {
  let resolve!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<JobDiscovery onResults={vi.fn()} />)
  enter()
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(screen.getByRole("button", { name: "Searching LinkedIn…" })).toBeDisabled()
  await act(async () => resolve([]))
  await waitFor(() => expect(screen.getByRole("button", { name: "Search LinkedIn" })).toBeEnabled())
})

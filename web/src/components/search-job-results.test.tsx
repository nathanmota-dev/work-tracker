import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { SearchPage } from "@/routes/search"
import { prepareSkill } from "@/lib/agent"
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn() }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: (props: React.ComponentProps<"select">) => <select {...props} /> }))
const request = vi.fn()
const jobs = [
  { job_id: 42, job_title: "Engineer", company: "Synthetic", location: "Remote" },
  { id: 43, title: "Designer", company_name: "Synthetic", url: "https://example.test/43" },
  { id: 43, title: "Incomplete", url: "https://example.test/invalid" },
]
beforeEach(() => {
  request.mockReset()
  vi.mocked(prepareSkill).mockClear()
  window.desktop = { request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(), connectionStatus: async () => true, getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {} }
})
async function search(result: unknown = jobs) {
  request.mockResolvedValueOnce(result)
  render(<SearchPage />)
  fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "Engineer" } })
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Remote" } })
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
}
it("saves one job without Launch/ACP and keeps assessment separate and saved-job access available", async () => {
  await search()
  request.mockResolvedValueOnce({ results: [{ key: "0", status: "saved", job: { id: 7, title: "Saved engineer", link: "https://example.test/7" } }] })
  fireEvent.click(await screen.findByRole("button", { name: "Save Engineer" }))
  fireEvent.click(await screen.findByRole("button", { name: "View saved job #7" }))
  expect(await screen.findByRole("dialog")).toHaveTextContent("Saved engineer")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  expect(request).toHaveBeenCalledWith("jobs/save-search", { items: [{ key: "0", result: jobs[0] }] })
  expect(prepareSkill).not.toHaveBeenCalled()
  expect(request.mock.calls.every(([path]) => !String(path).startsWith("acp/"))).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "View Engineer" }))
  fireEvent.click(screen.getByRole("button", { name: "Assess fit with agent" }))
  expect(prepareSkill).toHaveBeenCalledOnce()
})
it("preserves selection, criteria and local filters across mixed results, retry and transport errors", async () => {
  await search()
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Engineer" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer" }))
  fireEvent.click(screen.getByRole("button", { name: /Select all savable results/ }))
  expect(screen.getByRole("checkbox", { name: "Select Incomplete" })).toBeDisabled()
  request.mockResolvedValueOnce({ results: [{ key: "0", status: "existing", job: { id: 7 } }, { key: "1", status: "failed", error: "Write failed" }] })
  fireEvent.click(screen.getByRole("button", { name: "Save selected" }))
  expect(await screen.findByText("Failed: Write failed")).toBeInTheDocument()
  expect(screen.getByText("0 saved · 1 already saved · 1 failed")).toBeInTheDocument()
  expect(screen.getByLabelText("Keywords")).toHaveValue("Engineer")
  expect(screen.getByLabelText("Location")).toHaveValue("Remote")
  expect(screen.getByRole("checkbox", { name: "Select Engineer" })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "Select Designer" })).toBeChecked()
  fireEvent.change(screen.getByLabelText("Search Search results"), { target: { value: "Designer" } })
  request.mockRejectedValueOnce(new Error("Transport failed"))
  fireEvent.click(screen.getByRole("button", { name: "Save selected" }))
  expect(await screen.findByText("Failed: Transport failed")).toBeInTheDocument()
  expect(screen.getByLabelText("Search Search results")).toHaveValue("Designer")
  expect(screen.queryByRole("button", { name: "Save Engineer" })).not.toBeInTheDocument()
  expect(screen.getByText("0 saved · 0 already saved · 2 failed")).toBeInTheDocument()
  request.mockResolvedValueOnce({ results: [{ key: "0", status: "existing", job: { id: 7 } }, { key: "1", status: "saved", job: { id: 8 } }] })
  fireEvent.click(screen.getByRole("button", { name: "Save selected" }))
  expect(await screen.findByText("1 saved · 1 already saved · 0 failed")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
  expect(screen.getByRole("button", { name: "Save selected" })).toBeDisabled()
  expect(prepareSkill).not.toHaveBeenCalled()
})
it("shows prose and invalid items as not savable without guessing job fields", async () => {
  await search({ raw: "Engineer at Synthetic https://example.test/job" })
  expect(await screen.findByText(/Not savable — open manually/)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Save selected" })).not.toBeInTheDocument()
  request.mockResolvedValueOnce([null, "Unstructured", { title: "Only title" }])
  fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
  expect(await screen.findAllByText(/Not savable — open manually/)).toHaveLength(3)
  expect(within(screen.getByRole("table")).getAllByRole("checkbox").every(box => box.hasAttribute("disabled"))).toBe(true)
})

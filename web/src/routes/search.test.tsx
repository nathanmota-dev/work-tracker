import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SearchPage, searchRows } from "./search"
import { prepareSkill } from "@/lib/agent"

vi.mock("@/lib/agent", async (original) => ({
  ...(await original<typeof import("@/lib/agent")>()),
  prepareSkill: vi.fn(),
}))
vi.mock("@/components/ui/select-control", () => ({
  SelectControl: (props: React.ComponentProps<"select">) => <select {...props} />,
}))
const request = vi.fn()
beforeEach(() => {
  request.mockReset()
  vi.mocked(prepareSkill).mockReset()
  window.desktop = {
    request,
    readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(),
    connectionStatus: async () => true, getVersion: async () => "1",
    openExternal: vi.fn(), onEvent: () => () => {},
  }
})

describe("searchRows", () => {
  it("accepts arrays and unwraps supported nested response envelopes", () => {
    expect(searchRows([null, 2, { title: "Direct" }])).toEqual([{ title: "Direct" }])
    for (const key of ["jobs", "people", "results", "data", "items", "elements"]) {
      expect(searchRows({ [key]: [{ title: key }] })).toEqual([{ title: key }])
    }
    expect(searchRows({ structuredContent: { data: [{ id: 1 }] } })).toEqual([{ id: 1 }])
  })

  it("continues through empty envelopes and malformed text blocks", () => {
    expect(searchRows({ jobs: [], content: [
      { text: "not json" },
      { text: JSON.stringify({ results: [{ id: "ok" }] }) },
    ] })).toEqual([{ id: "ok" }])
    expect(searchRows(null)).toEqual([])
    expect(searchRows("unstructured")).toEqual([])
    expect(searchRows({})).toEqual([])
  })
})

describe("SearchPage", () => {
  it("submits trimmed job criteria and shows returned results", async () => {
    request.mockResolvedValue({ jobs: [{ job_id: 42, job_title: "Platform Engineer", company: "Northwind", location: "Remote" }] })
    render(<SearchPage />)
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "  Platform  " } })
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Remote" } })
    fireEvent.change(screen.getByLabelText("Work arrangement"), { target: { value: "remote" } })
    fireEvent.change(screen.getByLabelText("Pages to search"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    expect(await screen.findByText("Platform Engineer")).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith("search/jobs", {
      keywords: "Platform", location: "Remote", workType: "remote", maxPages: 3,
    })
  })

  it("loads full job details, reports detail errors, and prepares an assessment", async () => {
    request.mockResolvedValueOnce([{ id: 8, title: "Designer", url: "https://jobs.example/8" }])
      .mockResolvedValueOnce({ content: [{ text: "Full role description" }] })
      .mockRejectedValueOnce(new Error("Details unavailable"))
    render(<SearchPage />)
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "Designer" } })
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    fireEvent.click(await screen.findByRole("button", { name: "View Designer" }))
    fireEvent.click(screen.getByRole("button", { name: "Full details" }))
    expect(await screen.findByText("Full role description")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Full details" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("search/job-details", { jobId: "8" }))
    expect(await screen.findByRole("dialog")).toHaveTextContent("Details unavailable")
    fireEvent.click(screen.getByRole("button", { name: "Assess & save with agent" }))
    expect(prepareSkill).toHaveBeenCalledWith("deep-scout", { query: "https://jobs.example/8" })
  })

  it("renders readable empty output, handles errors, and supports people results", async () => {
    request.mockResolvedValueOnce({ content: [{ text: "No matching profiles" }] })
    render(<SearchPage />)
    fireEvent.click(screen.getByRole("button", { name: "People & recruiters" }))
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "Recruiter" } })
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    expect(await screen.findByText("No matching profiles")).toBeInTheDocument()
    request.mockRejectedValueOnce(new Error("LinkedIn unavailable"))
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("LinkedIn unavailable")
  })

  it("displays empty results and omits detail actions without a job ID", async () => {
    request.mockResolvedValueOnce([])
    render(<SearchPage />)
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "Anything" } })
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    expect(await screen.findByText("No results found")).toBeInTheDocument()
    request.mockResolvedValueOnce([{ title: "Unidentified role" }])
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    fireEvent.click(await screen.findByRole("button", { name: "View Unidentified role" }))
    expect(screen.getByRole("button", { name: "Full details" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Assess & save with agent" })).toBeInTheDocument()
  })
})

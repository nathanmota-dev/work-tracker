import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AnswersPage } from "@/routes/answers"
import { JobsPage } from "@/routes/jobs"
import { SearchPage, searchRows } from "@/routes/search"
import { publish, useApi } from "@/lib/api"
import { Records } from "@/components/records"
const request = vi.fn()
beforeEach(() => {
  request.mockReset()
  window.desktop = {
    request,
    readPdf: vi.fn(),
    savePdf: vi.fn(),
    chooseSource: vi.fn(),
    connectionStatus: async () => true,
    getVersion: async () => "1",
    openExternal: vi.fn(),
    onEvent: () => () => {},
  }
})
describe("workspace API flows", () => {
  it("loads real job records, filters them and opens details", async () => {
    request.mockResolvedValue([
      {
        id: 1,
        title: "Frontend Engineer",
        company_name: "Acme",
        status: "saved",
      },
      { id: 2, title: "Designer", company_name: "Other", status: "saved" },
    ])
    render(<JobsPage />)
    expect(await screen.findByText("Frontend Engineer")).toBeInTheDocument()
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search Opportunities" }),
      { target: { value: "Acme" } },
    )
    expect(screen.queryByText("Designer")).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "View Frontend Engineer" }),
    )
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith("jobs", undefined)
  })
  it("keeps failed answer edits open and persists a successful retry", async () => {
    request.mockImplementation(async (path: string, body?: unknown) => {
      if (path === "answers")
        return [{ key: "name", value: "Old", category: "personal" }]
      if ((body as { value: string }).value === "Fail")
        throw new Error("Save failed")
      return { ok: true }
    })
    render(<AnswersPage />)
    fireEvent.click(await screen.findByRole("button", { name: "View name" }))
    fireEvent.change(screen.getByLabelText("Answer"), {
      target: { value: "Fail" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Answer"), {
      target: { value: "New" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
    expect(request).toHaveBeenCalledWith("answer", {
      key: "name",
      value: "New",
      category: "personal",
    })
  })
  it("refreshes data on backend change events", async () => {
    request.mockResolvedValueOnce("before").mockResolvedValue("after")
    function View() {
      const api = useApi<string>("profile")
      return <p>{api.data}</p>
    }
    render(<View />)
    expect(await screen.findByText("before")).toBeInTheDocument()
    publish({ type: "changed", table: "profile" })
    expect(await screen.findByText("after")).toBeInTheDocument()
  })
  it("shows connection errors and allows retry", async () => {
    request
      .mockRejectedValueOnce(new Error("Backend unavailable"))
      .mockResolvedValue([])
    render(<JobsPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backend unavailable",
    )
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("No opportunities yet")).toBeInTheDocument()
  })
  it("submits people searches to the matching endpoint", async () => {
    request.mockResolvedValue({
      people: [{ name: "Recruiter Example", headline: "Talent" }],
    })
    render(<SearchPage />)
    fireEvent.click(screen.getByRole("button", { name: "People & recruiters" }))
    fireEvent.change(screen.getByLabelText("Keywords"), {
      target: { value: "Engineer" },
    })
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Acme" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Search LinkedIn" }))
    expect(await screen.findByText("Recruiter Example")).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith("search/people", {
      keywords: "Engineer",
      company: "Acme",
      location: "",
    })
  })
  it("paginates records and resets the page when filtering", () => {
    render(
      <Records
        rows={Array.from({ length: 20 }, (_, id) => ({
          id,
          title: `Role ${id}`,
        }))}
        columns={[{ key: "title", label: "Role" }]}
        noun="Jobs"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Role 19")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: "Search Jobs" }), {
      target: { value: "Role 0" },
    })
    expect(screen.getByText("Role 0")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
  })
  it("normalizes MCP text and structured search results", () => {
    expect(
      searchRows({
        content: [{ type: "text", text: '{"jobs":[{"title":"Engineer"}]}' }],
      }),
    ).toEqual([{ title: "Engineer" }])
    expect(
      searchRows({ structuredContent: { people: [{ name: "A" }] } }),
    ).toEqual([{ name: "A" }])
    expect(
      searchRows({ content: [{ type: "text", text: "No results" }] }),
    ).toEqual([])
  })
})

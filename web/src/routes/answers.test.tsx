import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AnswersPage } from "./answers"
import { publish, useApi } from "@/lib/api"

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
  publish: vi.fn(),
}))
const request = vi.fn()
const refresh = vi.fn()
let rows: { key: string; value: string; category?: string }[]
beforeEach(() => {
  rows = [{ key: "name", value: "Taylor", category: "personal" }]
  request.mockReset()
  refresh.mockReset()
  vi.mocked(publish).mockReset()
  vi.mocked(useApi).mockReturnValue({ data: rows, error: "", loading: false, refresh })
  window.desktop = {
    request,
    readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(),
    connectionStatus: async () => true, getVersion: async () => "1",
    openExternal: vi.fn(), onEvent: () => () => {},
  }
})

describe("AnswersPage", () => {
  it("prevents duplicate keys, cancels a draft, and saves a custom answer", async () => {
    request.mockResolvedValue({ ok: true })
    render(<AnswersPage />)
    fireEvent.click(screen.getByRole("button", { name: "Add answer" }))
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: " name " } })
    expect(screen.getByText("This key already exists. Open the saved answer to edit it.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Add answer" }))
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "  portfolio " } })
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "  " } })
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "https://example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("answer", {
      key: "portfolio", value: "https://example.test", category: "custom",
    }))
    expect(publish).toHaveBeenCalledWith({ type: "changed" })
    expect(await screen.findByRole("status")).toHaveTextContent("Answer saved.")
  })

  it("keeps a failed new answer open and permits retry after an error", async () => {
    request.mockRejectedValueOnce(new Error("Could not save" )).mockResolvedValueOnce({ ok: true })
    render(<AnswersPage />)
    fireEvent.click(screen.getByRole("button", { name: "Add answer" }))
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "city" } })
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Lisbon" } })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(request).toHaveBeenLastCalledWith("answer", { key: "city", value: "Lisbon", category: "custom" })
  })

  it("edits existing answers and uses the fallback category when absent", async () => {
    rows = [{ key: "preferred_name", value: "T", category: undefined }]
    vi.mocked(useApi).mockReturnValue({ data: rows, error: "", loading: false, refresh })
    request.mockResolvedValue({ ok: true })
    render(<AnswersPage />)
    fireEvent.click(screen.getByRole("button", { name: "View preferred_name" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit answer")
    expect(screen.getByLabelText("Field key")).toBeDisabled()
    expect(screen.getByLabelText("Category")).toHaveValue("custom")
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Tay" } })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("answer", {
      key: "preferred_name", value: "Tay", category: "custom",
    }))
  })
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AnswersPage } from "./answers"
import { publish, useApi } from "@/lib/api"
import { useWorkspaceState } from "@/lib/workspace-state"

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
  publish: vi.fn(),
}))
vi.mock("@/lib/workspace-state", () => ({ useWorkspaceState: vi.fn() }))
const route = { search: {} as Record<string, string>, update: vi.fn() }
const request = vi.fn()
const refresh = vi.fn()
let rows: { key: string; value: string; category?: string }[]
beforeEach(() => {
  rows = [{ key: "name", value: "Taylor", category: "personal" }]
  request.mockReset()
  refresh.mockReset()
  vi.mocked(publish).mockReset()
  route.search = {}; route.update.mockReset()
  vi.mocked(useWorkspaceState).mockImplementation(() => route as unknown as ReturnType<typeof useWorkspaceState>)
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
    fireEvent.click(screen.getByLabelText("Advanced mode"))
    fireEvent.click(screen.getByRole("button", { name: "Add answer" }))
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: " name " } })
    expect(screen.getByText("This key and language already exist. Open the saved answer to edit it.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Add answer" }))
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "  portfolio " } })
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "  " } })
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "https://example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("answer", {
      key: "portfolio", value: "https://example.test", category: "custom", language: "default",
    }))
    expect(publish).toHaveBeenCalledWith({ type: "changed" })
    expect(await screen.findByRole("status")).toHaveTextContent("Answer saved.")
  })

  it("keeps a failed new answer open and permits retry after an error", async () => {
    request.mockRejectedValueOnce(new Error("Could not save" )).mockResolvedValueOnce({ ok: true })
    render(<AnswersPage />)
    fireEvent.click(screen.getByLabelText("Advanced mode"))
    fireEvent.click(screen.getByRole("button", { name: "Add answer" }))
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "city" } })
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Lisbon" } })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(request).toHaveBeenLastCalledWith("answer", { key: "city", value: "Lisbon", category: "custom", language: "default" })
  })

  it("edits existing answers and uses the fallback category when absent", async () => {
    rows = [{ key: "preferred_name", value: "T", category: undefined }]
    vi.mocked(useApi).mockReturnValue({ data: rows, error: "", loading: false, refresh })
    request.mockResolvedValue({ ok: true })
    render(<AnswersPage />)
    fireEvent.click(screen.getByLabelText("Advanced mode"))
    fireEvent.click(screen.getByRole("button", { name: "View preferred_name" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit answer")
    expect(screen.getByLabelText("Field key")).toBeDisabled()
    expect(screen.getByLabelText("Category")).toHaveValue("custom")
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Tay" } })
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("answer", {
      key: "preferred_name", value: "Tay", category: "custom", language: "default",
    }))
  })
})

it("offers friendly fields, missing required answers, validation and explicit language fallback", async () => {
  rows = [{ key: "notice_period", value: "Two weeks", category: "eligibility" }]
  vi.mocked(useApi).mockReturnValue({ data: rows, error: "", loading: false, refresh })
  request.mockResolvedValue({ ok: true })
  render(<AnswersPage />)
  expect(screen.getAllByText("Required answer missing — add it")).toHaveLength(3)
  fireEvent.change(screen.getByLabelText("Requested language"), { target: { value: "pt-BR" } })
  fireEvent.change(screen.getByLabelText("Explicit fallback language (optional)"), { target: { value: "default" } })
  expect(screen.getByText("Using explicit fallback: default")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /Email · Required/ }))
  expect(screen.queryByLabelText("Field key")).not.toBeInTheDocument()
  expect(screen.getByLabelText("Field")).toHaveValue("email")
  fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "invalid" } })
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email")
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "fixture@example.test" } })
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("answer", { key: "email", value: "fixture@example.test", category: "contact", language: "pt-BR" }))
})

it("creates variants, guards duplicate languages and preserves the draft after deletion failure", async () => {
  rows = [{ key: "notice_period", value: "Two weeks", category: "eligibility" }]
  vi.mocked(useApi).mockReturnValue({ data: rows, error: "", loading: false, refresh })
  render(<AnswersPage />)
  fireEvent.click(screen.getByRole("button", { name: "View Notice period" }))
  fireEvent.click(screen.getByRole("button", { name: "Add language variant" }))
  expect(screen.getByRole("alert")).toHaveTextContent("language tag")
  fireEvent.change(screen.getByLabelText("Language"), { target: { value: "default" } })
  expect(screen.getByText(/This key and language already exist/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Language"), { target: { value: "pt-br" } })
  fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Duas semanas" } })
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("answer", { key: "notice_period", value: "Duas semanas", category: "eligibility", language: "pt-BR" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "View Notice period" }))
  request.mockRejectedValueOnce(new Error("Could not delete; retry")).mockResolvedValueOnce({ ok: true })
  fireEvent.click(screen.getByRole("button", { name: "Delete answer" }))
  expect(request).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete; retry")
  expect(screen.getByLabelText("Answer")).toHaveValue("Two weeks")
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Answer deleted")
  expect(request).toHaveBeenLastCalledWith("answer/delete", { key: "notice_period", language: "default" })
})

it("shows human review instructions and actionable invalid language and legacy values", () => {
  vi.mocked(useApi).mockReturnValue({ data: [{ key: "email", value: "bad" }], error: "", loading: false, refresh })
  render(<AnswersPage />)
  expect(screen.getByText("Invalid answer — correct it")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /Gender Human review only/ }))
  expect(screen.getByText(/Demographic answers are never filled automatically/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  fireEvent.change(screen.getByLabelText("Requested language"), { target: { value: "bad_tag" } })
  expect(screen.getByRole("alert")).toHaveTextContent("language tag")
})
it("shows which resume source filled a ready answer", () => {
  vi.mocked(useApi).mockReturnValue({ data: [
    { key: "phone", value: "+351 912 345 678", category: "contact", language: "default", autofill_source: "linkedin" },
    { key: "email", value: "typed@example.com", category: "contact", language: "default", autofill_source: null },
  ], error: "", loading: false, refresh })
  render(<AnswersPage />)
  expect(screen.getByRole("button", { name: "Phone Ready · from linkedin" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Email · Required Ready: default" })).toBeInTheDocument()
})
it("opens a requested field once and clears it from the URL when its editor closes", () => {
  route.search = { field: "phone" }
  const view = render(<AnswersPage />)
  expect(screen.getByRole("dialog")).toHaveTextContent("Add an answer")
  expect(route.update).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(route.update).toHaveBeenCalledWith({ field: "" })
  route.search = {}
  view.rerender(<AnswersPage />)
  route.search = { field: "phone" }
  view.rerender(<AnswersPage />)
  expect(screen.getByRole("dialog")).toBeInTheDocument()
})

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AnswerTables, type CatalogRow } from "./answer-tables"
import { AnswerPanel, useAnswerEditor } from "./answer-panel"
import type { Row } from "@/lib/api"

vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), publish: vi.fn() }))
const request = vi.fn()
beforeEach(() => {
  request.mockReset().mockResolvedValue({ ok: true })
  window.desktop = {
    request, readPdf: vi.fn(), savePdf: vi.fn(), chooseSource: vi.fn(),
    connectionStatus: async () => true, getVersion: async () => "1", openExternal: vi.fn(), onEvent: () => () => {},
  }
})

/** Every catalog table, with the shared answer dialog opened from a row. */
function Harness({ rows, language = "default", fallback = "" }: { rows: Row[]; language?: string; fallback?: string }) {
  const editor = useAnswerEditor()
  const catalog = rows.map(row => ({ key: String(row.key), value: row.value == null ? null : String(row.value), language: String(row.language ?? "default"), source: row.autofill_source as CatalogRow["source"] }))
  return <>
    <AnswerTables rows={catalog} language={language} fallback={fallback} onEdit={(key, lang) => editor.open(rows, key, lang)} />
    <AnswerPanel editor={editor} rows={rows} />
  </>
}

it("offers friendly fields, missing required answers, validation and explicit language fallback", async () => {
  render(<Harness rows={[{ key: "notice_period", value: "Two weeks", category: "eligibility" }]} language="pt-BR" fallback="default" />)
  expect(screen.getAllByText("Required — add it")).toHaveLength(3)
  expect(screen.getByText("Fallback: default")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /Email · Required/ }))
  expect(screen.queryByLabelText("Field key")).not.toBeInTheDocument()
  expect(screen.getByLabelText("Field")).toHaveTextContent("Email")
  fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "invalid" } })
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email")
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "fixture@example.test" } })
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
  await waitFor(() => expect(request).toHaveBeenCalledWith("answer", { key: "email", value: "fixture@example.test", category: "contact", language: "pt-BR" }))
})

it("flags invalid saved values and shows which resume source filled a ready answer", () => {
  render(<Harness rows={[
    { key: "phone", value: "+351 912 345 678", category: "contact", language: "default", autofill_source: "linkedin" },
    { key: "email", value: "typed@example.com", category: "contact", language: "default", autofill_source: null },
    { key: "linkedin_url", value: "bad", category: "links", language: "default" },
  ]} />)
  expect(screen.getByText("Invalid — correct it")).toBeInTheDocument()
  expect(screen.getByText("+351 912 345 678")).toBeInTheDocument()
  expect(screen.getByText("From LinkedIn")).toBeInTheDocument()
  expect(screen.getAllByText("Added by you").length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText("typed@example.com"))
  expect(screen.getByLabelText("Field")).toHaveTextContent("Email")
})

it("renders the control of each field type and validates it", () => {
  render(<Harness rows={[]} />)
  const open = (name: string) => { fireEvent.click(screen.getByRole("button", { name })); return screen.getByRole("region", { name: /^(Edit answer|Add an answer)$/ }) }
  expect(within(open("Birth date")).getByRole("button", { name: "Answer" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(open("Phone").querySelector("input[type=tel]")).not.toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(open("Experience level").querySelectorAll("input[type=checkbox]").length).toBeGreaterThan(3)
  fireEvent.click(screen.getByLabelText("Junior")); fireEvent.click(screen.getByLabelText("Pleno"))
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
  expect(request).toHaveBeenLastCalledWith("answer", expect.objectContaining({ key: "experience_level", value: "Junior, Pleno" }))
})

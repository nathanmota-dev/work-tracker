import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { MultiSelectRecords } from "./multi-select-records"
it("retains independent result keys through pagination and filtering and clears selection explicitly", () => {
  const act = vi.fn()
  const rows = Array.from({ length: 16 }, (_, i) => ({ id: "duplicate-source-id", key: String(i), title: `Role ${i}` }))
  render(<MultiSelectRecords rows={rows} columns={[{ key: "title", label: "Role" }]}
    noun="Roles" rowKey={row => String(row.key)} rowLabel={row => String(row.title)}
    canSelect={() => true} busy={false} onSelect={vi.fn()}
    action={chosen => <button onClick={() => act(chosen.map(row => row.key))}>Use selection</button>} />)
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Role 0" }))
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Role 15" }))
  fireEvent.change(screen.getByLabelText("Search Roles"), { target: { value: "Role 3" } })
  fireEvent.click(screen.getByRole("button", { name: "Use selection" }))
  expect(act).toHaveBeenLastCalledWith(["0", "15"])
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
  fireEvent.click(screen.getByRole("button", { name: "Use selection" }))
  expect(act).toHaveBeenLastCalledWith([])
})

it("selects the current page and all filtered results with explicit counts and exclusions", () => {
  const action = vi.fn()
  const rows = Array.from({ length: 32 }, (_, i) => ({ id: i, title: `Role ${i}`, status: i % 2 ? "saved" : "assessed" }))
  render(<MultiSelectRecords rows={rows} columns={[{ key: "title", label: "Role" }]} noun="Roles"
    rowKey={row => String(row.id)} rowLabel={row => String(row.title)} canSelect={row => row.id !== 31}
    busy={false} onSelect={vi.fn()} selectAllLabel="Select all filtered results"
    action={chosen => <button onClick={() => action(chosen.map(row => row.id))}>Use selection</button>} />)
  fireEvent.click(screen.getByRole("button", { name: "Select page (15)" }))
  expect(screen.getByText("15 selected")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Role 15" }))
  expect(screen.getByText("16 selected")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Search Roles"), { target: { value: "Role 2" } })
  expect(screen.getByText("16 selected · 15 outside current filter")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Select all filtered results (11)" }))
  expect(screen.getByText("26 selected · 15 outside current filter")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Role 20" }))
  fireEvent.click(screen.getByRole("button", { name: "Use selection" }))
  expect(action.mock.lastCall![0]).toHaveLength(25)
  expect(action.mock.lastCall![0]).not.toContain(20)
  fireEvent.change(screen.getByLabelText("Search Roles"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Select all filtered results (31)" }))
  expect(screen.getByText("31 selected")).toBeInTheDocument()
})

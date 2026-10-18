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

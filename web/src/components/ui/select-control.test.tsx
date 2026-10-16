import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { SelectControl } from "./select-control"

it("disables its trigger when the parent form is busy", () => {
  render(
    <SelectControl aria-label="Skill" value="" disabled onChange={vi.fn()}>
      <option value="">Choose a skill</option>
    </SelectControl>,
  )
  expect(screen.getByRole("combobox", { name: "Skill" })).toBeDisabled()
})

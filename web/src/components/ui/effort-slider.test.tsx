import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { EffortSlider, effortName } from "./effort-slider"

it("names each effort level for display", () => {
  expect(["", "low", "xhigh", "max"].map(effortName)).toEqual(["Default", "Low", "Extra high", "Max"])
})

it("moves between the provider default and each level, ignoring unknown values", () => {
  const onChange = vi.fn()
  const view = render(<EffortSlider label="Effort" levels={["low", "high", "max"]} value="stale" onChange={onChange} />)
  const slider = screen.getByRole("slider", { name: "Effort" })
  expect(slider).toHaveAttribute("aria-valuetext", "Default")
  expect(slider).toHaveAttribute("aria-valuemax", "3")
  fireEvent.keyDown(slider, { key: "End" })
  expect(onChange).toHaveBeenLastCalledWith("max")
  view.rerender(<EffortSlider label="Effort" levels={["low", "high", "max"]} value="high" onChange={onChange} />)
  expect(slider).toHaveAttribute("aria-valuetext", "High")
  fireEvent.keyDown(slider, { key: "Home" })
  expect(onChange).toHaveBeenLastCalledWith("")
  view.rerender(<EffortSlider label="Effort" levels={["low"]} value="low" disabled onChange={onChange} />)
  expect(screen.getByRole("slider", { name: "Effort" })).toHaveAttribute("data-disabled")
})

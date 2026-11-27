import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { brDate, DatePicker, fromIsoDate, toIsoDate } from "./date-picker"

describe("DatePicker", () => {
  it("round-trips ISO dates and rejects impossible ones", () => {
    expect(toIsoDate(fromIsoDate("2026-12-01")!)).toBe("2026-12-01")
    expect(fromIsoDate("2026-02-30")).toBeUndefined()
    expect(fromIsoDate("")).toBeUndefined()
  })
  it("picks a day, moves months and clears", () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-11-24" onChange={onChange} aria-label="Date" />)
    fireEvent.click(screen.getByRole("button", { name: "Date" }))
    fireEvent.click(screen.getByRole("button", { name: "Next month" }))
    fireEvent.click(screen.getByRole("button", { name: /December 15, 2026/ }))
    expect(onChange).toHaveBeenLastCalledWith("2026-12-15")
    fireEvent.click(screen.getByRole("button", { name: "Date" }))
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(onChange).toHaveBeenLastCalledWith("")
  })
  it("disables days after max", () => {
    render(<DatePicker value="2026-11-10" max="2026-11-12" onChange={vi.fn()} aria-label="Date" />)
    fireEvent.click(screen.getByRole("button", { name: "Date" }))
    expect(screen.getByRole("button", { name: /November 13, 2026/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /November 12, 2026/ })).toBeEnabled()
  })
  it("shows the chosen day as dd/mm/yyyy", () => {
    expect(brDate(new Date(2026, 0, 5))).toBe("05/01/2026")
    render(<DatePicker value="2026-11-24" onChange={vi.fn()} aria-label="Date" />)
    expect(screen.getByRole("button", { name: "Date" })).toHaveTextContent("24/11/2026")
  })
})

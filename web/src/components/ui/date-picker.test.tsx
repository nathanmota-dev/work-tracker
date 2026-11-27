import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { brDate, DatePicker, DateTimePicker, fromIsoDate, toIsoDate } from "./date-picker"

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

describe("DateTimePicker", () => {
  it("keeps the datetime-local format and masks the 24-hour time", () => {
    const onChange = vi.fn()
    render(<DateTimePicker label="When" value="2026-11-24T09:15" onChange={onChange} />)
    const time = screen.getByRole("textbox", { name: "When time" })
    expect(time).toHaveValue("09:15")
    fireEvent.change(time, { target: { value: "153" } })
    expect(time).toHaveValue("15:3")
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(time, { target: { value: "1530" } })
    expect(onChange).toHaveBeenLastCalledWith("2026-11-24T15:30")
    fireEvent.click(screen.getByRole("button", { name: "When date" }))
    fireEvent.click(screen.getByRole("button", { name: /November 25, 2026/ }))
    expect(onChange).toHaveBeenLastCalledWith("2026-11-25T15:30")
    fireEvent.click(screen.getByRole("button", { name: "When date" }))
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(onChange).toHaveBeenLastCalledWith("")
  })
  it("starts a new date at the current time and waits for a date before the time", () => {
    const onChange = vi.fn()
    render(<DateTimePicker label="When" value="" onChange={onChange} />)
    expect(screen.getByRole("textbox", { name: "When time" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "When date" }))
    fireEvent.click(screen.getByRole("button", { name: "Today" }))
    expect(onChange.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

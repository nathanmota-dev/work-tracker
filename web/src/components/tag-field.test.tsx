import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { TagField } from "@/components/tag-field"

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><TagField label="Role" value={value} onChange={setValue} suggestions={["Back-End", "Full Stack"]} /><output>{value}</output></>
}
const input = () => screen.getByLabelText("Role")

it("turns Enter and commas into badges that accept any text", () => {
  render(<Harness />)
  fireEvent.change(input(), { target: { value: "Back-End" } })
  fireEvent.keyDown(input(), { key: "Enter" })
  fireEvent.change(input(), { target: { value: "Chef, Pilot," } })
  expect(screen.getByRole("list", { name: "Selected values" }).textContent).toBe("Back-EndChefPilot")
  fireEvent.change(input(), { target: { value: "Gardener" } })
  // Text still being typed is part of the value (so submitting without Enter works) but is not a badge yet.
  expect(screen.getByRole("status")).toHaveTextContent("Back-End, Chef, Pilot, Gardener")
  expect(screen.getAllByRole("listitem")).toHaveLength(3)
  fireEvent.keyDown(input(), { key: "Enter" })
  expect(screen.getAllByRole("listitem")).toHaveLength(4)
  expect(input()).toHaveValue("")
})

it("ignores duplicates and removes by button or Backspace", () => {
  render(<Harness initial="Back-End, Chef" />)
  fireEvent.change(input(), { target: { value: "back-end" } })
  fireEvent.keyDown(input(), { key: "Enter" })
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
  fireEvent.click(screen.getByRole("button", { name: "Remove Back-End" }))
  fireEvent.keyDown(input(), { key: "Backspace" })
  expect(screen.queryByRole("list")).not.toBeInTheDocument()
})

it("suggests unused options in a styled list and adds the one picked by click or keyboard", () => {
  render(<Harness initial="Back-End" />)
  fireEvent.focus(input())
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Full Stack"])
  fireEvent.click(screen.getByRole("option", { name: "Full Stack" }))
  expect(screen.getByRole("status")).toHaveTextContent("Back-End, Full Stack")
  expect(screen.queryByRole("option")).not.toBeInTheDocument()
})

it("filters suggestions while typing and picks the highlighted one with Enter", () => {
  render(<Harness />)
  fireEvent.focus(input())
  fireEvent.change(input(), { target: { value: "stack" } })
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Full Stack"])
  fireEvent.keyDown(input(), { key: "ArrowDown" })
  fireEvent.keyDown(input(), { key: "Enter" })
  expect(screen.getByRole("status")).toHaveTextContent("Full Stack")
  fireEvent.change(input(), { target: { value: "Plumber" } })
  fireEvent.keyDown(input(), { key: "Enter" })
  expect(screen.getByRole("status")).toHaveTextContent("Full Stack, Plumber")
})

it("keeps the field required until a badge exists", () => {
  render(<TagField label="Role" value="" onChange={() => {}} required />)
  expect(input()).toBeRequired()
})

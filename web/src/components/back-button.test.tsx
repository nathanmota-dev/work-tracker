import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { BackButton } from "./back-button"

it("is an arrow link to the destination, named for screen readers", () => {
  render(<BackButton href="#/resumes" label="Back to Resumes" />)
  const link = screen.getByRole("link", { name: "Back to Resumes" })
  expect(link).toHaveAttribute("href", "#/resumes")
  expect(link).toHaveTextContent("")
  expect(link.querySelector("svg")).not.toBeNull()
})

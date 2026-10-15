import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ThemeProvider, useTheme } from "./theme-provider"
function Consumer() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
      {theme}
    </button>
  )
}
beforeEach(() => localStorage.clear())
afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove("light", "dark")
  vi.restoreAllMocks()
})
it.each([
  [null, "light"],
  ["invalid", "light"],
  ["dark", "dark"],
  ["light", "light"],
])("initializes from stored %s", (stored, expected) => {
  if (stored) localStorage.setItem("work-tracker-theme", stored)
  render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>,
  )
  expect(screen.getByRole("button", { name: expected })).toBeInTheDocument()
  expect(document.documentElement).toHaveClass(expected)
})
it("uses a custom default/key, updates document classes and persists changes", () => {
  localStorage.setItem("work-tracker-theme", "light")
  render(
    <ThemeProvider storageKey="custom-theme" defaultTheme="dark">
      <Consumer />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "dark" }))
  expect(document.documentElement).toHaveClass("light")
  expect(document.documentElement).not.toHaveClass("dark")
  expect(localStorage.getItem("custom-theme")).toBe("light")
})
it("rejects hooks outside a provider", () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  expect(() => render(<Consumer />)).toThrow("within a ThemeProvider")
})

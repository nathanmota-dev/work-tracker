import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Markdown } from "@/components/markdown"

const openExternal = vi.fn()
afterEach(() => { cleanup(); openExternal.mockReset() })

const table = "### Roles\n| Role | Link |\n|---|---|\n| Dev | [123](https://www.linkedin.com/jobs/view/123/) |"

describe("Markdown", () => {
  it("renders headings and tables", () => {
    render(<Markdown text={table} />)
    expect(screen.getByRole("heading", { name: "Roles" })).toBeTruthy()
    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeTruthy()
  })
  it("opens links externally instead of navigating", () => {
    window.desktop = { openExternal } as unknown as typeof window.desktop
    render(<Markdown text={table} />)
    fireEvent.click(screen.getByRole("link", { name: "123" }))
    expect(openExternal).toHaveBeenCalledWith("https://www.linkedin.com/jobs/view/123/")
  })
  it("does not render raw html", () => {
    const { container } = render(<Markdown text={"<img src=x onerror=alert(1)> hi"} />)
    expect(container.querySelector("img")).toBeNull()
  })
})

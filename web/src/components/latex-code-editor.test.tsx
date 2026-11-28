import { act, render, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { LatexCodeEditor } from "@/components/latex-code-editor"

it("edits LaTeX, follows the app theme and moves to a requested line", async () => {
  const onChange = vi.fn()
  const { container, rerender } = render(<LatexCodeEditor label="LaTeX of resume.tex" value={"\\section{A}\nline 2\nline 3"} onChange={onChange} />)
  const content = await screen.findByRole("textbox", { name: "LaTeX of resume.tex" })
  expect(content).toHaveTextContent("\\section{A}")
  expect(container.querySelector(".cm-editor")).toBeInTheDocument()
  act(() => document.documentElement.classList.add("dark"))
  await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument())
  document.documentElement.classList.remove("dark")
  rerender(<LatexCodeEditor label="LaTeX of resume.tex" value={"\\section{A}\nline 2\nline 3"} onChange={onChange} focus={{ line: 3 }} />)
  rerender(<LatexCodeEditor label="LaTeX of resume.tex" value={"\\section{A}\nline 2\nline 3"} onChange={onChange} readOnly focus={{ line: 99 }} />)
  expect(content).toHaveAttribute("aria-readonly", "true")
})

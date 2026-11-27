import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { parseLatexErrors, useResumeLatex } from "@/lib/resume-latex"
import { desktopWith } from "@/test/variants"

let desktop: ReturnType<typeof desktopWith>
beforeEach(() => { desktop = desktopWith({ "resume-variants/latex": () => ({ mainFile: "resume.tex", files: [{ name: "resume.tex", text: "Old" }] }) }) })

it("parses file:line errors and ignores other log lines", () => {
  expect(parseLatexErrors("LaTeX could not compile.\n./resume.tex:3: Undefined control sequence.\nsections/a.tex:10: Missing $ inserted.\n! Emergency stop.")).toEqual([
    { file: "resume.tex", line: 3, message: "Undefined control sequence." },
    { file: "sections/a.tex", line: 10, message: "Missing $ inserted." },
  ])
})

it("saves only when something changed, and stays dirty when the request fails before saving", async () => {
  const { result } = renderHook(() => useResumeLatex("v1"))
  await waitFor(() => expect(result.current.status).toBe("ready"))
  await act(async () => { expect(await result.current.save()).toBe(false) })
  expect(desktop.request).not.toHaveBeenCalledWith("resume-variants/save-latex", expect.anything())
  act(() => result.current.edit("resume.tex", "New"))
  expect(result.current.isChanged("resume.tex")).toBe(true)
  desktop.request.mockRejectedValueOnce(new Error("Disconnected"))
  await act(async () => { expect(await result.current.save()).toBe(false) })
  expect(result.current).toMatchObject({ dirty: true, failure: "Disconnected", errors: [] })
  await act(async () => { expect(await result.current.save()).toBe(true) })
  expect(result.current).toMatchObject({ dirty: false, failure: "" })
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { SavedResumePicker } from "./saved-resume-picker"
import { desktopWith, variant } from "@/test/variants"
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))

let variants: ReturnType<typeof variant>[]
let desktop: ReturnType<typeof desktopWith>
const onUsed = vi.fn()
const onError = vi.fn()
const target = { jobId: 7, applicationId: 3 }
beforeEach(() => { onUsed.mockReset(); onError.mockReset(); variants = []; desktop = desktopWith({ "resume-variants": () => variants, "application-preparation/use-variant": { id: "run-saved", application_id: 3 } }) })

it("lists ready saved resumes by role and uses the selected one", async () => {
  variants = [
    variant({ id: "b", name: "API resume" }),
    variant({ id: "f", name: "Front-End · React", role: "frontend", stacks: ["React"], pdf: { id: "p", kind: "variant", pages: 2, warnings: [] } }),
    variant({ id: "g", status: "generating" }),
    variant({ id: "a", archivedAt: "2026-11-02" }),
  ]
  render(<SavedResumePicker disabled={false} target={target} onUsed={onUsed} onError={onError} />)
  const select = await screen.findByLabelText("Saved resume")
  expect([...select.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Front-End · React — 2 pages", "Back-End · C#, .NET — 1 page (API resume)"])
  fireEvent.change(select, { target: { value: "b" } })
  fireEvent.click(screen.getByRole("button", { name: "Use this resume" }))
  await waitFor(() => expect(onUsed).toHaveBeenCalledWith({ id: "run-saved", application_id: 3 }))
  expect(desktop.request).toHaveBeenCalledWith("application-preparation/use-variant", { jobId: 7, applicationId: 3, variantId: "b" })
  expect(onError).toHaveBeenCalledWith("")
})

it("points to Resumes when nothing is ready, and can be disabled", async () => {
  const { unmount } = render(<SavedResumePicker disabled={false} target={target} onUsed={onUsed} onError={onError} />)
  expect(await screen.findByRole("link", { name: "Create one in Resumes" })).toHaveAttribute("href", "#/resumes")
  unmount()
  variants = [variant()]
  render(<SavedResumePicker disabled target={target} onUsed={onUsed} onError={onError} />)
  expect(await screen.findByRole("button", { name: "Use this resume" })).toBeDisabled()
})

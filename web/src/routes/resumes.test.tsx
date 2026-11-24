import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ResumesPage } from "@/routes/resumes"
import { publish } from "@/lib/api"
import { desktopWith, variant } from "@/test/variants"
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title }: { title: string }) => <section aria-label={title} /> }))

let variants: ReturnType<typeof variant>[]
let desktop: ReturnType<typeof desktopWith>
beforeEach(() => {
  variants = []
  desktop = desktopWith({ "resume-variants": () => structuredClone(variants), "acp/providers": { providers: [{ id: "opencode", displayName: "OpenCode", models: ["large"] }], default: "opencode" } })
})

it("starts empty with the explanation of generating once and reusing", async () => {
  render(<ResumesPage />)
  expect(await screen.findByText("No saved resumes yet")).toBeInTheDocument()
  expect(screen.getByText(/reuse it in Apply for every job with the same stack/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "New resume" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Import PDF" })).toBeEnabled()
})

it("groups saved resumes by role and refreshes on a variant change", async () => {
  variants = [variant(), variant({ id: "v2", name: "Front-End · React", role: "frontend", stacks: ["React"] })]
  render(<ResumesPage />)
  expect(await screen.findByRole("article", { name: "Back-End · C#, .NET" })).toBeInTheDocument()
  expect(screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["Front-End", "Back-End"])
  variants.push(variant({ id: "v3", name: "Generating", status: "generating", pdf: null }))
  act(() => publish({ type: "changed", table: "resume_variants", variantId: "v3" }))
  expect(await screen.findByRole("article", { name: "Generating" })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "New resume" })).toBeDisabled())
})

it("opens the generation and import forms", async () => {
  render(<ResumesPage />)
  fireEvent.click(await screen.findByRole("button", { name: "New resume" }))
  const dialog = await screen.findByRole("dialog", { name: "New resume" })
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "Import PDF" }))
  expect(await screen.findByRole("dialog", { name: "Import PDF" })).toBeInTheDocument()
  expect(desktop.request).toHaveBeenCalledWith("resume-variants", undefined)
})

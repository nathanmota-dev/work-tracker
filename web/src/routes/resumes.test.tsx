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
  expect(await screen.findByText(/Generate a resume once for a role and its stacks/)).toBeInTheDocument()
  expect(within(screen.getByRole("list", { name: "Saved resumes" })).getAllByRole("link").map(link => link.getAttribute("aria-label"))).toEqual(["Base resume (default)"])
  expect(screen.getByText(/reuse it in Apply for every job with the same stack/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "New resume" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Import PDF" })).toBeEnabled()
})

it("lists the base resume first, then saved resumes by role as cards that open their page, and refreshes on a variant change", async () => {
  const source = { jobId: 7, applicationId: 3, documentVersionId: "d1", company: "Acme", title: "Full Stack .NET/Angular" }
  variants = [variant(), variant({ id: "v2", name: "Front-End · React", role: "frontend", stacks: ["React"], source, match: { score: 78, band: "strong" } })]
  render(<ResumesPage />)
  expect(await screen.findByRole("link", { name: "Back-End · C#, .NET" })).toHaveAttribute("href", "#/resume?id=v1")
  const tailored = screen.getByRole("link", { name: "Front-End · React" })
  expect(tailored).not.toHaveTextContent("Tailored for")
  // The role, and every stack in its own badge.
  expect(within(tailored).getByRole("list", { name: "Stacks of Front-End · React" })).toHaveTextContent("React")
  expect(within(screen.getByRole("link", { name: "Back-End · C#, .NET" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["C#", ".NET"])
  expect(within(tailored).getByRole("img", { name: "Match with its job: 78 · Strong match" })).toBeInTheDocument()
  const grid = screen.getByRole("list", { name: "Saved resumes" })
  expect([...grid.children].map(item => item.firstElementChild?.getAttribute("aria-label"))).toEqual(["Base resume (default)", "Front-End · React", "Back-End · C#, .NET"])
  expect(screen.getByRole("link", { name: "Base resume (default)" })).toHaveAttribute("href", "#/resume?id=base")
  variants.push(variant({ id: "v3", name: "Generating", status: "generating", pdf: null }))
  act(() => publish({ type: "changed", table: "resume_variants", variantId: "v3" }))
  expect(await screen.findByRole("link", { name: "Generating" })).toHaveTextContent("Generating")
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

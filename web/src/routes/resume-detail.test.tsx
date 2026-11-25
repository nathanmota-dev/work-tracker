import { fireEvent, render, screen, within } from "@testing-library/react"
import { useSearch } from "@tanstack/react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { ResumeDetailPage } from "@/routes/resume-detail"
import { desktopWith, variant } from "@/test/variants"
vi.mock("@tanstack/react-router", async original => ({ ...(await original<typeof import("@tanstack/react-router")>()), useSearch: vi.fn() }))
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))
vi.mock("@/components/pdf-viewer", () => ({ PdfViewer: ({ title, artifact }: { title: string; artifact: { id: string } }) => <section aria-label={title}>{artifact.id}</section> }))

let variants: ReturnType<typeof variant>[]
let desktop: ReturnType<typeof desktopWith>
beforeEach(() => {
  vi.mocked(useSearch).mockReturnValue({ id: "v2" })
  const source = { jobId: 7, applicationId: 3, documentVersionId: "d1", company: "Acme", title: "Full Stack .NET/Angular" }
  variants = [variant(), variant({ id: "v2", name: "Full Stack .NET/Angular", role: "fullstack", stacks: ["C#", "Angular"], source, archivedAt: "2026-11-02T00:00:00.000Z", pdf: { id: "pdf-v2", kind: "variant", pages: 1, warnings: [] } })]
  desktop = desktopWith({ "resume-variants?archived=true": () => structuredClone(variants), "acp/providers": { providers: [], default: null } })
})

it("shows the selected resume's PDF and details, including an archived one, and edits it", async () => {
  render(<ResumeDetailPage />)
  expect(await screen.findByRole("heading", { level: 1, name: "Full Stack .NET/Angular" })).toBeInTheDocument()
  expect(await screen.findByRole("region", { name: "Full Stack .NET/Angular PDF" })).toHaveTextContent("pdf-v2")
  const details = screen.getByRole("article", { name: "Full Stack .NET/Angular" })
  expect(within(details).getByText("Archived")).toBeInTheDocument()
  expect(within(details).getByRole("link", { name: "Open application" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Back to Resumes" })).toHaveAttribute("href", "#/resumes")
  fireEvent.click(within(details).getByRole("button", { name: "Edit" }))
  expect(await screen.findByRole("dialog", { name: "Edit resume" })).toBeInTheDocument()
  expect(desktop.request).toHaveBeenCalledWith("resume-variants?archived=true", undefined)
})

it("explains a resume without a PDF yet and an unknown one", async () => {
  variants[1] = variant({ id: "v2", name: "Generating", status: "generating", pdf: null })
  const { unmount } = render(<ResumeDetailPage />)
  expect(await screen.findByText("No PDF yet")).toBeInTheDocument()
  unmount()
  vi.mocked(useSearch).mockReturnValue({ id: "missing" })
  render(<ResumeDetailPage />)
  expect(await screen.findByText("Saved resume not found")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Back to Resumes" })).toBeInTheDocument()
})

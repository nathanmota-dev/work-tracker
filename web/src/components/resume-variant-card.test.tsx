import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { ResumeVariantCard } from "./resume-variant-card"
import { desktopWith, variant } from "@/test/variants"

let desktop: ReturnType<typeof desktopWith>
beforeEach(() => { desktop = desktopWith({}) })

it("shows the role, origin and dd/mm/yyyy date, stacks, stale sources and a Markdown report, and regenerates; download, rename and archive live elsewhere", async () => {
  render(<ResumeVariantCard variant={variant({ stale: true, updatedAt: "2026-11-01T12:00:00.000Z" })} busy={false} />)
  expect(screen.getByText("Back-End · Generated · 01/11/2026")).toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Stacks of Back-End · C#, .NET" })).toHaveTextContent("C#.NET")
  expect(screen.getByText("Sources changed since generation")).toBeInTheDocument()
  expect(screen.getByText("Ready")).toBeInTheDocument()
  expect(screen.getByText("Tailoring report")).toBeInTheDocument()
  for (const name of ["Download", "Edit", "Archive"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("resume-variants/regenerate", { id: "v1" }))
})

it("an imported PDF cannot be regenerated", () => {
  render(<ResumeVariantCard variant={variant({ origin: "imported", sourceVersion: null, pdf: { id: "p", kind: "variant", pages: 2, warnings: [] } })} busy={false} />)
  expect(screen.getByText(/^Back-End · Imported PDF · /)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument()
})

it("shows progress and cancels a generation, and reports a failed action", async () => {
  const events = [{ type: "acp-update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Selecting .NET projects" } } }]
  desktop.request.mockRejectedValueOnce(new Error("This generation is not active."))
  render(<ResumeVariantCard variant={variant({ status: "generating", pdf: null, events })} busy />)
  expect(screen.getByText("Selecting .NET projects")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("This generation is not active.")
  expect(desktop.request).toHaveBeenCalledWith("resume-variants/cancel", { id: "v1" })
})

it("shows why an interrupted generation stopped, with Regenerate available", () => {
  render(<ResumeVariantCard variant={variant({ status: "interrupted", pdf: null, error: "The app closed during this generation." })} busy={false} />)
  expect(screen.getByText("Interrupted")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("The app closed")
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument()
})

it("a resume tailored in Apply links to its application, shows its match and is edited instead of regenerated", () => {
  const source = { jobId: 7, applicationId: 3, documentVersionId: "d1", company: "Acme", title: "Full Stack .NET/Angular" }
  render(<ResumeVariantCard variant={variant({ name: "Full Stack .NET/Angular", role: "fullstack", updatedAt: "2026-11-01T12:00:00.000Z", source, match: { score: 82, band: "strong" } })} busy={false} />)
  expect(screen.getByText("Full Stack · 01/11/2026")).toBeInTheDocument()
  const origin = screen.getByRole("region", { name: "Source application" })
  expect(origin).toHaveTextContent("JobFull Stack .NET/Angular")
  expect(origin).toHaveTextContent("CompanyAcme")
  expect(within(origin).getByRole("link", { name: "Open application" })).toHaveAttribute("href", "#/apply?jobId=7&applicationId=3")
  expect(screen.getByText("82 · Strong match")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument()
  expect(screen.getByText(/Edit its LaTeX in the Code tab/)).toBeInTheDocument()
})

it("marks an archived resume", () => {
  render(<ResumeVariantCard variant={variant({ archivedAt: "2026-11-02T00:00:00.000Z" })} busy={false} />)
  expect(screen.getByText("Archived")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument()
})

it("renders the tailoring report as Markdown", () => {
  render(<ResumeVariantCard variant={variant({ report: "# Changes\n\n- **Angular** first" })} busy={false} />)
  expect(screen.getByRole("heading", { name: "Changes" })).toBeInTheDocument()
  expect(screen.getByText("Angular").tagName).toBe("STRONG")
})

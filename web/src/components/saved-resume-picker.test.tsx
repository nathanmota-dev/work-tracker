import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { SavedResumePicker } from "./saved-resume-picker"
import { desktopWith, variant } from "@/test/variants"
import { documentScore } from "@/test/ats"
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))

let variants: ReturnType<typeof variant>[]
let desktop: ReturnType<typeof desktopWith>
const onUsed = vi.fn()
const onError = vi.fn()
const target = { jobId: 7, applicationId: 3 }
beforeEach(() => { onUsed.mockReset(); onError.mockReset(); variants = []; desktop = desktopWith({ "resume-variants": () => variants, "application-preparation/use-variant": { id: "run-saved", application_id: 3 } }) })

it("lists ready saved resumes by role and uses the selected one", async () => {
  variants = [
    variant({ id: "b", name: "API resume", source: { jobId: 9, applicationId: 4, documentVersionId: "d", company: "Acme", title: "API" } }),
    variant({ id: "f", name: "Front-End · React", role: "frontend", stacks: ["React"], pdf: { id: "p", kind: "variant", pages: 2, warnings: [] } }),
    variant({ id: "g", status: "generating" }),
    variant({ id: "a", archivedAt: "2026-11-02" }),
  ]
  render(<SavedResumePicker disabled={false} target={target} onUsed={onUsed} onError={onError} />)
  const select = await screen.findByLabelText("Saved resume")
  expect([...select.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Front-End · React — 2 pages", "Back-End · C#, .NET — 1 page (API resume) · Tailored for Acme"])
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

it("orders saved resumes by their score for the job, preselects the best and shows its missing required terms", async () => {
  variants = [variant({ id: "n", name: "Back-End · Node.js", stacks: ["Node.js"] }), variant({ id: "c" })]
  desktop = desktopWith({ "resume-variants": () => variants, "application-preparation/use-variant": { id: "run-saved", application_id: 3 }, "ats/jobs/7": { job_id: 7, keywords: [], documents: [
    documentScore({ document_key: "variant:c", variant_id: "c", score: 64, band: "partial", requiredMissing: ["SQL Server", "A", "B", "C", "D", "E"] }),
    documentScore({ document_key: "variant:n", variant_id: "n", label: "Back-End · Node.js", score: 20, band: "weak" }),
  ] } })
  render(<SavedResumePicker disabled={false} target={target} onUsed={onUsed} onError={onError} />)
  const select = await screen.findByLabelText("Saved resume")
  await waitFor(() => expect([...select.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Back-End · C#, .NET — 1 page · 64", "Back-End · Node.js — 1 page · 20"]))
  expect(select).toHaveValue("c")
  expect(screen.getByLabelText("Resume match (ATS keywords)")).toHaveTextContent("64 · Partial match")
  expect(screen.getByText("Missing required: SQL Server, A, B, C, D")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Use this resume" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("application-preparation/use-variant", { jobId: 7, applicationId: 3, variantId: "c" }))
})

it("shows the base resume's score without saved resumes and compares a tailored resume", async () => {
  desktop = desktopWith({ "resume-variants": () => [], "ats/jobs/7": { job_id: 7, keywords: [], documents: [
    documentScore({ document_key: "document:t", kind: "document", variant_id: null, label: "Tailored resume", score: 85 }),
    documentScore({ document_key: "base:s1", kind: "base", variant_id: null, label: "Base resume", score: 40, band: "weak", requiredMissing: [".NET"] }),
  ] } })
  render(<SavedResumePicker disabled={false} target={target} onUsed={onUsed} onError={onError} />)
  expect(await screen.findByLabelText("Resume match (ATS keywords)")).toHaveTextContent("Base resume: 40 · Weak match Generate tailored resume")
  expect(screen.getByText("Missing required: .NET")).toBeInTheDocument()
  expect(screen.getByText("Tailored: 85 · Best saved: 40")).toBeInTheDocument()
})

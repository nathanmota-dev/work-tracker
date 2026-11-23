import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { GateBadge, GateDetails, RowGateBadge } from "./gate-badge"
import { gateLabel, gatesOff, isFailed, rowVerdict, type StoredGate } from "@/lib/gates"
import { desktopDouble } from "@/test/doubles"

const off = { status: "off", summary: "Set your work eligibility to enable the eligibility gate.", findings: [] }
const failed = {
  version: 1, verdict: "fail", unverified: false, checked_at: "2026-11-23T12:00:00.000Z",
  language: { status: "fail", summary: "Requires a language you do not declare: Russian.", findings: [{ verdict: "fail", note: "Requires Russian (fluent), which is not in your languages.", quote: "Fluent <b>Russian</b> required" }] },
  eligibility: off, extraction: { languages: [], eligibility: {} },
} as unknown as StoredGate
let gate: StoredGate | null
beforeEach(() => {
  gate = failed
  window.desktop = desktopDouble()
  vi.mocked(window.desktop.request).mockImplementation(async (path: string) => (path === "gates/jobs/7" ? { gate } : undefined))
})
afterEach(() => { delete window.desktop })

it("labels every verdict with words, not only color", () => {
  expect(["fail", "flag", "pass", "unchecked"].map(verdict => gateLabel(verdict as never))).toEqual(["Fail", "Flag", "Pass", "Not checked"])
  expect(gateLabel("pass", true)).toBe("Pass (unverified)")
  render(<><GateBadge verdict="flag" /><RowGateBadge row={{ gate_verdict: "pass", gate_unverified: true }} /><RowGateBadge row={{}} /></>)
  for (const label of ["Flag", "Pass (unverified)", "Not checked"]) expect(screen.getByText(label)).toBeInTheDocument()
})

it("reads row verdicts defensively", () => {
  expect(rowVerdict({ gate_verdict: "maybe" })).toBe("unchecked")
  expect(isFailed({ gate_verdict: "fail" })).toBe(true)
  expect(gatesOff({ languages: [], eligibility: null })).toBe(true)
  expect(gatesOff({ languages: [], eligibility: "needs_permission" })).toBe(false)
  expect(gatesOff(undefined)).toBe(false)
})

it("shows the stored check with its quote as plain text and how to enable an off gate", async () => {
  const { container } = render(<GateDetails jobId={7} />)
  const status = await screen.findByRole("status", { name: "Requirements check" })
  expect(within(status).getByText("Fail")).toBeInTheDocument()
  expect(status).toHaveTextContent("Language: Fail. Requires a language you do not declare: Russian.")
  expect(status).toHaveTextContent("Fluent <b>Russian</b> required")
  expect(container.querySelector("b")).toBeNull()
  expect(status).toHaveTextContent("Eligibility: Off. Set your work eligibility")
  expect(within(status).getByRole("link", { name: "Set up deal-breakers" })).toHaveAttribute("href", "#/profile?tab=deal-breakers")
  expect(status).toHaveTextContent("This job stays saved.")
})

it("explains an unchecked job and reports a read failure", async () => {
  gate = null
  const { unmount } = render(<GateDetails jobId={7} />)
  expect(await screen.findByRole("status", { name: "Requirements check" })).toHaveTextContent("Not checked")
  expect(screen.getByRole("link", { name: "deal-breakers" })).toHaveAttribute("href", "#/profile?tab=deal-breakers")
  unmount()
  vi.mocked(window.desktop!.request).mockRejectedValue(new Error("job #7 not found"))
  render(<GateDetails jobId={7} />)
  expect(await screen.findByRole("alert")).toHaveTextContent("job #7 not found")
})

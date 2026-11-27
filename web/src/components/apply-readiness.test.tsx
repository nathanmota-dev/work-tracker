import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { applyBlocks, ApplyReadiness, ProfileConflictsWarning, type ReadinessInput } from "./apply-readiness"
const ready: ReadinessInput = { live: true, busy: false, archived: false, submitted: false, sources: true, tools: true, descriptionDirty: false, descriptionMissing: false, tailored: true, provider: "opencode", model: "", invalidModel: false }
it("maps every local blocker to its correction", () => {
  expect(applyBlocks(ready, "generate")).toEqual([])
  const blocks = applyBlocks({ ...ready, live: false, busy: true, archived: true, submitted: true, sources: false, tools: false, descriptionDirty: true, provider: undefined, invalidModel: true }, "generate")
  expect(blocks.map(block => block.label)).toEqual(["Check workspace connection", "View activity", "Restore in Jobs", "Open the board", "Configure an agent", "Choose a model", "Configure resume sources", "Check installed tools", "Edit job description"])
  for (const block of blocks) expect(block.href || block.action).toBeTruthy()
  expect(blocks.filter(block => block.step).map(block => [block.label, block.step])).toEqual([["Configure resume sources", "resume"], ["Check installed tools", "resume"]])
  expect(applyBlocks({ ...ready, tailored: false }, "fill")[0]?.message).toContain("Choose or generate a resume")
  expect(applyBlocks({ ...ready, descriptionMissing: true }, "generate")[0]?.action).toBe("description")
})
it("keeps Chrome and LinkedIn independent, ignores old model probes and blocks only relevant integrations", () => {
  const integrations = { backend: true, dependencies: [], entries: [{ target: "mcp/chrome" as const, executable: true, diagnostic: { target: "mcp/chrome" as const, checkedAt: "now", model: "", checks: [{ stage: "authentication", state: "ready", message: "Chrome connected" }] } }, { target: "mcp/linkedin" as const, executable: true, diagnostic: { target: "mcp/linkedin" as const, checkedAt: "now", model: "", checks: [{ stage: "authentication", state: "authentication_required", message: "LinkedIn requires login" }] } }] }
  expect(applyBlocks({ ...ready, linkedinNeeded: true, integrations }, "generate")[0]).toMatchObject({ message: "LinkedIn MCP: LinkedIn requires login", href: "#/settings?section=integrations&target=mcp%2Flinkedin" })
  expect(applyBlocks({ ...ready, integrations }, "fill")).toEqual([])
  const entry = { target: "acp/opencode" as const, executable: true, diagnostic: { target: "acp/opencode" as const, model: "old", checkedAt: "now", checks: [{ stage: "model", state: "invalid_model", message: "Invalid" }] } }
  expect(applyBlocks({ ...ready, integrations: { ...integrations, entries: [entry] } }, "generate")).toEqual([])
  entry.executable = false
  expect(applyBlocks({ ...ready, integrations: { ...integrations, entries: [entry] } }, "generate")[0]?.href).toContain("acp%2Fopencode")
})
it("renders corrections and re-test actions", () => {
  const correct = vi.fn(), test = vi.fn()
  render(<ApplyReadiness generate={[{ message: "Needs a description", label: "Edit job description", action: "description" }]} fill={[{ message: "Missing browser", label: "Configure Chrome", href: "#/settings?section=integrations&target=mcp%2Fchrome" }, { message: "No resume", label: "Configure resume sources", href: "#/resume?id=base", step: "resume" }]} correct={correct} test={test} testing={false} error="test failed" />)
  fireEvent.click(screen.getByRole("button", { name: "Edit job description" })); expect(correct).toHaveBeenCalledWith("description")
  expect(screen.getByRole("link", { name: "Configure Chrome" })).toHaveAttribute("href", "#/settings?section=integrations&target=mcp%2Fchrome")
  expect(screen.getByRole("link", { name: "Get started guide" })).toHaveAttribute("href", "#/dashboard?step=resume")
  fireEvent.click(screen.getByRole("button", { name: "Test availability again" })); expect(test).toHaveBeenCalledOnce()
  expect(screen.getByRole("alert")).toHaveTextContent("test failed")
})
it("a failed requirements check blocks generation until the user confirms the quoted warning", () => {
  expect(applyBlocks({ ...ready, gateUnconfirmed: true }, "generate")).toEqual([{ message: expect.stringContaining("failed a deal-breaker check"), label: "Review requirements", action: "gate" }])
  expect(applyBlocks({ ...ready, gateUnconfirmed: true }, "fill")).toEqual([])
  const gate = {
    verdict: "fail", unverified: false,
    language: { status: "pass", summary: "", findings: [{ verdict: "pass", note: "Requires Spanish; you declared Native.", quote: "Spanish" }] },
    eligibility: { status: "fail", summary: "", findings: [{ verdict: "fail", note: "Requires citizenship or permanent residency.", quote: "Must be a citizen or permanent resident." }] },
  } as never
  const confirm = vi.fn(), correct = vi.fn()
  const props = { generate: applyBlocks({ ...ready, gateUnconfirmed: true }, "generate"), fill: [], testing: false, error: "", test: vi.fn(), correct }
  const { rerender } = render(<ApplyReadiness {...props} gate={{ value: gate, confirmed: false, confirm }} />)
  const warning = screen.getByRole("alert", { name: "Deal-breaker warning" })
  expect(warning).toHaveTextContent("Fail: this job failed your deal-breakers.")
  expect(warning).toHaveTextContent("Requires citizenship or permanent residency. “Must be a citizen or permanent resident.”".replace(/[“”]/g, ""))
  expect(warning).not.toHaveTextContent("Requires Spanish")
  fireEvent.click(screen.getByRole("button", { name: "Review requirements" }))
  expect(correct).toHaveBeenCalledWith("gate")
  fireEvent.click(screen.getByRole("button", { name: "Prepare anyway" }))
  expect(confirm).toHaveBeenCalledOnce()
  rerender(<ApplyReadiness {...props} generate={[]} gate={{ value: gate, confirmed: true, confirm }} />)
  expect(screen.getByRole("alert", { name: "Deal-breaker warning" })).toHaveTextContent("You confirmed preparing this job anyway.")
  expect(screen.queryByRole("button", { name: "Prepare anyway" })).toBeNull()
  rerender(<ApplyReadiness {...props} generate={[]} gate={{ value: { ...(gate as object), verdict: "flag" } as never, confirmed: false, confirm }} />)
  expect(screen.queryByRole("alert", { name: "Deal-breaker warning" })).toBeNull()
})
it("warns about undecided profile conflicts without blocking generation", () => {
  const { rerender } = render(<ProfileConflictsWarning count={2} />)
  expect(screen.getByText(/Your profile has 2 undecided conflicts/)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Decide in Profile" })).toHaveAttribute("href", "#/profile?tab=profile")
  rerender(<ProfileConflictsWarning count={1} />)
  expect(screen.getByText(/1 undecided conflict between/)).toBeInTheDocument()
  rerender(<ProfileConflictsWarning count={0} />)
  expect(screen.queryByText(/undecided/)).toBeNull()
})

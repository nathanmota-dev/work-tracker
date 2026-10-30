import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { applyBlocks, ApplyReadiness, type ReadinessInput } from "./apply-readiness"
const ready: ReadinessInput = { live: true, busy: false, archived: false, submitted: false, sources: true, tools: true, descriptionDirty: false, descriptionMissing: false, tailored: true, provider: "opencode", model: "", invalidModel: false }
it("maps every local blocker to its correction", () => {
  expect(applyBlocks(ready, "generate")).toEqual([])
  const blocks = applyBlocks({ ...ready, live: false, busy: true, archived: true, submitted: true, sources: false, tools: false, descriptionDirty: true, provider: undefined, invalidModel: true }, "generate")
  expect(blocks.map(block => block.label)).toEqual(["Check workspace connection", "View activity", "Restore in Jobs", "Open the board", "Configure an agent", "Choose a model", "Configure resume sources", "Check installed tools", "Edit job description"])
  for (const block of blocks) expect(block.href || block.action).toBeTruthy()
  expect(applyBlocks({ ...ready, tailored: false }, "fill")[0]?.message).toContain("validated PDF")
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
  render(<ApplyReadiness generate={[{ message: "Needs a description", label: "Edit job description", action: "description" }]} fill={[{ message: "Missing browser", label: "Configure Chrome", href: "#/settings?section=integrations&target=mcp%2Fchrome" }]} correct={correct} test={test} testing={false} error="test failed" />)
  fireEvent.click(screen.getByRole("button", { name: "Edit job description" })); expect(correct).toHaveBeenCalledWith("description")
  expect(screen.getByRole("link", { name: "Configure Chrome" })).toHaveAttribute("href", "#/settings?section=integrations&target=mcp%2Fchrome")
  fireEvent.click(screen.getByRole("button", { name: "Test availability again" })); expect(test).toHaveBeenCalledOnce()
  expect(screen.getByRole("alert")).toHaveTextContent("test failed")
})

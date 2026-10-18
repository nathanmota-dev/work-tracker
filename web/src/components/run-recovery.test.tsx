import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { RunRecovery } from "@/components/run-recovery"
import type { PreparationRun } from "@/lib/preparation"
const run = (status: PreparationRun["status"], recovery: Partial<PreparationRun["recovery"]>) => ({ id: "run-1", status, recovery: { checkpoints: [], retryFrom: null, reviewRequired: false, summary: null, ...recovery } }) as unknown as PreparationRun
it("renders nothing while a run has nothing to retry", () => {
  const { container } = render(<RunRecovery run={run("completed", {})} disabled={false} onRetry={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
  render(<RunRecovery disabled={false} onRetry={vi.fn()} />)
  expect(screen.queryByRole("region", { name: "Execution recovery" })).not.toBeInTheDocument()
})
it.each([
  ["failed", "preparing", "Retry execution"],
  ["interrupted", "tailoring", "Continue from tailoring"],
  ["cancelled", "compiling", "Continue from compilation"],
  ["failed", "filling", "Fill again"],
  ["waiting_for_sign_in", "filling", "Retry after sign-in"],
] as const)("a %s run retries from %s", (status, retryFrom, label) => {
  const onRetry = vi.fn()
  render(<RunRecovery run={run(status, { retryFrom, summary: "Stopped.", checkpoints: ["sources", "tailored"] })} disabled={false} onRetry={onRetry} />)
  expect(screen.getByRole("status")).toHaveTextContent("Stopped.")
  expect(screen.getByText("Kept: source snapshot and base PDF, tailored sources.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: label }))
  expect(onRetry).toHaveBeenCalledWith(false)
})
it("requires the candidate's review before filling again after an unknown portal outcome", () => {
  const onRetry = vi.fn()
  render(<RunRecovery run={run("interrupted", { retryFrom: "filling", reviewRequired: true, summary: "Review the portal." })} disabled={false} onRetry={onRetry} />)
  expect(screen.queryByText(/Kept:/)).not.toBeInTheDocument()
  const button = screen.getByRole("button", { name: "Fill again" })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox", { name: "I reviewed the portal in the browser" }))
  fireEvent.click(button)
  expect(onRetry).toHaveBeenCalledWith(true)
})
it("disables retry while another execution is active", () => {
  render(<RunRecovery run={run("failed", { retryFrom: "compiling" })} disabled onRetry={vi.fn()} />)
  expect(screen.getByRole("button", { name: "Continue from compilation" })).toBeDisabled()
})

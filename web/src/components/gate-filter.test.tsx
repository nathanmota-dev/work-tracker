import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CheckRequirements } from "./gate-filter"
import { prepareSkill } from "@/lib/agent"
import type { Row } from "@/lib/api"

vi.mock("@/lib/agent", async (original) => ({ ...(await original<typeof import("@/lib/agent")>()), prepareSkill: vi.fn() }))

const jobs: Row[] = [{ id: 1, title: "Failed", gate_verdict: "fail" }, { id: 2, title: "Flagged", gate_verdict: "flag" }, { id: 3, title: "New" }]
it("opens the requirements check for the selected jobs", () => {
  const { rerender } = render(<CheckRequirements jobs={[]} />)
  expect(screen.getByRole("button", { name: "Check requirements" })).toBeDisabled()
  rerender(<CheckRequirements jobs={jobs.slice(0, 2)} />)
  fireEvent.click(screen.getByRole("button", { name: "Check requirements" }))
  expect(prepareSkill).toHaveBeenCalledWith("requirements-check", { jobIds: "1,2" })
})

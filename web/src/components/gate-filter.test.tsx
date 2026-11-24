import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CheckRequirements, useHideFailed } from "./gate-filter"
import { prepareSkill } from "@/lib/agent"
import type { Row } from "@/lib/api"

vi.mock("@/lib/agent", async (original) => ({ ...(await original<typeof import("@/lib/agent")>()), prepareSkill: vi.fn() }))

const jobs: Row[] = [{ id: 1, title: "Failed", gate_verdict: "fail" }, { id: 2, title: "Flagged", gate_verdict: "flag" }, { id: 3, title: "New" }]
function Harness({ view, rows = jobs }: { view: string; rows?: Row[] }) {
  const failed = useHideFailed(view, rows)
  return <>{failed.control}<ul>{failed.rows.map(row => <li key={String(row.id)}>{String(row.title)}</li>)}</ul></>
}
const titles = () => screen.queryAllByRole("listitem").map(item => item.textContent)

it("hides failed jobs in New by default, keeps them counted and brings them back", () => {
  render(<Harness view="new" />)
  expect(titles()).toEqual(["Flagged", "New"])
  expect(screen.getByRole("status", { name: "Failed jobs" })).toHaveTextContent("(1 hidden)")
  fireEvent.click(screen.getByRole("checkbox", { name: /Hide failed/ }))
  expect(titles()).toEqual(["Failed", "Flagged", "New"])
  expect(screen.getByRole("status", { name: "Failed jobs" })).toHaveTextContent("(1 shown)")
})

it("shows failed jobs in other tabs unless the filter is turned on", () => {
  render(<Harness view="shortlist" />)
  expect(titles()).toEqual(["Failed", "Flagged", "New"])
  fireEvent.click(screen.getByRole("checkbox", { name: /Hide failed/ }))
  expect(titles()).toEqual(["Flagged", "New"])
})

it("reports when nothing failed", () => {
  render(<Harness view="new" rows={[{ id: 3, title: "New" }]} />)
  expect(screen.getByRole("status", { name: "Failed jobs" })).toHaveTextContent("(none failed)")
})

it("opens the requirements check for the selected jobs", () => {
  const { rerender } = render(<CheckRequirements jobs={[]} />)
  expect(screen.getByRole("button", { name: "Check requirements" })).toBeDisabled()
  rerender(<CheckRequirements jobs={jobs.slice(0, 2)} />)
  fireEvent.click(screen.getByRole("button", { name: "Check requirements" }))
  expect(prepareSkill).toHaveBeenCalledWith("requirements-check", { jobIds: "1,2" })
})

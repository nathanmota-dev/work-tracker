import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DeadlineBadge, DeadlineSort } from "@/components/deadline-badge"
import { DeadlinePanel } from "@/components/deadline-panel"
import { byDeadline, deadlineLabel } from "@/lib/deadline"

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))

describe("deadlineLabel", () => {
  it("always gives a text label for urgent and upcoming deadlines", () => {
    expect(deadlineLabel("overdue", -3)).toBe("Overdue")
    expect(deadlineLabel("soon", 0)).toBe("Due today")
    expect(deadlineLabel("soon", 1)).toBe("Due in 1 day")
    expect(deadlineLabel("soon", 7)).toBe("Due in 7 days")
    expect(deadlineLabel("upcoming", 12)).toBe("Due in 12 days")
    expect(deadlineLabel("none", null)).toBeNull()
  })
})

describe("byDeadline", () => {
  it("puts the soonest deadline first and keeps undated rows in their order", () => {
    const rows = [{ id: 1 }, { id: 2, deadline: "2026-12-10" }, { id: 3, deadline: "" }, { id: 4, deadline: "2026-12-01" }, { id: 5, deadline: "2026-12-01" }]
    expect(byDeadline(rows).map(row => row.id)).toEqual([4, 5, 2, 1, 3])
  })
})

describe("DeadlineBadge", () => {
  it("shows the urgency as text with the date in its title", () => {
    render(<DeadlineBadge row={{ deadline: "2026-11-25", deadline_level: "soon", deadline_days: 2 }} />)
    expect(screen.getByText("Due in 2 days")).toHaveAttribute("title", "Deadline 2026-11-25")
  })
  it("shows overdue deadlines", () => {
    render(<DeadlineBadge row={{ deadline: "2026-11-01", deadline_level: "overdue", deadline_days: -22 }} />)
    expect(screen.getByText("Overdue")).toBeInTheDocument()
  })
  it("shows only the date once nothing is pending, and a dash without a deadline", () => {
    const { rerender } = render(<DeadlineBadge row={{ deadline: "2026-11-01", deadline_level: "none" }} />)
    expect(screen.getByText("2026-11-01")).toBeInTheDocument()
    rerender(<DeadlineBadge row={{ deadline: null }} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})

describe("DeadlineSort", () => {
  it("reports its state through aria-pressed and its label", () => {
    const onToggle = vi.fn()
    const { rerender } = render(<DeadlineSort active={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole("button", { name: "Sort by deadline" }))
    expect(onToggle).toHaveBeenCalledOnce()
    rerender(<DeadlineSort active onToggle={onToggle} />)
    expect(screen.getByRole("button", { name: "Sorted by deadline" })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("DeadlinePanel", () => {
  it("links each item to its job or application", () => {
    render(<DeadlinePanel items={[
      { kind: "job", id: 1, title: "Late role", company: "Acme", deadline: "2026-11-20", level: "overdue", days_left: -3 },
      { kind: "application", id: 2, title: "Draft role", company: "Beta", deadline: "2026-11-23", level: "soon", days_left: 0 },
    ]} />)
    expect(screen.getByRole("link", { name: "Late role" })).toHaveAttribute("href", "/jobs")
    expect(screen.getByRole("link", { name: "Draft role" })).toHaveAttribute("href", "/applications")
    expect(screen.getByText("Overdue")).toBeInTheDocument()
    expect(screen.getByText("Due today")).toBeInTheDocument()
    expect(screen.getByText("Acme · Job")).toBeInTheDocument()
    expect(screen.getByText("Beta · Application")).toBeInTheDocument()
  })
  it("has a discreet empty state", () => {
    render(<DeadlinePanel items={[]} />)
    expect(screen.getByText("No deadlines close")).toBeInTheDocument()
  })
})

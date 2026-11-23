import type { Row } from "@/lib/api"

export type DeadlineLevel = "overdue" | "soon" | "upcoming" | "none"

/** Text shown for a deadline; color is never the only signal. */
export function deadlineLabel(level: DeadlineLevel, days: number | null): string | null {
  if (level === "overdue") return "Overdue"
  if (level === "soon") return days === 0 ? "Due today" : `Due in ${days} ${days === 1 ? "day" : "days"}`
  if (level === "upcoming") return `Due in ${days} days`
  return null
}

/** Sorts rows with a deadline first (soonest first); rows without one keep their order after them. */
export function byDeadline(rows: Row[]): Row[] {
  const key = (row: Row) => (typeof row.deadline === "string" && row.deadline ? row.deadline : null)
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = key(a.row), right = key(b.row)
      if (left && right) return left.localeCompare(right) || a.index - b.index
      return left ? -1 : right ? 1 : a.index - b.index
    })
    .map(item => item.row)
}

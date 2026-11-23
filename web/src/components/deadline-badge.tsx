import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { deadlineLabel, type DeadlineLevel } from "@/lib/deadline"
import type { Row } from "@/lib/api"
import { cn } from "@/lib/utils"

const tone: Record<DeadlineLevel, string> = {
  overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  soon: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  upcoming: "text-muted-foreground",
  none: "",
}

/** Urgency of a record's deadline, always as text; renders a dash when nothing is pending. */
export function DeadlineBadge({ row }: { row: Row }) {
  const level = (row.deadline_level ?? "none") as DeadlineLevel
  const days = typeof row.deadline_days === "number" ? row.deadline_days : null
  const label = deadlineLabel(level, days)
  if (!label || typeof row.deadline !== "string") {
    return typeof row.deadline === "string" && row.deadline
      ? <span className="text-xs text-muted-foreground">{row.deadline}</span>
      : <>—</>
  }
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", tone[level])} title={`Deadline ${row.deadline}`}>
      {label}
    </Badge>
  )
}

/** Toggles a list between its default order and soonest deadline first. */
export function DeadlineSort({ active, onToggle, className }: { active: boolean; onToggle: () => void; className?: string }) {
  return (
    <Button size="sm" variant="outline" className={className} aria-pressed={active} onClick={onToggle}>
      {active ? "Sorted by deadline" : "Sort by deadline"}
    </Button>
  )
}

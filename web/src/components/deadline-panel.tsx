import { Link } from "@tanstack/react-router"
import { CalendarCheck } from "lucide-react"
import { Panel } from "@/components/workspace-ui"
import { DeadlineBadge } from "@/components/deadline-badge"
import { text, type Row } from "@/lib/api"

/** Overdue and soon-due roles and applications from the overview, soonest first. */
export function DeadlinePanel({ items }: { items: Row[] }) {
  if (!items.length)
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-dashed px-5 py-3 text-sm text-muted-foreground">
        <CalendarCheck className="size-4 shrink-0" />
        No deadlines in the next 7 days.
      </p>
    )
  return (
    <Panel title="Deadlines">
      <ul className="divide-y">
        {items.map((item) => (
          <li key={`${text(item.kind)}-${text(item.id)}`} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <Link
                to={item.kind === "job" ? "/jobs" : "/applications"}
                className="font-medium hover:underline"
              >
                {text(item.title)}
              </Link>
              <p className="text-xs text-muted-foreground">
                {text(item.company)} · {item.kind === "job" ? "Job" : "Application"}
              </p>
            </div>
            <DeadlineBadge row={{ ...item, deadline_level: item.level, deadline_days: item.days_left }} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

import { Link } from "@tanstack/react-router"
import { Panel, Empty } from "@/components/workspace-ui"
import { DeadlineBadge } from "@/components/deadline-badge"
import { text, type Row } from "@/lib/api"

/** Overdue and soon-due roles and applications from the overview, soonest first. */
export function DeadlinePanel({ items }: { items: Row[] }) {
  return (
    <Panel title="Deadlines">
      {items.length === 0 ? (
        <Empty title="No deadlines close" description="Roles and applications due within 7 days, or overdue, appear here." />
      ) : (
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
      )}
    </Panel>
  )
}

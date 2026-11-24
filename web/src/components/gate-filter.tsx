import { useState } from "react"
import { Button } from "@/components/ui/button"
import { prepareSkill } from "@/lib/agent"
import { isFailed } from "@/lib/gates"
import { text, type Row } from "@/lib/api"

/**
 * "Hide failed" per jobs tab, on by default in New. Failed jobs are only
 * collapsed: they stay counted and come back when the filter is turned off.
 */
export function useHideFailed(view: string, rows: Row[]) {
  const [choice, setChoice] = useState<Record<string, boolean>>({})
  const hide = choice[view] ?? view === "new"
  const failed = rows.filter(isFailed).length
  return {
    rows: hide ? rows.filter(row => !isFailed(row)) : rows,
    control: (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={hide} onChange={() => setChoice({ ...choice, [view]: !hide })} />
        Hide failed
        <span role="status" aria-label="Failed jobs" className="text-muted-foreground">
          {failed === 0 ? "(none failed)" : hide ? `(${failed} hidden)` : `(${failed} shown)`}
        </span>
      </label>
    ),
  }
}

/** Run the requirements check on the selected jobs, in the agent panel. */
export function CheckRequirements({ jobs }: { jobs: Row[] }) {
  return (
    <Button size="sm" variant="outline" disabled={!jobs.length}
      onClick={() => prepareSkill("requirements-check", { jobIds: jobs.map(job => text(job.id)).join(",") })}>
      Check requirements
    </Button>
  )
}

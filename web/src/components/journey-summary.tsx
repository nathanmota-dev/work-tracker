import { ChevronRight } from "lucide-react"
import {
  PHASES,
  type JourneyPhase,
  type ApplicationSummary,
} from "@/lib/application-journey"
import { cn } from "@/lib/utils"

const FILLS: Record<JourneyPhase, string> = {
  draft: "bg-muted-foreground/40",
  prepared: "bg-primary/60",
  filled: "bg-amber-500",
  submitted: "bg-emerald-500",
}

/**
 * Draft, prepared, filled and submitted as one horizontal funnel; each step
 * links to Applications filtered by it, and its bar shows its share of the total.
 */
export function JourneyFunnel({ phases }: { phases: Record<JourneyPhase, number> }) {
  const keys = Object.keys(PHASES) as JourneyPhase[]
  const total = keys.reduce((sum, key) => sum + phases[key], 0)
  return (
    <ol aria-label="Application journey" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {keys.map((phase, index) => {
        const filled = total ? Math.round((phases[phase] / total) * 12) : 0
        return (
          <li key={phase} className="relative flex">
            <a href={`#/applications?status=${phase}`} aria-label={`${phases[phase]} ${PHASES[phase].label.toLowerCase()}`}
              className="flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring">
              <span className="text-xs text-muted-foreground">{index + 1}. {PHASES[phase].label}</span>
              <span className="text-2xl font-medium tabular-nums">{phases[phase]}</span>
              <span aria-hidden className="flex gap-[3px]">
                {Array.from({ length: 12 }, (_, i) => <span key={i} className={cn("h-1.5 flex-1 rounded-[2px]", i < filled ? FILLS[phase] : "bg-muted")} />)}
              </span>
              <span className="truncate text-xs text-muted-foreground" title={PHASES[phase].hint}>{PHASES[phase].hint}</span>
            </a>
            {index < keys.length - 1 && (
              <ChevronRight aria-hidden className="absolute top-1/2 -right-2.5 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-background text-muted-foreground xl:block" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Records counted in more than one dimension, stated so totals are not added twice. */
export function JourneyOverlaps({ summary }: { summary: ApplicationSummary }) {
  const { ready_resumes, needs_input, submitted_archived, submitted_untracked } =
    summary.overlaps
  const notes = [
    ready_resumes && `${ready_resumes} with a ready resume, including filled and submitted ones`,
    needs_input && `${needs_input} filled but waiting for your input`,
    submitted_archived && `${submitted_archived} submitted and archived`,
    submitted_untracked && `${submitted_untracked} submitted but not on the board yet`,
  ].filter(Boolean)
  if (!notes.length) return null
  return (
    <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p>
  )
}

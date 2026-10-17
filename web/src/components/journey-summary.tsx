import { Stats } from "@/components/workspace-ui"
import {
  PHASES,
  type ApplicationSummary,
  type JourneyPhase,
} from "@/lib/application-journey"

/** Draft, prepared, filled and submitted totals; each application counts once. */
export function JourneyCounts({
  phases,
  href,
}: {
  phases: Record<JourneyPhase, number>
  href?: string
}) {
  return (
    <Stats
      items={(Object.keys(PHASES) as JourneyPhase[]).map((phase) => ({
        label: PHASES[phase].label,
        value: href ? (
          <a href={href} aria-label={`${phases[phase]} ${PHASES[phase].label.toLowerCase()}`}>
            {phases[phase]}
          </a>
        ) : (
          phases[phase]
        ),
        hint: PHASES[phase].hint,
      }))}
    />
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

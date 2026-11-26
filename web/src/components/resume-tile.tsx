import { Badge } from "@/components/ui/badge"
import { Status } from "@/components/workspace-ui"
import { ATS_NOTE, NOT_ENOUGH, atsTone, bandLabels, type AtsBest, type ScoreTone } from "@/lib/ats"
import { cn } from "@/lib/utils"
import { resumeHref, roleLabels, type ResumeVariant } from "@/lib/variants"

export const statusLabels: Record<ResumeVariant["status"], string> = { generating: "Generating", ready: "Ready", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted", waiting_for_sign_in: "Waiting for sign-in" }
const RING: Record<ScoreTone, string> = { good: "stroke-emerald-500", warn: "stroke-amber-500", bad: "stroke-destructive", none: "stroke-muted-foreground" }
const RADIUS = 15
const LENGTH = 2 * Math.PI * RADIUS

/** A resume's ATS score against a job, as a ring; the number and its label carry the meaning. */
export function ScoreRing({ match, subject = "its job" }: { match: Pick<AtsBest, "score" | "band">; subject?: string }) {
  const tone = atsTone(match)
  const label = match.score === null || !match.band ? NOT_ENOUGH : `${match.score} · ${bandLabels[match.band]}`
  return <span role="img" aria-label={`Match with ${subject}: ${label}`} title={ATS_NOTE} className="relative grid size-12 place-items-center rounded-full bg-background">
    <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3" className="stroke-muted" />
      {match.score !== null && <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3" strokeLinecap="round" className={RING[tone]} strokeDasharray={`${(match.score / 100) * LENGTH} ${LENGTH}`} />}
    </svg>
    <span className="text-sm font-semibold tabular-nums" aria-hidden>{match.score ?? "—"}</span>
  </span>
}

/** A sheet of paper with the score ring, or plain text lines without one. */
function Thumbnail({ variant }: { variant: ResumeVariant }) {
  return <div aria-hidden={!variant.match} className="relative mx-auto flex h-32 w-24 flex-col items-center gap-2 rounded-sm bg-muted px-3 pt-4 shadow-sm transition-transform group-hover:-rotate-2">
    {variant.match ? <ScoreRing match={variant.match} /> : <span className="h-2 w-12 self-start rounded bg-muted-foreground/30" />}
    {[10, 14, 12, 16].map(width => <span key={width} className="h-1.5 self-start rounded bg-muted-foreground/20" style={{ width: `${width * 4}px` }} />)}
  </div>
}

/** One saved resume in the Resumes grid; opens its page with the PDF. */
export function ResumeTile({ variant }: { variant: ResumeVariant }) {
  return <a href={resumeHref(variant.id)} aria-label={variant.name} className={cn("group flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring", variant.archivedAt && "opacity-60")}>
    <div className="relative rounded-lg bg-accent/30 py-4">
      <Thumbnail variant={variant} />
      {variant.status !== "ready" && <span className="absolute right-2 top-2"><Status value={statusLabels[variant.status]} /></span>}
    </div>
    <div className="min-w-0 space-y-2">
      <h3 className="truncate text-sm font-medium" title={variant.name}>{variant.name}</h3>
      <p className="text-xs text-muted-foreground">{roleLabels[variant.role]}</p>
      <ul aria-label={`Stacks of ${variant.name}`} className="flex flex-wrap gap-1">{variant.stacks.map(stack => <li key={stack}><Badge variant="secondary">{stack}</Badge></li>)}</ul>
    </div>
  </a>
}

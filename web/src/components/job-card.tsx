import { Archive, ArchiveRestore, ListPlus, MoreHorizontal, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CardBadge, CardLinkButton, OpportunityCard, ScoreBar, shortDate } from "@/components/opportunity-card"
import { openExternal, text, webUrl, type Row } from "@/lib/api"
import { ATS_NOTE, atsTone, verdictTone, type AtsBest, type ScoreTone } from "@/lib/ats"
import { rankingLabel, TRIAGE_NOTE } from "@/lib/ranking"
import { linkedApplication } from "@/components/job-list"
import { deadlineLabel, type DeadlineLevel } from "@/lib/deadline"
import { rowVerdict } from "@/lib/gates"
import { phaseLabel } from "@/components/application-list"

export type JobMutation = "archive" | "restore" | "shortlist"

/** The band a job's card shows: its triage verdict, else its best resume's ATS band. */
export function jobTone(row: Row): ScoreTone {
  if (row.ranking_status === "scored" && typeof row.ranking_overall === "number") return verdictTone(row.ranking_verdict)
  const match = row.ats_match as AtsBest | undefined
  return typeof match?.score === "number" ? atsTone(match) : "none"
}

/**
 * A job's triage score. Without one it falls back to the best resume's ATS match,
 * labelled as such; with neither it shows the ranking state instead of a number.
 */
export function JobScore({ row, label = "Fit score" }: { row: Row; label?: string }) {
  const scored = row.ranking_status === "scored" && typeof row.ranking_overall === "number"
  const match = row.ats_match as AtsBest | undefined
  if (!scored && typeof match?.score === "number")
    return <ScoreBar label="Resume match" value={match.score} tone={atsTone(match)} title={ATS_NOTE} />
  return (
    <ScoreBar
      label={label}
      value={scored ? Number(row.ranking_overall) : null}
      tone={scored ? verdictTone(row.ranking_verdict) : "none"}
      empty={rankingLabel(row) ?? undefined}
      title={TRIAGE_NOTE}
    />
  )
}

export function JobMenu({ row, busy, onMutate, onDelete, align = "start" }: {
  row: Row
  busy: boolean
  onMutate: (action: JobMutation, row: Row) => void
  onDelete: (row: Row) => void
  align?: "start" | "end"
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`More actions for ${text(row.title)}`} className="text-muted-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {!row.archived_at && !row.shortlisted_at && (
          <DropdownMenuItem onSelect={() => onMutate("shortlist", row)}><ListPlus /> Move to shortlist</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onMutate(row.archived_at ? "restore" : "archive", row)}>
          {row.archived_at ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}><Trash2 className="text-destructive" /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A saved job as an `OpportunityCard`. */
export function JobCard({ row, selected, fresh, busy, onToggle, onOpen, onMutate, onDelete }: {
  row: Row
  selected: boolean
  fresh: boolean
  busy: boolean
  onToggle: () => void
  onOpen: () => void
  onMutate: (action: JobMutation, row: Row) => void
  onDelete: (row: Row) => void
}) {
  const title = text(row.title)
  const application = linkedApplication(row)
  const gate = rowVerdict(row)
  const level = (row.deadline_level ?? "none") as DeadlineLevel
  const deadline = typeof row.deadline === "string" && row.deadline ? deadlineLabel(level, typeof row.deadline_days === "number" ? row.deadline_days : null) : ""
  return (
    <OpportunityCard
      company={row.company_name ? String(row.company_name) : undefined}
      title={title}
      badges={(fresh || !!row.closing_soon || !!application || !!deadline || gate === "fail" || gate === "flag") && <>
        {fresh && <CardBadge tone="primary">Just added</CardBadge>}
        {application && <CardBadge>{phaseLabel(application.phase)}</CardBadge>}
        {(gate === "fail" || gate === "flag") && (
          <CardBadge tone={gate === "fail" ? "danger" : "warn"} title="Requirements check">{gate === "fail" ? "Fails requirements" : "Requirements flagged"}</CardBadge>
        )}
        {deadline ? <CardBadge tone={level === "overdue" ? "danger" : level === "soon" ? "warn" : "muted"} title={`Deadline ${row.deadline}`}>{deadline}</CardBadge>
          : !!row.closing_soon && <CardBadge tone="warn">Closing soon</CardBadge>}
      </>}
      score={<JobScore row={row} />}
      location={[row.location, row.work_type].filter(Boolean).map(String).join(" · ")}
      menu={<JobMenu row={row} busy={busy} onMutate={onMutate} onDelete={onDelete} />}
      date={shortDate(row.scouted_at)}
      action={<CardLinkButton disabled={!webUrl(row.link)} onClick={() => void openExternal(row.link).catch(() => {})} />}
      selected={selected}
      disabled={busy}
      onToggle={onToggle}
      onOpen={onOpen}
    />
  )
}

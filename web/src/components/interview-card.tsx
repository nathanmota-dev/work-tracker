import { CalendarClock, Check, GraduationCap, MoreHorizontal, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CardAvatar, CardBadge, type CardBadgeTone } from "@/components/opportunity-card"
import { CardMeta, DetailsSheet, EntityCard, FactList, humanize, relativeDay, whenLabel } from "@/components/entity-card"
import { INTERVIEW_STAGES, INTERVIEW_STATUSES } from "@/components/interview-form"
import { text, type Row } from "@/lib/api"

export type InterviewAction = "edit" | "done" | "closed" | "delete"

export const stageLabel = (value: unknown) => INTERVIEW_STAGES.find(([key]) => key === value)?.[1] ?? (humanize(value) || "Interview")
const statusLabel = (value: unknown) => INTERVIEW_STATUSES.find(([key]) => key === value)?.[1] ?? humanize(value)
export const prepHref = (row: Row) => `#/interview-prep?q=${encodeURIComponent(text(row.company))}`

/** Upcoming is still ahead; past already happened; closed ended the process. */
export function interviewBucket(row: Row, now = Date.now()): "upcoming" | "past" | "closed" {
  if (row.status === "closed" || row.status === "cancelled") return "closed"
  if (row.status === "done") return "past"
  const time = new Date(String(row.scheduled_at ?? "")).getTime()
  return row.scheduled_at && !Number.isNaN(time) && time < now ? "past" : "upcoming"
}

function DayBadge({ row }: { row: Row }) {
  const label = relativeDay(row.scheduled_at)
  if (!label) return <CardBadge>Date not set</CardBadge>
  const days = Math.round((new Date(String(row.scheduled_at)).getTime() - Date.now()) / 86_400_000)
  const tone: CardBadgeTone = interviewBucket(row) !== "upcoming" ? "muted" : days <= 2 ? "warn" : "primary"
  return <CardBadge tone={tone}>{label}</CardBadge>
}

export function InterviewMenu({ row, onAction, align = "start" }: { row: Row; onAction: (action: InterviewAction, row: Row) => void; align?: "start" | "end" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${text(row.company)}`} className="text-muted-foreground"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onSelect={() => onAction("edit", row)}><Pencil /> Edit</DropdownMenuItem>
        {row.status !== "done" && <DropdownMenuItem onSelect={() => onAction("done", row)}><Check /> Mark as done</DropdownMenuItem>}
        {row.status !== "closed" && <DropdownMenuItem onSelect={() => onAction("closed", row)}><X /> Close process</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete", row)}><Trash2 className="text-destructive" /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PrepButton({ row, primary = false }: { row: Row; primary?: boolean }) {
  return (
    <Button asChild size="sm" variant={primary ? "default" : "outline"} className="rounded-full">
      <a href={prepHref(row)}><GraduationCap className="size-3.5" /> Prep</a>
    </Button>
  )
}

export function InterviewCard({ row, onOpen, onAction }: { row: Row; onOpen: () => void; onAction: (action: InterviewAction, row: Row) => void }) {
  const status = row.status && row.status !== "scheduled" ? <CardBadge>{statusLabel(row.status)}</CardBadge> : null
  return (
    <EntityCard
      name={text(row.company)}
      eyebrow={stageLabel(row.stage)}
      title={text(row.company)}
      badges={<><DayBadge row={row} />{status}</>}
      meta={[<CardMeta key="when" icon={CalendarClock}>{whenLabel(row.scheduled_at)}</CardMeta>]}
      menu={<InterviewMenu row={row} onAction={onAction} />}
      action={interviewBucket(row) === "upcoming" && <PrepButton row={row} />}
      onOpen={onOpen}
    >
      {row.notes ? <p className="line-clamp-2 text-sm text-muted-foreground">{String(row.notes)}</p> : undefined}
    </EntityCard>
  )
}

/** The next conversation, with a countdown and the way into its preparation. */
export function NextInterview({ row, onOpen }: { row: Row; onOpen: () => void }) {
  return (
    <section aria-label="Next conversation" className="flex flex-wrap items-center gap-5 rounded-2xl border bg-card p-5">
      <CardAvatar name={text(row.company)} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Next conversation · {stageLabel(row.stage)}</p>
        <p className="mt-0.5 truncate text-lg font-medium">{text(row.company)}</p>
        <p className="text-sm text-muted-foreground">{whenLabel(row.scheduled_at)}{row.notes ? ` · ${String(row.notes)}` : ""}</p>
      </div>
      <p className="text-2xl font-medium tracking-tight">{relativeDay(row.scheduled_at) || "Date not set"}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="rounded-full" onClick={onOpen}>Details</Button>
        <PrepButton row={row} primary />
      </div>
    </section>
  )
}

export function InterviewSheet({ row, onClose, onAction }: { row: Row | null; onClose: () => void; onAction: (action: InterviewAction, row: Row) => void }) {
  return (
    <DetailsSheet
      open={!!row}
      title={text(row?.company)}
      description={row ? `${stageLabel(row.stage)} · ${whenLabel(row.scheduled_at)}` : undefined}
      onClose={onClose}
      actions={row && <>
        <Button asChild><a href={prepHref(row)}><GraduationCap /> Prepare</a></Button>
        <Button variant="outline" onClick={() => onAction("edit", row)}><Pencil /> Edit</Button>
        <div className="ml-auto"><InterviewMenu row={row} onAction={onAction} align="end" /></div>
      </>}
    >
      {row && <FactList facts={[
        ["Company", row.company], ["Stage", stageLabel(row.stage)], ["When", whenLabel(row.scheduled_at)],
        ["Status", statusLabel(row.status)], ["Notes", row.notes],
      ]} />}
    </DetailsSheet>
  )
}

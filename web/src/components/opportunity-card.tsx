import type { ReactNode } from "react"
import { ArrowUpRight, Check, Globe, Maximize2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import type { ScoreTone } from "@/lib/ats"
import { cn } from "@/lib/utils"

/*
 * Reusable opportunity card, built from small parts so other pages can compose
 * their own variant. `OpportunityCard` is the ready-made layout:
 *
 *   [Avatar]  Company                [Details]
 *             Title
 *             badges
 *   Score bar
 *   🌐 Location
 *   [⋯ menu] date                    [Action]
 */

export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase()
}

/** Short date as dd/mm/yy; empty when the value is not a date. */
export function shortDate(value: unknown) {
  const parsed = new Date(String(value ?? ""))
  if (!value || Number.isNaN(parsed.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${pad(parsed.getFullYear() % 100)}`
}

/** Company initials; with `onToggle` it doubles as the card's selection checkbox. */
export function CardAvatar({ name, selected = false, disabled, label, onToggle }: {
  name: string
  selected?: boolean
  disabled?: boolean
  /** Accessible name of the selection toggle. */
  label?: string
  onToggle?: () => void
}) {
  const className = cn("grid size-10 shrink-0 place-items-center rounded-lg border text-xs font-medium text-muted-foreground transition-[color,background-color,border-color,transform] duration-200 motion-safe:active:scale-90",
    selected && "border-primary bg-primary text-primary-foreground")
  // Keyed so the turn replays when the initials and the check swap.
  const turn = "inline-grid motion-safe:animate-[avatar-turn_420ms_cubic-bezier(0.34,1.4,0.64,1)_both]"
  const content = selected
    ? <Check key="check" className={cn("size-4", turn)} />
    : <span key="initials" className={turn}>{initials(name)}</span>
  if (!onToggle) return <div aria-hidden className={className}>{content}</div>
  return (
    <button type="button" role="checkbox" aria-checked={selected} aria-label={label ?? `Select ${name}`} title="Select"
      disabled={disabled} onClick={onToggle} className={cn(className, "cursor-pointer hover:border-foreground/30", selected && "hover:border-primary")}>
      {content}
    </button>
  )
}

const FILLED: Record<ScoreTone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  none: "bg-muted-foreground/40",
}

/** Segmented 0–100 bar; `value` null shows `empty` instead of a number. */
export function ScoreBar({ label, value, tone, empty = "Not scored yet", title, segments = 20 }: {
  label: string
  value: number | null
  tone: ScoreTone
  empty?: string
  title?: string
  segments?: number
}) {
  const filled = value === null ? 0 : Math.round((Math.max(0, Math.min(100, value)) / 100) * segments)
  return (
    <div title={title} data-tone={tone} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value ?? undefined} aria-valuetext={value === null ? empty : `${value} out of 100`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {value === null ? (
          <span className="truncate text-xs text-muted-foreground">{empty}</span>
        ) : (
          <span className="text-lg font-medium tabular-nums">
            {value}
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">/100</span>
          </span>
        )}
      </div>
      <Segments total={segments} filled={filled} fill={FILLED[tone]} />
    </div>
  )
}

/** The segmented track shared by the score and progress bars. */
function Segments({ total, filled, fill }: { total: number; filled: number; fill: string }) {
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-2.5 flex-1 rounded-[2px] bg-muted">
          {i < filled && (
            <span className={cn("block size-full origin-left rounded-[2px] motion-safe:animate-[score-segment_260ms_ease-out_both]", fill)}
              style={{ animationDelay: `${i * 35}ms` }} />
          )}
        </span>
      ))}
    </div>
  )
}

export type ProgressTone = "primary" | "good" | "muted"
const PROGRESS: Record<ProgressTone, string> = {
  primary: "bg-primary",
  good: "bg-emerald-500",
  muted: "bg-muted-foreground/40",
}

/** Step `current` of `total` on the same segmented track; `step` names where it is now. */
export function ProgressBar({ label = "Progress", step, current, total, tone = "primary", title, segments = 20 }: {
  label?: string
  step: string
  current: number
  total: number
  tone?: ProgressTone
  title?: string
  segments?: number
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0
  return (
    <div title={title} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total}
      aria-valuenow={current} aria-valuetext={`${step}, step ${current} of ${total}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="min-w-0 truncate text-sm font-medium">
          {step}
          {total > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{current}/{total}</span>}
        </span>
      </div>
      <Segments total={segments} filled={Math.round(ratio * segments)} fill={PROGRESS[tone]} />
    </div>
  )
}

export type CardBadgeTone = "primary" | "warn" | "danger" | "muted"
const BADGES: Record<CardBadgeTone, string> = {
  primary: "bg-primary/10 text-primary",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
}

export function CardBadge({ tone = "muted", title, children }: { tone?: CardBadgeTone; title?: string; children: ReactNode }) {
  return <span title={title} className={cn("rounded px-1.5 py-0.5 text-[11px]", BADGES[tone])}>{children}</span>
}

export function CardHeader({ avatar, eyebrow, title, badges, action, onOpen }: {
  avatar?: ReactNode
  /** Small line above the title, such as the company. */
  eyebrow?: ReactNode
  title: ReactNode
  badges?: ReactNode
  /** Top-right control, such as the details button. */
  action?: ReactNode
  onOpen?: () => void
}) {
  return (
    <div className="flex items-start gap-3">
      {avatar}
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="truncate text-xs text-muted-foreground">{eyebrow}</p>}
        {onOpen ? (
          <button type="button" onClick={onOpen} className="mt-0.5 line-clamp-3 cursor-pointer text-left text-[15px] leading-snug font-medium hover:underline">{title}</button>
        ) : (
          <p className="mt-0.5 line-clamp-3 text-[15px] leading-snug font-medium">{title}</p>
        )}
        {badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}
      </div>
      {action}
    </div>
  )
}

export function CardDetailsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 text-muted-foreground" aria-label={label} title="View details" onClick={onClick}>
      <Maximize2 className="size-3.5" />
    </Button>
  )
}

export function CardLocation({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Globe className="size-3.5 shrink-0" />
      <span className="truncate">{children || "Location not set"}</span>
    </div>
  )
}

/** Bottom row: menu and date on the left, main action on the right. */
export function CardFooter({ menu, date, action }: { menu?: ReactNode; date?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        {menu}
        {date && <span className="truncate text-xs leading-none text-muted-foreground tabular-nums">{date}</span>}
      </div>
      {action}
    </div>
  )
}

export function CardLinkButton({ label = "View job", disabled, onClick }: { label?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="rounded-full" disabled={disabled} onClick={onClick}>
      {label} <ArrowUpRight className="size-3.5" />
    </Button>
  )
}

export function CardShell({ selected, label, className, children }: { selected?: boolean; label?: string; className?: string; children: ReactNode }) {
  return (
    <article aria-label={label} className={cn("flex w-full min-w-0 flex-col gap-5 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/20",
      selected && "border-primary/60 ring-1 ring-primary/40", className)}>
      {children}
    </article>
  )
}

/** The standard layout of the parts above; every slot is optional except the title. */
export function OpportunityCard({ company, title, badges, score, location, menu, date, action, selected, selectLabel, disabled, onToggle, onOpen, className }: {
  company?: string
  title: string
  badges?: ReactNode
  score?: ReactNode
  location?: ReactNode
  menu?: ReactNode
  date?: string
  action?: ReactNode
  selected?: boolean
  selectLabel?: string
  disabled?: boolean
  /** Makes the avatar a selection checkbox. */
  onToggle?: () => void
  /** Opens the details; shows the details button and makes the title clickable. */
  onOpen?: () => void
  className?: string
}) {
  return (
    <CardShell selected={selected} label={title} className={className}>
      <CardHeader
        avatar={<CardAvatar name={company || title} selected={selected} disabled={disabled} label={selectLabel ?? `Select ${title}`} onToggle={onToggle} />}
        eyebrow={company}
        title={title}
        badges={badges}
        onOpen={onOpen}
        action={onOpen && <CardDetailsButton label={`View details of ${title}`} onClick={onOpen} />}
      />
      {score && <div className="mt-auto">{score}</div>}
      <CardLocation>{location}</CardLocation>
      <CardFooter menu={menu} date={date} action={action} />
    </CardShell>
  )
}

/** Placeholder with the card's shape, shown while the list loads. */
export function OpportunityCardSkeleton() {
  return (
    <CardShell className="pointer-events-none">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <div className="mt-auto space-y-2.5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-12" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-[2px]" />
      </div>
      <Skeleton className="h-3 w-32" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
    </CardShell>
  )
}

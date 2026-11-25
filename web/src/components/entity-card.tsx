import type { ComponentType, ReactNode } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CardAvatar, CardDetailsButton, CardFooter, CardHeader, CardShell } from "@/components/opportunity-card"
import { text } from "@/lib/api"

/*
 * The generic sibling of `OpportunityCard`, for records that are not roles:
 * interviews, people, preparation packs. Same shell, header and footer, with
 * a free body and icon-labelled meta lines instead of a score and location.
 *
 *   [Avatar]  Eyebrow                [Details]
 *             Title
 *             badges
 *   body
 *   ⓘ meta · ⓘ meta
 *   [⋯ menu] date                    [Action]
 */

export function CardMeta({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  )
}

export function EntityCard({ name, eyebrow, title, badges, children, meta, menu, date, action, onOpen, className }: {
  /** Seed of the avatar's initials, such as the company or the person. */
  name: string
  eyebrow?: ReactNode
  title: string
  badges?: ReactNode
  children?: ReactNode
  /** Icon-labelled lines above the footer; empty entries are skipped. */
  meta?: ReactNode[]
  menu?: ReactNode
  date?: string
  action?: ReactNode
  onOpen?: () => void
  className?: string
}) {
  const lines = (meta ?? []).filter(Boolean)
  return (
    <CardShell label={title} className={className}>
      <CardHeader
        avatar={<CardAvatar name={name} />}
        eyebrow={eyebrow}
        title={title}
        badges={badges}
        onOpen={onOpen}
        action={onOpen && <CardDetailsButton label={`View details of ${title}`} onClick={onOpen} />}
      />
      {children}
      {!!lines.length && <div className="space-y-1.5">{lines}</div>}
      {/* Cards in a row share their height: the footer stays at the bottom. */}
      <div className="mt-auto"><CardFooter menu={menu} date={date} action={action} /></div>
    </CardShell>
  )
}

/** The responsive grid every card list uses. */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{children}</div>
}

/** "Interviews · 3 of 5": the count line between the filters and the grid. */
export function CountLine({ label, shown, total }: { label: string; shown: number; total: number }) {
  return (
    <p className="text-sm">
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground"> · {shown}{shown !== total ? ` of ${total}` : ""}</span>
    </p>
  )
}

/** Label and value pairs; empty values are left out. */
export function FactList({ facts }: { facts: [string, unknown][] }) {
  return (
    <dl className="grid gap-x-6 sm:grid-cols-2">
      {facts.filter(([, value]) => value != null && value !== "").map(([label, value]) => (
        <div key={label} className="border-t py-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-sm break-words whitespace-pre-wrap">{text(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Side panel with a record's details, the same frame as the job details. */
export function DetailsSheet({ open, title, description, actions, onClose, children }: {
  open: boolean
  title: string
  description?: ReactNode
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="text-base leading-snug">{title}</SheetTitle>
          <SheetDescription>{description ?? "Details saved in your workspace"}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** "hiring-manager" and "do_not_contact" as "Hiring manager" and "Do not contact". */
export function humanize(value: unknown) {
  const words = String(value ?? "").replace(/[-_]+/g, " ").trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : ""
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago", by calendar day. */
export function relativeDay(value: unknown, now = new Date()) {
  const parsed = new Date(String(value ?? ""))
  if (!value || Number.isNaN(parsed.getTime())) return ""
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((day(parsed) - day(now)) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  return days > 0 ? `In ${days} days` : `${-days} days ago`
}

/** Weekday, date and time, such as "Fri, Nov 27 · 19:47". */
export function whenLabel(value: unknown) {
  const parsed = new Date(String(value ?? ""))
  if (!value || Number.isNaN(parsed.getTime())) return "Not scheduled"
  const day = parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  const time = parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  return `${day} · ${time}`
}

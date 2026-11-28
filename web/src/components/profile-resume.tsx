import { useState, type ReactNode } from "react"
import { ArrowUpRight, ChevronDown, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openExternal, webUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ResumeEntry } from "../../../src/profile/types"

/** Brazilian order: `YYYY-MM-DD` as "15/07/2025", `YYYY-MM` as "07/2025"; a year or "Present" as written. */
export function profileMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value)
  if (!match) return value
  return match[3] ? `${match[3]}/${match[2]}/${match[1]}` : `${match[2]}/${match[1]}`
}
export function period(entry: Pick<ResumeEntry, "start" | "end">): string {
  const [start, end] = [profileMonth(entry.start), profileMonth(entry.end)]
  return start && end ? `${start} — ${end}` : start || end
}

/** A titled block of the profile with its count and an optional action on the right. */
export function ProfileSection({ title, count, action, children, id }: { title: string; count?: number; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          {title}
          {count !== undefined && <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function EditButton({ label, onClick, children = "Edit" }: { label: string; onClick: () => void; children?: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" className="text-muted-foreground" aria-label={label} onClick={onClick}>
      <Pencil className="size-3.5" />{children}
    </Button>
  )
}

/** Chips, with "Show all" once there are more than `limit`. */
export function Chips({ items, label, limit = 12 }: { items: string[]; label: string; limit?: number }) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, limit)
  return (
    <div className="space-y-3">
      <ul aria-label={label} className="flex flex-wrap gap-2">
        {shown.map(item => <li key={item} className="rounded-full border bg-muted/40 px-3 py-1 text-sm">{item}</li>)}
      </ul>
      {items.length > limit && (
        <button type="button" className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${items.length})`}
        </button>
      )}
    </div>
  )
}

/** Up to three lines of the role's bullets, with "Read more" when they are longer. */
function Bullets({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const long = items.length > 3 || items.join("").length > 280
  return (
    <div>
      <ul className={cn("space-y-1 text-sm leading-relaxed text-muted-foreground", !open && long && "line-clamp-3")}>
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
      {long && (
        <button type="button" className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Read less" : "Read more"}<ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      )}
    </div>
  )
}

/** Roles or courses on a vertical line, most recent first, the first `limit` until "Show all". */
export function Timeline({ entries, label, limit = 3 }: { entries: ResumeEntry[]; label: string; limit?: number }) {
  const [open, setOpen] = useState(false)
  const shown = open ? entries : entries.slice(0, limit)
  return (
    <div className="space-y-4">
      <ol aria-label={label} className="relative space-y-6 border-l pl-6">
        {shown.map((entry, index) => (
          <li key={`${entry.organization}-${entry.start}-${index}`} className="relative">
            <span aria-hidden className={cn("absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2 bg-background", entry.end === "Present" ? "border-primary" : "border-muted-foreground/50")} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <h3 className="font-medium">{entry.title || entry.organization}{entry.hidden && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">Not on base resume</span>}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">{period(entry)}</span>
            </div>
            {entry.title && <p className="text-sm text-muted-foreground">{[entry.organization, entry.location].filter(Boolean).join(" · ")}</p>}
            <div className="mt-2 space-y-2">
              <Bullets items={entry.bullets} />
              {entry.skills.length > 0 && (
                <ul aria-label={`Stack at ${entry.organization}`} className="flex flex-wrap gap-1">
                  {entry.skills.map(skill => <li key={skill} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{skill}</li>)}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      {entries.length > limit && (
        <button type="button" className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${entries.length})`}
        </button>
      )}
    </div>
  )
}

/** "LinkedIn ↗" style link, opened in the system browser. */
export function ProfileLink({ href, children }: { href: string; children: ReactNode }) {
  if (!webUrl(href)) return null
  return (
    <button type="button" title={href} onClick={() => void openExternal(href).catch(() => {})}
      className="inline-flex cursor-pointer items-center gap-0.5 underline-offset-4 hover:underline">
      {children}<ArrowUpRight className="size-3" />
    </button>
  )
}

/** An empty section's hint with its call to action. */
export function SectionEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
      <span>{children}</span>{action}
    </div>
  )
}

import { useState, type ReactNode } from "react"
import { ArrowUpRight, ChevronDown, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { JobMenu, JobScore, type JobMutation } from "@/components/job-card"
import { shortDate } from "@/components/opportunity-card"
import { JobApplication, linkedApplication } from "@/components/job-list"
import { PostingCheck } from "@/components/posting-check"
import { GateDetails, RowGateBadge } from "@/components/gate-badge"
import { RankingDetail } from "@/components/ranking-detail"
import { ResumeMatchBadge, ResumeMatchDetail } from "@/components/resume-match-detail"
import { DeadlineBadge } from "@/components/deadline-badge"
import { openExternal, text, webUrl, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
import { prepareSkill } from "@/lib/agent"
import { applyLabel } from "@/lib/application-journey"
import type { AtsBest } from "@/lib/ats"
import { cn } from "@/lib/utils"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function stage(row: Row) {
  const [label, dot] = row.archived_at ? ["Archived", "bg-muted-foreground"] : row.shortlisted_at ? ["Shortlisted", "bg-emerald-500"] : ["New", "bg-amber-500"]
  return <span className="inline-flex items-center gap-2"><span className={cn("size-1.5 rounded-full", dot)} />{label}</span>
}

function Description({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false)
  if (!value) return <p className="text-sm text-muted-foreground">No description saved yet.</p>
  return (
    <div>
      <div className={cn("relative whitespace-pre-wrap text-sm leading-relaxed", !open && "max-h-48 overflow-hidden")}>
        {String(value)}
        {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />}
      </div>
      <button type="button" className="mt-2 inline-flex cursor-pointer items-center gap-1 text-sm font-medium" onClick={() => setOpen(!open)}>
        {open ? "Show less" : "Read full description"}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
    </div>
  )
}

function Facts({ row }: { row: Row }) {
  const facts: [string, unknown][] = [
    ["Company", row.company_name], ["Role", row.title], ["Location", row.location], ["Work type", row.work_type],
    ["Compensation", row.comp], ["Saved", shortDate(row.scouted_at)], ["Deadline", row.deadline], ["Source", row.source], ["LinkedIn job ID", row.linkedin_job_id],
  ]
  return (
    <dl className="grid gap-x-6 sm:grid-cols-2">
      {facts.filter(([, value]) => value != null && value !== "").map(([label, value]) => (
        <div key={label} className="border-t py-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-sm break-words">{text(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function JobDetailsSheet({ row, busy, error, onClose, onEdit, onMutate, onDelete }: {
  row: Row | null
  busy: boolean
  error: string
  onClose: () => void
  onEdit: (row: Row) => void
  onMutate: (action: JobMutation, row: Row) => void
  onDelete: (row: Row) => void
}) {
  const application = row ? linkedApplication(row) : undefined
  const meta = row ? [row.company_name, shortDate(row.scouted_at) && `Saved ${shortDate(row.scouted_at)}`, row.source].filter(Boolean).map(String).join(" · ") : ""
  return (
    <Sheet open={!!row} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        {row && <>
          <SheetHeader className="border-b px-6 py-5 pr-12">
            <SheetTitle className="text-base leading-snug">{text(row.title)}</SheetTitle>
            <SheetDescription>{meta || "Details saved in your workspace"}</SheetDescription>
            {webUrl(row.link) && (
              <button type="button" className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => void openExternal(row.link).catch(() => {})}>
                View job <ArrowUpRight className="size-3.5" />
              </button>
            )}
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <div className="space-y-5 rounded-2xl border bg-card p-5">
              <JobScore row={row} />
              <div className="space-y-3 border-t pt-4">
                <SummaryRow label="Stage">{stage(row)}</SummaryRow>
                <SummaryRow label="Resume match"><ResumeMatchBadge match={row.ats_match as AtsBest | undefined} /></SummaryRow>
                <SummaryRow label="Requirements"><RowGateBadge row={row} /></SummaryRow>
                {!!row.deadline && <SummaryRow label="Deadline"><DeadlineBadge row={row} /></SummaryRow>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || !!row.archived_at} onClick={() => openApply(row.id, application?.id)}>{applyLabel(application)}</Button>
              <Button variant="outline" disabled={busy || !!row.archived_at} onClick={() => {
                onClose()
                prepareSkill("deep-scout", { query: text(row.link ?? row.linkedin_job_id ?? row.title) })
              }}>Assess fit</Button>
              <Button variant="outline" disabled={busy} onClick={() => {
                onClose()
                prepareSkill("requirements-check", { jobIds: text(row.id) })
              }}>Check requirements</Button>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => onEdit(row)}><Pencil /> Edit job</Button>
                <JobMenu row={row} busy={busy} onMutate={onMutate} onDelete={onDelete} align="end" />
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {!!row.archived_at && <p className="text-sm text-muted-foreground">Restore this role before preparing a new application.</p>}
            <PostingCheck guard={row.description_guard_json} description={row.description} />
            <GateDetails jobId={row.id} />
            <JobApplication job={row} />
            <Section title="About the job"><Description value={row.description} /></Section>
            <RankingDetail jobId={row.id} />
            <ResumeMatchDetail jobId={row.id} />
            <Section title="Details"><Facts row={row} /></Section>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  )
}

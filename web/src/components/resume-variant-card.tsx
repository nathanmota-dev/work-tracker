import { useMemo, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AgentConversation } from "@/components/agent-conversation"
import { Markdown } from "@/components/markdown"
import { ScoreOnlyBadge } from "@/components/resume-match-detail"
import { statusLabels } from "@/components/resume-tile"
import { Status } from "@/components/workspace-ui"
import { ATS_TITLE } from "@/lib/ats"
import { preparationMessages } from "@/lib/preparation"
import { cn, formatDate } from "@/lib/utils"
import { roleLabels, variantAction, type ResumeVariant } from "@/lib/variants"

/** The job a tailored resume was approved for, its match there, and the way back to the application. */
function Source({ variant }: { variant: ResumeVariant }) {
  const source = variant.source
  if (!source) return null
  return <section aria-label="Source application" className="space-y-3 rounded-lg border bg-muted/20 p-3 text-xs">
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
      <dt className="text-muted-foreground">Job</dt><dd className="min-w-0 font-medium">{source.title ?? "—"}</dd>
      <dt className="text-muted-foreground">Company</dt><dd className="min-w-0">{source.company ?? "—"}</dd>
      {variant.match && <><dt className="text-muted-foreground" title={ATS_TITLE}>Resume match</dt><dd><ScoreOnlyBadge match={variant.match} /></dd></>}
    </dl>
    <Button asChild variant="outline" size="sm" className="w-full">
      <a href={`#/apply?jobId=${source.jobId}&applicationId=${source.applicationId}`}><ExternalLink />Open application</a>
    </Button>
    <p className="text-muted-foreground">Edit its LaTeX in the Code tab. Approving a newer version in Apply replaces it, edits included.</p>
  </section>
}

/**
 * One saved resume: what it targets, where it came from, and its generation.
 * Download, rename and archive live in the page header and the Resumes grid.
 */
export function ResumeVariantCard({ variant, busy, className }: { variant: ResumeVariant; busy: boolean; className?: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const messages = useMemo(() => preparationMessages(variant.events, variant.status), [variant.events, variant.status])
  const stopped = variant.status === "generating" || variant.status === "waiting_for_sign_in"
  const regenerable = variant.origin === "generated" && !variant.source && !stopped
  async function act(action: "regenerate" | "cancel") {
    setPending(true); setError("")
    try { await variantAction(action, { id: variant.id }) } catch (e) { setError((e as Error).message) } finally { setPending(false) }
  }
  const title = variant.name
  const origin = variant.source ? null : variant.origin === "imported" ? "Imported PDF" : "Generated"
  return <article aria-label={title} className={cn("space-y-3 rounded-xl border p-4", className)}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{[roleLabels[variant.role], origin, formatDate(variant.updatedAt)].filter(Boolean).join(" · ")}</p>
      </div>
      <Status value={variant.archivedAt ? "Archived" : statusLabels[variant.status]} />
    </header>
    <ul aria-label={`Stacks of ${title}`} className="flex flex-wrap gap-1.5">{variant.stacks.map(stack => <li key={stack}><Badge variant="secondary">{stack}</Badge></li>)}</ul>
    <Source variant={variant} />
    {variant.stale && <Badge variant="outline">Sources changed since generation</Badge>}
    {variant.error && <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">{variant.error}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {(regenerable || stopped) && <div className="flex gap-2 [&>*]:flex-1">
      {regenerable && <Button size="sm" variant="outline" disabled={busy || pending || !!variant.archivedAt} onClick={() => void act("regenerate")}>Regenerate</Button>}
      {stopped && <Button size="sm" variant="outline" disabled={pending} onClick={() => void act("cancel")}>Cancel</Button>}
    </div>}
    {stopped && <AgentConversation messages={messages} />}
    {variant.report && !stopped && <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs font-medium">Tailoring report</summary>
      <div className="mt-3 text-sm"><Markdown text={variant.report} /></div>
    </details>}
  </article>
}

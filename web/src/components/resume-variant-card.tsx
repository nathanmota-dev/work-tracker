import { lazy, Suspense, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AgentConversation } from "@/components/agent-conversation"
import { Status } from "@/components/workspace-ui"
import { preparationMessages } from "@/lib/preparation"
import { roleLabels, variantAction, type ResumeVariant } from "@/lib/variants"
const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))

const statusLabels: Record<ResumeVariant["status"], string> = { generating: "Generating", ready: "Ready", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted", waiting_for_sign_in: "Waiting for sign-in" }

/** One saved resume: what it targets, its PDF and what can be done with it. */
export function ResumeVariantCard({ variant, busy, onEdit }: { variant: ResumeVariant; busy: boolean; onEdit: () => void }) {
  const [viewing, setViewing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const messages = useMemo(() => preparationMessages(variant.events, variant.status), [variant.events, variant.status])
  const generating = variant.status === "generating"
  const stopped = generating || variant.status === "waiting_for_sign_in"
  async function act(action: "regenerate" | "archive" | "cancel") {
    setPending(true); setError("")
    try { await variantAction(action, { id: variant.id }) } catch (e) { setError((e as Error).message) } finally { setPending(false) }
  }
  const title = variant.name
  return <article aria-label={title} className="space-y-3 rounded-xl border p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{roleLabels[variant.role]} · {variant.origin === "imported" ? "Imported PDF" : "Generated"}{variant.pdf ? ` · ${variant.pdf.pages} ${variant.pdf.pages === 1 ? "page" : "pages"}` : ""} · {new Date(variant.updatedAt).toLocaleDateString()}</p>
      </div>
      <Status value={statusLabels[variant.status]} />
    </header>
    <ul aria-label={`Stacks of ${title}`} className="flex flex-wrap gap-1.5">{variant.stacks.map(stack => <li key={stack}><Badge variant="secondary">{stack}</Badge></li>)}</ul>
    {variant.stale && <Badge variant="outline">Sources changed since generation</Badge>}
    {variant.error && <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">{variant.error}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {variant.pdf && <Button size="sm" variant="outline" onClick={() => setViewing(value => !value)}>{viewing ? "Hide PDF" : "View"}</Button>}
      {variant.pdf && <Button size="sm" variant="outline" onClick={() => void window.desktop?.savePdf(variant.pdf!.id).catch(e => setError(e.message))}>Download</Button>}
      {variant.origin === "generated" && !stopped && <Button size="sm" variant="outline" disabled={busy || pending || !!variant.archivedAt} onClick={() => void act("regenerate")}>Regenerate</Button>}
      {!generating && <Button size="sm" variant="outline" disabled={pending} onClick={onEdit}>Edit</Button>}
      {!generating && !variant.archivedAt && <Button size="sm" variant="outline" disabled={pending} onClick={() => void act("archive")}>Archive</Button>}
      {stopped && <Button size="sm" variant="outline" disabled={pending} onClick={() => void act("cancel")}>Cancel</Button>}
    </div>
    {stopped && <AgentConversation messages={messages} />}
    {viewing && variant.pdf && <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfViewer title={`${title} PDF`} artifact={variant.pdf} /></Suspense>}
  </article>
}

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Field, LoadState, controlClass } from "@/components/workspace-ui"
import { JobForm } from "@/components/job-form"
import { ResumeSources } from "@/components/resume-sources"
import { request, useApi, type Row } from "@/lib/api"
import type { Providers } from "@/lib/agent"
import { batchReviewHref } from "@/lib/batch-review"
import type { PreparationBatch } from "@/lib/preparation"
import type { BatchPreview } from "../../../src/preparation/types"

export function BatchPreparation({ jobs, onCreated }: { jobs: Row[]; onCreated: () => void }) {
  const [reviewing, setReviewing] = useState<Row[]>()
  const [notice, setNotice] = useState("")
  const [batchLink, setBatchLink] = useState("")
  return <>
    <Button size="sm" disabled={!jobs.length} onClick={() => { setNotice(""); setReviewing(jobs) }}>Prepare selected</Button>
    {notice && <span role="status" className="text-sm">{notice} <a className="underline" href="#/apply">Open preparation queue</a><span aria-hidden="true"> · </span><a className="underline" href={batchLink}>Review batch</a></span>}
    {reviewing && <BatchDialog jobs={reviewing} onClose={() => setReviewing(undefined)} onCreated={batch => {
      setReviewing(undefined); setNotice(`Batch created with ${batch.items.length} jobs.`); setBatchLink(batchReviewHref(batch.id)); onCreated()
    }} />}
  </>
}

function useBatchReview(jobs: Row[], onCreated: (batch: PreparationBatch) => void) {
  const [preview, setPreview] = useState<BatchPreview>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const last = useRef({ payload: "", requestId: "" })
  const [revision, refresh] = useState(0)
  useEffect(() => {
    let active = true
    setPreview(undefined); setError("")
    request<BatchPreview>("preparation-batches/preview", { items: jobs.map(job => ({ jobId: Number(job.id) })) })
      .then(value => { if (active) setPreview(value) }, (e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [jobs, revision])
  async function create(config: { provider: string; model: string; extra: string }, contexts: Record<number, string>) {
    if (pending.current || !preview?.eligible) return
    pending.current = true; setBusy(true); setError("")
    const body = { ...config, items: preview.items.filter(item => item.eligible).map(item => ({ jobId: item.jobId, extra: contexts[item.jobId] ?? "" })) }
    const payload = JSON.stringify(body)
    if (last.current.payload !== payload) last.current = { payload, requestId: crypto.randomUUID() }
    try { onCreated(await request<PreparationBatch>("preparation-batches/create", { ...body, requestId: last.current.requestId })) }
    catch (e) { setError((e as Error).message) }
    finally { pending.current = false; setBusy(false) }
  }
  return { preview, error, busy, create, refresh: () => refresh(value => value + 1) }
}

function BatchDialog({ jobs, onClose, onCreated }: { jobs: Row[]; onClose: () => void; onCreated: (batch: PreparationBatch) => void }) {
  const providers = useApi<Providers>("acp/providers")
  const [provider, setProvider] = useState("")
  const [model, setModel] = useState("")
  const [extra, setExtra] = useState("")
  const [contexts, setContexts] = useState<Record<number, string>>({})
  const [editing, setEditing] = useState<Row>()
  const [corrected, setCorrected] = useState<Record<number, Row>>({})
  const review = useBatchReview(jobs, onCreated)
  const agent = providers.data?.providers.find(item => item.id === (provider || providers.data?.default)) ?? providers.data?.providers[0]
  return <>
    <Dialog open={!editing} onOpenChange={open => { if (!open && !review.busy) onClose() }}>
      <DialogContent showCloseButton={!review.busy} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Prepare jobs in a batch</DialogTitle>
          <DialogDescription>Review the selection and exclusions. Every job uses the same agent, model and saved resume sources.</DialogDescription>
        </DialogHeader>
        <LoadState loading={!review.preview && !review.error} error={review.error || providers.error} retry={() => { providers.refresh(); review.refresh() }} />
        <fieldset disabled={review.busy} className="space-y-4">
          {review.preview && <>
            <p role="status">{review.preview.selected} selected · {review.preview.eligible} eligible · {review.preview.excluded} excluded</p>
            <ul className="space-y-3">{review.preview.items.map((item, index) => <li key={`${item.jobId}:${index}`} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{item.company} · {item.title}</p>
              {item.eligible ? <Field label={`Context for ${item.title}`}><Textarea value={contexts[item.jobId] ?? ""}
                placeholder="Leave empty to use the shared context" onChange={e => setContexts(previous => ({ ...previous, [item.jobId]: e.target.value }))} /></Field>
                : <><p>Excluded: {item.reasons.join("; ")}.</p>{item.missing.length > 0 && <Button size="sm" variant="outline" onClick={() => setEditing(corrected[item.jobId] ?? jobs.find(job => Number(job.id) === item.jobId))}>Correct {item.title}</Button>}</>}
            </li>)}</ul>
          </>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Batch agent"><SelectControl className={controlClass} value={agent?.id ?? ""} onChange={e => { setProvider(e.target.value); setModel("") }}>
              {providers.data?.providers.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
            </SelectControl></Field>
            <Field label="Batch model"><SelectControl className={controlClass} value={model} onChange={e => setModel(e.target.value)}>
              <option value="">Provider default</option>{agent?.models.map(value => <option key={value}>{value}</option>)}
            </SelectControl></Field>
          </div>
          <Field label="Shared context"><Textarea value={extra} onChange={e => setExtra(e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">A job's context replaces the shared context for that job. Empty fields use the shared context.</p>
          <details><summary className="cursor-pointer text-sm">Resume sources for this batch</summary><ResumeSources /></details>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="outline" onClick={review.refresh}>Refresh eligibility</Button>
            <Button disabled={!review.preview?.eligible || !agent || !!model && !agent.models.includes(model)} onClick={() => void review.create({ provider: agent!.id, model, extra }, contexts)}>
              {review.busy ? "Creating…" : `Create batch (${review.preview?.eligible ?? 0})`}
            </Button>
          </div>
        </fieldset>
      </DialogContent>
    </Dialog>
    {editing && <JobForm job={editing} onClose={() => setEditing(undefined)} onSaved={result => {
      setCorrected(previous => ({ ...previous, [Number(result.job.id)]: result.job })); setEditing(undefined); review.refresh()
    }} />}
  </>
}

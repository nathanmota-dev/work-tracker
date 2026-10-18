import { useEffect, useMemo, useState, lazy, Suspense } from "react"
import { useSearch } from "@tanstack/react-router"
import { useApplyContext } from "@/lib/apply-context"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Page, Panel, Field, LoadState, Status, ExternalLink, controlClass } from "@/components/workspace-ui"
import { ResumeSources } from "@/components/resume-sources"
import { ApplyReadiness, applyBlocks } from "@/components/apply-readiness"
import { useIntegrations, type Target } from "@/lib/integrations"
import { AgentConversation } from "@/components/agent-conversation"
import { RunRecovery } from "@/components/run-recovery"
import { request, useApi, useConnection, subscribe, type Row } from "@/lib/api"
import type { Providers } from "@/lib/agent"
import { openApply, preparationMessages, usePreparation, type SourcesState, type PdfArtifact, type SubmissionConfirmation } from "@/lib/preparation"
const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))
export function ApplyPage() {
  const search = useSearch({ strict: false }) as { jobId?: number; applicationId?: number; runId?: string }
  return <ApplyWorkspace key={`${search.jobId ?? "none"}:${search.applicationId ?? "job"}`} search={search} />
}
function ApplyWorkspace({ search }: { search: { jobId?: number; applicationId?: number; runId?: string } }) {
  const jobs = useApi<Row[]>("jobs")
  const providers = useApi<Providers>("acp/providers")
  const sources = useApi<SourcesState>("resume-sources")
  const details = usePreparation(search.jobId, search.applicationId)
  const live = useConnection()
  const integrations = useIntegrations()
  const { route, update, context, provider, model, setProvider, setModel, extra, descriptionDirty, description, setExtra, setDescription } = useApplyContext(search, details.data?.job.description, details.data?.runs)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<PdfArtifact>()
  const [wide, setWide] = useState(window.innerWidth >= 1100)
  useEffect(() => { const resize = () => setWide(window.innerWidth >= 1100); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize) }, [])
  const pdfTab = route.pdfTab ?? "base"
  const setPdfTab = (pdfTab: string) => update({ pdfTab })
  const refreshSources = sources.refresh
  useEffect(() => subscribe(event => { if (event.type === "resume-sources-changed") refreshSources() }), [refreshSources])
  const selectedProvider = providers.data?.providers.find(p => p.id === provider) ?? providers.data?.providers.find(p => p.id === providers.data?.default) ?? providers.data?.providers[0]
  const effectiveModel = selectedProvider?.models.includes(model) ? model : ""
  const run = details.data?.runs.find(r => r.id === search.runId) ?? details.data?.runs[0]
  const previous = details.data?.runs.find(r => r.artifacts.some(a => a.kind === "tailored"))
  const pdfRun = run?.artifacts.some(a => a.kind === "tailored") ? run : previous
  useEffect(() => { setPreview(undefined) }, [search.jobId, search.runId, run?.id])
  const base = preview ?? run?.artifacts.find(a => a.kind === "base") ?? sources.data?.preview
  const tailored = pdfRun?.artifacts.find(a => a.kind === "tailored")
  const busy = pending || details.loading || !details.data || !!details.data.busy
  const archived = !!details.data?.job.archived_at
  const missingTools = sources.data?.dependencies.some(d => !d.available) ?? true
  const readiness = { live, busy: busy || integrations.testing, archived, submitted: details.data?.applicationStatus === "submitted", sources: !!sources.data?.config.projectDir, tools: !missingTools, descriptionDirty, linkedinNeeded: !details.data?.job.description && !!details.data?.job.linkedin_job_id, descriptionMissing: !details.data?.job.description && !details.data?.job.linkedin_job_id, tailored: !!tailored, provider: selectedProvider?.id, model, invalidModel: !!model && !selectedProvider?.models.includes(model), integrations: integrations.data }
  const generateBlocks = applyBlocks(readiness, "generate")
  const fillBlocks = applyBlocks({ ...readiness, provider: pdfRun?.provider ?? selectedProvider?.id, model: pdfRun?.model ?? "", invalidModel: false }, "fill")
  function correct(action: "description" | "model") {
    if (action === "description") { const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Job description"]'); if (textarea?.parentElement?.parentElement instanceof HTMLDetailsElement) textarea.parentElement.parentElement.open = true; textarea?.focus() }
    else { setModel(""); document.querySelector<HTMLElement>('[aria-label="Model"]')?.focus() }
  }
  function testAvailability() {
    const targets: Target[] = [...(selectedProvider ? [`acp/${selectedProvider.id}` as Target] : []), "mcp/chrome", ...(!details.data?.job.description && details.data?.job.linkedin_job_id ? ["mcp/linkedin" as const] : [])]
    void integrations.test(targets, model); sources.refresh(); providers.refresh()
  }
  const messages = useMemo(() => preparationMessages(run?.events ?? [], run?.status), [run?.events, run?.status])
  async function action(kind: "generate" | "fill" | "retry" | "cancel" | "submitted" | "description", reviewed = false) {
    setPending(true); setError(""); setNotice("")
    try {
      const body = kind === "generate" ? { jobId: search.jobId, applicationId: search.applicationId ?? run?.application_id, provider: selectedProvider?.id, model: effectiveModel || undefined, extra } : kind === "description" ? { jobId: search.jobId, description } : kind === "submitted" ? { runId: pdfRun?.id, applicationId: pdfRun?.application_id ?? undefined } : kind === "retry" ? { runId: run?.id, extra, reviewed } : { runId: kind === "fill" ? pdfRun?.id : run?.id, extra }
      const value = await request<{ id?: string } & Partial<SubmissionConfirmation>>(`application-preparation/${kind}`, body)
      if (kind === "submitted") setNotice(value.alreadySubmitted ? "This submission was already confirmed. The application stays on the board." : "Submission confirmed. The application is now on the board in its initial stage.")
      if (kind === "generate" && value.id) { context.update(previous => ({ ...previous, runId: value.id })); openApply(search.jobId, body && "applicationId" in body ? body.applicationId : undefined, value.id) }
      if (kind === "retry" && run) openApply(search.jobId, search.applicationId, run.id)
      if (kind === "fill" && pdfRun) openApply(search.jobId, pdfRun.application_id ?? undefined, pdfRun.id)
      if (kind === "description") context.update(previous => ({ ...previous, descriptionDirty: false }))
      details.refresh()
    } catch (e) { setError((e as Error).message) }
    finally { setPending(false) }
  }
  const job = details.data?.job
  return <Page title="Apply" description="Prepare a resume for one role, review both PDFs and fill its application." actions={<Status value={run?.decisionStatus ? "Waiting for decision" : run ? `${run.phase} · ${run.status}` : "Ready"} />}>
    <LoadState {...jobs} retry={jobs.refresh} />
    <details className="rounded-xl border p-4" open={!sources.data?.config.projectDir || undefined}><summary className="cursor-pointer text-sm font-medium">Resume sources</summary><div className="mt-4"><ResumeSources onPreview={artifact => { setPreview(artifact); sources.refresh() }} /></div></details>
    <Panel title="Opportunity">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Saved job"><SelectControl className={controlClass} value={String(search.jobId ?? "")} onChange={e => openApply(e.target.value)}><option value="">Select a job</option>{jobs.data?.filter(j => !j.archived_at || j.id === search.jobId).map(j => <option key={String(j.id)} value={String(j.id)}>{String(j.company_name)} · {String(j.title)}{j.archived_at ? " (archived)" : ""}</option>)}</SelectControl></Field>
        <Field label="Agent"><SelectControl className={controlClass} value={selectedProvider?.id ?? ""} disabled={busy} onChange={e => { setProvider(e.target.value); setModel("") }}>{providers.data?.providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</SelectControl></Field>
        <Field label="Model"><SelectControl className={controlClass} value={effectiveModel} disabled={busy} onChange={e => setModel(e.target.value)}><option value="">Provider default</option>{selectedProvider?.models.map(m => <option key={m}>{m}</option>)}</SelectControl></Field>
      </div>
      <LoadState loading={providers.loading && !providers.data} error={providers.error || details.error} retry={() => { providers.refresh(); details.refresh() }} />
      {job && <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3"><p className="text-sm font-medium">{job.company_name} · {job.title}</p><ExternalLink value={job.link} label="View opportunity" /></div>
        <details><summary className="cursor-pointer text-sm">Job description</summary><div className="mt-3 space-y-3"><Textarea aria-label="Job description" className="min-h-40" value={description} disabled={busy} onChange={e => { setDescription(e.target.value) }} placeholder="Paste the description, or leave it empty to fetch it from LinkedIn when generating." /><Button variant="outline" size="sm" disabled={busy || !descriptionDirty || !description.trim()} onClick={() => void action("description")}>Save description</Button></div></details>
        <Field label="Additional context"><Textarea value={extra} disabled={busy} onChange={e => setExtra(e.target.value)} placeholder="What should the agent emphasize? The resume follows the job description’s language." /></Field>
        {archived && <p className="text-sm text-muted-foreground">Restore this job in Jobs before preparing an application.</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={generateBlocks.length > 0} onClick={() => void action("generate")}>{run ? "Regenerate" : "Generate resume"}</Button>
          <Button variant="outline" disabled={fillBlocks.length > 0} onClick={() => void action("fill")}>Fill application</Button>
          {(run?.status === "running" || run?.status === "waiting_for_sign_in") && <Button variant="outline" disabled={pending} onClick={() => void action("cancel")}>Cancel</Button>}
          {details.data?.applicationStatus === "filled" && details.data.uploadedRunId === pdfRun?.id && <Button variant="outline" disabled={busy} onClick={() => void action("submitted")}>I submitted in the browser</Button>}
        </div>
        <ApplyReadiness generate={generateBlocks} fill={fillBlocks} testing={integrations.testing} error={integrations.testError || integrations.error} test={testAvailability} correct={correct} />
        {details.data?.busy && run?.status !== "running" && <p className="text-xs text-muted-foreground">Another execution is active. You can review these files while it finishes.</p>}

        {!job.description && !job.linkedin_job_id && !descriptionDirty && <p role="status" className="text-xs text-muted-foreground">This job has no description yet. Paste it under Job description before generating.</p>}
      </div>}
    </Panel>
    {(error || context.error) && <p role="alert" className="text-sm text-destructive">{error || context.error}</p>}
    {(notice || details.data?.journey?.submission_status === "submitted") && <p role="status" className="text-sm">{notice || `Submitted${details.data?.journey?.submitted_at ? ` on ${new Date(details.data.journey.submitted_at).toLocaleDateString()}` : ""}.`} <a className="underline" href="#/application-board">Open the application board</a></p>}
    <RunRecovery run={run} disabled={busy || archived || !live || details.data?.applicationStatus === "submitted" || (run?.recovery?.retryFrom === "filling" && fillBlocks.length > 0)} onRetry={reviewed => void action("retry", reviewed)} />
    {run?.error && <details open className="rounded-xl border border-destructive/30 p-4"><summary className="cursor-pointer text-sm text-destructive">Execution needs attention</summary><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs">{run.error}</pre></details>}
    {!!details.data?.runs.length && <Field label="Execution history"><SelectControl className={controlClass} value={run?.id ?? ""} onChange={e => openApply(search.jobId, search.applicationId, e.target.value)}>{details.data.runs.map(r => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · {r.phase} · {r.status}</option>)}</SelectControl></Field>}
    {tailored && pdfRun?.id !== run?.id && <p className="text-sm text-muted-foreground">Showing the previous validated resume. Fill application will use that PDF.</p>}
    <Suspense fallback={<p role="status">Loading PDF viewer…</p>}>{wide ? <div className="grid min-w-0 grid-cols-2 gap-4"><PdfViewer title="Base PDF" artifact={base} /><PdfViewer title="Tailored PDF" artifact={tailored} /></div> : <Tabs value={pdfTab} onValueChange={setPdfTab}><TabsList><TabsTrigger value="base">Base PDF</TabsTrigger><TabsTrigger value="tailored">Tailored PDF</TabsTrigger></TabsList><TabsContent value="base"><PdfViewer title="Base PDF" artifact={base} /></TabsContent><TabsContent value="tailored"><PdfViewer title="Tailored PDF" artifact={tailored} /></TabsContent></Tabs>}</Suspense>
    <Panel title="Application workspace"><Tabs value={route.workspaceTab ?? "activity"} onValueChange={workspaceTab => update({ workspaceTab })}><TabsList><TabsTrigger value="activity">Agent activity</TabsTrigger><TabsTrigger value="report">Report</TabsTrigger></TabsList><TabsContent value="activity"><AgentConversation messages={messages} /></TabsContent><TabsContent value="report"><div className="max-h-[420px] overflow-auto whitespace-pre-wrap text-sm">{run?.report ?? "The tailoring report will appear after generation."}</div></TabsContent></Tabs></Panel>
    {tailored && <p className="text-xs text-muted-foreground">Review the PDF and portal fields before submitting in the browser.</p>}
  </Page>
}

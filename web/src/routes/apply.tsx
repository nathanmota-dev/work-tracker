import { useEffect, useMemo, useState, lazy, Suspense, type ReactNode } from "react"
import { useSearch } from "@tanstack/react-router"
import { useApplyContext } from "@/lib/apply-context"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Page, Panel, Field, LoadState, Status, ExternalLink, controlClass } from "@/components/workspace-ui"
import { ApplicationEmpty, ApplicationStepper } from "@/components/application-stepper"
import { ApplyReadiness, applyBlocks, type ApplyAction } from "@/components/apply-readiness"
import { useGateConfirmation } from "@/lib/gates"
import { useIntegrations, type Target } from "@/lib/integrations"
import { AgentConversation } from "@/components/agent-conversation"
import { DocumentReview } from "@/components/document-review"
import { RunRecovery } from "@/components/run-recovery"
import { FillReviewPanel } from "@/components/fill-review"
import { BatchReviewWorkspace } from "@/components/batch-review-workspace"
import type { ReviewSearch } from "@/lib/batch-review"
import { request, useApi, useConnection, subscribe } from "@/lib/api"
import { applicationSteps } from "@/lib/application-steps"
import { usePageCrumb } from "@/lib/page-crumb"
import type { Providers } from "@/lib/agent"
import { openApply, preparationMessages, usePreparation, type SourcesState, type PdfArtifact, type SubmissionConfirmation } from "@/lib/preparation"
const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))
export function ApplyPage() {
  const search = useSearch({ strict: false }) as ReviewSearch
  if (search.batchId) return <BatchReviewWorkspace key={search.batchId} search={search} renderItem={(item, controls, locked) => <ApplyWorkspace key={`${item.id}:${item.applicationId ?? "job"}`} search={{ ...search, jobId: item.jobId, applicationId: item.applicationId ?? undefined, runId: item.runId ?? undefined }} review={controls} reviewLocked={locked} />} />
  if (!search.jobId) return <Page title="Application" description="Open an application from a shortlisted job to prepare, fill and confirm it."><ApplicationEmpty /></Page>
  return <ApplyWorkspace key={`${search.jobId}:${search.applicationId ?? "job"}`} search={search} />
}
function ApplyWorkspace({ search, review, reviewLocked = false }: { search: ReviewSearch; review?: ReactNode; reviewLocked?: boolean }) {
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
  const gate = useGateConfirmation(search.jobId)
  const pdfTab = route.pdfTab ?? "base"
  const setPdfTab = (pdfTab: string) => update({ pdfTab })
  const refreshSources = sources.refresh
  useEffect(() => subscribe(event => { if (event.type === "resume-sources-changed") refreshSources() }), [refreshSources])
  const selectedProvider = providers.data?.providers.find(p => p.id === provider) ?? providers.data?.providers.find(p => p.id === providers.data?.default) ?? providers.data?.providers[0]
  const effectiveModel = selectedProvider?.models.includes(model) ? model : ""
  const run = review ? details.data?.runs.find(r => r.id === search.runId) : details.data?.runs.find(r => r.id === search.runId) ?? details.data?.runs[0]
  const previous = (!review || run) ? details.data?.runs.find(r => r.artifacts.some(a => a.kind === "tailored")) : undefined
  const pdfRun = run?.artifacts.some(a => a.kind === "tailored") ? run : previous
  useEffect(() => { setPreview(undefined) }, [search.jobId, search.runId, run?.id])
  const base = preview ?? run?.artifacts.find(a => a.kind === "base") ?? sources.data?.preview
  const version = details.data?.documents?.find(item => item.runId === pdfRun?.id)
  const tailored = pdfRun?.artifacts.find(a => a.kind === "tailored")
  const busy = reviewLocked || pending || details.loading || !details.data || !!details.data.busy
  const reviewBusy = (!!review && pdfRun?.id !== run?.id) || reviewLocked || pending || details.loading || !details.data || pdfRun?.status === "running" // Review stays possible while a batch runs another execution.
  const archived = !!details.data?.job.archived_at
  const missingTools = sources.data?.dependencies.some(d => !d.available) ?? true
  const readiness = { live, busy: (!!review && pdfRun?.id !== run?.id) || busy || integrations.testing, archived, submitted: details.data?.applicationStatus === "submitted", sources: !!sources.data?.config.projectDir, tools: !missingTools, descriptionDirty, gateUnconfirmed: gate.unconfirmed, linkedinNeeded: !details.data?.job.description && !!details.data?.job.linkedin_job_id, descriptionMissing: !details.data?.job.description && !details.data?.job.linkedin_job_id, tailored: !!tailored && !!version, approved: !!version?.approvedAt, provider: selectedProvider?.id, model, invalidModel: !!model && !selectedProvider?.models.includes(model), integrations: integrations.data }
  const generateBlocks = applyBlocks(readiness, "generate")
  const fillBlocks = applyBlocks({ ...readiness, provider: pdfRun?.provider ?? selectedProvider?.id, model: pdfRun?.model ?? "", invalidModel: false }, "fill")
  const steps = applicationSteps({ description: !readiness.descriptionMissing && !descriptionDirty, approved: readiness.approved, filled: ["filled", "needs_input"].includes(details.data?.applicationStatus ?? ""), submitted: readiness.submitted || details.data?.journey?.submission_status === "submitted", generate: review ? [] : generateBlocks, fill: fillBlocks })
  function correct(action: ApplyAction) {
    if (action === "review" || action === "gate") document.getElementById(action === "gate" ? "requirements-warning" : "document-review")?.scrollIntoView?.()
    else if (action === "description") { const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Job description"]'); if (textarea?.parentElement?.parentElement instanceof HTMLDetailsElement) textarea.parentElement.parentElement.open = true; textarea?.focus() }
    else { setModel(""); document.querySelector<HTMLElement>('[aria-label="Model"]')?.focus() }
  }
  function testAvailability() {
    const targets: Target[] = [...(review && run ? [`acp/${run.provider}` as Target] : selectedProvider ? [`acp/${selectedProvider.id}` as Target] : []), "mcp/chrome", ...(!details.data?.job.description && details.data?.job.linkedin_job_id ? ["mcp/linkedin" as const] : [])]
    void integrations.test(targets, review ? run?.model ?? "" : model); sources.refresh(); providers.refresh()
  }
  const messages = useMemo(() => preparationMessages(run?.events ?? [], run?.status), [run?.events, run?.status])
  async function action(kind: "generate" | "fill" | "retry" | "cancel" | "submitted" | "description" | "approve", reviewed = false) {
    setPending(true); setError(""); setNotice("")
    try {
      const body = kind === "generate" ? { jobId: search.jobId, applicationId: search.applicationId ?? run?.application_id, provider: selectedProvider?.id, model: effectiveModel || undefined, extra } : kind === "description" ? { jobId: search.jobId, description } : kind === "submitted" ? { runId: pdfRun?.id, applicationId: pdfRun?.application_id ?? undefined } : kind === "approve" ? { runId: pdfRun?.id, versionId: version?.id } : kind === "retry" ? { runId: run?.id, extra, reviewed } : { runId: kind === "fill" ? pdfRun?.id : run?.id, extra, ...(kind === "fill" ? { versionId: version?.id } : {}) }
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
  usePageCrumb(job ? `${job.company_name} · ${job.title}` : "")
  const applicationId = details.data?.journey?.id ?? pdfRun?.application_id ?? search.applicationId
  return <Page title="Application" description="One role, from job description to confirmed submission." actions={<Status value={run?.decisionStatus ? "Waiting for decision" : run ? `${run.phase} · ${run.status}` : "Ready"} />}>
    {review}
    {details.data && <ApplicationStepper steps={steps} />}
    {!review && sources.data && <p className="text-sm text-muted-foreground">{sources.data.config.projectDir ? "Base resume configured" : "Base resume missing"} · <a className="text-foreground underline" href="#/profile?tab=resume">Configure resume sources</a></p>}
    <Panel title="Opportunity">
      {!review && <div className="grid gap-4 md:grid-cols-2">
        <Field label="Agent"><SelectControl className={controlClass} value={selectedProvider?.id ?? ""} disabled={busy} onChange={e => { setProvider(e.target.value); setModel("") }}>{providers.data?.providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</SelectControl></Field>
        <Field label="Model"><SelectControl className={controlClass} value={effectiveModel} disabled={busy} onChange={e => setModel(e.target.value)}><option value="">Provider default</option>{selectedProvider?.models.map(m => <option key={m}>{m}</option>)}</SelectControl></Field>
      </div>}
      <LoadState loading={providers.loading && !providers.data} error={providers.error || details.error} retry={() => { providers.refresh(); details.refresh() }} />
      {job && <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3"><p className="text-sm font-medium">{job.company_name} · {job.title}</p><ExternalLink value={job.link} label="View opportunity" /></div>
        {!review && <details><summary className="cursor-pointer text-sm">Job description</summary><div className="mt-3 space-y-3"><Textarea aria-label="Job description" className="min-h-40" value={description} disabled={busy} onChange={e => { setDescription(e.target.value) }} placeholder="Paste the description, or leave it empty to fetch it from LinkedIn when generating." /><Button variant="outline" size="sm" disabled={busy || !descriptionDirty || !description.trim()} onClick={() => void action("description")}>Save description</Button></div></details>}
        {!review && <Field label="Additional context"><Textarea value={extra} disabled={busy} onChange={e => setExtra(e.target.value)} placeholder="What should the agent emphasize? The resume follows the job description’s language." /></Field>}
        {archived && <p className="text-sm text-muted-foreground">Restore this job in Jobs before preparing an application.</p>}
        <div className="flex flex-wrap gap-2">
          {!review && <Button disabled={generateBlocks.length > 0} onClick={() => void action("generate")}>{run ? "Regenerate" : "Generate resume"}</Button>}
          <Button variant="outline" disabled={fillBlocks.length > 0} onClick={() => void action("fill")}>Fill application</Button>
          {!review && (run?.status === "running" || run?.status === "waiting_for_sign_in") && <Button variant="outline" disabled={pending} onClick={() => void action("cancel")}>Cancel</Button>}
          {details.data?.applicationStatus === "filled" && details.data.uploadedRunId === pdfRun?.id && <Button variant="outline" disabled={reviewBusy} onClick={() => void action("submitted")}>I submitted in the browser</Button>}
        </div>
        <ApplyReadiness gate={gate.readiness} guard={job.description_guard_json} description={job.description} generate={review ? [] : generateBlocks} fill={fillBlocks} testing={integrations.testing} error={integrations.testError || integrations.error} test={testAvailability} correct={correct} />
        {details.data?.busy && run?.status !== "running" && <p className="text-xs text-muted-foreground">Another execution is active. You can review these files while it finishes.</p>}

        {!job.description && !job.linkedin_job_id && !descriptionDirty && <p role="status" className="text-xs text-muted-foreground">This job has no description yet. Paste it under Job description before generating.</p>}
      </div>}
    </Panel>
    {(error || context.error) && <p role="alert" className="text-sm text-destructive">{error || context.error}</p>}
    {(notice || details.data?.journey?.submission_status === "submitted") && <p role="status" className="text-sm">{notice || `Submitted${details.data?.journey?.submitted_at ? ` on ${new Date(details.data.journey.submitted_at).toLocaleDateString()}` : ""}.`} <a className="underline" href={`#/applications?view=board${applicationId ? `&highlight=${applicationId}` : ""}`}>View it on the board</a></p>}
    {!review && <RunRecovery run={run} disabled={busy || archived || !live || details.data?.applicationStatus === "submitted" || (run?.recovery?.retryFrom === "filling" && fillBlocks.length > 0)} onRetry={reviewed => void action("retry", reviewed)} />}
    {run?.error && <details open className="rounded-xl border border-destructive/30 p-4"><summary className="cursor-pointer text-sm text-destructive">Execution needs attention</summary><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs">{run.error}</pre></details>}
    {!review && !!details.data?.runs.length && <Field label="Execution history"><SelectControl className={controlClass} value={run?.id ?? ""} onChange={e => openApply(search.jobId, search.applicationId, e.target.value)}>{details.data.runs.map(r => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · {r.phase} · {r.status}</option>)}</SelectControl></Field>}
    {tailored && pdfRun?.id !== run?.id && <p className="text-sm text-muted-foreground">{review ? "Showing the previous validated resume. Retry this item to finish the requested version." : "Showing the previous validated resume. Approve this version before filling if needed."}</p>}
    {version && <DocumentReview key={version.id} version={version} versions={details.data?.documents ?? []} disabled={reviewBusy || archived || !live || details.data?.applicationStatus === "submitted"} approve={() => void action("approve")} />}
    {details.data?.fill && (!review || run) && <FillReviewPanel key={details.data.fill.applicationId} review={details.data.fill} run={run} fillBlocked={fillBlocks.length > 0} onFillAgain={() => void action("fill")} />}
    <PdfPair base={base} tailored={tailored} tab={pdfTab} onTab={setPdfTab} />
    <Panel title="Application workspace"><Tabs value={route.workspaceTab ?? "activity"} onValueChange={workspaceTab => update({ workspaceTab })}><TabsList><TabsTrigger value="activity">Agent activity</TabsTrigger><TabsTrigger value="report">Report</TabsTrigger></TabsList><TabsContent value="activity"><AgentConversation messages={messages} /></TabsContent><TabsContent value="report"><div className="max-h-[420px] overflow-auto whitespace-pre-wrap text-sm">{run?.report ?? "The tailoring report will appear after generation."}</div></TabsContent></Tabs></Panel>
    {tailored && <p className="text-xs text-muted-foreground">Review the PDF and portal fields before submitting in the browser.</p>}
  </Page>
}
/** Side by side on wide windows, tabs otherwise. */
function PdfPair({ base, tailored, tab, onTab }: { base?: PdfArtifact | null; tailored?: PdfArtifact; tab: string; onTab: (tab: string) => void }) {
  const [wide, setWide] = useState(window.innerWidth >= 1100)
  useEffect(() => { const resize = () => setWide(window.innerWidth >= 1100); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize) }, [])
  return <Suspense fallback={<p role="status">Loading PDF viewer…</p>}>{wide ? <div className="grid min-w-0 grid-cols-2 gap-4"><PdfViewer title="Base PDF" artifact={base} /><PdfViewer title="Tailored PDF" artifact={tailored} /></div> : <Tabs value={tab} onValueChange={onTab}><TabsList><TabsTrigger value="base">Base PDF</TabsTrigger><TabsTrigger value="tailored">Tailored PDF</TabsTrigger></TabsList><TabsContent value="base"><PdfViewer title="Base PDF" artifact={base} /></TabsContent><TabsContent value="tailored"><PdfViewer title="Tailored PDF" artifact={tailored} /></TabsContent></Tabs>}</Suspense>
}

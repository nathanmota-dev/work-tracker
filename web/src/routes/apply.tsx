import { useEffect, useState, lazy, Suspense, type ReactNode } from "react"
import { useSearch } from "@tanstack/react-router"
import { SelectControl } from "@/components/ui/select-control"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Page, Panel, Field, LoadState, Status, controlClass } from "@/components/workspace-ui"
import { ApplicationEmpty, ApplicationStepper } from "@/components/application-stepper"
import { AgentConversation } from "@/components/agent-conversation"
import { AgentModelFields } from "@/components/agent-model-fields"
import { DescriptionStep, FillStep, ResumeStep, SubmissionStep } from "@/components/apply-steps"
import { BatchReviewWorkspace } from "@/components/batch-review-workspace"
import type { ReviewSearch } from "@/lib/batch-review"
import { usePageCrumb } from "@/lib/page-crumb"
import { SAVED_RESUME, useApplyWorkspace, type ApplyWorkspaceState } from "@/lib/apply-workspace"
import { openApply, type PdfArtifact } from "@/lib/preparation"
const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))
export function ApplyPage() {
  const search = useSearch({ strict: false }) as ReviewSearch
  if (search.batchId) return <BatchReviewWorkspace key={search.batchId} search={search} renderItem={(item, controls, locked) => <ApplyWorkspace key={`${item.id}:${item.applicationId ?? "job"}`} search={{ ...search, jobId: item.jobId, applicationId: item.applicationId ?? undefined, runId: item.runId ?? undefined }} review={controls} reviewLocked={locked} />} />
  if (!search.jobId) return <Page title="Application" description="Open an application from a shortlisted job to prepare, fill and confirm it."><ApplicationEmpty /></Page>
  return <ApplyWorkspace key={`${search.jobId}:${search.applicationId ?? "job"}`} search={search} />
}
/** The agent that generates tailored resumes and fills portals, chosen once for the application. */
function AgentBar({ w }: { w: ApplyWorkspaceState }) {
  const { apply, providers } = w
  return <section aria-label="Agent" className="rounded-2xl border bg-card p-4">
    <AgentModelFields providers={providers.data?.providers ?? []} provider={w.selectedProvider} model={w.effectiveModel} disabled={w.busy} onProvider={id => { apply.setProvider(id); apply.setModel("") }} onModel={apply.setModel} />
    <p className="mt-2 text-xs text-muted-foreground">Used to generate a tailored resume and to fill the portal, also when you use a saved resume.</p>
  </section>
}
/** The documents, the agent's activity, the report and the execution history, beside the steps. */
function WorkspaceAside({ w }: { w: ApplyWorkspaceState }) {
  const { route, update } = w.apply
  const runs = w.details.data?.runs ?? []
  return <aside aria-label="Documents and activity" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
    <PdfPair base={w.base} tailored={w.tailored} tab={route.pdfTab ?? "base"} onTab={pdfTab => update({ pdfTab })} />
    {w.tailored && <p className="text-xs text-muted-foreground">Review the PDF and portal fields before submitting in the browser.</p>}
    <Panel title="Application workspace">
      {!w.review && !!runs.length && <div className="mb-3"><Field label="Execution history"><SelectControl className={controlClass} value={w.run?.id ?? ""} onChange={e => openApply(w.search.jobId, w.search.applicationId, e.target.value)}>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · {r.provider === SAVED_RESUME ? "saved resume" : r.provider} · {r.phase} · {r.status}</option>)}</SelectControl></Field></div>}
      <Tabs value={route.workspaceTab ?? "activity"} onValueChange={workspaceTab => update({ workspaceTab })}><TabsList><TabsTrigger value="activity">Agent activity</TabsTrigger><TabsTrigger value="report">Report</TabsTrigger></TabsList><TabsContent value="activity"><AgentConversation messages={w.messages} /></TabsContent><TabsContent value="report"><div className="max-h-[420px] overflow-auto whitespace-pre-wrap text-sm">{w.run?.report ?? "The tailoring report will appear after generation."}</div></TabsContent></Tabs>
    </Panel>
  </aside>
}
function ApplyWorkspace({ search, review, reviewLocked = false }: { search: ReviewSearch; review?: ReactNode; reviewLocked?: boolean }) {
  const w = useApplyWorkspace(search, !!review, reviewLocked)
  const { run, details, providers } = w
  const job = details.data?.job
  usePageCrumb(job ? `${job.company_name} · ${job.title}` : "")
  return <Page title="Application" description="One role, from job description to confirmed submission." actions={<Status value={run?.decisionStatus ? "Waiting for decision" : run ? `${run.phase} · ${run.status}` : "Ready"} />}>
    {review}
    <LoadState loading={providers.loading && !providers.data} error={providers.error || details.error} retry={() => { providers.refresh(); details.refresh() }} />
    {details.data && <ApplicationStepper steps={w.steps} />}
    {(w.error || w.apply.context.error) && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{w.error || w.apply.context.error}</p>}
    {details.data?.busy && run?.status !== "running" && <p className="text-xs text-muted-foreground">Another execution is active. You can review these files while it finishes.</p>}
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {!review && <AgentBar w={w} />}
        <DescriptionStep w={w} />
        <ResumeStep w={w} />
        <FillStep w={w} />
        <SubmissionStep w={w} />
      </div>
      <WorkspaceAside w={w} />
    </div>
  </Page>
}
/** Both PDFs on wide windows, the tailored one first and stacked beside the steps; tabs otherwise. */
function PdfPair({ base, tailored, tab, onTab }: { base?: PdfArtifact | null; tailored?: PdfArtifact; tab: string; onTab: (tab: string) => void }) {
  const [wide, setWide] = useState(window.innerWidth >= 1100)
  useEffect(() => { const resize = () => setWide(window.innerWidth >= 1100); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize) }, [])
  return <Suspense fallback={<p role="status">Loading PDF viewer…</p>}>{wide ? <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-1"><PdfViewer title="Tailored PDF" artifact={tailored} /><PdfViewer title="Base PDF" artifact={base} /></div> : <Tabs value={tab} onValueChange={onTab}><TabsList><TabsTrigger value="base">Base PDF</TabsTrigger><TabsTrigger value="tailored">Tailored PDF</TabsTrigger></TabsList><TabsContent value="base"><PdfViewer title="Base PDF" artifact={base} /></TabsContent><TabsContent value="tailored"><PdfViewer title="Tailored PDF" artifact={tailored} /></TabsContent></Tabs>}</Suspense>
}

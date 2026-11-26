import type { ReactNode } from "react"
import { useSearch } from "@tanstack/react-router"
import { SelectControl } from "@/components/ui/select-control"
import { Page, LoadState, Status } from "@/components/workspace-ui"
import { ApplicationEmpty, ApplicationStepper, activeStep } from "@/components/application-stepper"
import { DescriptionView, FillView, SubmissionView } from "@/components/apply-steps"
import { ResumeView } from "@/components/apply-resume-step"
import { BatchReviewWorkspace } from "@/components/batch-review-workspace"
import type { ReviewSearch } from "@/lib/batch-review"
import { usePageCrumb } from "@/lib/page-crumb"
import { BASE_RESUME, SAVED_RESUME, useApplyWorkspace, type ApplyWorkspaceState } from "@/lib/apply-workspace"
import type { StepKey } from "@/lib/application-steps"
import { openApply } from "@/lib/preparation"

export function ApplyPage() {
  const search = useSearch({ strict: false }) as ReviewSearch
  if (search.batchId) return <BatchReviewWorkspace key={search.batchId} search={search} renderItem={(item, controls, locked) => <ApplyWorkspace key={`${item.id}:${item.applicationId ?? "job"}`} search={{ ...search, jobId: item.jobId, applicationId: item.applicationId ?? undefined, runId: item.runId ?? undefined }} review={controls} reviewLocked={locked} />} />
  if (!search.jobId) return <Page title="Application" description="Open an application from a shortlisted job to prepare, fill and confirm it."><ApplicationEmpty /></Page>
  return <ApplyWorkspace key={`${search.jobId}:${search.applicationId ?? "job"}`} search={search} />
}

/** Earlier executions of this application, to open one of them. */
function ExecutionHistory({ w }: { w: ApplyWorkspaceState }) {
  const runs = w.details.data?.runs ?? []
  if (w.review || !runs.length) return null
  return <SelectControl aria-label="Execution history" className="h-8 max-w-72 rounded-md border bg-background px-2 text-xs" value={w.run?.id ?? ""} onChange={e => openApply(w.search.jobId, w.search.applicationId, e.target.value)}>
    {runs.map(r => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · {r.provider === SAVED_RESUME ? "saved resume" : r.provider === BASE_RESUME ? "base resume" : r.provider} · {r.phase} · {r.status}</option>)}
  </SelectControl>
}

const VIEWS: Record<StepKey, (props: { w: ApplyWorkspaceState }) => ReactNode> = { description: DescriptionView, resume: ResumeView, fill: FillView, submission: SubmissionView }

function ApplyWorkspace({ search, review, reviewLocked = false }: { search: ReviewSearch; review?: ReactNode; reviewLocked?: boolean }) {
  const w = useApplyWorkspace(search, !!review, reviewLocked)
  const { run, details, providers } = w
  const job = details.data?.job
  usePageCrumb(job ? `${job.company_name} · ${job.title}` : "")
  const step = (w.apply.route.step as StepKey | undefined) ?? activeStep(w.steps)
  const View = VIEWS[step]
  const columns = step === "resume" || step === "fill"
  return <Page fill={columns} title="Application" description="One role, from job description to confirmed submission." actions={<><ExecutionHistory w={w} /><Status value={run?.decisionStatus ? "Waiting for decision" : run ? `${run.phase} · ${run.status}` : "Ready"} /></>}>
    {review}
    <LoadState loading={providers.loading && !providers.data} error={providers.error || details.error} retry={() => { providers.refresh(); details.refresh() }} />
    {details.data && <ApplicationStepper steps={w.steps} selected={step} onSelect={key => w.apply.update({ step: key })} />}
    {(w.error || w.apply.context.error) && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{w.error || w.apply.context.error}</p>}
    {details.data?.busy && run?.status !== "running" && <p className="text-xs text-muted-foreground">Another execution is active. You can review these files while it finishes.</p>}
    {details.data && <View w={w} />}
  </Page>
}

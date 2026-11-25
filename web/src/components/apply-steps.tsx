import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, ExternalLink } from "@/components/workspace-ui"
import { StepSection } from "@/components/application-stepper"
import { AvailabilityCheck, BlockList, RoleWarnings } from "@/components/apply-readiness"
import { SavedResumePicker } from "@/components/saved-resume-picker"
import { DocumentReview } from "@/components/document-review"
import { RunRecovery } from "@/components/run-recovery"
import { FillReviewPanel } from "@/components/fill-review"
import { openApply } from "@/lib/preparation"
import { SAVED_RESUME, type ApplyWorkspaceState } from "@/lib/apply-workspace"
import type { StepKey } from "@/lib/application-steps"

type Props = { w: ApplyWorkspaceState }
const stepOf = (w: ApplyWorkspaceState, key: StepKey) => {
  const index = w.steps.findIndex(step => step.key === key)
  return { step: w.steps[index], index }
}
/** One way to obtain the resume, as a titled option. */
function Option({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background/40 p-3">
    <div><h3 className="text-sm font-medium">{title}</h3><p className="text-xs text-muted-foreground">{description}</p></div>
    {children}
  </div>
}
/** A stopped execution's recovery and error, shown in the step it belongs to. */
function RunProblems({ w, filling }: Props & { filling: boolean }) {
  const { run } = w
  if (!run || (run.phase === "filling") !== filling) return null
  const recovery = !w.review && <RunRecovery run={run} disabled={w.busy || w.archived || !w.live || w.submitted || (filling && w.fillBlocks.length > 0)} onRetry={reviewed => void w.action("retry", reviewed)} />
  return <>
    {recovery}
    {run.error && <details open className="rounded-xl border border-destructive/30 p-4"><summary className="cursor-pointer text-sm text-destructive">Execution needs attention</summary><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs">{run.error}</pre></details>}
  </>
}
function CancelRun({ w, filling }: Props & { filling: boolean }) {
  const { run } = w
  if (w.review || !run || (run.phase === "filling") !== filling || (run.status !== "running" && run.status !== "waiting_for_sign_in")) return null
  return <Button variant="outline" disabled={w.pending} onClick={() => void w.action("cancel")}>Cancel</Button>
}

export function DescriptionStep({ w }: Props) {
  const job = w.details.data?.job
  const { step, index } = stepOf(w, "description")
  if (!job) return null
  const { description, descriptionDirty, setDescription } = w.apply
  return <StepSection step={step} index={index} aside={<ExternalLink value={job.link} label="View opportunity" />}>
    <p className="text-sm font-medium">{job.company_name} · {job.title}</p>
    {!w.review && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm">Job description</summary><div className="mt-3 space-y-3"><Textarea aria-label="Job description" className="min-h-40" value={description} disabled={w.busy} onChange={e => { setDescription(e.target.value) }} placeholder="Paste the description, or leave it empty to fetch it from LinkedIn when generating." /><Button variant="outline" size="sm" disabled={w.busy || !descriptionDirty || !description.trim()} onClick={() => void w.action("description")}>Save description</Button></div></details>}
    {!job.description && !job.linkedin_job_id && !descriptionDirty && <p role="status" className="text-xs text-muted-foreground">This job has no description yet. Paste it under Job description before generating.</p>}
    <RoleWarnings profile={!w.review} gate={w.gate.readiness} guard={job.description_guard_json} description={job.description} />
    {w.archived && <p className="text-sm text-muted-foreground">Restore this job in Jobs before preparing an application.</p>}
  </StepSection>
}

function ResumeOptions({ w }: Props) {
  const { run } = w
  const target = { jobId: w.search.jobId, applicationId: w.search.applicationId ?? run?.application_id ?? undefined }
  return <div className="grid gap-3 2xl:grid-cols-2">
    <Option title="Use a saved resume" description="Reuse a resume already tailored for this role and stack. No agent runs, so you can review and fill right away.">
      <SavedResumePicker disabled={w.busy || w.archived || !w.live || w.readiness.submitted || w.integrations.testing} target={target} onError={w.setError} onUsed={value => { w.setNotice(""); w.apply.context.update(previous => ({ ...previous, runId: value.id })); openApply(w.search.jobId, value.application_id ?? undefined, value.id); w.details.refresh() }} />
    </Option>
    <Option title="Generate a tailored resume" description="The selected agent tailors your base resume to this job description.">
      <Field label="Additional context"><Textarea value={w.apply.extra} disabled={w.busy} onChange={e => w.apply.setExtra(e.target.value)} placeholder="What should the agent emphasize? The resume follows the job description’s language." /></Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={w.generateBlocks.length > 0} onClick={() => void w.action("generate")}>{run ? "Regenerate" : "Generate resume"}</Button>
        <CancelRun w={w} filling={false} />
      </div>
      <BlockList label="Generate" blocks={w.generateBlocks} correct={w.correct} />
      {w.sources.data && <p className="text-xs text-muted-foreground">{w.sources.data.config.projectDir ? "Base resume configured" : "Base resume missing"} · <a className="text-foreground underline" href="#/resume?id=base">Configure resume sources</a></p>}
    </Option>
  </div>
}

export function ResumeStep({ w }: Props) {
  const { step, index } = stepOf(w, "resume")
  const { version, tailored, pdfRun, run } = w
  return <StepSection step={step} index={index}>
    {!w.review && <ResumeOptions w={w} />}
    <RunProblems w={w} filling={false} />
    {tailored && pdfRun?.id !== run?.id && <p className="text-sm text-muted-foreground">{w.review ? "Showing the previous validated resume. Retry this item to finish the requested version." : "Showing the previous validated resume. Approve this version before filling if needed."}</p>}
    {version && <DocumentReview key={version.id} version={version} versions={w.details.data?.documents ?? []} disabled={w.reviewBusy || w.archived || !w.live || w.submitted} approve={() => void w.action("approve")} />}
  </StepSection>
}

function agentName(w: ApplyWorkspaceState) {
  const provider = w.providers.data?.providers.find(item => item.id === w.fillAgent.provider)
  const name = provider?.displayName ?? w.fillAgent.provider
  return name ? `${name}${w.fillAgent.model ? ` · ${w.fillAgent.model}` : ""}` : "No agent selected"
}

export function FillStep({ w }: Props) {
  const { step, index } = stepOf(w, "fill")
  const fill = w.details.data?.fill
  return <StepSection step={step} index={index}>
    <p className="text-sm">Agent: <span className="font-medium">{agentName(w)}</span>{w.pdfRun?.provider === SAVED_RESUME && <span className="text-muted-foreground"> · fills the saved resume you chose</span>}</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={w.fillBlocks.length > 0} onClick={() => void w.action("fill")}>Fill application</Button>
      <CancelRun w={w} filling />
    </div>
    <BlockList label="Fill" blocks={w.fillBlocks} correct={w.correct} />
    <RunProblems w={w} filling />
    {fill && (!w.review || w.run) && <FillReviewPanel key={fill.applicationId} review={fill} run={w.run} fillBlocked={w.fillBlocks.length > 0} onFillAgain={() => void w.action("fill")} />}
    <AvailabilityCheck testing={w.integrations.testing} error={w.integrations.testError || w.integrations.error} test={w.testAvailability} />
  </StepSection>
}

export function SubmissionStep({ w }: Props) {
  const { step, index } = stepOf(w, "submission")
  const data = w.details.data
  const applicationId = data?.journey?.id ?? w.pdfRun?.application_id ?? w.search.applicationId
  const confirmed = w.notice || data?.journey?.submission_status === "submitted"
  return <StepSection step={step} index={index}>
    {data?.applicationStatus === "filled" && data.uploadedRunId === w.pdfRun?.id
      ? <Button variant="outline" disabled={w.reviewBusy} onClick={() => void w.action("submitted")}>I submitted in the browser</Button>
      : !confirmed && <p className="text-sm text-muted-foreground">After the portal is filled, submit it in the browser and confirm here.</p>}
    {confirmed && <p role="status" className="text-sm">{w.notice || `Submitted${data?.journey?.submitted_at ? ` on ${new Date(data.journey.submitted_at).toLocaleDateString()}` : ""}.`} <a className="underline" href={`#/applications?view=board${applicationId ? `&highlight=${applicationId}` : ""}`}>View it on the board</a></p>}
  </StepSection>
}

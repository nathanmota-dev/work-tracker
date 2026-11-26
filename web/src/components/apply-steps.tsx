import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ExternalLink, Panel } from "@/components/workspace-ui"
import { AgentConversation } from "@/components/agent-conversation"
import { BlockList, RoleWarnings } from "@/components/apply-readiness"
import { CancelRun, RunProblems } from "@/components/apply-run"
import { FillReviewPanel } from "@/components/fill-review"
import { agentSetupLink } from "@/lib/integrations"
import { PortalLink } from "@/components/portal-link"
import { BASE_RESUME, SAVED_RESUME, type ApplyWorkspaceState } from "@/lib/apply-workspace"

type Props = { w: ApplyWorkspaceState }

/** The job description step: the role, its description and the warnings about it. */
export function DescriptionView({ w }: Props) {
  const job = w.details.data?.job
  if (!job) return null
  const { description, descriptionDirty, setDescription } = w.apply
  return <Panel title={`${job.company_name} · ${job.title}`} action={<ExternalLink value={job.link} label="View opportunity" />}>
    <div className="space-y-4">
      {!w.review && <div className="space-y-3">
        <Textarea aria-label="Job description" className="min-h-[50dvh]" value={description} disabled={w.busy} onChange={e => { setDescription(e.target.value) }} placeholder="Paste the description, or leave it empty to fetch it from LinkedIn when generating." />
        <Button variant="outline" size="sm" disabled={w.busy || !descriptionDirty || !description.trim()} onClick={() => void w.action("description")}>Save description</Button>
      </div>}
      {!job.description && !job.linkedin_job_id && !descriptionDirty && <p role="status" className="text-xs text-muted-foreground">This job has no description yet. Paste it above before generating.</p>}
      <RoleWarnings profile={!w.review} gate={w.gate.readiness} guard={job.description_guard_json} description={job.description} />
      {w.archived && <p className="text-sm text-muted-foreground">Restore this job in Jobs before preparing an application.</p>}
    </div>
  </Panel>
}

function agentName(w: ApplyWorkspaceState) {
  const provider = w.providers.data?.providers.find(item => item.id === w.fillAgent.provider)
  const name = provider?.displayName ?? w.fillAgent.provider
  return name ? `${name}${w.fillAgent.model ? ` · ${w.fillAgent.model}` : ""}` : "your agent"
}

/** The fill step, laid out like Find jobs: the form on the left, the agent's output on the right. */
export function FillView({ w }: Props) {
  const fill = w.details.data?.fill
  const filling = w.run?.phase === "filling"
  return <div className="grid gap-4 lg:min-h-[32rem] lg:flex-1 lg:grid-cols-2">
    <div className="flex min-h-0 flex-col"><Panel title="Fill portal" fill><div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <p className="text-sm text-muted-foreground">Your agent opens the application portal in Chrome and fills it with the approved resume{w.pdfRun?.provider === SAVED_RESUME ? " (the saved resume you chose)" : w.pdfRun?.provider === BASE_RESUME ? " (your base resume as it is)" : ""}. It never submits: you review and submit in the browser.</p>
      {!w.review && <PortalLink applicationId={w.details.data?.journey?.id} url={w.details.data?.journey?.external_url} disabled={w.busy || w.submitted} onSaved={w.details.refresh} />}
      <div className="flex flex-wrap gap-2">
        <Button disabled={w.fillBlocks.length > 0} onClick={() => void w.action("fill")}>Fill application</Button>
        <CancelRun w={w} filling />
      </div>
      {!w.review && <p className="text-xs text-muted-foreground">Runs with {agentName(w)}. <a href={agentSetupLink()} className="underline">Change in Agent setup</a></p>}
      <BlockList label="Fill" blocks={w.fillBlocks} correct={w.correct} />
      <RunProblems w={w} filling />
      {fill && (!w.review || w.run) && <FillReviewPanel key={fill.applicationId} review={fill} run={w.run} fillBlocked={w.fillBlocks.length > 0} onFillAgain={() => void w.action("fill")} />}
    </div></Panel></div>
    <div className="flex h-[70dvh] min-h-0 flex-col lg:h-auto"><Panel title="Agent workspace" fill><AgentConversation fill messages={filling ? w.messages : []} /></Panel></div>
  </div>
}

/** The last step: confirm the submission made in the browser. */
export function SubmissionView({ w }: Props) {
  const data = w.details.data
  const applicationId = data?.journey?.id ?? w.pdfRun?.application_id ?? w.search.applicationId
  const confirmed = w.notice || data?.journey?.submission_status === "submitted"
  return <Panel title="Confirm submission">
    <div className="space-y-3">
      {data?.applicationStatus === "filled" && data.uploadedRunId === w.pdfRun?.id
        ? <><p className="text-sm text-muted-foreground">Submit the filled form in the browser, then confirm here to move the application to the board.</p><Button disabled={w.reviewBusy} onClick={() => void w.action("submitted")}>I submitted in the browser</Button></>
        : !confirmed && <p className="text-sm text-muted-foreground">After the portal is filled, submit it in the browser and confirm here.</p>}
      {confirmed && <p role="status" className="text-sm">{w.notice || `Submitted${data?.journey?.submitted_at ? ` on ${new Date(data.journey.submitted_at).toLocaleDateString()}` : ""}.`} <a className="underline" href={`#/applications?view=board${applicationId ? `&highlight=${applicationId}` : ""}`}>View it on the board</a></p>}
    </div>
  </Panel>
}

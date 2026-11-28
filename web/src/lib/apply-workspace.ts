import { useEffect, useMemo, useState } from "react"
import { useApplyContext } from "@/lib/apply-context"
import { applyBlocks, type ApplyAction } from "@/components/apply-readiness"
import { useGateConfirmation } from "@/lib/gates"
import { useIntegrations } from "@/lib/integrations"
import { request, useApi, useConnection, subscribe } from "@/lib/api"
import { applicationSteps } from "@/lib/application-steps"
import type { Providers } from "@/lib/agent"
import type { ReviewSearch } from "@/lib/batch-review"
import { readyVariants, useVariants } from "@/lib/variants"
import { resumeChoice, startUsing, usesReadyPdf } from "@/lib/resume-choice"
import { openApply, preparationMessages, usePreparation, type SourcesState, type PdfArtifact, type SubmissionConfirmation } from "@/lib/preparation"

export { BASE_RESUME, SAVED_RESUME, usesReadyPdf } from "@/lib/resume-choice"
export type ApplyKind = "generate" | "fill" | "retry" | "cancel" | "submitted" | "description" | "approve"

/** Focus the job description editor. */
function focusDescription() {
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Job description"]')?.focus()
}

/**
 * Everything the Apply workspace shows for one job: its executions, the
 * displayed document, what blocks each operation and the actions. In a batch
 * review (`review`), the item's own execution and agent are used.
 */
export function useApplyWorkspace(search: ReviewSearch, review: boolean, reviewLocked: boolean) {
  const providers = useApi<Providers>("acp/providers")
  const sources = useApi<SourcesState>("resume-sources")
  const details = usePreparation(search.jobId, search.applicationId)
  const live = useConnection()
  const integrations = useIntegrations()
  const apply = useApplyContext(search, details.data?.job.description, details.data?.runs)
  const { context, model, setModel, extra, descriptionDirty, description } = apply
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<PdfArtifact>()
  const gate = useGateConfirmation(search.jobId)
  const refreshSources = sources.refresh
  useEffect(() => subscribe(event => { if (event.type === "resume-sources-changed") refreshSources() }), [refreshSources])
  const selectedProvider = providers.data?.providers.find(p => p.id === apply.provider) ?? providers.data?.providers.find(p => p.id === providers.data?.default) ?? providers.data?.providers[0]
  const effectiveModel = selectedProvider?.models.includes(model) ? model : ""
  const runs = details.data?.runs ?? []
  const run = review ? runs.find(r => r.id === search.runId) : runs.find(r => r.id === search.runId) ?? runs[0]
  const previous = (!review || run) ? runs.find(r => r.artifacts.some(a => a.kind === "tailored")) : undefined
  const pdfRun = run?.artifacts.some(a => a.kind === "tailored") ? run : previous
  useEffect(() => { setPreview(undefined) }, [search.jobId, search.runId, run?.id])
  const base = preview ?? run?.artifacts.find(a => a.kind === "base") ?? sources.data?.preview
  const version = details.data?.documents?.find(item => item.runId === pdfRun?.id)
  const tailored = pdfRun?.artifacts.find(a => a.kind === "tailored")
  const variants = useVariants()
  const resume = resumeChoice({ review, run: tailored ? pdfRun : undefined, version, saved: readyVariants(variants.data), pick: context.draft.resume })
  const pickResume = (choice: string) => context.update(previous => ({ ...previous, resume: { choice, runId: tailored ? pdfRun?.id : undefined } }))
  const busy = reviewLocked || pending || details.loading || !details.data || !!details.data.busy || variants.loading && !variants.data
  const reviewBusy = (!!review && pdfRun?.id !== run?.id) || reviewLocked || pending || details.loading || !details.data || pdfRun?.status === "running" // Review stays possible while a batch runs another execution.
  const archived = !!details.data?.job.archived_at
  const submitted = details.data?.applicationStatus === "submitted"
  const missingTools = sources.data?.dependencies.some(d => !d.available) ?? true
  // A batch item is filled by the agent that generated it; otherwise by the selected agent.
  const itemAgent = review && pdfRun && !usesReadyPdf(pdfRun.provider) ? { provider: pdfRun.provider, model: pdfRun.model ?? "" } : undefined
  const fillAgent = itemAgent ?? { provider: selectedProvider?.id, model: effectiveModel }
  const readiness = { live, busy: (!!review && pdfRun?.id !== run?.id) || busy || integrations.testing, archived, submitted, sources: !!sources.data?.source, tools: !missingTools, descriptionDirty, gateUnconfirmed: gate.unconfirmed, linkedinNeeded: !details.data?.job.description && !!details.data?.job.linkedin_job_id, descriptionMissing: !details.data?.job.description && !details.data?.job.linkedin_job_id, tailored: !!resume.replacement || !!tailored && !!version, approved: review ? !!version?.approvedAt : undefined, baseUnconfigured: resume.replacement === "base" && !sources.data?.source, provider: selectedProvider?.id, model, invalidModel: !!model && !selectedProvider?.models.includes(model), integrations: integrations.data }
  const generateBlocks = review ? [] : applyBlocks(readiness, "generate")
  // An unavailable saved model is not sent, so it never blocks filling.
  const fillBlocks = applyBlocks({ ...readiness, ...fillAgent, invalidModel: false }, "fill")
  const steps = applicationSteps({ description: !readiness.descriptionMissing && !descriptionDirty, resume: review ? !!readiness.approved : readiness.tailored, filled: ["filled", "needs_input"].includes(details.data?.applicationStatus ?? ""), submitted: submitted || details.data?.journey?.submission_status === "submitted", generate: generateBlocks, fill: fillBlocks })
  // Each correction opens the step that holds it, then brings it into view once rendered.
  function correct(action: ApplyAction) {
    if (action === "model") { setModel(""); return }
    apply.update({ step: action === "review" ? "resume" : "description" })
    requestAnimationFrame(() => {
      if (action === "description") focusDescription()
      else document.getElementById(action === "gate" ? "requirements-warning" : "document-review")?.scrollIntoView?.()
    })
  }
  const messages = useMemo(() => preparationMessages(run?.events ?? [], run?.status), [run?.events, run?.status])
  const agentFields = review ? {} : { provider: fillAgent.provider, model: fillAgent.model || undefined }
  function body(kind: ApplyKind, reviewed: boolean) {
    switch (kind) {
      case "generate": return { jobId: search.jobId, applicationId: search.applicationId ?? run?.application_id, provider: selectedProvider?.id, model: effectiveModel || undefined, extra }
      case "description": return { jobId: search.jobId, description }
      case "submitted": return { runId: pdfRun?.id, applicationId: pdfRun?.application_id ?? undefined }
      case "approve": return { runId: pdfRun?.id, versionId: version?.id }
      case "retry": return { runId: run?.id, extra, reviewed, ...agentFields }
      case "fill": return { runId: pdfRun?.id, extra, versionId: version?.id, ...agentFields }
      case "cancel": return { runId: run?.id, extra }
    }
  }
  /** The execution to fill: a newly chosen base or saved resume is put in use first. */
  async function fillTarget() {
    if (!resume.replacement) return { payload: body("fill", false), runId: pdfRun?.id, applicationId: pdfRun?.application_id }
    const used = await startUsing(resume.replacement, { jobId: search.jobId, applicationId: search.applicationId ?? run?.application_id ?? undefined })
    context.update(previous => ({ ...previous, runId: used.id, resume: undefined }))
    openApply(search.jobId, used.application_id ?? undefined, used.id)
    return { payload: { runId: used.id, extra, ...agentFields }, runId: used.id, applicationId: used.application_id }
  }
  async function action(kind: ApplyKind, reviewed = false) {
    setPending(true); setError(""); setNotice("")
    try {
      const target = kind === "fill" ? await fillTarget() : undefined
      const payload = target ? target.payload : body(kind, reviewed)
      const value = await request<{ id?: string; application_id?: number | null } & Partial<SubmissionConfirmation>>(`application-preparation/${kind}`, payload)
      if (kind === "submitted") setNotice(value.alreadySubmitted ? "This submission was already confirmed. The application stays on the board." : "Submission confirmed. The application is now on the board in its initial stage.")
      if (kind === "generate" && value.id) { context.update(previous => ({ ...previous, runId: value.id })); openApply(search.jobId, "applicationId" in payload ? payload.applicationId : undefined, value.id) }
      if (kind === "retry" && run) openApply(search.jobId, search.applicationId, run.id)
      if (target?.runId) openApply(search.jobId, target.applicationId ?? undefined, target.runId)
      if (kind === "description") context.update(previous => ({ ...previous, descriptionDirty: false }))
      details.refresh()
    } catch (e) { setError((e as Error).message); details.refresh() }
    finally { setPending(false) }
  }
  return {
    search, review, providers, sources, details, live, integrations, apply, error, setError, notice, setNotice, preview, setPreview, gate,
    selectedProvider, effectiveModel, run, pdfRun, base, version, tailored, busy, reviewBusy, archived, submitted, readiness, fillAgent,
    generateBlocks, fillBlocks, steps, correct, messages, action, pending, variants, resume, pickResume,
  }
}
export type ApplyWorkspaceState = ReturnType<typeof useApplyWorkspace>

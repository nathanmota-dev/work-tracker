import { useEffect, useMemo, useState } from "react"
import { useApplyContext } from "@/lib/apply-context"
import { applyBlocks, type ApplyAction } from "@/components/apply-readiness"
import { useGateConfirmation } from "@/lib/gates"
import { useIntegrations, type Target } from "@/lib/integrations"
import { request, useApi, useConnection, subscribe } from "@/lib/api"
import { applicationSteps } from "@/lib/application-steps"
import type { Providers } from "@/lib/agent"
import type { ReviewSearch } from "@/lib/batch-review"
import { openApply, preparationMessages, usePreparation, type SourcesState, type PdfArtifact, type SubmissionConfirmation } from "@/lib/preparation"

/** Marks an execution that reused a saved resume; no agent generated it. */
export const SAVED_RESUME = "saved-resume"
/** Marks an execution that used the base resume as it is. */
export const BASE_RESUME = "base-resume"
/** No agent generated these executions' PDFs, so the selected agent fills them. */
export const usesReadyPdf = (provider?: string) => provider === SAVED_RESUME || provider === BASE_RESUME
export type ApplyKind = "generate" | "fill" | "retry" | "cancel" | "submitted" | "description" | "approve" | "use-base"

/** Open the job description editor and focus it. */
function focusDescription() {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Job description"]')
  const details = textarea?.closest("details")
  if (details) details.open = true
  textarea?.focus()
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
  const busy = reviewLocked || pending || details.loading || !details.data || !!details.data.busy
  const reviewBusy = (!!review && pdfRun?.id !== run?.id) || reviewLocked || pending || details.loading || !details.data || pdfRun?.status === "running" // Review stays possible while a batch runs another execution.
  const archived = !!details.data?.job.archived_at
  const submitted = details.data?.applicationStatus === "submitted"
  const missingTools = sources.data?.dependencies.some(d => !d.available) ?? true
  // A batch item is filled by the agent that generated it; otherwise by the selected agent.
  const itemAgent = review && pdfRun && !usesReadyPdf(pdfRun.provider) ? { provider: pdfRun.provider, model: pdfRun.model ?? "" } : undefined
  const fillAgent = itemAgent ?? { provider: selectedProvider?.id, model: effectiveModel }
  const readiness = { live, busy: (!!review && pdfRun?.id !== run?.id) || busy || integrations.testing, archived, submitted, sources: !!sources.data?.config.projectDir, tools: !missingTools, descriptionDirty, gateUnconfirmed: gate.unconfirmed, linkedinNeeded: !details.data?.job.description && !!details.data?.job.linkedin_job_id, descriptionMissing: !details.data?.job.description && !details.data?.job.linkedin_job_id, tailored: !!tailored && !!version, approved: !!version?.approvedAt, provider: selectedProvider?.id, model, invalidModel: !!model && !selectedProvider?.models.includes(model), integrations: integrations.data }
  const generateBlocks = review ? [] : applyBlocks(readiness, "generate")
  // An unavailable saved model is not sent, so it never blocks filling.
  const fillBlocks = applyBlocks({ ...readiness, ...fillAgent, invalidModel: false }, "fill")
  const steps = applicationSteps({ description: !readiness.descriptionMissing && !descriptionDirty, approved: readiness.approved, filled: ["filled", "needs_input"].includes(details.data?.applicationStatus ?? ""), submitted: submitted || details.data?.journey?.submission_status === "submitted", generate: generateBlocks, fill: fillBlocks })
  function correct(action: ApplyAction) {
    if (action === "review" || action === "gate") document.getElementById(action === "gate" ? "requirements-warning" : "document-review")?.scrollIntoView?.()
    else if (action === "description") focusDescription()
    else { setModel(""); document.querySelector<HTMLElement>('[aria-label="Model"]')?.focus() }
  }
  function testAvailability() {
    const targets: Target[] = [...(fillAgent.provider ? [`acp/${fillAgent.provider}` as Target] : []), "mcp/chrome", ...(!details.data?.job.description && details.data?.job.linkedin_job_id ? ["mcp/linkedin" as const] : [])]
    void integrations.test(targets, fillAgent.model); sources.refresh(); providers.refresh()
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
      case "use-base": return { jobId: search.jobId, applicationId: search.applicationId ?? run?.application_id ?? undefined }
    }
  }
  async function action(kind: ApplyKind, reviewed = false) {
    setPending(true); setError(""); setNotice("")
    try {
      const payload = body(kind, reviewed)
      const value = await request<{ id?: string; application_id?: number | null } & Partial<SubmissionConfirmation>>(`application-preparation/${kind}`, payload)
      if (kind === "use-base" && value.id) { const runId = value.id; context.update(previous => ({ ...previous, runId })); openApply(search.jobId, value.application_id ?? undefined, runId) }
      if (kind === "submitted") setNotice(value.alreadySubmitted ? "This submission was already confirmed. The application stays on the board." : "Submission confirmed. The application is now on the board in its initial stage.")
      if (kind === "generate" && value.id) { context.update(previous => ({ ...previous, runId: value.id })); openApply(search.jobId, "applicationId" in payload ? payload.applicationId : undefined, value.id) }
      if (kind === "retry" && run) openApply(search.jobId, search.applicationId, run.id)
      if (kind === "fill" && pdfRun) openApply(search.jobId, pdfRun.application_id ?? undefined, pdfRun.id)
      if (kind === "description") context.update(previous => ({ ...previous, descriptionDirty: false }))
      details.refresh()
    } catch (e) { setError((e as Error).message) }
    finally { setPending(false) }
  }
  return {
    search, review, providers, sources, details, live, integrations, apply, error, setError, notice, setNotice, preview, setPreview, gate,
    selectedProvider, effectiveModel, run, pdfRun, base, version, tailored, busy, reviewBusy, archived, submitted, readiness, fillAgent,
    generateBlocks, fillBlocks, steps, correct, testAvailability, messages, action, pending,
  }
}
export type ApplyWorkspaceState = ReturnType<typeof useApplyWorkspace>

import { lazy, Suspense, useState, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, Panel } from "@/components/workspace-ui"
import { AgentConversation } from "@/components/agent-conversation"
import { BlockList } from "@/components/apply-readiness"
import { DocumentReview } from "@/components/document-review"
import { Markdown } from "@/components/markdown"
import { ScoreRing } from "@/components/resume-tile"
import { request } from "@/lib/api"
import { ATS_NOTE, byJobScore, useAtsJob, type AtsDocumentScore } from "@/lib/ats"
import { openApply, type PdfArtifact } from "@/lib/preparation"
import { BASE_RESUME, SAVED_RESUME, type ApplyWorkspaceState } from "@/lib/apply-workspace"
import { readyVariants, roleLabels, useVariants, type ResumeVariant } from "@/lib/variants"
import { cn } from "@/lib/utils"
import { CancelRun, RunProblems } from "@/components/apply-run"

const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))
type Props = { w: ApplyWorkspaceState }
/** "application" is the resume this application already uses; "base" the base resume; any other value a saved resume's id. */
type Choice = string
const MAX_MISSING = 5

/** A sheet of paper with the score ring or plain text lines, like the cards in Resumes. */
function Sheet({ score }: { score?: AtsDocumentScore }) {
  return <div aria-hidden={!score} className="relative mx-auto flex h-28 w-20 flex-col items-center gap-2 rounded-sm bg-muted px-3 pt-3 shadow-sm transition-transform group-hover:-rotate-2">
    {score ? <ScoreRing match={score} subject="this job" /> : <span className="h-2 w-10 self-start rounded bg-muted-foreground/30" />}
    {[9, 12, 10, 13].map(width => <span key={width} className="h-1.5 self-start rounded bg-muted-foreground/20" style={{ width: `${width * 4}px` }} />)}
  </div>
}

/** One resume to choose for this application; choosing it shows its PDF beside the cards. */
function ResumeCard({ name, detail, badge, score, selected, onSelect, children }: { name: string; detail: string; badge?: string; score?: AtsDocumentScore; selected: boolean; onSelect: () => void; children?: ReactNode }) {
  return <button type="button" aria-pressed={selected} aria-label={name} onClick={onSelect} className={cn("group flex w-full min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring", selected && "border-primary bg-primary/5 hover:bg-primary/5")}>
    <div className="relative rounded-lg bg-accent/30 py-3">
      <Sheet score={score} />
      {badge && <span className="absolute right-2 top-2"><Badge>{badge}</Badge></span>}
    </div>
    <div className="min-w-0 space-y-1.5">
      <h3 className="truncate text-sm font-medium" title={name}>{name}</h3>
      <p className="truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
      {children}
    </div>
  </button>
}

function Stacks({ variant }: { variant: ResumeVariant }) {
  return <ul aria-label={`Stacks of ${variant.name}`} className="flex flex-wrap gap-1">{variant.stacks.slice(0, 4).map(stack => <li key={stack}><Badge variant="secondary">{stack}</Badge></li>)}{variant.stacks.length > 4 && <li><Badge variant="outline">+{variant.stacks.length - 4}</Badge></li>}</ul>
}

/** Where the application's current resume came from. */
function applicationResume(w: ApplyWorkspaceState) {
  const provider = w.pdfRun?.provider
  const name = provider === SAVED_RESUME ? w.version?.variant?.name ?? "Saved resume" : provider === BASE_RESUME ? "Base resume" : "Tailored resume"
  const state = w.version?.submittedAt ? "Submitted" : w.version?.approvedAt ? "Approved" : "Awaiting approval"
  return { name, detail: `${provider === SAVED_RESUME ? "Saved resume" : provider === BASE_RESUME ? "As it is" : "Generated for this job"} · ${state}` }
}

/** What can be done with the chosen resume: approve the application's one, or start using another. */
function ChoiceAction({ w, choice, variant, score }: Props & { choice: Choice; variant?: ResumeVariant; score?: AtsDocumentScore }) {
  const [pending, setPending] = useState(false)
  const target = { jobId: w.search.jobId, applicationId: w.search.applicationId ?? w.run?.application_id ?? undefined }
  const locked = w.busy || w.archived || !w.live || w.readiness.submitted || pending
  const baseReady = !!w.sources.data?.config.projectDir
  async function applySaved(variantId: string) {
    setPending(true); w.setError("")
    try {
      const value = await request<{ id: string; application_id: number | null }>("application-preparation/use-variant", { ...target, variantId })
      w.setNotice(""); w.apply.context.update(previous => ({ ...previous, runId: value.id })); openApply(w.search.jobId, value.application_id ?? undefined, value.id); w.details.refresh()
    } catch (e) { w.setError((e as Error).message) }
    finally { setPending(false) }
  }
  const missing = score?.requiredMissing.slice(0, MAX_MISSING) ?? []
  return <div className="space-y-2 rounded-xl border bg-background/40 p-3 text-sm">
    {choice === "application" && <p>{w.version?.approvedAt ? "This resume is approved. Continue in Fill portal." : "Review the PDF and approve this version before filling."}</p>}
    {choice === "application" && w.version && !w.version.approvedAt && <Button disabled={w.reviewBusy || w.archived || !w.live || w.submitted} onClick={() => void w.action("approve")}>Approve this resume</Button>}
    {choice === "base" && <>
      <p className="text-muted-foreground">Send the base resume as it is, without tailoring. Its PDF is compiled first if needed.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!baseReady || locked} onClick={() => void w.action("use-base")}>Use base resume</Button>
        {w.sources.data && !baseReady && <a className="text-xs underline" href="#/resume?id=base">Configure resume sources</a>}
      </div>
    </>}
    {variant && <>
      <p className="text-muted-foreground">Reuse this saved resume. No agent runs, so you can approve and fill right away.</p>
      <Button disabled={locked} onClick={() => void applySaved(variant.id)}>Use this resume</Button>
    </>}
    {choice !== "application" && !!missing.length && <p className="text-xs text-muted-foreground" title={ATS_NOTE}>Missing required: {missing.join(", ")}</p>}
  </div>
}

/** Tailor the base resume to this job with the default agent. */
function GeneratePanel({ w }: Props) {
  return <Panel title="Generate a tailored resume">
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Your agent tailors the base resume to this job description. The new resume appears as a card here; it is added to Resumes only after the application is submitted.</p>
      <Field label="Additional context"><Textarea value={w.apply.extra} disabled={w.busy} onChange={e => w.apply.setExtra(e.target.value)} placeholder="What should the agent emphasize? The resume follows the job description’s language." /></Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={w.generateBlocks.length > 0} onClick={() => void w.action("generate")}>{w.tailored && w.pdfRun?.provider !== SAVED_RESUME && w.pdfRun?.provider !== BASE_RESUME ? "Regenerate" : "Generate resume"}</Button>
        <CancelRun w={w} filling={false} />
      </div>
      <BlockList label="Generate" blocks={w.generateBlocks} correct={w.correct} />
      <RunProblems w={w} filling={false} />
      {w.run?.report && w.run.phase !== "filling" && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Tailoring report</summary><div className="mt-3 text-sm"><Markdown text={w.run.report} /></div></details>}
    </div>
  </Panel>
}

/** The resume step: resumes as cards on the left, the chosen one's PDF on the right. */
export function ResumeView({ w }: Props) {
  const variants = useVariants()
  const ats = useAtsJob(w.search.jobId)
  const scores = Array.isArray(ats.data?.documents) ? ats.data.documents : []
  const saved = w.review ? [] : byJobScore(readyVariants(variants.data), scores)
  const [picked, setPicked] = useState<Choice>()
  const choices: Choice[] = [...(w.tailored ? ["application"] : []), ...(w.review ? [] : ["base"]), ...saved.map(variant => variant.id)]
  const choice = picked && choices.includes(picked) ? picked : choices[0] ?? "base"
  const variant = saved.find(item => item.id === choice)
  const scoreOf = (id?: string) => scores.find(item => (id ? item.variant_id === id : item.kind === "base"))
  const generating = !!w.run && w.run.phase !== "filling" && (w.run.status === "running" || w.run.status === "waiting_for_sign_in")
  const pdf: PdfArtifact | null | undefined = choice === "application" ? w.tailored : choice === "base" ? w.base : variant?.pdf
  const current = w.tailored ? applicationResume(w) : undefined
  const title = choice === "application" ? current?.name : choice === "base" ? "Base resume" : variant?.name
  return <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
    <div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
      <Panel title="Choose a resume">
        <div className="space-y-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {current && <ResumeCard name={current.name} detail={current.detail} badge="This application" selected={choice === "application"} onSelect={() => setPicked("application")} />}
            {!w.review && <ResumeCard name="Base resume" detail={w.sources.data?.config.projectDir ? w.sources.data.config.mainFile : "Not configured"} badge="Default" score={scoreOf()} selected={choice === "base"} onSelect={() => setPicked("base")} />}
            {saved.map(item => <ResumeCard key={item.id} name={item.name} detail={roleLabels[item.role]} score={scoreOf(item.id)} selected={choice === item.id} onSelect={() => setPicked(item.id)}><Stacks variant={item} /></ResumeCard>)}
          </div>
          {!w.review && !saved.length && variants.data && <p className="text-xs text-muted-foreground">No saved resume is ready. <a className="text-foreground underline" href="#/resumes">Create one in Resumes</a> to reuse it for jobs with the same stack.</p>}
          <ChoiceAction w={w} choice={choice} variant={variant} score={choice === "base" ? scoreOf() : variant ? scoreOf(variant.id) : undefined} />
        </div>
      </Panel>
      {!w.review && <GeneratePanel w={w} />}
      {w.review && <RunProblems w={w} filling={false} />}
      {w.tailored && w.pdfRun?.id !== w.run?.id && <p className="text-sm text-muted-foreground">{w.review ? "Showing the previous validated resume. Retry this item to finish the requested version." : "Showing the previous validated resume. Approve this version before filling if needed."}</p>}
      {choice === "application" && w.version && <DocumentReview key={w.version.id} version={w.version} versions={w.details.data?.documents ?? []} disabled={w.reviewBusy || w.archived || !w.live || w.submitted} approve={() => void w.action("approve")} />}
    </div>
    <div className="flex h-[80dvh] min-h-0 flex-col lg:h-auto">
      {generating
        ? <Panel title="Agent workspace" fill><AgentConversation fill messages={w.messages} /></Panel>
        : <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfViewer key={choice} title={title ? `${title} PDF` : "Resume PDF"} artifact={pdf} fill /></Suspense>}
    </div>
  </div>
}

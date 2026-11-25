import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2, ChevronDown, Circle, SkipForward } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/workspace-ui"
import { getStartedLink, itemText, saveOnboarding, stepCopy, stepHref, useOnboarding, type OnboardingStatus, type OnboardingStep, type StepId } from "@/lib/onboarding"

const badges = { done: "Done", pending: "To do", skipped: "Skipped" } as const
const icons = { done: CheckCircle2, pending: Circle, skipped: SkipForward } as const
/** How long the completion confirmation stays before the card disappears. */
export const CONFIRMATION_MS = 5000

function StepRow({ step, number, open, focused, busy, onToggle, onSkip }: {
  step: OnboardingStep; number: number; open: boolean; focused: boolean; busy: boolean; onToggle: () => void; onSkip: (skipped: boolean) => void
}) {
  const copy = stepCopy[step.id]
  const Icon = icons[step.state]
  return <li id={`get-started-${step.id}`} aria-current={focused ? "step" : undefined}
    className={cn("rounded-xl border", open && "bg-muted/20", focused && "border-primary ring-1 ring-primary")}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left">
      <Icon aria-hidden className={cn("size-4 shrink-0", step.state === "done" ? "text-emerald-500" : "text-muted-foreground")} />
      <h3 className={cn("min-w-0 flex-1 truncate text-sm", step.state === "done" ? "text-muted-foreground" : "font-medium")}>{number}. {copy.title}</h3>
      {step.optional && step.state !== "done" && <span className="hidden text-xs text-muted-foreground sm:inline">Optional</span>}
      <Badge variant={step.state === "done" ? "secondary" : "outline"}>{badges[step.state]}</Badge>
      <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
    </button>
    {open && <div className="space-y-3 px-4 pb-4 pl-11">
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      {step.state === "pending" && <ul aria-label={`${copy.title} requirements`} className="space-y-1 text-xs">
        {step.items.map(item => <li key={item.key} className={item.ready ? "text-muted-foreground" : ""}>{item.ready ? "✓" : "•"} {itemText(item)}</li>)}
      </ul>}
      {step.state === "skipped" && <p className="text-xs text-muted-foreground">Skipped. Agent features stay unavailable until you resume this step.</p>}
      <div className="flex flex-wrap gap-2">
        {step.state === "pending" && <Button size="sm" asChild><a href={stepHref(step)}>{copy.action}</a></Button>}
        {step.optional && step.state === "pending" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onSkip(true)}>Skip for now</Button>}
        {step.state === "skipped" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onSkip(false)}>Resume step</Button>}
      </div>
    </div>}
  </li>
}

/** One segment per step, filled once it is done or skipped. */
function StepProgress({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter(step => step.state !== "pending").length
  return <div className="space-y-2">
    <p className="text-sm"><span className="font-medium">{done} of {steps.length} steps complete</span><span className="text-muted-foreground"> · each step updates by itself when its requirement is met.</span></p>
    <div aria-hidden className="flex gap-[3px]">
      {steps.map(step => <span key={step.id} className={cn("h-1.5 flex-1 rounded-[2px]", step.state === "done" ? "bg-emerald-500" : step.state === "skipped" ? "bg-muted-foreground/40" : "bg-muted")} />)}
    </div>
  </div>
}

function useChecklistActions(status: OnboardingStatus | undefined) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save(preferences: Parameters<typeof saveOnboarding>[0]) {
    setBusy(true); setError("")
    try { await saveOnboarding(preferences) }
    catch { setError("The checklist could not be saved. Check the workspace connection and try again.") }
    finally { setBusy(false) }
  }
  const skipped = status?.steps.filter(step => step.state === "skipped").map(step => step.id) ?? []
  const skip = (id: StepId, value: boolean) => save({ skipped: value ? [...skipped, id] : skipped.filter(step => step !== id) })
  const manual = () => save({ skipped: status?.steps.filter(step => step.optional && step.state !== "done").map(step => step.id) ?? [] })
  return { busy, error, save, skip, manual }
}

/**
 * Dashboard checklist from a new workspace to its first application. Every
 * state comes from the workspace; `focus` opens it at one step, even while hidden.
 */
export function GetStarted({ focus }: { focus?: string }) {
  const { status } = useOnboarding()
  const actions = useChecklistActions(status)
  const [confirming, setConfirming] = useState(false)
  // undefined follows the next pending step; null closes every step.
  const [expanded, setExpanded] = useState<StepId | null>()
  const firstCompletion = !!status?.complete && !status.completedAt && !status.hidden
  if (firstCompletion && !confirming) setConfirming(true)
  useEffect(() => {
    if (!confirming) return
    void saveOnboarding({ completed: true, hidden: true }).catch(() => {})
    const timer = setTimeout(() => setConfirming(false), CONFIRMATION_MS)
    return () => clearTimeout(timer)
  }, [confirming])
  useEffect(() => {
    if (focus) document.getElementById(`get-started-${focus}`)?.scrollIntoView?.({ block: "center" })
  }, [focus, status])
  if (confirming) return <Panel title="Get started" action={<Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Dismiss</Button>}>
    <p role="status" className="text-sm">You’re all set. Your workspace is ready for the next application. You can reopen this checklist in Settings.</p>
  </Panel>
  if (!status || status.hidden && !focus) return null
  const manual = status.steps.some(step => step.optional && step.state === "pending")
  const next = status.steps.find(step => step.state === "pending")?.id
  const isOpen = (id: StepId) => expanded === undefined ? id === (focus ?? next) : expanded === id
  return <Panel title="Get started" action={<Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => void actions.save({ hidden: true })}>Hide checklist</Button>}>
    <div className="space-y-4">
      <StepProgress steps={status.steps} />
      <ol className="space-y-2">
        {status.steps.map((step, index) => <StepRow key={step.id} step={step} number={index + 1} open={isOpen(step.id)} focused={focus === step.id} busy={actions.busy}
          onToggle={() => setExpanded(isOpen(step.id) ? null : step.id)} onSkip={value => void actions.skip(step.id, value)} />)}
      </ol>
      {manual && <p className="text-xs text-muted-foreground">Only tracking jobs by hand? <Button size="sm" variant="link" className="h-auto p-0 text-xs" disabled={actions.busy} onClick={() => void actions.manual()}>Start without an agent</Button> and add jobs and applications manually.</p>}
      {actions.error && <p role="alert" className="text-sm text-destructive">{actions.error}</p>}
    </div>
  </Panel>
}

function StepLink({ id }: { id: StepId }) {
  return <a className="underline" href={getStartedLink(id)}>{stepCopy[id].title}</a>
}

/** Points an empty list or a blocker at the next Get started step. */
export function NextStepHint({ step: id, fallback = "" }: { step?: StepId; fallback?: string }) {
  const { status, next, step } = useOnboarding()
  const target = id ? step(id) : next
  if (!status || !target || target.state === "done") return <>{fallback}</>
  return <>{id ? "Set this up in Get started" : "Next in Get started"}: <StepLink id={target.id} />.</>
}

/** Explains a blocker caused by an unfinished step, only while that step is not done. */
export function SetupNotice({ step: id, pendingOnly = false, children }: { step: StepId; pendingOnly?: boolean; children: ReactNode }) {
  const target = useOnboarding().step(id)
  if (!target || target.state === "done" || pendingOnly && target.state !== "pending") return null
  return <p className="text-sm text-muted-foreground">{children} Set this up in Get started: <StepLink id={id} />.</p>
}

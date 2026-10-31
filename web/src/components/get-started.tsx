import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2, Circle, SkipForward } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/workspace-ui"
import { getStartedLink, itemText, saveOnboarding, stepCopy, stepHref, useOnboarding, type OnboardingStatus, type OnboardingStep, type StepId } from "@/lib/onboarding"

const badges = { done: "Done", pending: "To do", skipped: "Skipped" } as const
const icons = { done: CheckCircle2, pending: Circle, skipped: SkipForward } as const
/** How long the completion confirmation stays before the card disappears. */
export const CONFIRMATION_MS = 5000

function StepRow({ step, number, focused, busy, onSkip }: {
  step: OnboardingStep; number: number; focused: boolean; busy: boolean; onSkip: (skipped: boolean) => void
}) {
  const copy = stepCopy[step.id]
  const Icon = icons[step.state]
  return <li id={`get-started-${step.id}`} aria-current={focused ? "step" : undefined}
    className={`flex gap-3 rounded-lg border p-3 ${focused ? "border-chart-1 ring-1 ring-chart-1" : ""}`}>
    <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${step.state === "done" ? "text-chart-2" : "text-muted-foreground"}`} />
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{number}. {copy.title}</h3>
        <Badge variant={step.state === "done" ? "secondary" : "outline"}>{badges[step.state]}</Badge>
        {step.optional && step.state !== "done" && <span className="text-xs text-muted-foreground">Optional for manual tracking</span>}
      </div>
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
    </div>
  </li>
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
  const done = status.steps.filter(step => step.state !== "pending").length
  const manual = status.steps.some(step => step.optional && step.state === "pending")
  return <Panel title="Get started" action={<Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => void actions.save({ hidden: true })}>Hide checklist</Button>}>
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{done} of {status.steps.length} steps complete. Each step updates by itself when its requirement is met.</p>
      {manual && <p className="text-sm">Only tracking jobs by hand? <Button size="sm" variant="link" className="h-auto p-0" disabled={actions.busy} onClick={() => void actions.manual()}>Start without an agent</Button> and add jobs and applications manually.</p>}
      <ol className="space-y-2">
        {status.steps.map((step, index) => <StepRow key={step.id} step={step} number={index + 1} focused={focus === step.id} busy={actions.busy}
          onSkip={value => void actions.skip(step.id, value)} />)}
      </ol>
      {actions.error && <p role="alert" className="text-sm text-destructive">{actions.error}</p>}
    </div>
  </Panel>
}

/** Settings entry that brings a hidden checklist back to the Dashboard. */
export function GetStartedSettings() {
  const { status } = useOnboarding()
  const actions = useChecklistActions(status)
  if (!status) return null
  const skipped = status.steps.filter(step => step.state === "skipped")
  return <Panel title="Get started checklist">
    <p className="mb-4 text-sm text-muted-foreground">
      {status.hidden ? "The checklist is hidden from the Dashboard." : "The checklist is shown on the Dashboard."}
      {skipped.length > 0 && ` Skipped: ${skipped.map(step => stepCopy[step.id].title).join(", ")}.`}
    </p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={actions.busy || !status.hidden} onClick={() => void actions.save({ hidden: false })}>Show checklist on Dashboard</Button>
      {skipped.length > 0 && <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => void actions.save({ skipped: [] })}>Resume skipped steps</Button>}
    </div>
    {actions.error && <p role="alert" className="mt-2 text-sm text-destructive">{actions.error}</p>}
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

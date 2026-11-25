import type { ReactNode } from "react"
import { Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Empty } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import type { ApplicationStep, StepState } from "@/lib/application-steps"
import { cn } from "@/lib/utils"

const STATES: Record<StepState, string> = {
  done: "Done",
  current: "Current step",
  blocked: "Blocked",
  upcoming: "Next",
}

/** The element that holds a step's actions, which the stepper scrolls to. */
export const stepAnchor = (key: ApplicationStep["key"]) => `apply-step-${key}`

/** Where the application is, from job description to confirmed submission; a step opens its section. */
export function ApplicationStepper({ steps }: { steps: ApplicationStep[] }) {
  return (
    <nav aria-label="Application progress">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const active = step.state === "current" || step.state === "blocked"
          return (
            <li key={step.key} aria-current={active ? "step" : undefined} aria-label={`${index + 1}. ${step.label}: ${STATES[step.state]}`} className="flex">
              <button
                type="button"
                onClick={() => document.getElementById(stepAnchor(step.key))?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                className={cn(
                  "flex w-full cursor-pointer gap-3 rounded-xl border p-3 text-left text-sm outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring",
                  active && "border-primary bg-primary/5",
                  step.state === "blocked" && "border-destructive/40 bg-destructive/5",
                )}
              >
                <StepBadge state={step.state} index={index} />
                <span className="min-w-0 space-y-1">
                  <span className="block font-medium">{step.label}</span>
                  <span className="block text-xs text-muted-foreground">{STATES[step.state]} · {step.hint}</span>
                  {step.blocks[0] && (
                    <span className="block text-xs text-destructive">
                      {step.blocks[0].message}
                      {step.blocks.length > 1 && ` (+${step.blocks.length - 1} more)`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** The step number, or a check once it is done. */
export function StepBadge({ state, index }: { state: StepState; index: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        (state === "current" || state === "blocked") && "border-primary text-primary",
        state === "blocked" && "border-destructive text-destructive",
      )}
    >
      {state === "done" ? <Check className="size-3.5" /> : index + 1}
    </span>
  )
}

/** A step's own section: its state, its actions and what went wrong with them, together. */
export function StepSection({ step, index, children, aside }: { step?: ApplicationStep; index: number; children: ReactNode; aside?: ReactNode }) {
  if (!step) return null
  return (
    <section id={stepAnchor(step.key)} aria-label={`Step ${index + 1}: ${step.label}`} className={cn("scroll-mt-4 rounded-2xl border bg-card p-4", (step.state === "current" || step.state === "blocked") && "border-primary/40")}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StepBadge state={step.state} index={index} />
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{step.label}</h2>
            <p className="text-xs text-muted-foreground">{step.hint}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {aside}
          <Badge variant="outline" className={cn("rounded-md font-normal", step.state === "done" && "border-primary/40 text-primary", step.state === "blocked" && "border-destructive/40 text-destructive")}>{STATES[step.state]}</Badge>
        </div>
      </header>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

/** The detail needs a job; applications start from the Jobs shortlist. */
export function ApplicationEmpty() {
  return (
    <Empty
      title="Choose a job to apply to"
      description="Applications start from a role in your Jobs shortlist. Use Apply on a shortlisted role to open its application here."
    >
      <Button asChild>
        <a href="#/jobs?view=shortlist">Open the Jobs shortlist</a>
      </Button>
    </Empty>
  )
}

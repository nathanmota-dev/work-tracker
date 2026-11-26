import { Check } from "lucide-react"
import { Empty } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import type { ApplicationStep, StepKey, StepState } from "@/lib/application-steps"
import { cn } from "@/lib/utils"

const STATES: Record<StepState, string> = {
  done: "Done",
  current: "Current step",
  blocked: "Blocked",
  upcoming: "Next",
}

/** The step to open first: the one waiting for the user, or the last one once everything is done. */
export function activeStep(steps: ApplicationStep[]): StepKey {
  return (steps.find(step => step.state === "current" || step.state === "blocked") ?? steps[steps.length - 1])?.key ?? "description"
}

/** Where the application is, from job description to confirmed submission; each step opens its own view. */
export function ApplicationStepper({ steps, selected, onSelect }: { steps: ApplicationStep[]; selected: StepKey; onSelect: (key: StepKey) => void }) {
  return (
    <nav aria-label="Application progress">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const active = step.state === "current" || step.state === "blocked"
          const open = step.key === selected
          return (
            <li key={step.key} aria-current={active ? "step" : undefined} aria-label={`${index + 1}. ${step.label}: ${STATES[step.state]}`} className="flex">
              <button
                type="button"
                aria-pressed={open}
                onClick={() => onSelect(step.key)}
                className={cn(
                  "flex w-full cursor-pointer gap-3 rounded-xl border p-3 text-left text-sm outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring",
                  open && "border-primary bg-primary/5",
                  step.state === "blocked" && "border-destructive/40",
                  open && step.state === "blocked" && "bg-destructive/5",
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

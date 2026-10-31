import { Check } from "lucide-react"
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

/** Where the application is, from job description to confirmed submission. */
export function ApplicationStepper({ steps }: { steps: ApplicationStep[] }) {
  return (
    <nav aria-label="Application progress">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const active = step.state === "current" || step.state === "blocked"
          return (
            <li
              key={step.key}
              aria-current={active ? "step" : undefined}
              aria-label={`${index + 1}. ${step.label}: ${STATES[step.state]}`}
              className={cn(
                "flex gap-3 rounded-xl border p-3 text-sm",
                active && "border-primary bg-primary/5",
                step.state === "blocked" && "border-destructive/40 bg-destructive/5",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  step.state === "done" && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {step.state === "done" ? <Check className="size-3.5" /> : index + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground">
                  {STATES[step.state]} · {step.hint}
                </p>
                {step.blocks[0] && (
                  <p className="text-xs text-destructive">
                    {step.blocks[0].message}
                    {step.blocks.length > 1 && ` (+${step.blocks.length - 1} more)`}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
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

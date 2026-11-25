import { Button } from "@/components/ui/button"
import { text, type Row } from "@/lib/api"
import { nextStep } from "@/lib/application-journey"
import { NextStepAction, originLabel, phaseLabel } from "@/components/application-list"

/** The job's latest application attempt, shaped like an Applications row. */
export function linkedApplication(job: Row): Row | undefined {
  if (!(Number(job.application_id) > 0)) return undefined
  return {
    id: job.application_id,
    job_id: job.id,
    phase: job.application_phase,
    view: job.application_view,
    origin: job.application_origin,
  }
}

/** Linked application summary with its contextual next step. */
export function JobApplication({ job }: { job: Row }) {
  const application = linkedApplication(job)
  if (!application) return null
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        Application #{text(application.id)} · {originLabel(application)} ·{" "}
        {phaseLabel(application.phase)}
      </p>
      <div className="flex flex-wrap gap-2">
        {nextStep(application).kind === "board" && (
          <NextStepAction row={application} onPrepare={() => {}} />
        )}
        <Button asChild size="sm" variant="ghost">
          <a href="#/applications">View in Applications</a>
        </Button>
      </div>
    </div>
  )
}

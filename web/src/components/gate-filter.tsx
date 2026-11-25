import { Button } from "@/components/ui/button"
import { prepareSkill } from "@/lib/agent"
import { text, type Row } from "@/lib/api"

/** Run the requirements check on the selected jobs, in the agent panel. */
export function CheckRequirements({ jobs }: { jobs: Row[] }) {
  return (
    <Button size="sm" variant="ghost" disabled={!jobs.length}
      onClick={() => prepareSkill("requirements-check", { jobIds: jobs.map(job => text(job.id)).join(",") })}>
      Check requirements
    </Button>
  )
}

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Page,
  Details,
  LoadState,
  ExternalLink,
} from "@/components/workspace-ui"
import { ApplicationReview } from "@/components/application-review"
import { JobLinkDialog } from "@/components/job-link-dialog"
import {
  ApplicationList,
  NextStepAction,
  originLabel,
  phaseLabel,
} from "@/components/application-list"
import { useApi, text, type Row } from "@/lib/api"
import {
  VIEWS,
  nextStep,
  type ApplicationView,
} from "@/lib/application-journey"
import { openApply } from "@/lib/preparation"
export function ApplicationsPage() {
  const api = useApi<Row[]>("applications")
  const [selected, setSelected] = useState<Row | null>(null)
  const [linking, setLinking] = useState<Row>()
  // An application without a saved job is linked first, so Apply opens with usable data.
  function prepare(row: Row) {
    if (Number(row.job_id) > 0) return openApply(row.job_id, row.id)
    setSelected(null)
    setLinking(row)
  }
  return (
    <Page
      title="Applications"
      description="Manual and agent-prepared applications, from first draft to next steps."
      actions={
        <Button size="sm" onClick={() => openApply()}>
          Tailor a resume
        </Button>
      }
    >
      <LoadState {...api} retry={api.refresh} />
      <ApplicationReview />
      {api.data && (
        <ApplicationList
          rows={api.data}
          onSelect={setSelected}
          onPrepare={prepare}
        />
      )}
      <Details
        row={selected}
        title={text(selected?.job_title ?? "Application details")}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <p className="text-sm text-muted-foreground">
            {originLabel(selected)} · {phaseLabel(selected.phase)} ·{" "}
            {(VIEWS[selected.view as ApplicationView] ?? VIEWS.preparation).label}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Artifact paths refer to files in your local workspace.
        </p>
        <div className="flex gap-2">
          <ExternalLink value={selected?.external_url} label="Open portal" />
          <Button onClick={() => selected && prepare(selected)}>
            Prepare application
          </Button>
          {selected && nextStep(selected).kind === "board" && (
            <NextStepAction row={selected} onPrepare={prepare} />
          )}
        </div>
      </Details>
      {linking && (
        <JobLinkDialog
          applicationId={Number(linking.id)}
          title="Prepare this application"
          actionLabel="Link and open Apply"
          onClose={() => setLinking(undefined)}
          onLinked={(result) => {
            setLinking(undefined)
            openApply(result.job_id, result.application_id)
          }}
        />
      )}
    </Page>
  )
}

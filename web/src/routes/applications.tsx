import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Page,
  Details,
  LoadState,
  Status,
  ExternalLink,
} from "@/components/workspace-ui"
import { Records } from "@/components/records"
import { useApi, text, date, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
export function ApplicationsPage() {
  const api = useApi<Row[]>("applications")
  const [selected, setSelected] = useState<Row | null>(null)
  return (
    <Page
      title="Automatic applications"
      description="Every application, from first draft to next steps."
      actions={
        <Button size="sm" onClick={() => openApply()}>
          Tailor a resume
        </Button>
      }
    >
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <Records
          rows={api.data}
          noun="Automatic applications"
          onSelect={setSelected}
          columns={[
            {
              key: "job_title",
              label: "Role",
              render: (r) => (
                <div className="font-medium">
                  {text(r.job_title)}
                  <p className="mt-1 text-xs font-normal text-muted-foreground">
                    {text(r.company_name)}
                  </p>
                </div>
              ),
            },
            {
              key: "status",
              label: "Status",
              render: (r) => <Status value={r.status} />,
            },
            {
              key: "keyword_score",
              label: "Keyword score",
              render: (r) =>
                r.keyword_score == null ? "—" : `${r.keyword_score}%`,
            },
            { key: "portal", label: "Portal" },
            {
              key: "applied_at",
              label: "Applied",
              render: (r) =>
                r.applied_at ? date(r.applied_at) : "Not submitted",
            },
          ]}
        />
      )}
      <Details
        row={selected}
        title={text(selected?.job_title ?? "Application details")}
        onClose={() => setSelected(null)}
      >
        <p className="text-xs text-muted-foreground">
          Artifact paths refer to files in your local workspace.
        </p>
        <div className="flex gap-2">
          <ExternalLink value={selected?.external_url} label="Open portal" />
          <Button
            disabled={!selected?.external_url && !selected?.job_id}
            onClick={() =>
              openApply(selected?.job_id, selected?.id)
            }
          >
            Prepare application
          </Button>
        </div>
      </Details>
    </Page>
  )
}

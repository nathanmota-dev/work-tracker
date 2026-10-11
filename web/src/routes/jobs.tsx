import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Page,
  Records,
  LoadState,
  Details,
  Status,
  ExternalLink,
  Stats,
} from "@/components/workspace-ui"
import { useApi, text, date, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
export function JobsPage() {
  const api = useApi<Row[]>("jobs")
  const [selected, setSelected] = useState<Row | null>(null)
  return (
    <Page
      title="Jobs"
      description="A considered shortlist for your next chapter."
      actions={
        <Button size="sm" onClick={() => prepareSkill("job-scout")}>
          Discover opportunities
        </Button>
      }
    >
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <>
          <Stats
            items={[
              { label: "Saved roles", value: api.data.length },
              {
                label: "Companies",
                value: new Set(
                  api.data.map((r) => r.company_name).filter(Boolean),
                ).size,
              },
              {
                label: "Remote roles",
                value: api.data.filter((r) => /remote/i.test(text(r.work_type)))
                  .length,
              },
              {
                label: "Assessed roles",
                value: api.data.filter((r) => !!r.fit).length,
              },
            ]}
          />
          <Records
            rows={api.data}
            noun="Opportunities"
            onSelect={setSelected}
            columns={[
              {
                key: "title",
                label: "Opportunity",
                render: (r) => (
                  <div>
                    <p className="font-medium">{text(r.title)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {text(r.company_name)}
                    </p>
                  </div>
                ),
              },
              { key: "location", label: "Location" },
              { key: "work_type", label: "Work type" },
              {
                key: "fit",
                label: "Fit",
                render: (r) => <Status value={r.fit} />,
              },
              {
                key: "status",
                label: "Status",
                render: (r) => <Status value={r.status} />,
              },
              {
                key: "scouted_at",
                label: "Saved",
                render: (r) => (
                  <span className="text-xs text-muted-foreground">
                    {date(r.scouted_at)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
      <Details
        row={selected}
        title={text(selected?.title)}
        onClose={() => setSelected(null)}
      >
        <div className="flex flex-wrap gap-2">
          <ExternalLink value={selected?.link} label="View opportunity" />
          <Button
            onClick={() =>
              prepareSkill("resume-tailor", { jobIds: String(selected?.id) })
            }
          >
            Tailor resume
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              prepareSkill("deep-scout", {
                query: text(
                  selected?.link ??
                    selected?.linkedin_job_id ??
                    selected?.title,
                ),
              })
            }
          >
            Assess fit
          </Button>
        </div>
      </Details>
    </Page>
  )
}

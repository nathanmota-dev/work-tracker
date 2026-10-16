import { useState } from "react"
import {
  Page,
  Details,
  Stats,
  LoadState,
  Status,
} from "@/components/workspace-ui"
import { Records } from "@/components/records"
import { useApi, text, date, type Row } from "@/lib/api"
export function InterviewsPage() {
  const api = useApi<Row[]>("interviews")
  const [selected, setSelected] = useState<Row | null>(null)
  const upcoming = (api.data ?? []).filter(
    (r) =>
      r.status !== "closed" &&
      new Date(String(r.scheduled_at)).getTime() >= Date.now(),
  )
  return (
    <Page
      title="Interviews"
      description="Make space for the conversations that move you forward."
    >
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <>
          <Stats
            items={[
              { label: "Upcoming", value: upcoming.length },
              {
                label: "Companies",
                value: new Set(api.data.map((r) => r.company)).size,
              },
              { label: "Total interviews", value: api.data.length },
              {
                label: "Next conversation",
                value: upcoming.length ? text(upcoming[0].company) : "—",
                hint: upcoming.length
                  ? date(upcoming[0].scheduled_at)
                  : "Nothing scheduled yet",
              },
            ]}
          />
          <Records
            noun="Interviews"
            rows={api.data}
            onSelect={setSelected}
            columns={[
              { key: "company", label: "Company" },
              {
                key: "scheduled_at",
                label: "Schedule",
                render: (r) => date(r.scheduled_at),
              },
              { key: "stage", label: "Stage" },
              {
                key: "status",
                label: "Status",
                render: (r) => <Status value={r.status} />,
              },
              {
                key: "notes",
                label: "Notes",
                render: (r) => <p className="line-clamp-2">{text(r.notes)}</p>,
              },
            ]}
          />
        </>
      )}
      <Details
        row={selected}
        title={text(selected?.company)}
        onClose={() => setSelected(null)}
      />
    </Page>
  )
}

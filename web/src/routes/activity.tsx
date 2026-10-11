import { Page, Records, LoadState, Status } from "@/components/workspace-ui"
import { useApi, date, type Row } from "@/lib/api"
export function ActivityPage() {
  const api = useApi<Row[]>("activity")
  return (
    <Page
      title="Activity"
      description="A running record of the steps you’ve taken. Showing the latest 50 events."
    >
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <Records
          rows={api.data}
          noun="Activity"
          columns={[
            {
              key: "ts",
              label: "When",
              render: (r) => (
                <span className="text-xs text-muted-foreground">
                  {date(r.ts)}
                </span>
              ),
            },
            {
              key: "kind",
              label: "Event",
              render: (r) => <Status value={r.kind} />,
            },
            { key: "summary", label: "Summary" },
            { key: "skill", label: "Skill" },
          ]}
        />
      )}
    </Page>
  )
}

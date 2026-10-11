import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Page,
  Records,
  Details,
  LoadState,
  Status,
  ExternalLink,
  Panel,
  Empty,
} from "@/components/workspace-ui"
import { useApi, request, publish, text, date, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
export function RecruitersPage() {
  const api = useApi<Row[]>("recruiters")
  const due = useApi<Row[]>("recruiters/due")
  const [selected, setSelected] = useState<Row | null>(null)
  const [sync, setSync] = useState<{
    changes: Row[]
    [key: string]: unknown
  }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  async function synchronize(apply: boolean) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await request<{ changes: Row[] }>("recruiters/sync", {
        apply,
      })
      setSync(result)
      if (apply) {
        publish({ type: "changed" })
        setSync(undefined)
        setNotice(
          `Sync complete. ${result.changes.length} connections updated.`,
        )
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page
      title="Recruiters"
      description="Build relationships with the people behind your next opportunity."
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void synchronize(false)}
          >
            {busy ? "Checking LinkedIn…" : "Preview connection sync"}
          </Button>
          <Button size="sm" onClick={() => prepareSkill("recruiter-outreach")}>
            Find recruiters
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {sync && (
        <Panel title="Connection sync preview">
          {sync.changes.length ? (
            <>
              <ul className="mb-4 space-y-2 text-sm">
                {sync.changes.map((r, i) => (
                  <li key={i}>{text(r.name)} · accepted</li>
                ))}
              </ul>
              <Button disabled={busy} onClick={() => void synchronize(true)}>
                Apply accepted connections
              </Button>
            </>
          ) : (
            <Empty
              title="You’re up to date"
              description="No new accepted connections were found."
            />
          )}
          <Button
            className="ml-2"
            variant="ghost"
            onClick={() => setSync(undefined)}
          >
            Dismiss
          </Button>
        </Panel>
      )}
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <Records
          rows={api.data}
          noun="Recruiters"
          onSelect={setSelected}
          columns={[
            {
              key: "name",
              label: "Contact",
              render: (r) => (
                <div className="font-medium">
                  {text(r.name)}
                  <p className="mt-1 text-xs font-normal text-muted-foreground">
                    {text(r.title)}
                  </p>
                </div>
              ),
            },
            { key: "company", label: "Company" },
            { key: "location", label: "Location" },
            {
              key: "status",
              label: "Status",
              render: (r) => <Status value={r.status} />,
            },
            {
              key: "date_contacted",
              label: "Contacted",
              render: (r) => (r.date_contacted ? date(r.date_contacted) : "—"),
            },
          ]}
        />
      )}
      <LoadState {...due} retry={due.refresh} />
      {due.data && (
        <Records
          rows={due.data}
          noun="Due follow-ups"
          columns={[
            { key: "name", label: "Contact" },
            { key: "company", label: "Company" },
            {
              key: "action",
              label: "Next action",
              render: (r) => <Status value={r.action} />,
            },
            { key: "reason", label: "Reason" },
            { key: "due", label: "Due", render: (r) => date(r.due) },
          ]}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => prepareSkill("outreach-tracker")}
            >
              Review follow-ups
            </Button>
          }
        />
      )}
      <Details
        row={selected}
        title={text(selected?.name)}
        onClose={() => setSelected(null)}
      >
        <ExternalLink
          value={
            selected?.username
              ? `https://www.linkedin.com/in/${encodeURIComponent(String(selected.username))}/`
              : null
          }
          label="View LinkedIn"
        />
      </Details>
    </Page>
  )
}

import { useState } from "react"
import { RefreshCw, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Page, LoadState, Panel, Empty } from "@/components/workspace-ui"
import { RecruiterBoard } from "@/components/recruiter-cards"
import { useApi, request, publish, text, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"

/** Previews accepted LinkedIn connections, then applies them on confirmation. */
export function useRecruiterSync() {
  const [changes, setChanges] = useState<Row[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  async function synchronize(apply: boolean) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await request<{ changes: Row[] }>("recruiters/sync", { apply })
      setChanges(apply ? undefined : result.changes)
      if (apply) {
        publish({ type: "changed" })
        setNotice(`Sync complete. ${result.changes.length} connections updated.`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { changes, busy, error, notice, preview: () => void synchronize(false), apply: () => void synchronize(true), dismiss: () => setChanges(undefined) }
}
export type RecruiterSync = ReturnType<typeof useRecruiterSync>

/** The header buttons of the recruiter list. */
export function RecruiterActions({ sync }: { sync: RecruiterSync }) {
  return <>
    <Button size="sm" variant="outline" disabled={sync.busy} onClick={sync.preview}>
      <RefreshCw /> {sync.busy ? "Checking LinkedIn…" : "Preview connection sync"}
    </Button>
    <Button size="sm" onClick={() => prepareSkill("recruiter-outreach")}><UserPlus /> Find recruiters</Button>
  </>
}

function SyncPreview({ sync }: { sync: RecruiterSync }) {
  if (!sync.changes) return null
  return (
    <Panel title="Connection sync preview" action={<Button size="sm" variant="ghost" onClick={sync.dismiss}>Dismiss</Button>}>
      {sync.changes.length ? (
        <div className="space-y-4">
          <ul className="space-y-2 text-sm">{sync.changes.map((r, i) => <li key={i}>{text(r.name)} · accepted</li>)}</ul>
          <Button disabled={sync.busy} onClick={sync.apply}>Apply accepted connections</Button>
        </div>
      ) : (
        <Empty title="You’re up to date" description="No new accepted connections were found." />
      )}
    </Panel>
  )
}

/** Recruiters as cards. Inside Contacts the hub owns the header and passes its sync state. */
export function RecruitersPage({ sync: shared }: { sync?: RecruiterSync }) {
  const api = useApi<Row[]>("recruiters")
  const own = useRecruiterSync()
  const sync = shared ?? own
  return (
    <Page
      title="Recruiters"
      description={shared ? undefined : "Build relationships with the people behind your next opportunity."}
      actions={shared ? undefined : <RecruiterActions sync={sync} />}
    >
      {sync.error && <p role="alert" className="text-sm text-destructive">{sync.error}</p>}
      {sync.notice && <p role="status" className="text-sm">{sync.notice}</p>}
      <SyncPreview sync={sync} />
      <LoadState {...api} loading={api.loading && !api.data} retry={api.refresh} />
      {api.data && <RecruiterBoard rows={api.data} />}
    </Page>
  )
}

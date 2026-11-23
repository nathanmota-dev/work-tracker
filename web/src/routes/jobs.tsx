import { useEffect, useState, type ReactNode } from "react"
import { JobDiscovery } from "@/components/job-discovery"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Page,
  LoadState,
  Details,
  ExternalLink,
} from "@/components/workspace-ui"
import {
  JobActions,
  JobApplication,
  JobStats,
  JobTabs,
  jobColumns,
  linkedApplication,
} from "@/components/job-list"
import { useApi, request, text, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
import { prepareSkill } from "@/lib/agent"
import { JobForm, postingNotice, type JobSaveResult } from "@/components/job-form"
import { PostingCheck } from "@/components/posting-check"
import { RankingDetail } from "@/components/ranking-detail"
import { useWorkspaceState } from "@/lib/workspace-state"
import { applyLabel } from "@/lib/application-journey"

function JobDetailActions({
  selected,
  busy,
  error,
  actions,
  close,
}: {
  selected: Row | null
  busy: boolean
  error: string
  close: () => void
  actions: (row: Row) => ReactNode
}) {
  const application = selected ? linkedApplication(selected) : undefined
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      {selected && <PostingCheck guard={selected.description_guard_json} description={selected.description} />}
      <div className="flex flex-wrap gap-2">
        <ExternalLink value={selected?.link} label="View opportunity" />
        <Button
          disabled={busy || !!selected?.archived_at}
          onClick={() => openApply(selected?.id, application?.id)}
        >
          {applyLabel(application)}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !!selected?.archived_at}
          onClick={() => {
            close()
            prepareSkill("deep-scout", {
              query: text(
                selected?.link ??
                  selected?.linkedin_job_id ??
                  selected?.title,
              ),
            })
          }}
        >
          Assess fit
        </Button>
      </div>
      {!!selected?.archived_at && (
        <p className="text-sm text-muted-foreground">
          Restore this role before preparing a new application.
        </p>
      )}
      {selected && <RankingDetail jobId={selected.id} />}
      {selected && (
        <JobApplication job={selected} />
      )}
      {selected && actions(selected)}
    </>
  )
}

function DeleteJobDialog({
  deleting,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  deleting: Row | null
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: (row: Row) => void
}) {
  return (
    <Dialog
      open={!!deleting}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent showCloseButton={!busy} className="[&_button]:cursor-pointer">
        <DialogHeader>
          <DialogTitle>Delete {text(deleting?.title)}?</DialogTitle>
          <DialogDescription>
            This permanently removes the saved role from your workspace.
            It may appear again in a future search. Archive it instead to keep
            a record and exclude it from future shortlists. Jobs with linked
            applications or interviews must be archived to preserve their history.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => deleting && onConfirm(deleting)}
          >
            {busy ? "Deleting…" : "Delete job"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useJobs() {
  const api = useApi<Row[]>("jobs")
  const { search, update } = useWorkspaceState("jobs")
  const selectedId = Number(search.selected) || null
  const setSelectedId = (id: number | null) => update({ selected: id ? String(id) : "" })
  useEffect(() => {
    if (!api.data || api.loading) return
    const ids = new Set(api.data.map(row => String(row.id)))
    const selection = (search.selection ?? []).filter(id => ids.has(id))
    const exists = api.data.some(row => String(row.id) === search.selected)
    if (selection.length !== search.selection?.length || search.selected && !exists)
      update({ selection, selected: exists ? search.selected : "" })
  }, [api.data, api.loading, search, update])
  const selected = api.data?.find((row) => row.id === selectedId) ?? null
  const [editing, setEditing] = useState<Row | "new" | null>(null)
  const [notice, setNotice] = useState("")
  const [posting, setPosting] = useState("")
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const active = api.data?.filter((row) => !row.archived_at) ?? []
  const archived = api.data?.filter((row) => !!row.archived_at) ?? []

  async function mutate(action: "archive" | "restore" | "delete" | "shortlist", row: Row) {
    setBusy(true)
    setNotice("")
    setError("")
    try {
      await request(`jobs/${action}`, { id: row.id })
      if (selectedId === Number(row.id)) setSelectedId(null)
      setDeleting(null)
      api.refresh()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  function actions(row: Row, includePreparation = true) {
    return (
      <JobActions
        row={row}
        busy={busy}
        includePreparation={includePreparation}
        onMutate={(action, target) => void mutate(action, target)}
        onDelete={(target) => {
          setError("")
          setSelectedId(null)
          setDeleting(target)
        }}
      />
    )
  }
  function edit(job: Row | "new" | null) {
    setNotice("")
    setPosting("")
    setError("")
    setSelectedId(null)
    setEditing(job)
  }
  function saved(result: JobSaveResult) {
    setEditing(null)
    setNotice(result.existing ? `Job #${result.job.id} already exists. Its saved content was preserved.` : "Job saved.")
    setPosting(result.existing ? "" : postingNotice(result))
    api.refresh()
    // Show the saved job in its tab: added jobs skip triage, edits keep theirs.
    const view = result.job.archived_at ? "archived" : result.job.shortlisted_at ? "shortlist" : "new"
    update({ selected: String(result.job.id), view })
  }
  return { api, selected, deleting, busy, error, active, archived, editing, notice, posting,
    setSelectedId, edit, setDeleting, setError, actions, saved, mutate }
}

export function JobsPage() {
  const { api, selected, deleting, busy, error, active, archived, editing, notice, posting,
    setSelectedId, edit, setDeleting, setError, actions, saved, mutate } = useJobs()
  const { update } = useWorkspaceState("jobs")
  const [arrived, setArrived] = useState<number[]>([])
  return (
    <Page
      title="Jobs"
      description="Discover, triage and shortlist your next opportunity."
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => edit("new")}>Add job</Button>
        </div>
      }
    >
      <JobDiscovery onResults={ids => {
        setArrived(ids)
        update({ view: "new", page: 0, q: "", status: "", selection: [], selected: "" })
        api.refresh()
      }} />
      <LoadState {...api} retry={api.refresh} />
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {posting && <p role="status" aria-label="Saved posting check" className="text-sm">{posting}</p>}
      {editing && <JobForm job={editing === "new" ? undefined : editing} onClose={() => edit(null)} onSaved={saved} />}
      {error && !deleting && !selected && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {api.data && (
        <>
          <JobStats jobs={active} />
          <JobTabs
            active={active}
            archived={archived}
            columns={jobColumns(actions, arrived)}
            onMutate={mutate}
            onSelect={(row) => setSelectedId(Number(row.id))}
          />
        </>
      )}
      <Details
        row={selected}
        omit={["description_guard_json", "ranking_status", "ranking_overall", "ranking_verdict", "ranking_attempts", "ranking_expired_reason", "closing_soon"]}
        title={text(selected?.title)}
        onClose={() => setSelectedId(null)}
      >
        <Button variant="outline" disabled={busy} onClick={() => selected && edit(selected)}>Edit job</Button>
        <JobDetailActions
          close={() => setSelectedId(null)}
          selected={selected}
          busy={busy}
          error={error}
          actions={(row) => actions(row, false)}
        />
      </Details>
      <DeleteJobDialog
        deleting={deleting}
        busy={busy}
        error={error}
        onCancel={() => {
          setDeleting(null)
          setError("")
        }}
        onConfirm={(row) => void mutate("delete", row)}
      />
    </Page>
  )
}

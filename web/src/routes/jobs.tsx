import { useEffect, useState } from "react"
import { ArrowLeft, Plus, Sparkles } from "lucide-react"
import { JobDiscovery, SearchOutcomes } from "@/components/job-discovery"
import { RoleAssessment } from "@/components/role-assessment"
import { Tabs, TabsTrigger } from "@/components/ui/tabs"
import { CountTabsList } from "@/components/underline-tabs"
import type { SearchSaveResult } from "../../../src/jobs/search-results"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Page, LoadState } from "@/components/workspace-ui"
import { JobBoard, JobBoardSkeleton } from "@/components/job-board"
import { JobCard } from "@/components/job-card"
import { JobDetailsSheet } from "@/components/job-details-sheet"
import { useApi, request, text, type Row } from "@/lib/api"
import { JobForm, postingNotice, type JobSaveResult } from "@/components/job-form"
import { useAtsBest, withAtsMatch } from "@/lib/ats"
import { useWorkspaceState } from "@/lib/workspace-state"

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
  const [editing, setEditing] = useState<Row | "new" | null>(null)
  const [notice, setNotice] = useState("")
  const [posting, setPosting] = useState("")
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const ats = useAtsBest()
  const rows = withAtsMatch(api.data ?? [], ats.data)
  // From the rows with their resume match, so the details show the same score as the card.
  const selected = rows.find((row) => row.id === selectedId) ?? null
  const active = rows.filter((row) => !row.archived_at)
  const archived = rows.filter((row) => !!row.archived_at)

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

  function remove(target: Row) {
    setError("")
    setSelectedId(null)
    setDeleting(target)
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
    setSelectedId, edit, setDeleting, setError, remove, saved, mutate }
}

/** Discover has two separate tasks: searching LinkedIn for new roles, and assessing one role the user already found. */
function DiscoverJobsPage({ onBack, onResults }: { onBack: () => void; onResults: (ids: number[], outcomes: SearchSaveResult[]) => void }) {
  const { search, update } = useWorkspaceState("jobs")
  const mode = search.mode === "assess" ? "assess" : "search"
  return (
    <Page
      title="Discover opportunities"
      description={mode === "assess" ? "Check how one role fits your experience before you apply." : "Search LinkedIn and save new roles for triage."}
      back={
        <Button variant="ghost" size="icon-sm" className="-ml-2 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Back to jobs" title="Back to jobs" onClick={onBack}>
          <ArrowLeft />
        </Button>
      }
    >
      <Tabs value={mode} onValueChange={value => update({ mode: value })} className="border-b">
        <CountTabsList label="Discover views">
          {([["search", "Search LinkedIn"], ["assess", "Assess a role"]] as const).map(([value, label]) =>
            <TabsTrigger key={value} value={value}
              className="-mb-px rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              {label}
            </TabsTrigger>)}
        </CountTabsList>
      </Tabs>
      {mode === "assess" ? <RoleAssessment /> : <JobDiscovery onResults={onResults} />}
    </Page>
  )
}

export function JobsPage() {
  const { api, selected, deleting, busy, error, active, archived, editing, notice, posting,
    setSelectedId, edit, setDeleting, setError, remove, saved, mutate } = useJobs()
  const { search, update } = useWorkspaceState("jobs")
  const [arrived, setArrived] = useState<number[]>([])
  const [outcomes, setOutcomes] = useState<SearchSaveResult[]>([])
  if (search.discover || search.focus)
    return (
      <DiscoverJobsPage
        onBack={() => update({ discover: false, focus: false, mode: "search" })}
        onResults={(ids, results) => {
          setArrived(ids)
          setOutcomes(results)
          update({ discover: false, focus: false, mode: "search", view: "new", page: 0, q: "", status: "", selection: [], selected: "" })
          api.refresh()
        }}
      />
    )
  return (
    <Page
      title="Jobs"
      description="Triage and shortlist your next opportunity."
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => update({ discover: true })}>
            <Sparkles /> Discover opportunities
          </Button>
          <Button size="sm" onClick={() => edit("new")}>
            <Plus /> Add job
          </Button>
        </>
      }
    >
      {api.loading && !api.data ? <JobBoardSkeleton /> : <LoadState {...api} loading={false} retry={api.refresh} />}
      <SearchOutcomes outcomes={outcomes} onDismiss={() => setOutcomes([])} />
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
          <JobBoard
            active={active}
            archived={archived}
            renderCard={(row, selection) => (
              <JobCard
                row={row}
                selected={selection.selected}
                fresh={arrived.includes(Number(row.id))}
                busy={busy}
                onToggle={selection.toggle}
                onOpen={() => setSelectedId(Number(row.id))}
                onMutate={(action, target) => void mutate(action, target)}
                onDelete={remove}
              />
            )}
            onMutate={mutate}
          />
        </>
      )}
      <JobDetailsSheet
        row={selected}
        busy={busy}
        error={error}
        onClose={() => setSelectedId(null)}
        onEdit={edit}
        onMutate={(action, target) => void mutate(action, target)}
        onDelete={remove}
      />
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

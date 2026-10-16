import { useState, type ReactNode } from "react"
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
import { JobActions, JobStats, JobTabs, jobColumns } from "@/components/job-list"
import { useApi, request, text, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
import { prepareSkill } from "@/lib/agent"

function JobDetailActions({
  selected,
  busy,
  error,
  actions,
}: {
  selected: Row | null
  busy: boolean
  error: string
  actions: (row: Row) => ReactNode
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <ExternalLink value={selected?.link} label="View opportunity" />
        <Button
          disabled={busy || !!selected?.archived_at}
          onClick={() =>
            openApply(selected?.id)
          }
        >
          Prepare application
        </Button>
        <Button
          variant="outline"
          disabled={busy || !!selected?.archived_at}
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
      {!!selected?.archived_at && (
        <p className="text-sm text-muted-foreground">
          Restore this role before preparing a new application.
        </p>
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

export function JobsPage() {
  const api = useApi<Row[]>("jobs")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = api.data?.find((row) => row.id === selectedId) ?? null
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const active = api.data?.filter((row) => !row.archived_at) ?? []
  const archived = api.data?.filter((row) => !!row.archived_at) ?? []

  async function mutate(action: "archive" | "restore" | "delete", row: Row) {
    setBusy(true)
    setError("")
    try {
      await request(`jobs/${action}`, { id: row.id })
      setSelectedId(null)
      setDeleting(null)
      api.refresh()
    } catch (e) {
      setError((e as Error).message)
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
            columns={jobColumns(actions)}
            onSelect={(row) => setSelectedId(Number(row.id))}
          />
        </>
      )}
      <Details
        row={selected}
        title={text(selected?.title)}
        onClose={() => setSelectedId(null)}
      >
        <JobDetailActions
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

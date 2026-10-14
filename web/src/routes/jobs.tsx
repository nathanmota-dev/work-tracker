import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Archive, ArchiveRestore, Trash2 } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Page,
  Records,
  LoadState,
  Details,
  Status,
  ExternalLink,
  Stats,
} from "@/components/workspace-ui"
import { useApi, request, text, date, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
import { prepareSkill } from "@/lib/agent"
export function JobsPage() {
  const api = useApi<Row[]>("jobs")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = api.data?.find((row) => row.id === selectedId) ?? null
  const [view, setView] = useState("active")
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
      <div className="flex flex-wrap gap-2">
        {includePreparation && <Button size="sm" variant="outline" disabled={busy || !!row.archived_at} onClick={() => openApply(row.id)}>Prepare application</Button>}
        <Button
          variant="outline"
          size="icon-sm"
          className="cursor-pointer"
          disabled={busy}
          title={row.archived_at ? "Restore job" : "Archive job"}
          aria-label={`${row.archived_at ? "Restore" : "Archive"} ${text(row.title)}`}
          onClick={() => void mutate(row.archived_at ? "restore" : "archive", row)}
        >
          {row.archived_at ? <ArchiveRestore /> : <Archive />}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          className="cursor-pointer"
          disabled={busy}
          title="Delete job"
          aria-label={`Delete ${text(row.title)}`}
          onClick={() => {
            setError("")
            setSelectedId(null)
            setDeleting(row)
          }}
        >
          <Trash2 />
        </Button>
      </div>
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
          <Stats
            items={[
              { label: "Active roles", value: active.length },
              {
                label: "Companies",
                value: new Set(
                  active.map((r) => r.company_name).filter(Boolean),
                ).size,
              },
              {
                label: "Remote roles",
                value: active.filter((r) => /remote/i.test(text(r.work_type)))
                  .length,
              },
              {
                label: "Assessed roles",
                value: active.filter((r) => !!r.fit).length,
              },
            ]}
          />
          <Tabs value={view} onValueChange={setView}>
            <TabsList aria-label="Job archive filter">
              <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
              <TabsTrigger value="archived">
                Archived ({archived.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value={view}>
              {view === "archived" && (
                <p className="mb-4 text-sm text-muted-foreground">
                  Archived roles stay saved and are excluded from future shortlists.
                  Restore a role before preparing a new application.
                </p>
              )}
              <Records
                key={view}
                rows={view === "archived" ? archived : active}
                noun={view === "archived" ? "Archived opportunities" : "Opportunities"}
                onSelect={(row) => setSelectedId(Number(row.id))}
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
                  {
                    key: "actions",
                    label: "Actions",
                    render: actions,
                  },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
      <Details
        row={selected}
        title={text(selected?.title)}
        onClose={() => setSelectedId(null)}
      >
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
        {selected && actions(selected, false)}
      </Details>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleting(null)
            setError("")
          }
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
              onClick={() => {
                setDeleting(null)
                setError("")
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => deleting && void mutate("delete", deleting)}
            >
              {busy ? "Deleting…" : "Delete job"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

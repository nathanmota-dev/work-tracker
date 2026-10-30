import { useState, type ReactNode } from "react"
import { Archive, ArchiveRestore, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Stats, Status } from "@/components/workspace-ui"
import { type Column } from "@/components/records"
import { MultiSelectRecords } from "@/components/multi-select-records"
import { BatchPreparation } from "@/components/batch-preparation"
import { useWorkspaceState } from "@/lib/workspace-state"
import { text, date, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"
import { nextStep } from "@/lib/application-journey"
import { NextStepAction, originLabel, phaseLabel } from "@/components/application-list"

/** The job's latest application attempt, shaped like an Applications row. */
export function linkedApplication(job: Row): Row | undefined {
  if (!(Number(job.application_id) > 0)) return undefined
  return {
    id: job.application_id,
    job_id: job.id,
    phase: job.application_phase,
    view: job.application_view,
    origin: job.application_origin,
  }
}

/** Linked application summary with its contextual next step. */
export function JobApplication({ job }: { job: Row }) {
  const application = linkedApplication(job)
  if (!application) return null
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        Application #{text(application.id)} · {originLabel(application)} ·{" "}
        {phaseLabel(application.phase)}
      </p>
      <div className="flex flex-wrap gap-2">
        {nextStep(application).kind === "board" && (
          <NextStepAction row={application} onPrepare={() => {}} />
        )}
        <Button asChild size="sm" variant="ghost">
          <a href="#/applications">View in Applications</a>
        </Button>
      </div>
    </div>
  )
}

export function JobStats({ jobs }: { jobs: Row[] }) {
  return (
    <Stats
      items={[
        { label: "New roles", value: jobs.filter(row => !row.shortlisted_at).length },
        { label: "Shortlisted roles", value: jobs.filter(row => !!row.shortlisted_at).length },
        {
          label: "Companies",
          value: new Set(
            jobs.map((r) => r.company_name).filter(Boolean),
          ).size,
        },
        {
          label: "Remote roles",
          value: jobs.filter((r) => /remote/i.test(text(r.work_type)))
            .length,
        },
        {
          label: "Assessed roles",
          value: jobs.filter((r) => !!r.fit).length,
        },
      ]}
    />
  )
}

export function jobColumns(actions: (row: Row) => ReactNode, arrived: number[] = []): Column[] {
  return [
    {
      key: "title",
      label: "Opportunity",
      render: (r) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{text(r.title)}</p>
            {arrived.includes(Number(r.id)) && <span className="rounded bg-primary/10 px-2 text-xs text-primary">Just added</span>}
          </div>
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
      key: "application_phase",
      label: "Application",
      render: (r) =>
        linkedApplication(r) ? <Status value={phaseLabel(r.application_phase)} /> : "—",
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
  ]
}

function PrepareJob({ row, busy }: { row: Row; busy: boolean }) {
  const application = linkedApplication(row)
  const step = application ? nextStep(application) : undefined
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || !!row.archived_at}
      onClick={() => openApply(row.id, application?.id)}
    >
      {step?.kind === "prepare" ? step.label : "Prepare application"}
    </Button>
  )
}

export function JobActions({
  row,
  busy,
  includePreparation,
  onMutate,
  onDelete,
}: {
  row: Row
  busy: boolean
  includePreparation: boolean
  onMutate: (action: "archive" | "restore" | "shortlist", row: Row) => void
  onDelete: (row: Row) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {includePreparation && !!row.shortlisted_at && <PrepareJob row={row} busy={busy} />}
      {!row.archived_at && !row.shortlisted_at && <Button size="sm" disabled={busy} onClick={() => onMutate("shortlist", row)}>Move to shortlist</Button>}
      <Button
        variant="outline"
        size="icon-sm"
        className="cursor-pointer"
        disabled={busy}
        title={row.archived_at ? "Restore job" : "Archive job"}
        aria-label={`${row.archived_at ? "Restore" : "Archive"} ${text(row.title)}`}
        onClick={() => onMutate(row.archived_at ? "restore" : "archive", row)}
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
        onClick={() => onDelete(row)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export function JobTabs({
  active,
  archived,
  columns,
  onSelect,
  onMutate,
}: {
  active: Row[]
  archived: Row[]
  columns: Column[]
  onSelect: (row: Row) => void
  onMutate: (action: "shortlist" | "archive", row: Row) => Promise<boolean>
}) {
  const { search, update } = useWorkspaceState("jobs")
  const view = search.view ?? "new"
  const fresh = active.filter(row => !row.shortlisted_at)
  const shortlist = active.filter(row => !!row.shortlisted_at)
  const rows = view === "archived" ? archived : view === "shortlist" ? shortlist : fresh
  return (
    <Tabs value={view} onValueChange={view => update({ view, page: 0, q: "", status: "", selected: "", selection: [] })}>
      <TabsList aria-label="Job archive filter">
        <TabsTrigger value="new">New ({fresh.length})</TabsTrigger>
        <TabsTrigger value="shortlist">Shortlist ({shortlist.length})</TabsTrigger>
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
        <MultiSelectRecords
          workspace="jobs"
          selectionRows={rows}
          rowKey={row => String(row.id)} rowLabel={row => text(row.title)}
          canSelect={() => true} busy={false} selectAllLabel="Select all filtered results"
          action={(jobs, clear) => view === "new"
            ? <JobTriage jobs={jobs} onMutate={onMutate} onDone={clear} />
            : <BatchPreparation jobs={jobs} onCreated={clear} />}
          rows={rows}
          noun={view === "archived" ? "Archived opportunities" : "Opportunities"}
          onSelect={onSelect}
          columns={columns}
        />
      </TabsContent>
    </Tabs>
  )
}

function JobTriage({ jobs, onMutate, onDone }: {
  jobs: Row[]; onMutate: (action: "shortlist" | "archive", row: Row) => Promise<boolean>; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function run(action: "shortlist" | "archive") {
    setBusy(true)
    try {
      for (const job of jobs) if (!await onMutate(action, job)) return
      onDone()
    }
    finally { setBusy(false) }
  }
  return <>
    <Button size="sm" disabled={busy || !jobs.length} onClick={() => void run("shortlist")}>Move selected to shortlist</Button>
    <Button size="sm" variant="outline" disabled={busy || !jobs.length} onClick={() => void run("archive")}>Archive selected</Button>
  </>
}

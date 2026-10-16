import { useState, type ReactNode } from "react"
import { Archive, ArchiveRestore, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Stats, Status } from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { text, date, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"

export function JobStats({ jobs }: { jobs: Row[] }) {
  return (
    <Stats
      items={[
        { label: "Active roles", value: jobs.length },
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

export function jobColumns(actions: (row: Row) => ReactNode): Column[] {
  return [
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
  ]
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
  onMutate: (action: "archive" | "restore", row: Row) => void
  onDelete: (row: Row) => void
}) {
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
}: {
  active: Row[]
  archived: Row[]
  columns: Column[]
  onSelect: (row: Row) => void
}) {
  const [view, setView] = useState("active")
  return (
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
          onSelect={onSelect}
          columns={columns}
        />
      </TabsContent>
    </Tabs>
  )
}

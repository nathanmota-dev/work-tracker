import { useEffect, useRef, useState } from "react"
import { DragDropProvider, DragOverlay } from "@dnd-kit/react"
import { Archive, Columns3, Plus, RotateCcw, Search } from "lucide-react"
import {
  ApplicationCard,
  ApplicationColumn,
  ApplicationSummary,
  ArchiveDropZone,
} from "@/components/application-card"
import { ApplicationForm } from "@/components/application-form"
import { ApplicationArchive } from "@/components/application-archive"
import { ApplicationStages } from "@/components/application-stages"
import { ApplicationDetails } from "@/components/application-details"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Empty, LoadState, Page } from "@/components/workspace-ui"
import { date, useApi } from "@/lib/api"
import {
  ARCHIVE_REASONS,
  boardAction,
  matchesApplication,
  type ApplicationBoard,
  type TrackedApplication,
} from "@/lib/application-board"

export function ApplicationBoardPage() {
  const api = useApi<ApplicationBoard>("application-board")
  const [query, setQuery] = useState("")
  const [view, setView] = useState("active")
  const [edit, setEdit] = useState<TrackedApplication | null>()
  const [archive, setArchive] = useState<TrackedApplication>()
  const [selectedId, setSelectedId] = useState<number>()
  const [manage, setManage] = useState(false)
  const [overrides, setOverrides] = useState<
    Record<number, TrackedApplication>
  >({})
  const pendingRef = useRef(new Set<number>())
  const [pending, setPending] = useState(new Set<number>())
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => {
    if (!api.data) return
    setOverrides((previous) => {
      const next = { ...previous }
      let changed = false
      for (const [id, record] of Object.entries(previous)) {
        const saved = api.data!.applications.find(
          (item) => item.id === Number(id),
        )
        if (
          !pending.has(Number(id)) &&
          saved &&
          (JSON.stringify(saved) === JSON.stringify(record) ||
            saved.updated_at > record.updated_at)
        ) {
          delete next[Number(id)]
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [api.data, pending])
  const records = new Map(
    (api.data?.applications ?? []).map((application) => [
      application.id,
      application,
    ]),
  )
  Object.values(overrides).forEach((application) =>
    records.set(application.id, application),
  )
  const applications = [...records.values()].sort(
    (a, b) => b.applied_at.localeCompare(a.applied_at) || b.id - a.id,
  )
  const stages = api.data?.stages ?? []
  const active = applications.filter(
    (application) => application.tracking_status === "active",
  )
  const archived = applications
    .filter((application) => application.tracking_status === "archived")
    .sort(
      (a, b) =>
        (b.archived_at ?? "").localeCompare(a.archived_at ?? "") || b.id - a.id,
    )
  const visible = active.filter((application) =>
    matchesApplication(application, query),
  )
  const archivedVisible = archived.filter((application) =>
    matchesApplication(application, query),
  )
  const selected =
    selectedId === undefined ? undefined : records.get(selectedId)
  function saved(application: TrackedApplication) {
    setOverrides((previous) => ({ ...previous, [application.id]: application }))
    setNotice(
      application.tracking_status === "archived"
        ? "Application archived. Your progress stays saved."
        : "Application saved.",
    )
    setError("")
    api.refresh()
  }
  function lock(id: number) {
    if (pendingRef.current.has(id)) return false
    pendingRef.current.add(id)
    setPending(new Set(pendingRef.current))
    setError("")
    setNotice("")
    return true
  }
  function unlock(id: number) {
    pendingRef.current.delete(id)
    setPending(new Set(pendingRef.current))
    api.refresh()
  }
  async function move(application: TrackedApplication, stageId: number) {
    if (stageId === application.current_stage_id || !lock(application.id))
      return
    setOverrides((previous) => ({
      ...previous,
      [application.id]: { ...application, current_stage_id: stageId },
    }))
    try {
      saved(
        await boardAction("move", {
          id: application.id,
          stage_id: stageId,
          expected_stage_id: application.current_stage_id,
        }),
      )
    } catch (e) {
      setOverrides((previous) => ({
        ...previous,
        [application.id]: application,
      }))
      setError((e as Error).message)
    } finally {
      unlock(application.id)
    }
  }
  async function reopen(application: TrackedApplication) {
    if (!lock(application.id)) return
    try {
      saved(await boardAction("reopen", { id: application.id }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      unlock(application.id)
    }
  }
  function editRecord(application: TrackedApplication) {
    setSelectedId(undefined)
    setEdit(application)
  }
  function archiveRecord(application: TrackedApplication) {
    setSelectedId(undefined)
    setArchive(application)
  }
  return (
    <Page
      title="Application board"
      description="Track every application, every round and where each process ends."
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={!api.data}
            onClick={() => setManage(true)}
          >
            <Columns3 className="size-4" />
            Manage stages
          </Button>
          <Button size="sm" onClick={() => setEdit(null)}>
            <Plus className="size-4" />
            New application
          </Button>
        </>
      }
    >
      <LoadState
        loading={api.loading && !api.data}
        error={api.error}
        retry={api.refresh}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>
      {api.data && (
        <Tabs value={view} onValueChange={setView}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
              <TabsTrigger value="archived">
                Archived ({archived.length})
              </TabsTrigger>
            </TabsList>
            <div className="relative w-full sm:w-80">
              <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search applications"
                placeholder="Search company, role or stack…"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <TabsContent value="active" className="space-y-4">
            {!active.length && (
              <Empty
                title="No active applications yet"
                description="Register an application with just a company name and job link."
              >
                <Button onClick={() => setEdit(null)}>New application</Button>
              </Empty>
            )}
            {active.length > 0 && !visible.length && (
              <p className="text-sm text-muted-foreground">
                No applications match your search.
              </p>
            )}
            <DragDropProvider
              onDragEnd={(event) => {
                if (event.canceled) return
                const sourceId = String(event.operation.source?.id ?? "")
                const targetId = String(event.operation.target?.id ?? "")
                const application = records.get(
                  Number(sourceId.replace("application:", "")),
                )
                if (!application || pendingRef.current.has(application.id))
                  return
                if (targetId === "archive") archiveRecord(application)
                else if (targetId.startsWith("stage:"))
                  void move(application, Number(targetId.slice(6)))
              }}
            >
              <div
                className="flex gap-4 overflow-x-auto pb-3"
                aria-label="Application kanban"
              >
                {stages
                  .filter((stage) => !stage.is_archived)
                  .map((stage) => (
                    <ApplicationColumn
                      key={stage.id}
                      stage={stage}
                      total={
                        active.filter(
                          (application) =>
                            application.current_stage_id === stage.id,
                        ).length
                      }
                      count={
                        visible.filter(
                          (application) =>
                            application.current_stage_id === stage.id,
                        ).length
                      }
                    >
                      {visible
                        .filter(
                          (application) =>
                            application.current_stage_id === stage.id,
                        )
                        .map((application) => (
                          <ApplicationCard
                            key={application.id}
                            application={application}
                            busy={pending.has(application.id)}
                            onDetails={() => {
                              setError("")
                              setSelectedId(application.id)
                            }}
                            onEdit={() => editRecord(application)}
                            onArchive={() => archiveRecord(application)}
                          />
                        ))}
                    </ApplicationColumn>
                  ))}
              </div>
              <ArchiveDropZone />
              <DragOverlay>
                {(source) => {
                  const application = records.get(
                    Number(String(source.id).replace("application:", "")),
                  )
                  return application ? (
                    <Card aria-hidden className="w-72 py-3 shadow-lg">
                      <CardContent className="px-3">
                        <ApplicationSummary application={application} />
                      </CardContent>
                    </Card>
                  ) : null
                }}
              </DragOverlay>
            </DragDropProvider>
          </TabsContent>
          <TabsContent value="archived">
            {!archivedVisible.length ? (
              <Empty
                title={
                  query
                    ? "No matching applications"
                    : "No archived applications"
                }
                description={
                  query
                    ? "Try another company, role or technology."
                    : "Closed processes will appear here with the stage where they ended."
                }
              />
            ) : (
              <div className="space-y-3">
                {archivedVisible.map((application) => (
                  <Card key={application.id} className="py-4 shadow-none">
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 px-4">
                      <button
                        type="button"
                        className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`View ${application.company_name} application`}
                        onClick={() => {
                          setError("")
                          setSelectedId(application.id)
                        }}
                      >
                        <ApplicationSummary application={application} />
                      </button>
                      <div className="text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">
                          {application.archive_reason &&
                            ARCHIVE_REASONS[application.archive_reason]}
                        </p>
                        <p>
                          Last stage:{" "}
                          {
                            stages.find(
                              (stage) =>
                                stage.id === application.current_stage_id,
                            )?.name
                          }
                        </p>
                        <p>{date(application.archived_at)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending.has(application.id)}
                        onClick={() => void reopen(application)}
                      >
                        <RotateCcw className="size-4" />
                        Reopen application
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
      {edit !== undefined && (
        <ApplicationForm
          key={edit?.id ?? "new"}
          application={edit ?? undefined}
          onClose={() => setEdit(undefined)}
          onSaved={saved}
        />
      )}
      {archive && (
        <ApplicationArchive
          application={archive}
          onClose={() => setArchive(undefined)}
          onSaved={saved}
        />
      )}
      {manage && (
        <ApplicationStages
          stages={stages}
          onClose={() => setManage(false)}
          onChanged={api.refresh}
        />
      )}
      {selected && (
        <ApplicationDetails
          key={selected.id}
          application={selected}
          stages={stages}
          busy={pending.has(selected.id)}
          actionError={error}
          onClose={() => setSelectedId(undefined)}
          onEdit={() => editRecord(selected)}
          onArchive={() => archiveRecord(selected)}
          onMove={(stageId) => void move(selected, stageId)}
          onReopen={() => void reopen(selected)}
        />
      )}
    </Page>
  )
}

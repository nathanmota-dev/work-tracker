import { DragDropProvider, DragOverlay } from "@dnd-kit/react"
import { RotateCcw } from "lucide-react"
import {
  ApplicationCard,
  ApplicationColumn,
  ApplicationSummary,
  ArchiveDropZone,
} from "@/components/application-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty } from "@/components/workspace-ui"
import { date } from "@/lib/api"
import {
  ARCHIVE_REASONS,
  type ApplicationStage,
  type TrackedApplication,
} from "@/lib/application-board"

type Actions = {
  onDetails: (application: TrackedApplication) => void
  onEdit: (application: TrackedApplication) => void
  onArchive: (application: TrackedApplication) => void
  onMove: (application: TrackedApplication, stageId: number) => void
}

function recordFor(
  records: Map<number, TrackedApplication>,
  id: unknown,
): TrackedApplication | undefined {
  return records.get(Number(String(id ?? "").replace("application:", "")))
}

function DragPreview({ application }: { application?: TrackedApplication }) {
  return application ? (
    <Card aria-hidden className="w-72 py-3 shadow-lg">
      <CardContent className="px-3">
        <ApplicationSummary application={application} />
      </CardContent>
    </Card>
  ) : null
}

export function ActiveBoard({
  active,
  visible,
  stages,
  records,
  pending,
  isLocked,
  onCreate,
  onDetails,
  onEdit,
  onArchive,
  onMove,
}: Actions & {
  active: TrackedApplication[]
  visible: TrackedApplication[]
  stages: ApplicationStage[]
  records: Map<number, TrackedApplication>
  pending: Set<number>
  isLocked: (id: number) => boolean
  onCreate: () => void
}) {
  const inStage = (list: TrackedApplication[], stage: ApplicationStage) =>
    list.filter((application) => application.current_stage_id === stage.id)
  return (
    <>
      {!active.length && (
        <Empty
          title="No active applications yet"
          description="Register an application with just a company name and job link."
        >
          <Button onClick={onCreate}>New application</Button>
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
          const targetId = String(event.operation.target?.id ?? "")
          const application = recordFor(records, event.operation.source?.id)
          if (!application || isLocked(application.id)) return
          if (targetId === "archive") onArchive(application)
          else if (targetId.startsWith("stage:"))
            onMove(application, Number(targetId.slice(6)))
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
                total={inStage(active, stage).length}
                count={inStage(visible, stage).length}
              >
                {inStage(visible, stage).map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    busy={pending.has(application.id)}
                    onDetails={() => onDetails(application)}
                    onEdit={() => onEdit(application)}
                    onArchive={() => onArchive(application)}
                  />
                ))}
              </ApplicationColumn>
            ))}
        </div>
        <ArchiveDropZone />
        <DragOverlay>
          {(source) => <DragPreview application={recordFor(records, source.id)} />}
        </DragOverlay>
      </DragDropProvider>
    </>
  )
}

export function ArchivedList({
  applications,
  query,
  stages,
  pending,
  onDetails,
  onReopen,
}: {
  applications: TrackedApplication[]
  query: string
  stages: ApplicationStage[]
  pending: Set<number>
  onDetails: (application: TrackedApplication) => void
  onReopen: (application: TrackedApplication) => void
}) {
  if (!applications.length)
    return (
      <Empty
        title={query ? "No matching applications" : "No archived applications"}
        description={
          query
            ? "Try another company, role or technology."
            : "Closed processes will appear here with the stage where they ended."
        }
      />
    )
  return (
    <div className="space-y-3">
      {applications.map((application) => (
        <Card key={application.id} className="py-4 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 px-4">
            <button
              type="button"
              className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`View ${application.company_name} application`}
              onClick={() => onDetails(application)}
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
                    (stage) => stage.id === application.current_stage_id,
                  )?.name
                }
              </p>
              <p>{date(application.archived_at)}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending.has(application.id)}
              onClick={() => onReopen(application)}
            >
              <RotateCcw className="size-4" />
              Reopen application
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

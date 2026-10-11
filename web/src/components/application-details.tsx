import { useEffect, useState } from "react"
import { ArrowUpRight, Archive, Pencil, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SelectControl } from "@/components/ui/select-control"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Field, LoadState } from "@/components/workspace-ui"
import { ApplicationSummary } from "@/components/application-card"
import { date, openExternal, subscribe } from "@/lib/api"
import {
  ARCHIVE_REASONS,
  boardAction,
  type ApplicationDetails as Details,
  type ApplicationStage,
  type TrackedApplication,
} from "@/lib/application-board"

export function ApplicationDetails({
  application,
  stages,
  busy,
  actionError,
  onClose,
  onEdit,
  onArchive,
  onMove,
  onReopen,
}: {
  application: TrackedApplication
  stages: ApplicationStage[]
  busy: boolean
  actionError: string
  onClose: () => void
  onEdit: () => void
  onArchive: () => void
  onMove: (stageId: number) => void
  onReopen: () => void
}) {
  const [details, setDetails] = useState<Details>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      subscribe((event) => {
        if (
          event.type === "changed" &&
          (!event.table ||
            [
              "applications",
              "application_events",
              "application_stages",
            ].includes(String(event.table)))
        )
          setRevision((previous) => previous + 1)
      }),
    [],
  )
  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    boardAction("details", { id: application.id })
      .then((value) => {
        if (active) setDetails(value)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [application.id, application.updated_at, revision])
  const currentStage = stages.find(
    (stage) => stage.id === application.current_stage_id,
  )
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{application.company_name}</SheetTitle>
          <SheetDescription>
            Application details and saved progress
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6">
          <ApplicationSummary application={application} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openExternal(application.external_url)}
            >
              <ArrowUpRight className="size-4" />
              Open job
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onEdit}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
            {application.tracking_status === "active" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onArchive}
              >
                <Archive className="size-4" />
                Archive
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={onReopen}>
                <RotateCcw className="size-4" />
                Reopen application
              </Button>
            )}
          </div>
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
          {application.tracking_status === "active" ? (
            <Field label="Current stage">
              <SelectControl
                aria-label="Current stage"
                disabled={busy}
                value={String(application.current_stage_id)}
                onChange={(e) => onMove(Number(e.target.value))}
              >
                {stages
                  .filter((stage) => !stage.is_archived)
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </SelectControl>
            </Field>
          ) : (
            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <Badge variant="secondary">
                {application.archive_reason &&
                  ARCHIVE_REASONS[application.archive_reason]}
              </Badge>
              <p>Last stage: {currentStage?.name}</p>
              <p className="text-xs text-muted-foreground">
                Archived {date(application.archived_at)}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Applied {date(application.applied_at)}
          </p>
          {application.notes && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Notes</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {application.notes}
              </p>
            </div>
          )}
          <div className="border-t pt-4">
            <h3 className="mb-4 text-sm font-medium">Timeline</h3>
            <LoadState
              loading={loading && !details}
              error={error}
              retry={() => setRevision((previous) => previous + 1)}
            />
            {details && (
              <ol className="space-y-4 border-l pl-4">
                {details.events.map((event) => (
                  <li key={event.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground" />
                    <p className="font-medium">
                      {event.event_type === "created"
                        ? `Registered in ${event.stage_name}`
                        : event.event_type === "moved"
                          ? `Moved to ${event.stage_name}`
                          : event.event_type === "archived"
                            ? `Archived in ${event.stage_name}`
                            : `Reopened in ${event.stage_name}`}
                    </p>
                    {event.reason && (
                      <p className="text-xs text-muted-foreground">
                        {ARCHIVE_REASONS[event.reason]}
                      </p>
                    )}
                    {event.note && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                        {event.note}
                      </p>
                    )}
                    <time
                      className="mt-1 block text-xs text-muted-foreground"
                      dateTime={event.occurred_at}
                    >
                      {date(event.occurred_at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

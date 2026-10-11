import { useState, type ReactNode } from "react"
import { useDraggable, useDroppable } from "@dnd-kit/react"
import { Archive, ArrowUpRight, GripVertical, Pencil } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { openExternal } from "@/lib/api"
import {
  faviconUrl,
  ROLE_TYPES,
  type ApplicationStage,
  type TrackedApplication,
} from "@/lib/application-board"
import { cn } from "@/lib/utils"

export function CompanyIcon({
  application,
}: {
  application: TrackedApplication
}) {
  const url = faviconUrl(application)
  const [failedUrl, setFailedUrl] = useState<string>()
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background text-sm font-semibold text-muted-foreground">
      {url && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          className="size-6 object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        application.company_name.slice(0, 2).toUpperCase()
      )}
    </span>
  )
}
export function ApplicationSummary({
  application,
}: {
  application: TrackedApplication
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <CompanyIcon application={application} />
        <div className="min-w-0">
          <p
            className="truncate font-semibold"
            title={application.company_name}
          >
            {application.company_name}
          </p>
          {application.role_title && (
            <p
              className="truncate text-xs text-muted-foreground"
              title={application.role_title}
            >
              {application.role_title}
            </p>
          )}
        </div>
      </div>
      {application.role_type && (
        <Badge variant="secondary">{ROLE_TYPES[application.role_type]}</Badge>
      )}
      {application.stack.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {application.stack.map((technology) => (
            <Badge
              key={technology}
              variant="outline"
              className="text-[11px] font-normal"
            >
              {technology}
            </Badge>
          ))}
        </div>
      )}
      {application.comp && (
        <p className="text-xs font-medium text-muted-foreground">
          {application.comp}
        </p>
      )}
    </div>
  )
}
export function ApplicationCard({
  application,
  busy,
  onDetails,
  onEdit,
  onArchive,
}: {
  application: TrackedApplication
  busy: boolean
  onDetails: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `application:${application.id}`,
    type: "application",
    disabled: busy,
  })
  return (
    <Card
      ref={ref}
      className={cn(
        "gap-3 rounded-xl py-3 shadow-none transition-shadow hover:shadow-sm",
        isDragging && "opacity-40",
        busy && "opacity-60",
      )}
      aria-busy={busy}
    >
      <CardContent className="space-y-3 px-3">
        <div className="flex items-start gap-1">
          <button
            type="button"
            disabled={busy}
            className="min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`View ${application.company_name} application`}
            onClick={onDetails}
          >
            <ApplicationSummary application={application} />
          </button>
          <button
            ref={handleRef}
            type="button"
            disabled={busy}
            aria-label={`Drag ${application.company_name} application`}
            className="touch-none rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-[11px] text-muted-foreground">
            {new Date(application.applied_at).toLocaleDateString()}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Open ${application.company_name} job`}
              onClick={() => void openExternal(application.external_url)}
            >
              <ArrowUpRight className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={busy}
              aria-label={`Edit ${application.company_name} application`}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={busy}
              aria-label={`Archive ${application.company_name} application`}
              onClick={onArchive}
            >
              <Archive className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
const colors = {
  applied: "bg-slate-400",
  recruiter: "bg-sky-500",
  technical: "bg-violet-500",
  assessment: "bg-amber-500",
  offer: "bg-emerald-500",
}
export function ApplicationColumn({
  stage,
  total,
  count,
  children,
}: {
  stage: ApplicationStage
  total: number
  count: number
  children: ReactNode
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `stage:${stage.id}`,
    accept: "application",
  })
  return (
    <section
      ref={ref}
      aria-label={`${stage.name} applications`}
      className={cn(
        "flex w-80 shrink-0 flex-col rounded-xl border bg-muted/20 transition-colors",
        isDropTarget && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-3">
        <span
          className={cn("size-2 shrink-0 rounded-full", colors[stage.category])}
        />
        <h2
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={stage.name}
        >
          {stage.name}
        </h2>
        <Badge
          variant="secondary"
          className="font-normal"
          aria-label={`${count} of ${total} applications`}
        >
          {count === total ? count : `${count}/${total}`}
        </Badge>
      </div>
      <div className="flex max-h-[calc(100dvh-25rem)] min-h-64 flex-col gap-3 overflow-y-auto p-3">
        {children}
        {!count && (
          <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
            Drop an application here
          </p>
        )}
      </div>
    </section>
  )
}
export function ArchiveDropZone() {
  const { ref, isDropTarget } = useDroppable({
    id: "archive",
    accept: "application",
  })
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Archive applications"
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground transition-colors",
        isDropTarget && "border-destructive bg-destructive/5 text-destructive",
      )}
    >
      <Archive className="size-4" /> Drag here to archive · Your progress stays
      saved
    </div>
  )
}

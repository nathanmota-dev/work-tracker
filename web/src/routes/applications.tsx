import { useState } from "react"
import { Columns3, LayoutGrid, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Page,
  Details,
  LoadState,
  ExternalLink,
} from "@/components/workspace-ui"
import { ApplicationReview } from "@/components/application-review"
import { JobLinkDialog } from "@/components/job-link-dialog"
import { PreparationQueue } from "@/components/preparation-queue"
import { QuietApplications } from "@/components/quiet-applications"
import { FollowupsDue } from "@/components/followups-due"
import {
  ApplicationBoardView,
  BoardDialogs,
  useBoardDialogs,
} from "@/components/application-board-panel"
import { ApplicationCards } from "@/components/application-cards"
import {
  NextStepAction,
  originLabel,
  phaseLabel,
} from "@/components/application-list"
import { useApplicationBoard } from "@/hooks/use-application-board"
import { useApi, text, type Row } from "@/lib/api"
import {
  VIEWS,
  nextStep,
  type ApplicationView,
} from "@/lib/application-journey"
import { openApply } from "@/lib/preparation"
import { useWorkspaceState } from "@/lib/workspace-state"
import { cn } from "@/lib/utils"

function ApplicationDetailsSheet({
  selected,
  onClose,
  onPrepare,
}: {
  selected: Row | null
  onClose: () => void
  onPrepare: (row: Row) => void
}) {
  return (
    <Details
      row={selected}
      title={text(selected?.job_title ?? "Application details")}
      onClose={onClose}
    >
      {selected && (
        <p className="text-sm text-muted-foreground">
          {originLabel(selected)} · {phaseLabel(selected.phase)} ·{" "}
          {(VIEWS[selected.view as ApplicationView] ?? VIEWS.preparation).label}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Artifact paths refer to files in your local workspace.
      </p>
      <div className="flex gap-2">
        <ExternalLink value={selected?.external_url} label="Open portal" />
        <Button onClick={() => selected && onPrepare(selected)}>
          Prepare application
        </Button>
        {selected && nextStep(selected).kind === "board" && (
          <NextStepAction row={selected} onPrepare={onPrepare} />
        )}
      </div>
    </Details>
  )
}

/** Cards or board, as a segmented pill next to the page actions. */
function LayoutToggle({ value, onChange }: { value: "list" | "board"; onChange: (value: "list" | "board") => void }) {
  const option = (key: "list" | "board", label: string, Icon: typeof LayoutGrid) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === key}
      aria-label={label}
      title={label}
      onClick={() => onChange(key)}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:text-foreground",
        value === key && "bg-background text-foreground shadow-sm",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Applications layout" className="inline-flex items-center rounded-full border bg-muted/50 p-0.5">
      {option("list", "Cards", LayoutGrid)}
      {option("board", "Board", Columns3)}
    </div>
  )
}

/** Preparation queue, follow-ups due and quiet applications, each shown only when it has items. */
function ApplicationBanners() {
  return (
    <>
      <PreparationQueue />
      <FollowupsDue />
      <QuietApplications />
    </>
  )
}

/**
 * Every application in one place, from first draft to the final board stage,
 * as a list or a board. The layout, search and review filter live in the URL.
 */
export function ApplicationsPage() {
  const api = useApi<Row[]>("applications")
  const board = useApplicationBoard()
  const dialogs = useBoardDialogs(board.records, board.setError)
  const { search, update } = useWorkspaceState("applications")
  const [selected, setSelected] = useState<Row | null>(null)
  const [linking, setLinking] = useState<Row>()
  const layout = search.view === "board" ? "board" : "list"
  const rows = api.data ?? []
  // The review filter applies while flagged records remain; resolving the last one shows all again.
  const reviewing = !!search.review && rows.some((row) => !!row.review_reason)
  // An application without a saved job is linked first, so its detail opens with usable data.
  function prepare(row: Row) {
    if (Number(row.job_id) > 0) return openApply(row.job_id, row.id)
    setSelected(null)
    setLinking(row)
  }
  return (
    <Page
      title="Applications"
      description="Every application, from first draft to the final stage."
      actions={
        <>
          <LayoutToggle value={layout} onChange={(view) => update({ view })} />
          {layout === "board" && (
            <Button
              size="sm"
              variant="outline"
              disabled={!board.api.data}
              onClick={() => dialogs.setManage(true)}
            >
              <Columns3 className="size-4" />
              Manage stages
            </Button>
          )}
          <Button size="sm" onClick={() => dialogs.setEdit(null)}>
            <Plus className="size-4" />
            New application
          </Button>
        </>
      }
    >
      <LoadState {...api} retry={api.refresh} />
      <ApplicationReview
        open={!!search.review}
        onOpenChange={(review) => update({ review })}
      />
      <ApplicationBanners />
      {layout === "list" && api.data && (
        <ApplicationCards
          board={{ records: board.records, stages: board.stages }}
          rows={reviewing ? rows.filter((row) => !!row.review_reason) : rows}
          onSelect={setSelected}
          onPrepare={prepare}
        />
      )}
      {layout === "board" && (
        <ApplicationBoardView
          board={board}
          dialogs={dialogs}
          rows={rows}
          query={search.q ?? ""}
          onQuery={(q) => update({ q })}
          tab={search.tab ?? "active"}
          onTab={(tab) => update({ tab })}
          highlight={search.highlight}
          onPrepare={prepare}
        />
      )}
      <ApplicationDetailsSheet
        selected={selected}
        onClose={() => setSelected(null)}
        onPrepare={prepare}
      />
      <BoardDialogs
        board={board}
        dialogs={dialogs}
        onEdit={dialogs.editRecord}
        onArchive={dialogs.archiveRecord}
      />
      {linking && (
        <JobLinkDialog
          applicationId={Number(linking.id)}
          title="Prepare this application"
          actionLabel="Link and open the application"
          onClose={() => setLinking(undefined)}
          onLinked={(result) => {
            setLinking(undefined)
            openApply(result.job_id, result.application_id)
          }}
        />
      )}
    </Page>
  )
}

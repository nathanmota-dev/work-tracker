import { useState } from "react"
import { Columns3, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import {
  ApplicationBoardView,
  BoardDialogs,
  useBoardDialogs,
} from "@/components/application-board-panel"
import {
  ApplicationList,
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
      <PreparationQueue />
      <QuietApplications />
      <Tabs value={layout} onValueChange={(view) => update({ view })}>
        <TabsList aria-label="Applications layout">
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="board">Board</TabsTrigger>
        </TabsList>
      </Tabs>
      {layout === "list" && api.data && (
        <ApplicationList
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

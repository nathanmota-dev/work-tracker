import { useState } from "react"
import { Search } from "lucide-react"
import {
  ActiveBoard,
  ArchivedList,
} from "@/components/application-board-views"
import { ApplicationForm } from "@/components/application-form"
import { ApplicationArchive } from "@/components/application-archive"
import { ApplicationStages } from "@/components/application-stages"
import { ApplicationDetails } from "@/components/application-details"
import { AdvanceDialog } from "@/components/advance-dialog"
import { PreparationColumns, preparationRows } from "@/components/preparation-columns"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LoadState } from "@/components/workspace-ui"
import type { Row } from "@/lib/api"
import { useApplicationBoard } from "@/hooks/use-application-board"
import {
  matchesApplication,
  type TrackedApplication,
} from "@/lib/application-board"

function BoardToolbar({
  activeCount,
  archivedCount,
  query,
  onQuery,
}: {
  activeCount: number
  archivedCount: number
  query: string
  onQuery: (query: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabsList>
        <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
        <TabsTrigger value="archived">
          Archived ({archivedCount})
        </TabsTrigger>
      </TabsList>
      <div className="relative w-full sm:w-80">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label="Search applications"
          placeholder="Search company, role or stack…"
          className="pl-9"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
    </div>
  )
}

type Dialogs = {
  edit: TrackedApplication | null | undefined
  setEdit: (edit: TrackedApplication | null | undefined) => void
  archive: TrackedApplication | undefined
  setArchive: (archive: TrackedApplication | undefined) => void
  manage: boolean
  setManage: (manage: boolean) => void
  selected: TrackedApplication | undefined
  setSelectedId: (id: number | undefined) => void
}

export function BoardDialogs({
  board,
  dialogs,
  onEdit,
  onArchive,
}: {
  board: ReturnType<typeof useApplicationBoard>
  dialogs: Dialogs
  onEdit: (application: TrackedApplication) => void
  onArchive: (application: TrackedApplication) => void
}) {
  const { edit, setEdit, archive, setArchive, manage, setManage, selected, setSelectedId } = dialogs
  return (
    <>
      {edit !== undefined && (
        <ApplicationForm
          key={edit?.id ?? "new"}
          application={edit ?? undefined}
          onClose={() => setEdit(undefined)}
          onSaved={board.saved}
        />
      )}
      {archive && (
        <ApplicationArchive
          application={archive}
          onClose={() => setArchive(undefined)}
          onSaved={board.saved}
        />
      )}
      {manage && (
        <ApplicationStages
          stages={board.stages}
          onClose={() => setManage(false)}
          onChanged={board.api.refresh}
        />
      )}
      {selected && (
        <ApplicationDetails
          key={selected.id}
          application={selected}
          stages={board.stages}
          busy={board.pending.has(selected.id)}
          actionError={board.error}
          onClose={() => setSelectedId(undefined)}
          onEdit={() => onEdit(selected)}
          onArchive={() => onArchive(selected)}
          onMove={(stageId) => void board.move(selected, stageId)}
          onReopen={() => void board.reopen(selected)}
        />
      )}
    </>
  )
}

export function useBoardDialogs(
  records: Map<number, TrackedApplication>,
  setError: (error: string) => void,
) {
  const [edit, setEdit] = useState<TrackedApplication | null>()
  const [archive, setArchive] = useState<TrackedApplication>()
  const [selectedId, setSelectedId] = useState<number>()
  const [manage, setManage] = useState(false)
  const selected =
    selectedId === undefined ? undefined : records.get(selectedId)
  function showDetails(application: TrackedApplication) {
    setError("")
    setSelectedId(application.id)
  }
  function editRecord(application: TrackedApplication) {
    setSelectedId(undefined)
    setEdit(application)
  }
  function archiveRecord(application: TrackedApplication) {
    setSelectedId(undefined)
    setArchive(application)
  }
  return {
    edit,
    setEdit,
    archive,
    setArchive,
    manage,
    setManage,
    selected,
    setSelectedId,
    showDetails,
    editRecord,
    archiveRecord,
  }
}

/**
 * The board view of Applications: fixed preparation columns, then the
 * configurable stages. Only confirmed submissions enter the stages.
 */
export function ApplicationBoardView({
  board,
  dialogs,
  rows,
  query,
  onQuery,
  tab,
  onTab,
  highlight,
  onPrepare,
}: {
  board: ReturnType<typeof useApplicationBoard>
  dialogs: ReturnType<typeof useBoardDialogs>
  /** Applications list rows, for the preparation columns. */
  rows: Row[]
  query: string
  onQuery: (query: string) => void
  tab: string
  onTab: (tab: string) => void
  highlight?: number
  onPrepare: (row: Row) => void
}) {
  const { api, records, stages, active, archived, pending, error } = board
  const { showDetails, editRecord, archiveRecord } = dialogs
  const visible = active.filter((application) =>
    matchesApplication(application, query),
  )
  const archivedVisible = archived.filter((application) =>
    matchesApplication(application, query),
  )
  const [advancing, setAdvancing] = useState<{ row: Row; stageId?: number } | null>(null)
  const preparing = preparationRows(rows, "")
  const preparingVisible = preparationRows(rows, query)
  return (
    <>
      <AdvanceDialog
        row={advancing?.row ?? null}
        stage={stages.find((stage) => stage.id === advancing?.stageId)?.name}
        onCancel={() => setAdvancing(null)}
        onConfirm={() => {
          if (!advancing) return
          void board.submitPrepared(Number(advancing.row.id), advancing.stageId)
          setAdvancing(null)
        }}
      />
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
        {board.notice}
      </p>
      {api.data && (
        <Tabs value={tab} onValueChange={onTab}>
          <BoardToolbar
            activeCount={active.length}
            archivedCount={archived.length}
            query={query}
            onQuery={onQuery}
          />
          <TabsContent value="active" className="space-y-4">
            <ActiveBoard
              active={active}
              visible={visible}
              stages={stages}
              records={records}
              pending={pending}
              isLocked={board.isLocked}
              highlight={highlight}
              preparation={{
                columns: (
                  <PreparationColumns
                    rows={preparingVisible}
                    highlight={highlight}
                    onOpen={onPrepare}
                    onAdvance={(row) => setAdvancing({ row })}
                  />
                ),
                total: preparing.length,
                visible: preparingVisible.length,
              }}
              onCreate={() => dialogs.setEdit(null)}
              onDetails={showDetails}
              onEdit={editRecord}
              onArchive={archiveRecord}
              onMove={(application, stageId) => void board.move(application, stageId)}
              onSubmitPrepared={(id, stageId) => {
                const row = rows.find((item) => Number(item.id) === id)
                if (row) setAdvancing({ row, stageId })
              }}
            />
          </TabsContent>
          <TabsContent value="archived">
            <ArchivedList
              applications={archivedVisible}
              query={query}
              stages={stages}
              pending={pending}
              onDetails={showDetails}
              onReopen={(application) => void board.reopen(application)}
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  )
}

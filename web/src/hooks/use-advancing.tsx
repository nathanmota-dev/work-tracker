import { useState } from "react"
import { AdvanceDialog } from "@/components/advance-dialog"
import type { Row } from "@/lib/api"
import type { ApplicationStage } from "../../../src/applications/types"
import type { useApplicationBoard } from "@/hooks/use-application-board"

/**
 * Confirmation before a prepared application moves to Tracking, from the card's
 * arrow or from a drop on a stage. `dialog` is rendered once by the board.
 */
export function useAdvancing(board: ReturnType<typeof useApplicationBoard>, stages: ApplicationStage[], rows: Row[]) {
  const [asking, setAsking] = useState<{ row: Row; stageId?: number } | null>(null)
  const dialog = (
    <AdvanceDialog
      row={asking?.row ?? null}
      stage={stages.find((stage) => stage.id === asking?.stageId)?.name}
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        if (!asking) return
        void board.submitPrepared(Number(asking.row.id), asking.stageId)
        setAsking(null)
      }}
    />
  )
  return {
    dialog,
    ask: (row: Row) => setAsking({ row }),
    drop: (id: number, stageId: number) => {
      const row = rows.find((item) => Number(item.id) === id)
      if (row) setAsking({ row, stageId })
    },
  }
}

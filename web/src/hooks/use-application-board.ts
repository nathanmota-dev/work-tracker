import { useEffect, useRef, useState } from "react"
import { useApi } from "@/lib/api"
import {
  boardAction,
  type ApplicationBoard,
  type TrackedApplication,
} from "@/lib/application-board"

function useOptimisticRecords(
  board: ApplicationBoard | undefined,
  pending: Set<number>,
) {
  const [overrides, setOverrides] = useState<
    Record<number, TrackedApplication>
  >({})
  useEffect(() => {
    if (!board) return
    setOverrides((previous) => {
      const next = { ...previous }
      let changed = false
      for (const [id, record] of Object.entries(previous)) {
        const saved = board.applications.find(
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
  }, [board, pending])
  const records = new Map(
    (board?.applications ?? []).map((application) => [
      application.id,
      application,
    ]),
  )
  Object.values(overrides).forEach((application) =>
    records.set(application.id, application),
  )
  const override = (application: TrackedApplication) =>
    setOverrides((previous) => ({ ...previous, [application.id]: application }))
  return { records, override }
}

function sortedLists(records: Map<number, TrackedApplication>) {
  const applications = [...records.values()].sort(
    (a, b) => b.applied_at.localeCompare(a.applied_at) || b.id - a.id,
  )
  const active = applications.filter(
    (application) => application.tracking_status === "active",
  )
  const archived = applications
    .filter((application) => application.tracking_status === "archived")
    .sort(
      (a, b) =>
        (b.archived_at ?? "").localeCompare(a.archived_at ?? "") || b.id - a.id,
    )
  return { active, archived }
}

/** Board data with optimistic updates and per-application action locks. */
export function useApplicationBoard() {
  const api = useApi<ApplicationBoard>("application-board")
  const pendingRef = useRef(new Set<number>())
  const [pending, setPending] = useState(new Set<number>())
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const { records, override } = useOptimisticRecords(api.data, pending)
  function saved(application: TrackedApplication) {
    override(application)
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
    override({ ...application, current_stage_id: stageId })
    try {
      saved(
        await boardAction("move", {
          id: application.id,
          stage_id: stageId,
          expected_stage_id: application.current_stage_id,
        }),
      )
    } catch (e) {
      override(application)
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
  return {
    api,
    records,
    stages: api.data?.stages ?? [],
    ...sortedLists(records),
    pending,
    isLocked: (id: number) => pendingRef.current.has(id),
    error,
    setError,
    notice,
    saved,
    move,
    reopen,
  }
}

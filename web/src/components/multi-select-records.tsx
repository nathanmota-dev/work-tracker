import { useEffect, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Records, type Column } from "@/components/records"
import { useWorkspaceState } from "@/lib/workspace-state"
import type { Row } from "@/lib/api"

/** Selection is keyed independently of database IDs and survives filtering/paging. */
export function MultiSelectRecords({ rows, columns, noun, rowKey, rowLabel, canSelect, busy, action, onSelect, workspace = "", selectAllLabel = "Select all eligible results" }: {
  workspace?: string
  rows: Row[]
  columns: Column[]
  noun: string
  rowKey: (row: Row) => string
  rowLabel: (row: Row) => string
  canSelect: (row: Row) => boolean
  busy: boolean
  action: (selected: Row[]) => ReactNode
  onSelect: (row: Row) => void
  selectAllLabel?: string
}) {
  const { search, update } = useWorkspaceState(workspace || "jobs")
  const selected = new Set(search.selection ?? [])
  const setSelected = (next: Set<string>) => update({ selection: [...next] })
  const eligible = rows.filter(canSelect)
  const chosen = eligible.filter(row => selected.has(rowKey(row)))
  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }
  useEffect(() => {
    const valid = (search.selection ?? []).filter(key => eligible.some(row => rowKey(row) === key))
    if (valid.length !== search.selection?.length) update({ selection: valid })
  }, [eligible, rowKey, search.selection, update])
  return (
    <Records
      workspace={workspace}
      noun={noun}
      rows={rows}
      rowKey={rowKey}
      onSelect={onSelect}
      columns={[{
        key: "selection", label: "Select",
        render: row => <input type="checkbox" aria-label={`Select ${rowLabel(row)}`}
          disabled={busy || !canSelect(row)} checked={selected.has(rowKey(row))}
          onChange={() => toggle(rowKey(row))} />,
      }, ...columns]}
      action={<>
        <Button size="sm" variant="outline" disabled={busy || !eligible.length}
          onClick={() => setSelected(new Set(eligible.map(rowKey)))}>{selectAllLabel}</Button>
        <Button size="sm" variant="ghost" disabled={busy || !chosen.length}
          onClick={() => setSelected(new Set())}>Clear selection</Button>
        <span role="status" className="self-center text-sm">{chosen.length} selected</span>
        {action(chosen)}
      </>}
    />
  )
}

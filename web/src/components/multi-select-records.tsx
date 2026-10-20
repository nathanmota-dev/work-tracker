import { useEffect, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Records, type Column } from "@/components/records"
import { useWorkspaceState } from "@/lib/workspace-state"
import type { Row } from "@/lib/api"

/** Selection is keyed independently of database IDs and survives filtering/paging. */
export function MultiSelectRecords({ rows, columns, noun, rowKey, rowLabel, canSelect, busy, action, onSelect, workspace = "", selectionRows = rows, selectAllLabel = "Select all eligible results" }: {
  workspace?: string
  rows: Row[]
  /** Complete selectable set, independent of the displayed archive tab/page. */
  selectionRows?: Row[]
  columns: Column[]
  noun: string
  rowKey: (row: Row) => string
  rowLabel: (row: Row) => string
  canSelect: (row: Row) => boolean
  busy: boolean
  action: (selected: Row[], clear: () => void) => ReactNode
  onSelect: (row: Row) => void
  selectAllLabel?: string
}) {
  const { search, update } = useWorkspaceState(workspace || "jobs")
  const selected = new Set(search.selection ?? [])
  const setSelected = (next: Set<string>) => update({ selection: [...next] })
  const eligible = selectionRows.filter(canSelect)
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
      action={({ filteredRows, pageRows }) => {
        const filtered = filteredRows.filter(canSelect)
        const page = pageRows.filter(canSelect)
        const hidden = chosen.filter(row => !filtered.some(visible => rowKey(visible) === rowKey(row))).length
        const select = (scope: Row[]) => setSelected(new Set([...selected, ...scope.map(rowKey)]))
        return <>
          <Button size="sm" variant="outline" disabled={busy || !page.length}
            onClick={() => select(page)}>Select page ({page.length})</Button>
          <Button size="sm" variant="outline" disabled={busy || !filtered.length}
            onClick={() => select(filtered)}>{selectAllLabel} ({filtered.length})</Button>
          <Button size="sm" variant="ghost" disabled={busy || !chosen.length}
            onClick={() => setSelected(new Set())}>Clear selection</Button>
          <span role="status" className="self-center text-sm">{chosen.length} selected{hidden ? ` · ${hidden} outside current filter` : ""}</span>
          {action(chosen, () => setSelected(new Set()))}
        </>
      }}
    />
  )
}

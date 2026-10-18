import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Records, type Column } from "@/components/records"
import type { Row } from "@/lib/api"

/** Selection is keyed independently of database IDs and survives filtering/paging. */
export function MultiSelectRecords({ rows, columns, noun, rowKey, rowLabel, canSelect, busy, action, onSelect, selectAllLabel = "Select all eligible results" }: {
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const eligible = rows.filter(canSelect)
  const chosen = eligible.filter(row => selected.has(rowKey(row)))
  const toggle = (key: string) => setSelected(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  return (
    <Records
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

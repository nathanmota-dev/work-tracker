import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Floating bar of bulk actions, shown only while something is selected.
 * `onSelectAll` offers to extend the selection to every filtered item.
 */
export function SelectionBar({ count, total, noun = "selected", onSelectAll, onClear, children }: {
  count: number
  /** Items the current filters show; "Select all" appears while fewer are selected. */
  total: number
  noun?: string
  onSelectAll?: () => void
  onClear: () => void
  children: ReactNode
}) {
  if (!count) return null
  return (
    <div className="pointer-events-none sticky bottom-4 z-40 flex justify-center">
      <div role="toolbar" aria-label="Selection actions"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border bg-popover px-3 py-2 text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
        <span role="status" className="px-1 text-sm font-medium tabular-nums">{count} {noun}</span>
        {onSelectAll && count < total && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onSelectAll}>Select all {total}</Button>
        )}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        {children}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <Button size="icon-sm" variant="ghost" aria-label="Clear selection" title="Clear selection" onClick={onClear}>
          <X />
        </Button>
      </div>
    </div>
  )
}

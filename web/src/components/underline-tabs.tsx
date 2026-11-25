import type { ReactNode } from "react"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"

/** One underlined tab with its item count, as used by the Jobs and Applications boards. */
export function CountTab({ value, label, count }: { value: string; label: string; count: number }) {
  return (
    <TabsTrigger value={value} aria-label={`${label} (${count})`}
      className="-mb-px gap-1.5 rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
      {label}<span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
    </TabsTrigger>
  )
}

/** The bare tab strip that holds `CountTab`s above a bottom border. */
export function CountTabsList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TabsList aria-label={label} className="h-auto gap-6 rounded-none bg-transparent p-0">
      {children}
    </TabsList>
  )
}

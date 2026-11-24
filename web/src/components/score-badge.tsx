import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { ScoreTone } from "@/lib/ats"

// Text colors keep AA contrast on the light and dark backgrounds; the label always carries the meaning.
const TONES: Record<ScoreTone, string> = {
  good: "border-emerald-600/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  warn: "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  bad: "border-destructive/50 bg-destructive/10 text-destructive",
  none: "text-muted-foreground",
}

/** A score with its band's color. Color is never the only signal: `children` is always text. */
export function ScoreBadge({ tone, title, children, className }: { tone: ScoreTone; title?: string; children: ReactNode; className?: string }) {
  return (
    <span data-tone={tone} title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {children}
    </span>
  )
}

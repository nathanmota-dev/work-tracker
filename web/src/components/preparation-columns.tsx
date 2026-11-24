import { useDraggable } from "@dnd-kit/react"
import { ArrowRight, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useHighlightRef } from "@/components/application-card"
import { originLabel } from "@/components/application-list"
import { text, type Row } from "@/lib/api"
import { PHASES, PHASE_LABELS, canAdvance, nextStep, type JourneyPhase } from "@/lib/application-journey"
import { normalizeSearch } from "@/lib/application-board"
import { cn } from "@/lib/utils"

const COLUMNS: JourneyPhase[] = ["draft", "prepared", "filled"]

/**
 * Applications still being prepared, one per row. Submitted records without a
 * board stage are left to Needs review instead of a preparation column.
 */
export function preparationRows(rows: Row[], query: string) {
  const search = normalizeSearch(query)
  return rows.filter(
    (row) =>
      (row.view ?? "preparation") === "preparation" &&
      COLUMNS.includes(row.phase as JourneyPhase) &&
      normalizeSearch(`${text(row.company_name)} ${text(row.job_title)}`).includes(search),
  )
}

function PreparationCard({
  row,
  highlighted,
  onOpen,
  onAdvance,
}: {
  row: Row
  highlighted: boolean
  onOpen: (row: Row) => void
  onAdvance: (row: Row) => void
}) {
  const highlight = useHighlightRef<HTMLDivElement>(highlighted)
  const draggable = canAdvance(row)
  const { ref: dragRef, handleRef, isDragging } = useDraggable({ id: `prep:${text(row.id)}`, type: "application", disabled: !draggable })
  const ref = { current: null as HTMLDivElement | null }
  const name = `${text(row.company_name)} · ${text(row.job_title)}`
  return (
    <Card
      ref={(element) => {
        highlight.current = element
        ref.current = element
        dragRef(element)
      }}
      role="group"
      aria-label={name}
      data-highlighted={highlighted || undefined}
      className={cn(
        "gap-2 rounded-xl py-3 shadow-none",
        isDragging && "opacity-40",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <CardContent className="space-y-2 px-3">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate font-semibold" title={text(row.company_name)}>
            {text(row.company_name)}
          </p>
          {draggable && (
            <button ref={handleRef} type="button" aria-label={`Drag ${text(row.company_name)} application`}
              className="touch-none rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing">
              <GripVertical className="size-4" />
            </button>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={text(row.job_title)}>
          {text(row.job_title)}
        </p>
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-[11px] text-muted-foreground">{originLabel(row)}</span>
          <Button
            size="sm"
            variant="outline"
            aria-label={`Continue ${name}`}
            onClick={() => onOpen(row)}
          >
            {nextStep(row).label}
          </Button>
          {draggable && (
            <Button size="icon" variant="ghost" className="size-8" title="Advance to next step" aria-label={`Advance ${name} to the next step`} onClick={() => onAdvance(row)}>
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Fixed Draft → Prepared → Filled columns before the board stages. The server
 * computes each phase. A prepared or filled card is dragged to a board stage,
 * or advanced with its arrow, once the candidate submitted it in the portal.
 */
export function PreparationColumns({
  rows,
  highlight,
  onOpen,
  onAdvance,
}: {
  rows: Row[]
  highlight?: number
  onOpen: (row: Row) => void
  onAdvance: (row: Row) => void
}) {
  return (
    <>
      {COLUMNS.map((phase) => {
        const cards = rows.filter((row) => row.phase === phase)
        return (
          <section
            key={phase}
            aria-label={`${PHASE_LABELS[phase]} applications`}
            className="flex w-72 shrink-0 flex-col rounded-xl border border-dashed bg-muted/10"
          >
            <div className="border-b px-3 py-3">
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                  {PHASE_LABELS[phase]}
                </h2>
                <Badge variant="secondary" className="font-normal">
                  {cards.length}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {PHASES[phase].hint} · updated automatically
              </p>
            </div>
            <div className="flex max-h-[calc(100dvh-25rem)] min-h-64 flex-col gap-3 overflow-y-auto p-3">
              {cards.map((row) => (
                <PreparationCard
                  key={String(row.id)}
                  row={row}
                  highlighted={Number(row.id) === highlight}
                  onOpen={onOpen}
                  onAdvance={onAdvance}
                />
              ))}
              {!cards.length && (
                <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                  Nothing here
                </p>
              )}
            </div>
          </section>
        )
      })}
    </>
  )
}

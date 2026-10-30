import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useHighlightRef } from "@/components/application-card"
import { originLabel } from "@/components/application-list"
import { text, type Row } from "@/lib/api"
import { PHASES, PHASE_LABELS, nextStep, type JourneyPhase } from "@/lib/application-journey"
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
}: {
  row: Row
  highlighted: boolean
  onOpen: (row: Row) => void
}) {
  const ref = useHighlightRef<HTMLDivElement>(highlighted)
  const name = `${text(row.company_name)} · ${text(row.job_title)}`
  return (
    <Card
      ref={ref}
      role="group"
      aria-label={name}
      data-highlighted={highlighted || undefined}
      className={cn(
        "gap-2 rounded-xl py-3 shadow-none",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <CardContent className="space-y-2 px-3">
        <p className="truncate font-semibold" title={text(row.company_name)}>
          {text(row.company_name)}
        </p>
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
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Fixed Draft → Prepared → Filled columns before the board stages. The server
 * computes each phase, so these cards cannot be dragged.
 */
export function PreparationColumns({
  rows,
  highlight,
  onOpen,
}: {
  rows: Row[]
  highlight?: number
  onOpen: (row: Row) => void
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

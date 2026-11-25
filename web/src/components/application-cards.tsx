import { useEffect, useState } from "react"
import { ArrowRight, ArrowUpDown, ArrowUpRight, Columns3, ExternalLink, Layers, MoreHorizontal, Route, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { CountTab, CountTabsList } from "@/components/underline-tabs"
import { CardBadge, OpportunityCard, ProgressBar, shortDate } from "@/components/opportunity-card"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { RecordPagination } from "@/components/records"
import { Empty } from "@/components/workspace-ui"
import { NextStepHint } from "@/components/get-started"
import { boardHref, originLabel, phaseLabel, useAdvance } from "@/components/application-list"
import { openExternal, text, webUrl, type Row } from "@/lib/api"
import { ARCHIVE_REASONS, type ApplicationStage, type TrackedApplication } from "@/lib/application-board"
import { byDeadline, deadlineLabel, type DeadlineLevel } from "@/lib/deadline"
import {
  ORIGINS,
  PHASE_LABELS,
  VIEWS,
  canAdvance,
  countRows,
  nextStep,
  type ApplicationOrigin,
  type ApplicationView,
  type JourneyPhase,
} from "@/lib/application-journey"
import { useWorkspaceState } from "@/lib/workspace-state"

const PAGE_SIZE = 24
type ViewFilter = ApplicationView | "all"

const PHASE_ORDER: JourneyPhase[] = ["draft", "prepared", "filled", "submitted"]

/** The board data the cards read to place tracked applications on their stage. */
export type BoardContext = { records: Map<number, TrackedApplication>; stages: ApplicationStage[] }

/**
 * Where an application is: its preparation step while preparing, its board
 * stage once tracked, and the stage where it ended once archived.
 */
function ApplicationProgress({ row, board }: { row: Row; board: BoardContext }) {
  const record = board.records.get(Number(row.id))
  const stages = board.stages.filter(stage => !stage.is_archived).sort((a, b) => a.position - b.position)
  const index = record ? stages.findIndex(stage => stage.id === record.current_stage_id) : -1
  if (row.view !== "preparation" && index >= 0) {
    const stage = stages[index]
    if (row.view === "archived") {
      const reason = record?.archive_reason ? ARCHIVE_REASONS[record.archive_reason] : "Closed"
      return <ProgressBar step={`${reason} · ${stage.name}`} current={index + 1} total={stages.length} tone="muted" title="Board stage where the process ended" />
    }
    return <ProgressBar step={stage.name} current={index + 1} total={stages.length} tone={index === stages.length - 1 ? "good" : "primary"} title="Current board stage" />
  }
  const phase = PHASE_ORDER.includes(row.phase as JourneyPhase) ? row.phase as JourneyPhase : "draft"
  const step = PHASE_ORDER.indexOf(phase) + 1
  return <ProgressBar step={PHASE_LABELS[phase]} current={step} total={PHASE_ORDER.length} tone={phase === "submitted" ? "good" : "primary"}
    title="Preparation: draft, prepared, filled, submitted" />
}

function matches(row: Row, query: string) {
  if (!query) return true
  const needle = query.toLowerCase()
  return [row.job_title, row.company_name, row.portal, originLabel(row), phaseLabel(row.phase)]
    .some(value => text(value).toLowerCase().includes(needle))
}

function ApplicationMenu({ row, onOpen, onPrepare, onAdvance }: {
  row: Row
  onOpen: () => void
  onPrepare: (row: Row) => void
  onAdvance: () => void
}) {
  const portal = webUrl(row.external_url)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${text(row.job_title)}`} className="text-muted-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onOpen}><Layers /> View details</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPrepare(row)}><Wand2 /> Prepare application</DropdownMenuItem>
        {canAdvance(row) && row.view === "preparation" && (
          <DropdownMenuItem onSelect={onAdvance}><ArrowRight /> Advance to next step</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><a href={boardHref(row)}><Columns3 /> Show on board</a></DropdownMenuItem>
        <DropdownMenuItem disabled={!portal} onSelect={() => void openExternal(row.external_url).catch(() => {})}>
          <ExternalLink /> Open portal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The card's main action: the contextual next step of the journey. */
function NextStepButton({ row, onPrepare }: { row: Row; onPrepare: (row: Row) => void }) {
  const step = nextStep(row)
  if (step.kind === "review")
    return <span className="truncate text-xs text-muted-foreground" title={step.label}>Needs review</span>
  if (step.kind === "board")
    return (
      <Button asChild variant="outline" size="sm" className="rounded-full">
        <a href={boardHref(row)}>{step.label} <ArrowUpRight className="size-3.5" /></a>
      </Button>
    )
  return (
    <Button size="sm" className="rounded-full" onClick={() => onPrepare(row)}>
      {step.label} <ArrowRight className="size-3.5" />
    </Button>
  )
}

/** An application as an `OpportunityCard`, the same layout as the Jobs cards. */
export function ApplicationOpportunityCard({ row, board, onOpen, onPrepare }: {
  row: Row
  board: BoardContext
  onOpen: () => void
  onPrepare: (row: Row) => void
}) {
  const advance = useAdvance(row)
  const title = text(row.job_title) || "Untitled role"
  const level = (row.deadline_level ?? "none") as DeadlineLevel
  const deadline = typeof row.deadline === "string" && row.deadline
    ? deadlineLabel(level, typeof row.deadline_days === "number" ? row.deadline_days : null) : ""
  const score = typeof row.keyword_score === "number" ? row.keyword_score : null
  const applied = shortDate(row.applied_at ?? row.submitted_at)
  return (
    <>
      <OpportunityCard
        company={row.company_name ? String(row.company_name) : undefined}
        title={title}
        badges={<>
          {row.origin && row.origin !== "unknown" && <CardBadge>{originLabel(row)}</CardBadge>}
          {score !== null && <CardBadge tone="primary" title="Keyword match of the tailored resume">Match {score}</CardBadge>}
          {row.view === "archived" && <CardBadge>Archived</CardBadge>}
          {!!row.review_reason && <CardBadge tone="warn" title={String(row.review_reason)}>Needs review</CardBadge>}
          {deadline && (
            <CardBadge tone={level === "overdue" ? "danger" : level === "soon" ? "warn" : "muted"} title={`Deadline ${row.deadline}`}>{deadline}</CardBadge>
          )}
        </>}
        score={<ApplicationProgress row={row} board={board} />}
        location={row.portal ? `${text(row.portal)} portal` : null}
        menu={<ApplicationMenu row={row} onOpen={onOpen} onPrepare={onPrepare} onAdvance={advance.ask} />}
        date={applied ? `Applied ${applied}` : "Not submitted"}
        action={<NextStepButton row={row} onPrepare={onPrepare} />}
        onOpen={onOpen}
      />
      {advance.dialog}
    </>
  )
}

function ViewTabs({ counts }: { counts: Record<ViewFilter, number> }) {
  const tab = (value: ViewFilter, label: string) => <CountTab key={value} value={value} label={label} count={counts[value]} />
  return (
    <CountTabsList label="Application views">
      {tab("all", "All")}
      {(Object.keys(VIEWS) as ApplicationView[]).map(key => tab(key, VIEWS[key].label))}
    </CountTabsList>
  )
}

const originOptions = (Object.keys(ORIGINS) as ApplicationOrigin[]).map(value => ({ value, label: ORIGINS[value] }))
const phaseOptions = (Object.keys(PHASE_LABELS) as JourneyPhase[]).map(value => ({ value, label: PHASE_LABELS[value] }))
const orderOptions = [{ value: "deadline", label: "Deadline first" }]

/**
 * Applications as tabs by journey view, one filter row and a card grid with
 * numbered pages, in the same layout as the Jobs board.
 */
export function ApplicationCards({ rows, board, onSelect, onPrepare }: {
  rows: Row[]
  board: BoardContext
  onSelect: (row: Row) => void
  onPrepare: (row: Row) => void
}) {
  const { search, update } = useWorkspaceState("applications")
  const [view, setView] = useState<ViewFilter>("all")
  const [origin, setOrigin] = useState("")
  const phase = search.status ?? ""
  const setPhase = (status: string) => update({ status })
  const [order, setOrder] = useState("")
  const query = search.q ?? ""
  const counts = countRows(rows)
  const all = view === "all" ? rows : rows.filter(row => (row.view ?? "preparation") === view)
  const filtered = all.filter(row =>
    matches(row, query)
    && (!origin || (row.origin ?? "unknown") === origin)
    && (!phase || (row.phase ?? "draft") === phase))
  const visible = order === "deadline" ? byDeadline(filtered) : filtered
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1)
  const page = Math.min(search.page ?? 0, lastPage)
  useEffect(() => { if ((search.page ?? 0) !== page) update({ page }) }, [search.page, page, update])
  const filter = (apply: () => void) => { apply(); update({ page: 0 }) }
  const narrowed = !!(query || origin || phase)
  return (
    <Tabs value={view} className="gap-5" onValueChange={next => filter(() => setView(next as ViewFilter))}>
      <div className="border-b">
        <ViewTabs counts={{ all: rows.length, ...counts.views }} />
      </div>
      <TabsContent value={view} className="space-y-4">
        <FilterBar>
          <FilterSearch value={query} placeholder="Role, company or portal" label="Search applications" onChange={q => update({ q, page: 0 })} />
          <FilterSelect icon={Route} label="Step" value={phase} options={phaseOptions} onChange={value => filter(() => setPhase(value))} />
          <FilterSelect icon={Layers} label="Origin" value={origin} options={originOptions} onChange={value => filter(() => setOrigin(value))} />
          <FilterSelect icon={ArrowUpDown} label="Sort" value={order} anyLabel="Most recent" options={orderOptions} onChange={value => filter(() => setOrder(value))} />
        </FilterBar>
        <p className="text-sm">
          <span className="font-medium">{view === "all" ? "Applications" : `${VIEWS[view].label} applications`}</span>
          <span className="text-muted-foreground"> · {visible.length}{narrowed ? ` of ${all.length}` : ""}</span>
          {view !== "all" && <span className="text-muted-foreground"> · {VIEWS[view].hint}</span>}
        </p>
        {!visible.length ? (
          <Empty
            title={all.length ? "No matching applications" : view === "all" ? "No applications yet" : `No ${VIEWS[view].label.toLowerCase()} applications`}
            description={all.length ? "Try a different search or filter."
              : <NextStepHint fallback="Prepare a shortlisted job, or register an application you already sent." />}
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => (
                <div key={String(row.id)} className="flex">
                  <ApplicationOpportunityCard row={row} board={board} onOpen={() => onSelect(row)} onPrepare={onPrepare} />
                </div>
              ))}
            </div>
            <RecordPagination current={page} lastPage={lastPage} onPage={next => update({ page: next })} />
          </>
        )}
      </TabsContent>
    </Tabs>
  )
}

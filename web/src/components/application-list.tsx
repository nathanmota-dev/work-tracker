import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Records, type Column } from "@/components/records"
import { JourneyCounts } from "@/components/journey-summary"
import { NextStepHint } from "@/components/get-started"
import { DeadlineBadge, DeadlineSort } from "@/components/deadline-badge"
import { byDeadline } from "@/lib/deadline"
import { Status, controlClass } from "@/components/workspace-ui"
import { text, date, type Row } from "@/lib/api"
import {
  ORIGINS,
  PHASE_LABELS,
  VIEWS,
  countRows,
  nextStep,
  type ApplicationOrigin,
  type ApplicationView,
  type JourneyPhase,
} from "@/lib/application-journey"

export function originLabel(row: Row) {
  return ORIGINS[row.origin as ApplicationOrigin] ?? ORIGINS.unknown
}
export function phaseLabel(value: unknown) {
  return PHASE_LABELS[value as JourneyPhase] ?? PHASE_LABELS.draft
}

/** Board view of Applications, scrolled to one card; archived records open on that tab. */
export function boardHref(row: Row) {
  return `#/applications?view=board${row.view === "archived" ? "&tab=archived" : ""}&highlight=${text(row.id)}`
}

/** Moves the application forward: its detail while preparing, the board once tracked. */
export function NextStepAction({
  row,
  onPrepare,
}: {
  row: Row
  onPrepare: (row: Row) => void
}) {
  const step = nextStep(row)
  if (step.kind === "review")
    return <span className="text-xs text-muted-foreground">{step.label}</span>
  if (step.kind === "board")
    return (
      <Button asChild size="sm" variant="outline">
        <a href={boardHref(row)}>{step.label}</a>
      </Button>
    )
  return (
    <Button size="sm" variant="outline" onClick={() => onPrepare(row)}>
      {step.label}
    </Button>
  )
}

function columns(onPrepare: (row: Row) => void): Column[] {
  return [
    {
      key: "job_title",
      label: "Role",
      render: (r) => (
        <div className="font-medium">
          {text(r.job_title)}
          <p className="mt-1 text-xs font-normal text-muted-foreground">
            {text(r.company_name)}
          </p>
        </div>
      ),
    },
    { key: "origin", label: "Origin", render: (r) => <Status value={originLabel(r)} /> },
    { key: "phase", label: "Step", render: (r) => <Status value={phaseLabel(r.phase)} /> },
    {
      key: "keyword_score",
      label: "Keyword score",
      render: (r) => (r.keyword_score == null ? "—" : `${r.keyword_score}%`),
    },
    { key: "deadline", label: "Deadline", render: (r) => <DeadlineBadge row={r} /> },
    { key: "portal", label: "Portal" },
    {
      key: "applied_at",
      label: "Applied",
      render: (r) => (r.applied_at ? date(r.applied_at) : "Not submitted"),
    },
    {
      key: "next",
      label: "Next step",
      render: (r) => <NextStepAction row={r} onPrepare={onPrepare} />,
    },
  ]
}

type ViewFilter = ApplicationView | "all"

/**
 * Manual and agent-prepared applications in one list, split by where they are
 * in the journey. Counts come from the same server-computed phase and view.
 */
export function ApplicationList({
  rows,
  onSelect,
  onPrepare,
}: {
  rows: Row[]
  onSelect: (row: Row) => void
  onPrepare: (row: Row) => void
}) {
  const [view, setView] = useState<ViewFilter>("all")
  const [origin, setOrigin] = useState("")
  const [byDue, setByDue] = useState(false)
  const counts = countRows(rows)
  const filtered = rows.filter(
    (row) =>
      (view === "all" || (row.view ?? "preparation") === view) &&
      (!origin || (row.origin ?? "unknown") === origin),
  )
  const visible = byDue ? byDeadline(filtered) : filtered
  return (
    <div className="space-y-4">
      <JourneyCounts phases={counts.phases} />
      <Tabs value={view} onValueChange={(value) => setView(value as ViewFilter)}>
        <TabsList aria-label="Application views">
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
          {(Object.keys(VIEWS) as ApplicationView[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {VIEWS[key].label} ({counts.views[key]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {view !== "all" && (
        <p className="text-sm text-muted-foreground">{VIEWS[view].hint}</p>
      )}
      <Records
        rows={visible}
        noun="Applications"
        workspace="applications"
        empty={<NextStepHint fallback="Prepare a shortlisted job, or register an application you already sent." />}
        statusKey="phase"
        onSelect={onSelect}
        columns={columns(onPrepare)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DeadlineSort active={byDue} onToggle={() => setByDue((value) => !value)} />
            <SelectControl
              aria-label="Filter by origin"
              className={controlClass}
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            >
              <option value="">All origins</option>
              {(Object.keys(ORIGINS) as ApplicationOrigin[]).map((key) => (
                <option key={key} value={key}>
                  {ORIGINS[key]}
                </option>
              ))}
            </SelectControl>
          </div>
        }
      />
    </div>
  )
}

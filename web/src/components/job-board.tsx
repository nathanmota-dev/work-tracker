import { useEffect, useState, type ReactNode } from "react"
import { ArrowUpDown, Gauge, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { OpportunityCardSkeleton } from "@/components/opportunity-card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { SelectionBar } from "@/components/selection-bar"
import { RecordPagination } from "@/components/records"
import { Empty } from "@/components/workspace-ui"
import { NextStepHint } from "@/components/get-started"
import { BatchCreatedNotice, BatchPreparation } from "@/components/batch-preparation"
import type { PreparationBatch } from "@/lib/preparation"
import { CheckRequirements } from "@/components/gate-filter"
import { RankRolesMenu, RankSelected, RankingRunSummary } from "@/components/job-ranking-action"
import { jobTone } from "@/components/job-card"
import { useWorkspaceState } from "@/lib/workspace-state"
import { filterJobs, orderOptions, scoreOptions, workTypeOptions, type JobOrder } from "@/lib/job-filters"
import type { Row } from "@/lib/api"

const PAGE_SIZE = 24
type View = "new" | "shortlist" | "archived"
export type CardSelection = { selected: boolean; toggle: () => void }

function JobTriage({ jobs, onMutate, onDone }: {
  jobs: Row[]; onMutate: (action: "shortlist" | "archive", row: Row) => Promise<boolean>; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function run(action: "shortlist" | "archive") {
    setBusy(true)
    try {
      for (const job of jobs) if (!await onMutate(action, job)) return
      onDone()
    }
    finally { setBusy(false) }
  }
  return <>
    <Button size="sm" disabled={busy || !jobs.length} onClick={() => void run("shortlist")}>Move to shortlist</Button>
    <Button size="sm" variant="ghost" disabled={busy || !jobs.length} onClick={() => void run("archive")}>Archive</Button>
  </>
}

function BulkActions({ view, jobs, onMutate, clear, onBatch }: {
  view: View; jobs: Row[]; onMutate: (action: "shortlist" | "archive", row: Row) => Promise<boolean>; clear: () => void
  onBatch: (batch: PreparationBatch) => void
}) {
  // Creating a batch clears the selection, which hides this bar; the board shows the result instead.
  const created = (batch: PreparationBatch) => { onBatch(batch); clear() }
  if (view === "archived") return <BatchPreparation jobs={jobs} onCreated={created} />
  return <>
    {view === "new" ? <JobTriage jobs={jobs} onMutate={onMutate} onDone={clear} /> : <BatchPreparation jobs={jobs} onCreated={created} />}
    <RankSelected jobs={jobs} />
    <CheckRequirements jobs={jobs} />
  </>
}

function ViewTabs({ counts }: { counts: Record<View, number> }) {
  const tab = (value: View, label: string) => (
    <TabsTrigger value={value} aria-label={`${label} (${counts[value]})`}
      className="-mb-px gap-1.5 rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
      {label}<span className="text-xs font-normal text-muted-foreground tabular-nums">{counts[value]}</span>
    </TabsTrigger>
  )
  return (
    <TabsList aria-label="Job archive filter" className="h-auto gap-6 rounded-none bg-transparent p-0">
      {tab("new", "New")}{tab("shortlist", "Shortlist")}{tab("archived", "Archived")}
    </TabsList>
  )
}

/** Jobs as tabs, one filter row, a card grid with numbered pages and a floating bar for the selection. */
export function JobBoard({ active, archived, renderCard, onMutate }: {
  active: Row[]
  archived: Row[]
  renderCard: (row: Row, selection: CardSelection) => ReactNode
  onMutate: (action: "shortlist" | "archive", row: Row) => Promise<boolean>
}) {
  const { search, update } = useWorkspaceState("jobs")
  const view = (search.view ?? "new") as View
  const [workType, setWorkType] = useState("")
  const [score, setScore] = useState("")
  const [order, setOrder] = useState<JobOrder>("saved")
  const [batch, setBatch] = useState<PreparationBatch>()
  const fresh = active.filter(row => !row.shortlisted_at)
  const shortlist = active.filter(row => !!row.shortlisted_at)
  const all = view === "archived" ? archived : view === "shortlist" ? shortlist : fresh
  const rows = filterJobs(all, { q: search.q ?? "", workType, score, order }, jobTone)
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)
  const page = Math.min(search.page ?? 0, lastPage)
  useEffect(() => { if ((search.page ?? 0) !== page) update({ page }) }, [search.page, page, update])
  const selection = new Set(search.selection ?? [])
  const chosen = all.filter(row => selection.has(String(row.id)))
  const setSelection = (ids: Set<string>) => update({ selection: [...ids] })
  const toggle = (row: Row) => {
    const next = new Set(selection)
    if (!next.delete(String(row.id))) next.add(String(row.id))
    setSelection(next)
  }
  const clear = () => setSelection(new Set())
  // Keep only roles of this tab: deleted or newly archived roles leave the selection.
  useEffect(() => {
    const ids = new Set(all.map(row => String(row.id)))
    const kept = (search.selection ?? []).filter(id => ids.has(id))
    if (kept.length !== (search.selection ?? []).length) update({ selection: kept })
  }, [all, search.selection, update])
  const filter = (apply: () => void) => { apply(); update({ page: 0 }) }
  const filtered = !!(search.q || workType || score)
  return (
    <Tabs value={view} className="gap-5" onValueChange={next => update({ view: next, page: 0, q: "", status: "", selected: "", selection: [] })}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <ViewTabs counts={{ new: fresh.length, shortlist: shortlist.length, archived: archived.length }} />
        {view !== "archived" && <div className="pb-2"><RankRolesMenu /></div>}
      </div>
      <TabsContent value={view} className="space-y-4">
        {view !== "archived" && <RankingRunSummary />}
        {batch && <p className="text-sm"><BatchCreatedNotice batch={batch} /></p>}
        <FilterBar>
          <FilterSearch value={search.q ?? ""} placeholder="Role, company or skill" label="Search opportunities" onChange={q => update({ q, page: 0 })} />
          <FilterSelect icon={Globe} label="Work type" value={workType} options={workTypeOptions} onChange={value => filter(() => setWorkType(value))} />
          <FilterSelect icon={Gauge} label="Score" value={score} options={scoreOptions} onChange={value => filter(() => setScore(value))} />
          <FilterSelect icon={ArrowUpDown} label="Sort" value={order === "saved" ? "" : order} anyLabel="Recently saved"
            options={orderOptions.filter(option => option.value !== "saved")} onChange={value => filter(() => setOrder((value || "saved") as JobOrder))} />
        </FilterBar>
        <p className="text-sm">
          <span className="font-medium">{view === "archived" ? "Archived opportunities" : "Opportunities"}</span>
          <span className="text-muted-foreground"> · {rows.length}{filtered ? ` of ${all.length}` : ""} roles</span>
        </p>
        {view === "archived" && (
          <p className="text-sm text-muted-foreground">Archived roles stay saved and are excluded from future shortlists. Restore a role before preparing a new application.</p>
        )}
        {!rows.length ? (
          <Empty
            title={all.length ? "No matching roles" : view === "archived" ? "No archived roles" : "No roles yet"}
            description={all.length ? "Try a different search or filter." : view === "archived" ? undefined
              : <NextStepHint fallback={view === "new" ? "Discover opportunities or add a job by hand to start your list." : "Move roles from New to build your shortlist."} />}
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => (
                <div key={String(row.id)} className="flex">
                  {renderCard(row, { selected: selection.has(String(row.id)), toggle: () => toggle(row) })}
                </div>
              ))}
            </div>
            <RecordPagination current={page} lastPage={lastPage} onPage={next => update({ page: next })} />
          </>
        )}
        <SelectionBar count={chosen.length} total={rows.length} onClear={clear}
          onSelectAll={() => setSelection(new Set([...selection, ...rows.map(row => String(row.id))]))}>
          <BulkActions view={view} jobs={chosen} onMutate={onMutate} clear={clear} onBatch={setBatch} />
        </SelectionBar>
      </TabsContent>
    </Tabs>
  )
}

/** The board's layout while jobs load: tabs, filter row and a grid of card placeholders. */
export function JobBoardSkeleton() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-5">
      <div className="flex items-end justify-between gap-3 border-b pb-2.5">
        <div className="flex gap-6">{[16, 20, 20].map((w, i) => <Skeleton key={i} className="h-4" style={{ width: `${w * 4}px` }} />)}</div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 min-w-56 flex-1 rounded-full" />
        {[28, 24, 24].map((w, i) => <Skeleton key={i} className="h-9 rounded-full" style={{ width: `${w * 4}px` }} />)}
      </div>
      <Skeleton className="h-4 w-44" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="flex"><OpportunityCardSkeleton /></div>)}
      </div>
      <span className="sr-only">Loading jobs…</span>
    </div>
  )
}

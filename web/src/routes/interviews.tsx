import { useState } from "react"
import { ArrowUpDown, Plus, Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { CountTab, CountTabsList } from "@/components/underline-tabs"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Empty, LoadState, Page } from "@/components/workspace-ui"
import { CardGrid, CountLine } from "@/components/entity-card"
import { InterviewForm } from "@/components/interview-form"
import { InterviewCard, InterviewSheet, NextInterview, interviewBucket, stageLabel, type InterviewAction } from "@/components/interview-card"
import { useApi, request, text, type Row } from "@/lib/api"

type View = "upcoming" | "past" | "closed"
const VIEWS: [View, string][] = [["upcoming", "Upcoming"], ["past", "Past"], ["closed", "Closed"]]
const time = (row: Row) => new Date(String(row.scheduled_at ?? "")).getTime() || Number.MAX_SAFE_INTEGER

function useInterviewActions(refresh: () => void) {
  const [editing, setEditing] = useState<Row | "new" | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [selected, setSelected] = useState<Row | null>(null)
  const [error, setError] = useState("")
  async function save(path: string, body: Row) {
    setError("")
    try { await request(`interviews/${path}`, body); refresh(); return true }
    catch (e) { setError((e as Error).message); return false }
  }
  function act(action: InterviewAction, row: Row) {
    if (action === "edit") { setSelected(null); setEditing(row) }
    else if (action === "delete") { setSelected(null); setDeleting(row) }
    else void save("update", { ...row, status: action })
  }
  async function remove(row: Row) { if (await save("delete", { id: row.id })) setDeleting(null) }
  return { editing, setEditing, deleting, setDeleting, selected, setSelected, error, act, remove }
}

function DeleteInterviewDialog({ row, onCancel, onConfirm }: { row: Row | null; onCancel: () => void; onConfirm: (row: Row) => void }) {
  return (
    <Dialog open={!!row} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete the {text(row?.company)} interview?</DialogTitle>
          <DialogDescription>This removes it from your calendar. Mark it as done or close the process instead to keep its history.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={() => row && onConfirm(row)}>Delete interview</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InterviewBoard({ rows, onOpen, onAction }: { rows: Row[]; onOpen: (row: Row) => void; onAction: (action: InterviewAction, row: Row) => void }) {
  const [view, setView] = useState<View>("upcoming")
  const [query, setQuery] = useState("")
  const [stage, setStage] = useState("")
  const [order, setOrder] = useState("")
  const counts = Object.fromEntries(VIEWS.map(([key]) => [key, rows.filter(row => interviewBucket(row) === key).length])) as Record<View, number>
  const all = rows.filter(row => interviewBucket(row) === view)
  const needle = query.toLowerCase()
  const shown = all
    .filter(row => !needle || [row.company, stageLabel(row.stage), row.notes].some(value => text(value).toLowerCase().includes(needle)))
    .filter(row => !stage || row.stage === stage)
    .sort((a, b) => order === "company" ? text(a.company).localeCompare(text(b.company)) : (view === "upcoming" ? 1 : -1) * (time(a) - time(b)))
  const stages = [...new Set(rows.map(row => String(row.stage ?? "")).filter(Boolean))].map(value => ({ value, label: stageLabel(value) }))
  return (
    <Tabs value={view} className="gap-5" onValueChange={next => setView(next as View)}>
      <div className="border-b">
        <CountTabsList label="Interview views">{VIEWS.map(([key, label]) => <CountTab key={key} value={key} label={label} count={counts[key]} />)}</CountTabsList>
      </div>
      <TabsContent value={view} className="space-y-4">
        <FilterBar>
          <FilterSearch value={query} placeholder="Company, stage or notes" label="Search interviews" onChange={setQuery} />
          <FilterSelect icon={Route} label="Stage" value={stage} options={stages} onChange={setStage} />
          <FilterSelect icon={ArrowUpDown} label="Sort" value={order} anyLabel={view === "upcoming" ? "Soonest first" : "Most recent"}
            options={[{ value: "company", label: "Company" }]} onChange={setOrder} />
        </FilterBar>
        <CountLine label={`${VIEWS.find(([key]) => key === view)![1]} interviews`} shown={shown.length} total={all.length} />
        {!shown.length ? (
          <Empty title={all.length ? "No matching interviews" : view === "upcoming" ? "A clear calendar" : `No ${view} interviews`}
            description={all.length ? "Try a different search or filter." : view === "upcoming" ? "Add an interview as soon as it is scheduled to prepare for it." : "Interviews move here once they happen or the process closes."} />
        ) : (
          <CardGrid>{shown.map(row => <InterviewCard key={String(row.id)} row={row} onOpen={() => onOpen(row)} onAction={onAction} />)}</CardGrid>
        )}
      </TabsContent>
    </Tabs>
  )
}

export function InterviewsPage() {
  const api = useApi<Row[]>("interviews")
  const actions = useInterviewActions(api.refresh)
  const next = (api.data ?? []).filter(row => interviewBucket(row) === "upcoming" && row.scheduled_at).sort((a, b) => time(a) - time(b))[0]
  return (
    <Page
      title="Interviews"
      description="Make space for the conversations that move you forward."
      actions={<Button size="sm" onClick={() => actions.setEditing("new")}><Plus /> Add interview</Button>}
    >
      <LoadState {...api} loading={api.loading && !api.data} retry={api.refresh} />
      {actions.error && <p role="alert" className="text-sm text-destructive">{actions.error}</p>}
      {next && <NextInterview row={next} onOpen={() => actions.setSelected(next)} />}
      {api.data && <InterviewBoard rows={api.data} onOpen={actions.setSelected} onAction={actions.act} />}
      <InterviewSheet row={actions.selected} onClose={() => actions.setSelected(null)} onAction={actions.act} />
      {actions.editing && (
        <InterviewForm interview={actions.editing === "new" ? undefined : actions.editing}
          onClose={() => actions.setEditing(null)} onSaved={() => { actions.setEditing(null); api.refresh() }} />
      )}
      <DeleteInterviewDialog row={actions.deleting} onCancel={() => actions.setDeleting(null)} onConfirm={row => void actions.remove(row)} />
    </Page>
  )
}

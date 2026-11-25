import { useState } from "react"
import { CircleDot, Clock, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { CardBadge, CardLinkButton, type CardBadgeTone } from "@/components/opportunity-card"
import { CardGrid, CardMeta, CountLine, DetailsSheet, EntityCard, FactList, humanize, relativeDay } from "@/components/entity-card"
import { RecordPagination } from "@/components/records"
import { Empty } from "@/components/workspace-ui"
import { NextStepHint } from "@/components/get-started"
import { date, openExternal, text, type Row } from "@/lib/api"

const PAGE_SIZE = 24
type View = "all" | "pending" | "accepted" | "replied"
const VIEWS: [View, string][] = [["all", "All"], ["pending", "Pending"], ["accepted", "Accepted"], ["replied", "Replied"]]
const inView = (row: Row, view: View) => view === "all" || (view === "replied" ? ["replied", "interviewing"].includes(String(row.status)) : row.status === view)
const TONES: Record<string, CardBadgeTone> = { accepted: "primary", replied: "primary", interviewing: "primary", pending: "muted" }

export const linkedinUrl = (row: Row) => row.username ? `https://www.linkedin.com/in/${encodeURIComponent(String(row.username))}/` : null
const open = (row: Row) => void openExternal(linkedinUrl(row)).catch(() => {})

function RecruiterCard({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const contacted = relativeDay(row.date_contacted)
  return (
    <EntityCard
      name={text(row.name)}
      eyebrow={row.company ? String(row.company) : undefined}
      title={text(row.name)}
      badges={<CardBadge tone={TONES[String(row.status)] ?? "muted"}>{humanize(row.status) || "Unknown"}</CardBadge>}
      meta={[
        row.location ? <CardMeta key="where" icon={MapPin}>{String(row.location)}</CardMeta> : null,
        contacted ? <CardMeta key="when" icon={Clock}>Contacted {contacted.toLowerCase()}</CardMeta> : null,
      ]}
      action={linkedinUrl(row) && <CardLinkButton label="LinkedIn" onClick={() => open(row)} />}
      onOpen={onOpen}
    >
      {row.title ? <p className="line-clamp-2 text-sm text-muted-foreground">{String(row.title)}</p> : undefined}
    </EntityCard>
  )
}

function RecruiterSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  return (
    <DetailsSheet
      open={!!row}
      title={text(row?.name)}
      description={row && [row.title, row.company].filter(Boolean).map(String).join(" · ")}
      onClose={onClose}
      actions={row && linkedinUrl(row) && <Button onClick={() => open(row)}>View LinkedIn</Button>}
    >
      {row && <FactList facts={[
        ["Company", row.company], ["Role", row.title], ["Location", row.location], ["Status", humanize(row.status)],
        ["Connection", row.degree], ["Contacted", row.date_contacted && date(row.date_contacted)],
        ["Accepted", row.accepted_at && date(row.accepted_at)], ["Replied", row.replied_at && date(row.replied_at)],
        ["Note", row.note], ["Found by", row.source_skill],
      ]} />}
    </DetailsSheet>
  )
}

/** Recruiters with a search, a status filter and a card grid, like the Jobs board. */
export function RecruiterBoard({ rows }: { rows: Row[] }) {
  const [view, setView] = useState<View>("all")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Row | null>(null)
  const all = rows.filter(row => inView(row, view))
  const needle = query.toLowerCase()
  const shown = all.filter(row => !needle || [row.name, row.company, row.title, row.location].some(value => text(value).toLowerCase().includes(needle)))
  const lastPage = Math.max(0, Math.ceil(shown.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  const options = VIEWS.filter(([key]) => key !== "all").map(([value, label]) => ({ value, label: `${label} · ${rows.filter(row => inView(row, value)).length}` }))
  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterSearch value={query} placeholder="Name, company or role" label="Search recruiters" onChange={q => { setQuery(q); setPage(0) }} />
        <FilterSelect icon={CircleDot} label="Status" anyLabel={`All · ${rows.length}`} value={view === "all" ? "" : view}
          options={options} onChange={value => { setView((value || "all") as View); setPage(0) }} />
      </FilterBar>
      <CountLine label={view === "all" ? "Recruiters" : `${VIEWS.find(([key]) => key === view)![1]} recruiters`} shown={shown.length} total={all.length} />
      {!shown.length ? (
        <Empty title={all.length ? "No matching recruiters" : "No recruiters yet"}
          description={all.length ? "Try a different search." : <NextStepHint fallback="Recruiters you reach out to will appear here." />} />
      ) : (
        <>
          <CardGrid>{shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <RecruiterCard key={String(row.id)} row={row} onOpen={() => setSelected(row)} />)}</CardGrid>
          <RecordPagination current={current} lastPage={lastPage} onPage={setPage} />
        </>
      )}
      <RecruiterSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

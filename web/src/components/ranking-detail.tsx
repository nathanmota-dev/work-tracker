import { useApi, date, type Row } from "@/lib/api"
import { TRIAGE_NOTE, rankingLabel } from "@/lib/ranking"

const DIMENSIONS = [["technical", "Technical"], ["experience", "Experience"], ["career", "Career alignment"]] as const

function Items({ title, items }: { title: string; items: unknown }) {
  const list = Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : []
  if (!list.length) return null
  // Agent-written text is rendered as plain text, never as HTML or Markdown.
  return <div><p className="font-medium">{title}</p><ul className="list-disc pl-5">{list.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
}

/** Triage result of one job: the three scores, strengths, honest gaps and when it was ranked. */
export function RankingDetail({ jobId }: { jobId: unknown }) {
  const rankings = useApi<Row[]>("rankings")
  const ranking = Array.isArray(rankings.data) ? rankings.data.find(row => Number(row.job_id) === Number(jobId)) : undefined
  if (!ranking) return null
  return (
    <section aria-label="Triage ranking" className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">Triage: {rankingLabel(ranking)}</p>
      {ranking.status === "scored" && (
        <dl className="grid grid-cols-3 gap-2">
          {DIMENSIONS.map(([key, label]) => (
            <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd>{String(ranking[key] ?? "—")}</dd></div>
          ))}
        </dl>
      )}
      <Items title="Strengths" items={ranking.strengths} />
      <Items title="Gaps" items={ranking.gaps} />
      {typeof ranking.last_error === "string" && ranking.last_error && <p>Last read: {ranking.last_error}</p>}
      {ranking.status === "gave_up" && <p>The posting could not be read after several attempts. It may still be live; check it manually.</p>}
      {typeof ranking.ranked_at === "string" && <p className="text-xs text-muted-foreground">Ranked {date(ranking.ranked_at)}</p>}
      <p className="text-xs text-muted-foreground">{TRIAGE_NOTE}</p>
    </section>
  )
}

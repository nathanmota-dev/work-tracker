import type { Row } from "@/lib/api"

/** Shown wherever triage scores appear: they never replace Apply's evaluation. */
export const TRIAGE_NOTE = "Triage score from the posting text only. Apply re-evaluates the role before drafting anything."

export type RankingCandidates = {
  limit: number
  all: boolean
  items: Row[]
  eligible: number
  deferred: number
  expired: number
  already_ranked: number
  gate_failed?: Row[]
}

/** Ranking state of a job as text; color is never the only signal. */
export function rankingLabel(row: Row): string | null {
  const status = row.ranking_status ?? row.status
  if (status === "scored" && typeof (row.ranking_overall ?? row.overall) === "number")
    return `${row.ranking_overall ?? row.overall} · ${sentence(String(row.ranking_verdict ?? row.verdict ?? ""))}`
  if (status === "expired") return (row.ranking_expired_reason ?? row.expired_reason) === "deadline" ? "Expired (deadline passed)" : "Expired"
  if (status === "unreachable") return `Unreachable (attempt ${Number(row.ranking_attempts ?? row.fetch_attempts) || 1})`
  if (status === "gave_up") return "Check manually"
  return null
}

/** "Strong Fit" reads as "Strong fit" in running text. */
function sentence(verdict: string) {
  return verdict.charAt(0) + verdict.slice(1).toLowerCase()
}

function score(row: Row) {
  return row.ranking_status === "scored" && typeof row.ranking_overall === "number" ? row.ranking_overall : -1
}

/** Highest score first; a deadline within 7 days wins ties. Unscored rows keep their order after. */
export function byScore(rows: Row[]): Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => score(b.row) - score(a.row) || Number(!!b.row.closing_soon) - Number(!!a.row.closing_soon) || a.index - b.index)
    .map(item => item.row)
}

export function candidatesPath(options: { jobIds?: unknown[]; all?: boolean }) {
  const query = [
    ...(options.all ? ["all=true"] : []),
    ...(options.jobIds?.length ? [`job_ids=${options.jobIds.map(Number).join(",")}`] : []),
  ]
  return `rankings/candidates${query.length ? `?${query.join("&")}` : ""}`
}

/** What a run will do, said before it starts. */
export function previewText(preview: RankingCandidates) {
  const skipped = [
    preview.already_ranked ? `${preview.already_ranked} already ranked` : "",
    preview.expired ? `${preview.expired} expired by deadline` : "",
    preview.gate_failed?.length ? `${preview.gate_failed.length} failed deal-breakers` : "",
  ].filter(Boolean).join(", ")
  const plan = preview.items.length
    ? `${preview.items.length} ${preview.items.length === 1 ? "role" : "roles"} will be ranked, ${preview.deferred} deferred.`
    : "Nothing new to rank."
  return skipped ? `${plan} Skipped: ${skipped}.` : plan
}

export type RankingRun = { jobIds: number[]; deferred: number; expired: number; startedAt: string }

/** Summary of a finished run from the rankings it stored after it started. */
export function runSummary(run: RankingRun, rankings: Row[]) {
  const ids = new Set(run.jobIds)
  const stored = rankings.filter(row => ids.has(Number(row.job_id)) && typeof row.ranked_at === "string" && row.ranked_at >= run.startedAt)
  const count = (...statuses: string[]) => stored.filter(row => statuses.includes(String(row.status))).length
  const unreachable = count("unreachable", "gave_up")
  const again = run.deferred > 0 || unreachable > 0 ? " Run again to continue." : ""
  return `Ranked ${count("scored")} · ${unreachable} unreachable · ${count("expired") + run.expired} expired · ${run.deferred} deferred.${again}`
}

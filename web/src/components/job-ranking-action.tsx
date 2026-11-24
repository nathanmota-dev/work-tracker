import { useEffect, useState } from "react"
import { ScoreBadge } from "@/components/score-badge"
import { verdictTone } from "@/lib/ats"
import { Button } from "@/components/ui/button"
import { request, type Row } from "@/lib/api"
import { prepareSkill, useAgent } from "@/lib/agent"
import {
  TRIAGE_NOTE, candidatesPath, previewText, rankingLabel, runSummary,
  type RankingCandidates, type RankingRun,
} from "@/lib/ranking"

// Kept outside React so the summary still appears after leaving and reopening Jobs.
let pendingRun: RankingRun | null = null
let summarized = -1
let lastSummary = ""

/** Score, verdict or retry state of a job, with the closing-soon marker as text. */
export function RankingScore({ row }: { row: Row }) {
  const label = rankingLabel(row)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label ? <ScoreBadge tone={row.ranking_status === "scored" ? verdictTone(row.ranking_verdict) : "none"} title={TRIAGE_NOTE}>{label}</ScoreBadge> : <span>—</span>}
      {!!row.closing_soon && <span className="whitespace-nowrap text-xs" title="Deadline within 7 days">🔥 Closing soon</span>}
    </div>
  )
}

/** Previews the run, then opens the triage skill in the agent panel; the page stays usable. */
function useRankingLaunch() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  async function launch(options: { jobIds?: unknown[]; all?: boolean }) {
    setBusy(true)
    setNotice("")
    try {
      const preview = await request<RankingCandidates>(candidatesPath(options))
      setNotice(previewText(preview))
      if (!preview.items.length) return
      pendingRun = { jobIds: preview.items.map(item => Number(item.job_id)), deferred: preview.deferred, expired: preview.expired, startedAt: new Date().toISOString() }
      prepareSkill("job-ranking", {
        jobIds: options.jobIds?.length ? options.jobIds.map(Number).join(",") : "",
        ...(options.all ? { all: "true" } : {}),
      })
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, notice, launch }
}

function Notice({ text }: { text: string }) {
  return text ? <span role="status" aria-label="Ranking plan" className="text-sm">{text}</span> : null
}

/** "Rank selected" in the multi-selection of New and Shortlist. */
export function RankSelected({ jobs }: { jobs: Row[] }) {
  const { busy, notice, launch } = useRankingLaunch()
  return <>
    <Button size="sm" variant="outline" disabled={busy || !jobs.length} onClick={() => void launch({ jobIds: jobs.map(job => job.id) })}>Rank selected</Button>
    <Notice text={notice} />
  </>
}

/** Top of New: rank the roles that still need triage, or re-rank everything after a profile change. */
export function RankNewRoles() {
  const { busy, notice, launch } = useRankingLaunch()
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2" title={TRIAGE_NOTE}>
      <Notice text={notice} />
      <Button size="sm" disabled={busy} onClick={() => void launch({})}>Rank new roles</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void launch({ all: true })}>Rank all again</Button>
    </div>
  )
}

/** "Ranked N · X unreachable · Y expired · Z deferred" once a triage run completes. */
export function RankingRunSummary() {
  const { completion } = useAgent()
  const [summary, setSummary] = useState(lastSummary)
  useEffect(() => {
    if (!completion || completion.skill !== "job-ranking" || completion.id === summarized || !pendingRun) return
    summarized = completion.id
    const run = pendingRun
    let active = true
    request<Row[]>("rankings").then(rankings => {
      lastSummary = runSummary(run, Array.isArray(rankings) ? rankings : [])
      if (active) setSummary(lastSummary)
    }, () => {})
    return () => { active = false }
  }, [completion])
  return summary ? <p role="status" aria-label="Ranking summary" className="mb-4 text-sm">{summary}</p> : null
}

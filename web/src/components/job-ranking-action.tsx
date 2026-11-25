import { useEffect, useState } from "react"
import { ChevronDown, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { request, type Row } from "@/lib/api"
import { prepareSkill, useAgent } from "@/lib/agent"
import {
  TRIAGE_NOTE, candidatesPath, previewText, runSummary,
  type RankingCandidates, type RankingRun,
} from "@/lib/ranking"

// Kept outside React so the summary still appears after leaving and reopening Jobs.
let pendingRun: RankingRun | null = null
let summarized = -1
let lastSummary = ""

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
    <Button size="sm" variant="ghost" aria-label="Rank selected" disabled={busy || !jobs.length} onClick={() => void launch({ jobIds: jobs.map(job => job.id) })}>Rank</Button>
    <Notice text={notice} />
  </>
}

/** Rank the roles that still need triage, or re-rank everything after a profile change. */
export function RankRolesMenu() {
  const { busy, notice, launch } = useRankingLaunch()
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" title={TRIAGE_NOTE}>
      <Notice text={notice} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            <Gauge /> Rank roles <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void launch({})}>Rank new roles</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void launch({ all: true })}>Rank all again</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

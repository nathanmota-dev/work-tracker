import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/workspace-ui"
import { SearchFilters } from "@/routes/search"
import { useWorkspaceState } from "@/lib/workspace-state"
import { prepareSkill, useAgent } from "@/lib/agent"
import { request, text } from "@/lib/api"
import { structuredSearchRows, type SearchSaveResult } from "../../../src/jobs/search-results"

let shownCompletion: number | undefined

export function JobDiscovery({ onResults }: { onResults: (ids: number[]) => void }) {
  const { search, update } = useWorkspaceState("jobs")
  const agent = useAgent()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [outcomes, setOutcomes] = useState<SearchSaveResult[]>([])
  const [output, setOutput] = useState("")
  const form = useRef<HTMLFormElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const onComplete = useRef(onResults)
  onComplete.current = onResults
  const values = { keywords: search.keywords ?? "", location: search.location ?? "", company: "", workType: search.workType ?? "", maxPages: search.maxPages ?? 1 }
  useEffect(() => {
    if (search.focus) form.current?.querySelector("input")?.focus()
  }, [search.focus])
  useEffect(() => {
    const completion = agent.completion
    if (!completion || completion.skill !== "job-scout" || completion.id === shownCompletion) return
    shownCompletion = completion.id
    const outcomes = agent.jobOutcomes
    setOutcomes(outcomes)
    onComplete.current(outcomes.filter(item => item.status === "saved" && !item.job?.archived_at).map(item => Number(item.job?.id)))
  }, [agent.completion, agent.jobOutcomes])

  async function discover() {
    setError(""); setOutcomes([]); setOutput("")
    if (search.assess) {
      prepareSkill("job-scout", { query: values.keywords.trim(), location: values.location,
        extra: `Work arrangement: ${values.workType || "any"}. Pages to search: ${values.maxPages}. Save discovered jobs for triage and report saved, already saved, or failed for each item.` })
      return
    }
    setBusy(true)
    try {
      const result = await request("search/jobs", { ...values, keywords: values.keywords.trim() })
      const rows = structuredSearchRows(result)
      if (!rows.length) setOutput(`No savable results. ${typeof result === "string" ? result : JSON.stringify(result)}`)
      const results: SearchSaveResult[] = []
      for (let offset = 0; offset < rows.length; offset += 500) {
        const response = await request<{ results: SearchSaveResult[] }>("jobs/save-search", {
          items: rows.slice(offset, offset + 500).map((result, index) => ({ key: String(offset + index), result })),
        })
        results.push(...response.results)
        setOutcomes([...results])
      }
      if (mounted.current) onResults(results.filter(item => item.status === "saved").map(item => Number(item.job?.id)))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <Panel title="Discover opportunities">
    <form ref={form} className="space-y-4" onSubmit={event => { event.preventDefault(); void discover() }}>
      <SearchFilters kind="jobs" values={values} busy={busy} set={(key, value) => update({ [key]: value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!search.assess} disabled={busy}
        onChange={event => update({ assess: event.target.checked })} />Assess fit with agent</label>
      <Button disabled={busy || !values.keywords.trim()}>{busy ? "Searching LinkedIn…" : search.assess ? "Search with agent" : "Search LinkedIn"}</Button>
    </form>
    {error && <p role="alert">{error}</p>}
    {output && <p role="status" className="mt-3 whitespace-pre-wrap text-sm">{output}</p>}
    {!!outcomes.length && <div className="mt-3 text-sm">
      <p role="status">{outcomes.filter(r => r.status === "saved").length} saved · {outcomes.filter(r => r.status === "existing").length} already saved · {outcomes.filter(r => r.status === "failed").length} failed</p>
      <ul>{outcomes.map((item, index) => <li key={`${item.key}:${index}`}>
        {item.job ? `${text(item.job.title)}: ${item.status === "existing" ? "Already saved" : "Saved"}${item.job.archived_at ? " (archived)" : ""}` : `Result ${index + 1}: Failed — ${item.error}`}
      </li>)}</ul>
    </div>}
  </Panel>
}

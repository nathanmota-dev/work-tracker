import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, Panel, controlClass } from "@/components/workspace-ui"
import { Textarea } from "@/components/ui/textarea"
import { useSkillInputs } from "@/lib/skill-inputs"
import { SetupNotice } from "@/components/get-started"
import { SearchFilters } from "@/routes/search"
import { useWorkspaceState } from "@/lib/workspace-state"
import { prepareSkill, useAgent } from "@/lib/agent"
import { request, text } from "@/lib/api"
import { structuredSearchRows, type SearchSaveResult } from "../../../src/jobs/search-results"

let shownCompletion: number | undefined

/** "2 saved · 1 already saved · 0 failed" and each item's outcome, after a search saved its results. */
export function SearchOutcomes({ outcomes, onDismiss }: { outcomes: SearchSaveResult[]; onDismiss?: () => void }) {
  if (!outcomes.length) return null
  const count = (status: SearchSaveResult["status"]) => outcomes.filter(r => r.status === status).length
  return <div className="rounded-xl border bg-card px-4 py-3 text-sm">
    <div className="flex items-center justify-between gap-3">
      <p role="status" className="font-medium">{count("saved")} saved · {count("existing")} already saved · {count("failed")} failed</p>
      {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}
    </div>
    <ul className="mt-2 space-y-0.5 text-muted-foreground">{outcomes.map((item, index) => <li key={`${item.key}:${index}`}>
      {item.job ? `${text(item.job.title)}: ${item.status === "existing" ? "Already saved" : "Saved"}${item.job.archived_at ? " (archived)" : ""}` : `Result ${index + 1}: Failed — ${item.error}`}
    </li>)}</ul>
  </div>
}

/** Search criteria; `onResults` runs once a search saved its results, with the new job IDs and every outcome. */
export function JobDiscovery({ onResults }: { onResults: (ids: number[], outcomes: SearchSaveResult[]) => void }) {
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
  // Criteria persist with the job search skill, so the agent panel and this form show the same values.
  const { inputs, setInputs } = useSkillInputs("job-scout")
  const values = { keywords: inputs.query ?? "", location: inputs.location ?? "", company: "", workType: inputs.workType ?? "", maxPages: Math.min(10, Math.max(1, Number(inputs.maxPages) || 1)) }
  const setValue = (key: string, value: unknown) => {
    const field = key === "keywords" ? "query" : key
    if (["query", "location", "workType", "maxPages"].includes(field)) setInputs({ [field]: String(value ?? "") })
  }
  // Old Search links carried the criteria in the URL; keep them once, then the saved inputs take over.
  useEffect(() => {
    if (!search.keywords && !search.location) return
    setInputs({ ...(search.keywords && { query: search.keywords }), ...(search.location && { location: search.location }),
      ...(search.workType && { workType: search.workType }), ...(search.maxPages && search.maxPages > 1 && { maxPages: String(search.maxPages) }) })
    update({ keywords: "", location: "", workType: "", maxPages: 1 })
  }, [search.keywords, search.location, search.workType, search.maxPages, setInputs, update])
  useEffect(() => {
    if (search.focus) form.current?.querySelector("input")?.focus()
  }, [search.focus])
  useEffect(() => {
    const completion = agent.completion
    if (!completion || completion.skill !== "job-scout" || completion.id === shownCompletion) return
    shownCompletion = completion.id
    const outcomes = agent.jobOutcomes
    setOutcomes(outcomes)
    onComplete.current(outcomes.filter(item => item.status === "saved" && !item.job?.archived_at).map(item => Number(item.job?.id)), outcomes)
  }, [agent.completion, agent.jobOutcomes])

  async function discover() {
    setError(""); setOutcomes([]); setOutput("")
    if (search.assess) {
      prepareSkill("job-scout", {
        instructions: `Work arrangement: ${values.workType || "any"}. Pages to search: ${values.maxPages}. Save discovered jobs for triage and report saved, already saved, or failed for each item.` })
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
      // Without savable rows the explanation stays here instead of returning to the list.
      if (mounted.current && rows.length) onResults(results.filter(item => item.status === "saved").map(item => Number(item.job?.id)), results)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <Panel title="Search criteria">
    <form ref={form} className="space-y-4" onSubmit={event => { event.preventDefault(); void discover() }}>
      <SearchFilters kind="jobs" values={values} busy={busy} set={setValue} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!search.assess} disabled={busy}
        onChange={event => update({ assess: event.target.checked })} />Assess fit with agent</label>
      {search.assess && <Field label="Additional context">
        <Textarea className={`${controlClass} h-28 resize-y py-2`} placeholder="What should the agent know?" disabled={busy}
          value={inputs.extra ?? ""} onChange={event => setInputs({ extra: event.target.value })} />
      </Field>}
      <Button disabled={busy || !values.keywords.trim()}>{busy ? "Searching LinkedIn…" : search.assess ? "Search with agent" : "Search LinkedIn"}</Button>
    </form>
    <div className="mt-3">
      {error ? <SetupNotice step="connect">LinkedIn search needs a tested LinkedIn MCP.</SetupNotice>
        : <SetupNotice step="connect" pendingOnly>LinkedIn search and agent assessment need your agent and the LinkedIn MCP. You can still add jobs by hand.</SetupNotice>}
    </div>
    {error && <p role="alert">{error}</p>}
    {output && <p role="status" className="mt-3 whitespace-pre-wrap text-sm">{output}</p>}
    {!!outcomes.length && <div className="mt-3"><SearchOutcomes outcomes={outcomes} /></div>}
  </Panel>
}

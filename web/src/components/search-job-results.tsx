import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Details, ExternalLink } from "@/components/workspace-ui"
import { MultiSelectRecords } from "@/components/multi-select-records"
import { request, text, type Row } from "@/lib/api"
import { normalizeSearchJob, type SearchSaveResult } from "../../../src/jobs/search-results"

function useSearchSave() {
  const [busy, setBusy] = useState(false)
  const [outcomes, setOutcomes] = useState<Record<string, SearchSaveResult>>({})
  async function save(rows: Row[]) {
    setBusy(true)
    const items = rows.map(row => ({ key: String(row.search_key), result: row.search_result }))
    let results: SearchSaveResult[]
    try {
      const response = await request<{ results: SearchSaveResult[] }>("jobs/save-search", { items })
      results = response.results
    } catch (error) {
      results = items.map(item => ({ key: item.key, status: "failed", error: (error as Error).message }))
    }
    setOutcomes(previous => ({ ...previous, ...Object.fromEntries(results.map(result => [result.key, result])) }))
    setBusy(false)
  }
  return { busy, outcomes, save }
}

function SaveOutcome({ outcome, onView }: { outcome?: SearchSaveResult; onView: (job: Row) => void }) {
  if (!outcome) return null
  return <div className="space-y-1 text-xs">
    <p role={outcome.status === "failed" ? "alert" : "status"}>
      {outcome.status === "failed" ? `Failed: ${outcome.error}` : outcome.status === "existing" ? "Already saved" : "Saved"}
    </p>
    {outcome.job && <Button size="sm" variant="link" onClick={() => onView(outcome.job!)}>
      View saved job #{outcome.job.id}
    </Button>}
  </div>
}

export function SearchJobResults({ results, onSelect }: { results: unknown[]; onSelect: (row: Row) => void }) {
  const { busy, outcomes, save } = useSearchSave()
  const [savedJob, setSavedJob] = useState<Row | null>(null)
  const rows: Row[] = results.map((result, index) => {
    const raw = result && typeof result === "object" && !Array.isArray(result) ? result as Row : { raw: result }
    const normalized = normalizeSearchJob(result)
    return { ...raw, ...normalized.job, title: normalized.job?.title ?? raw.title ?? raw.job_title ?? "Unrecognized result",
      search_key: String(index), search_result: result, savable: !!normalized.job, save_error: normalized.error }
  })
  const all = Object.values(outcomes)
  return <>
    {all.length > 0 && <p role="status" className="text-sm">
      {all.filter(r => r.status === "saved").length} saved · {all.filter(r => r.status === "existing").length} already saved · {all.filter(r => r.status === "failed").length} failed
    </p>}
    <MultiSelectRecords
      noun="Search results" rows={rows} busy={busy} rowKey={row => String(row.search_key)}
      selectAllLabel="Select all savable results"
      rowLabel={row => text(row.title)} canSelect={row => row.savable === true}
      onSelect={row => {
        const raw = row.search_result && typeof row.search_result === "object" ? row.search_result as Row : { raw: row.search_result }
        onSelect({ ...raw, ...normalizeSearchJob(row.search_result).job })
      }}
      action={selected => <Button size="sm" disabled={busy || !selected.length}
        onClick={() => void save(selected)}>{busy ? "Saving…" : "Save selected"}</Button>}
      columns={[
        { key: "title", label: "Role" },
        { key: "company_name", label: "Company", render: row => text(row.company_name ?? row.company) },
        { key: "location", label: "Location" },
        { key: "save", label: "Save", render: row => <div className="space-y-2">
          {row.savable ? <Button size="sm" variant="outline" disabled={busy}
            aria-label={`Save ${text(row.title)}`} onClick={() => void save([row])}>Save job</Button>
            : <><p className="text-xs">Not savable — open manually. {text(row.save_error)}</p>
              <ExternalLink value={row.link ?? row.url ?? row.job_url} label="Open manually" /></>}
          <SaveOutcome outcome={outcomes[String(row.search_key)]} onView={setSavedJob} />
        </div> },
      ]}
    />
    <Details row={savedJob} title={text(savedJob?.title)} onClose={() => setSavedJob(null)}>
      <ExternalLink value={savedJob?.link} label="View opportunity" />
    </Details>
  </>
}

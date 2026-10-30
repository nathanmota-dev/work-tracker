import type React from "react"
import { Button } from "@/components/ui/button"
import { Empty, ExternalLink, Panel } from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { request, text, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
import { extractSearchRows, structuredSearchRows } from "../../../src/jobs/search-results"
import { SearchJobResults } from "@/components/search-job-results"

// MCP servers may return structuredContent, text content blocks, or raw arrays.
export function searchRows(raw: unknown): Row[] {
  return structuredSearchRows(raw).filter((row): row is Row =>
    !!row && typeof row === "object" && !Array.isArray(row))
}
function readable(raw: unknown): string {
  if (raw && typeof raw === "object" && typeof (raw as Row).raw === "string") return (raw as Row).raw as string
  if (raw && typeof raw === "object" && Array.isArray((raw as Row).content))
    return ((raw as Row).content as Row[]).map((r) => text(r.text)).join("\n\n")
  return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)
}
export type SearchKind = "jobs" | "people"
export type SearchValues = {
  keywords: string
  location: string
  company: string
  workType: string
  maxPages: number
}
export const initialValues: SearchValues = {
  keywords: "",
  location: "",
  company: "",
  workType: "",
  maxPages: 1,
}
const peopleColumns: Column[] = [
  {
    key: "name",
    label: "Name",
    render: (r) => text(r.name ?? r.full_name),
  },
  {
    key: "title",
    label: "Headline",
    render: (r) => text(r.headline ?? r.title),
  },
  { key: "location", label: "Location" },
  
]

export function SearchResults({
  kind,
  result,
  onSelect,
}: {
  kind: SearchKind
  result: unknown
  onSelect: (row: Row) => void
}) {
  const rows = searchRows(result)
  const jobRows = kind === "jobs" ? structuredSearchRows(result) : []
  const output = extractSearchRows(result) ? "" : readable(result)
  if (jobRows.length) return <SearchJobResults results={jobRows} onSelect={onSelect} />
  return (
    rows.length ? (
      <Records
        workspace="search"
        rows={rows.map((row, index) => ({ ...row, search_key: String(index) }))}
        noun="Search results"
        onSelect={onSelect}
        columns={peopleColumns}
      />
    ) : (
      <Panel title="Search results">
        {output && !["[]", "{}", "null"].includes(output) ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {kind === "jobs" && <p className="mb-3 font-medium">Not savable — open manually. Search returned text without structured job fields.</p>}
            <div>{output}</div>
          </div>
        ) : (
          <Empty
            title="No results found"
            description="Try broader keywords or a different location."
          />
        )}
      </Panel>
    )
  )
}

export function ResultActions({
  kind,
  selected,
  setSelected,
  detailBusy,
  setDetailBusy,
}: {
  kind: SearchKind
  selected: Row | null
  setSelected: React.Dispatch<React.SetStateAction<Row | null>>
  detailBusy: boolean
  setDetailBusy: (busy: boolean) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ExternalLink
        value={
          selected?.url ??
          selected?.link ??
          selected?.profile_url ??
          selected?.job_url
        }
      />
      {kind === "jobs" && (
        <>
          <Button
            variant="outline"
            disabled={
              detailBusy ||
              !(
                selected?.job_id ??
                selected?.id ??
                selected?.linkedin_job_id
              )
            }
            onClick={async () => {
              setDetailBusy(true)
              try {
                const details = await request("search/job-details", {
                  jobId: String(
                    selected?.job_id ??
                      selected?.id ??
                      selected?.linkedin_job_id,
                  ),
                })
                setSelected((r) =>
                  r?.search_key === selected?.search_key ? { ...r, description: readable(details) } : r,
                )
              } catch (e) {
                setSelected((r) =>
                  r?.search_key === selected?.search_key ? { ...r, error: (e as Error).message } : r,
                )
              } finally {
                setDetailBusy(false)
              }
            }}
          >
            {detailBusy ? "Loading…" : "Full details"}
          </Button>
          <Button
            onClick={() => {
              setSelected(null)
              prepareSkill("deep-scout", {
                query: text(
                  selected?.url ??
                    selected?.link ??
                    selected?.job_url ??
                    selected?.title,
                ),
              })
            }}
          >
            Assess fit with agent
          </Button>
        </>
      )}
    </div>
  )
}

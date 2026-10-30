import { Empty, ExternalLink, Panel } from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { text, type Row } from "@/lib/api"
import { extractSearchRows, structuredSearchRows } from "../../../src/jobs/search-results"

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
  result,
  onSelect,
}: {
  result: unknown
  onSelect: (row: Row) => void
}) {
  const rows = searchRows(result)
  const output = extractSearchRows(result) ? "" : readable(result)
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

export function ResultActions({ selected }: { selected: Row | null }) {
  return <ExternalLink value={selected?.url ?? selected?.link ?? selected?.profile_url} />
}

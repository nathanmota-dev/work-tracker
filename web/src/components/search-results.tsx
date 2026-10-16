import type React from "react"
import { Button } from "@/components/ui/button"
import { Empty, ExternalLink, Panel } from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { request, text, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"

// MCP servers may return structuredContent, text content blocks, or raw arrays.
export function searchRows(raw: unknown): Row[] {
  if (Array.isArray(raw))
    return raw.filter((x): x is Row => !!x && typeof x === "object")
  if (!raw || typeof raw !== "object") return []
  const data = raw as Row
  for (const key of [
    "structuredContent",
    "jobs",
    "people",
    "results",
    "data",
    "items",
    "elements",
  ]) {
    if (data[key]) {
      const rows = searchRows(data[key])
      if (rows.length) return rows
    }
  }
  if (Array.isArray(data.content))
    for (const item of data.content as Row[]) {
      if (typeof item.text === "string") {
        try {
          const rows = searchRows(JSON.parse(item.text))
          if (rows.length) return rows
        } catch {
          /* display readable raw output below */
        }
      }
    }
  return []
}
function readable(raw: unknown): string {
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
const searchColumns: Record<SearchKind, Column[]> = {
  jobs: [
  {
    key: "title",
    label: "Role",
    render: (r) => text(r.title ?? r.job_title),
  },
  {
    key: "company",
    label: "Company",
    render: (r) => text(r.company_name ?? r.company),
  },
  { key: "location", label: "Location" },
  
  ],
  people: [
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
  
  ],
}

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
  return (
    rows.length ? (
      <Records
        rows={rows}
        noun="Search results"
        onSelect={onSelect}
        columns={searchColumns[kind]}
      />
    ) : (
      <Panel title="Search results">
        {readable(result) &&
        !["[]", "{}", "null"].includes(readable(result)) ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {readable(result)}
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
                  r ? { ...r, description: readable(details) } : null,
                )
              } catch (e) {
                setSelected((r) =>
                  r ? { ...r, error: (e as Error).message } : null,
                )
              } finally {
                setDetailBusy(false)
              }
            }}
          >
            {detailBusy ? "Loading…" : "Full details"}
          </Button>
          <Button
            onClick={() =>
              prepareSkill("deep-scout", {
                query: text(
                  selected?.url ??
                    selected?.link ??
                    selected?.job_url ??
                    selected?.title,
                ),
              })
            }
          >
            Assess & save with agent
          </Button>
        </>
      )}
    </div>
  )
}

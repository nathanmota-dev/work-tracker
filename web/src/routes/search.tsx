import { SelectControl } from "@/components/ui/select-control"
import { useState } from "react"
import { Search as SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Page,
  Panel,
  Field,
  controlClass,
  Empty,
  Records,
  Details,
  ExternalLink,
} from "@/components/workspace-ui"
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
export function SearchPage() {
  const [kind, setKind] = useState("jobs")
  const [keywords, setKeywords] = useState("")
  const [location, setLocation] = useState("")
  const [company, setCompany] = useState("")
  const [workType, setWorkType] = useState("")
  const [maxPages, setMaxPages] = useState(1)
  const [result, setResult] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Row | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  async function search() {
    setBusy(true)
    setError("")
    setResult(undefined)
    try {
      setResult(
        await request(`search/${kind}`, {
          keywords: keywords.trim(),
          location,
          ...(kind === "jobs" ? { workType, maxPages } : { company }),
        }),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const rows = searchRows(result)
  return (
    <Page
      title="Search"
      description="Find the roles and people that fit your direction."
    >
      <Panel title="Explore LinkedIn">
        <div className="mb-5 flex gap-2">
          {["jobs", "people"].map((key) => (
            <Button
              key={key}
              size="sm"
              variant={kind === key ? "default" : "outline"}
              disabled={busy}
              aria-pressed={kind === key}
              onClick={() => {
                setKind(key)
                setResult(undefined)
                setError("")
              }}
            >
              {key === "jobs" ? "Opportunities" : "People & recruiters"}
            </Button>
          ))}
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Keywords">
              <Input
                required
                placeholder={
                  kind === "jobs"
                    ? "Product engineer, React…"
                    : "Technical recruiter…"
                }
                value={keywords}
                disabled={busy}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </Field>
            <Field label="Location">
              <Input
                placeholder="City, country or region"
                value={location}
                disabled={busy}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
            {kind === "people" ? (
              <Field label="Company">
                <Input
                  value={company}
                  disabled={busy}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Target company"
                />
              </Field>
            ) : (
              <>
                <Field label="Work arrangement">
                  <SelectControl
                    className={controlClass}
                    value={workType}
                    disabled={busy}
                    onChange={(e) => setWorkType(e.target.value)}
                  >
                    <option value="">Any arrangement</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="on-site">On-site</option>
                  </SelectControl>
                </Field>
                <Field label="Pages to search">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxPages}
                    disabled={busy}
                    onChange={(e) => setMaxPages(Number(e.target.value))}
                  />
                </Field>
              </>
            )}
          </div>
          <Button disabled={busy || !keywords.trim()}>
            <SearchIcon className="size-4" />
            {busy ? "Searching LinkedIn…" : "Search LinkedIn"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </Panel>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Looking for a good match. LinkedIn searches can take a moment.
        </p>
      )}
      {result === undefined && !busy && (
        <Panel title="Your next discovery">
          <Empty
            title="Good opportunities start with curiosity"
            description="Search for a role, a skill or a person. Your results will appear here."
          />
        </Panel>
      )}
      {result !== undefined &&
        (rows.length ? (
          <Records
            rows={rows}
            noun="Search results"
            onSelect={setSelected}
            columns={
              kind === "jobs"
                ? [
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
                  ]
                : [
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
            }
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
        ))}
      <Details
        row={selected}
        title={text(selected?.title ?? selected?.name ?? "Search result")}
        onClose={() => setSelected(null)}
      >
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
      </Details>
    </Page>
  )
}

import { SelectControl } from "@/components/ui/select-control"
import { Search as SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Page,
  Panel,
  Field,
  controlClass,
  Empty,
  Details,
} from "@/components/workspace-ui"
import {
  ResultActions,
  SearchResults,
  type SearchKind,
  type SearchValues,
} from "@/components/search-results"
import { useSearchWorkspace } from "@/lib/use-search-workspace"
import { text } from "@/lib/api"

export { searchRows } from "@/components/search-results"

export function SearchFilters({
  kind,
  values,
  busy,
  set,
}: {
  kind: SearchKind
  values: SearchValues
  busy: boolean
  set: <K extends keyof SearchValues>(key: K, value: SearchValues[K]) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Keywords">
        <Input
          required
          placeholder={
            kind === "jobs"
              ? "Product engineer, React…"
              : "Technical recruiter…"
          }
          value={values.keywords}
          disabled={busy}
          onChange={(e) => set("keywords", e.target.value)}
        />
      </Field>
      <Field label="Location">
        <Input
          placeholder="City, country or region"
          value={values.location}
          disabled={busy}
          onChange={(e) => set("location", e.target.value)}
        />
      </Field>
      {kind === "people" ? (
        <Field label="Company">
          <Input
            value={values.company}
            disabled={busy}
            onChange={(e) => set("company", e.target.value)}
            placeholder="Target company"
          />
        </Field>
      ) : (
        <>
          <Field label="Work arrangement">
            <SelectControl
              className={controlClass}
              value={values.workType}
              disabled={busy}
              onChange={(e) => set("workType", e.target.value)}
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
              value={values.maxPages}
              disabled={busy}
              onChange={(e) => set("maxPages", Number(e.target.value))}
            />
          </Field>
        </>
      )}
    </div>
  )
}


export function SearchPage() {
  const { kind, values, result, selected, setSelected, busy, error, search, update } = useSearchWorkspace()
  return (
    <Page
      title="Find people"
      description="Find people and recruiters that fit your direction."
    >
      <Panel title="People & recruiters">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <SearchFilters
            kind={kind}
            values={values}
            busy={busy}
            set={(key, value) => update({ [key]: value })}
          />
          <Button disabled={busy || !values.keywords.trim()}>
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
      {result !== undefined && !busy && (
        <SearchResults result={result} onSelect={setSelected} />
      )}
      <Details
        row={selected}
        title={text(selected?.title ?? selected?.name ?? "Search result")}
        onClose={() => setSelected(null)}
      >
        <ResultActions selected={selected} />
      </Details>
    </Page>
  )
}

import { Panel } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { SOURCE_LABELS } from "@/lib/profile-details"
import { ANSWER_CATALOG, CATEGORY_LABELS, resolveAnswer, type AnswerValue } from "../../../src/answers/catalog"
import type { PersonalSource } from "../../../src/profile/types"

/** `source` is the resume source that filled the default answer, if it still holds that value. */
export type CatalogRow = AnswerValue & { source?: PersonalSource | null }
function readyStatus(rows: CatalogRow[], key: string, language: string): string {
  const source = rows.find(row => row.key === key && (row.language ?? "default") === language)?.source
  return source && SOURCE_LABELS[source] ? `Ready · ${SOURCE_LABELS[source].toLowerCase()}` : `Ready: ${language}`
}

export function AnswerCatalog({ rows, language, fallback, onEdit }: {
  rows: CatalogRow[]; language: string; fallback: string
  onEdit: (key: string, language: string) => void
}) {
  return <Panel title="Answer catalog">
    <p className="mb-4 text-sm text-muted-foreground">Your contact details and links are filled from your resume sources. Add the rest yourself: first name, last name and email are required, and portals may request others. Missing or ambiguous fields remain pending for review.</p>
    {Object.entries(CATEGORY_LABELS).filter(([category]) => category !== "custom").map(([category, label]) => <div className="mb-4" key={category}>
      <h3 className="mb-2 font-medium">{label}</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ANSWER_CATALOG.filter(spec => spec.category === category).map(spec => {
          let resolution: ReturnType<typeof resolveAnswer> = { status: "missing", fallback: false }
          try { resolution = resolveAnswer(rows, spec.key, language, fallback || undefined) } catch { /* invalid selector is explained above */ }
          const status = spec.humanOnly ? "Human review only" : resolution.status === "invalid" ? "Invalid answer — correct it"
            : resolution.status === "missing" ? spec.required ? "Required answer missing — add it" : "No answer — add if requested"
              : resolution.fallback ? `Using explicit fallback: ${resolution.language}` : readyStatus(rows, spec.key, resolution.language ?? language)
          return <Button aria-label={`${spec.label}${spec.required ? " · Required" : ""} ${status}`} variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" key={spec.key}
            onClick={() => onEdit(spec.key, resolution.language ?? language)}>
            <span><span className="block">{spec.label}{spec.required ? " · Required" : ""}</span><span className="text-xs text-muted-foreground">{status}</span></span>
          </Button>
        })}
      </div>
    </div>)}
  </Panel>
}

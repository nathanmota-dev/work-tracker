import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { SOURCE_LABELS } from "@/lib/profile-details"
import { ANSWER_CATALOG, CATEGORY_LABELS, answerEntries, answerInput, resolveAnswer, type AnswerValue } from "../../../src/answers/catalog"
import type { PersonalSource } from "../../../src/profile/types"

/** `source` is the resume source that filled the default answer, if it still holds that value. */
export type CatalogRow = AnswerValue & { source?: PersonalSource | null }

/** Several values show as chips, a long text is clipped, anything else as typed. */
function Value({ value, kind }: { value: string; kind: string }) {
  if (kind === "tags" || kind === "multiselect")
    return <ul className="flex flex-wrap gap-1">{answerEntries(value).map(item => <li key={item}><Badge variant="secondary" className="h-auto whitespace-normal break-words py-0.5 text-[11px]">{item}</Badge></li>)}</ul>
  return <span className={kind === "textarea" ? "line-clamp-3" : ""}>{value}</span>
}

function Status({ required, humanOnly, status, source, fallback }: { required: boolean; humanOnly: boolean; status: string; source?: string; fallback?: string }) {
  if (status === "invalid") return <Badge variant="destructive">Invalid — correct it</Badge>
  if (status === "missing") return humanOnly ? <Badge variant="outline">Human review only</Badge> : <Badge variant={required ? "destructive" : "outline"}>{required ? "Required — add it" : "Not set"}</Badge>
  return <Badge variant="secondary">{humanOnly ? "Saved · never auto-filled" : fallback ? `Fallback: ${fallback}` : source ?? "Added by you"}</Badge>
}

/** One card per category listing every catalog field with its saved value; a row opens its editor. */
export function AnswerTables({ rows, language, fallback, categories, onEdit, editor }: {
  rows: CatalogRow[]; language: string; fallback: string
  /** The editor shown in place of a field's row while it is being edited. */
  editor?: (key: string) => ReactNode
  /** Categories to list; all but custom by default. */
  categories?: readonly string[]
  onEdit: (key: string, language: string) => void
}) {
  return <>
    {Object.entries(CATEGORY_LABELS).filter(([category]) => categories ? categories.includes(category) : category !== "custom").map(([category, label]) => (
      <section key={category} aria-label={label} className="rounded-2xl border p-4">
        <h2 className="mb-2 px-2 font-medium">{label}</h2>
        <ul aria-label={label} className="divide-y">
          {ANSWER_CATALOG.filter(spec => spec.category === category).map(spec => {
            let resolution: ReturnType<typeof resolveAnswer> = { status: "missing", fallback: false }
            try { resolution = resolveAnswer(rows, spec.key, language, fallback || undefined) } catch { /* invalid selector is explained above */ }
            const shown = resolution.value ?? ""
            const lang = resolution.language ?? language
            const source = rows.find(row => row.key === spec.key && (row.language ?? "default") === lang)?.source
            const others = rows.filter(row => row.key === spec.key && (row.language ?? "default") !== "default" && row.value?.trim()).map(row => row.language)
            const editing = editor?.(spec.key)
            if (editing) return <li key={spec.key} className="py-2">{editing}</li>
            return <li key={spec.key}>
              <div className="group grid items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-muted/40 sm:grid-cols-[14rem_minmax(0,1fr)_auto]">
                <button type="button" className="cursor-pointer text-left text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline" aria-label={`${spec.label}${spec.required ? " · Required" : ""}`}
                  onClick={() => onEdit(spec.key, lang)}>{spec.label}{spec.required ? " *" : ""}</button>
                <div className="min-w-0 cursor-pointer text-sm break-words" onClick={() => onEdit(spec.key, lang)}>
                  {shown ? <Value value={shown} kind={answerInput(spec.key).kind} /> : <span className="text-muted-foreground">—</span>}
                  {others.length > 0 && <span className="ml-2 text-xs text-muted-foreground">Also in {others.join(", ")}</span>}
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <Status required={spec.required} humanOnly={spec.humanOnly} status={resolution.status}
                    source={source && SOURCE_LABELS[source] ? SOURCE_LABELS[source] : undefined} fallback={resolution.fallback ? resolution.language : undefined} />
                </div>
              </div>
            </li>
          })}
        </ul>
      </section>
    ))}
  </>
}

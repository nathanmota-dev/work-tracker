import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Page, LoadState } from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { useApi, date, type Row } from "@/lib/api"
import { useWorkspaceState } from "@/lib/workspace-state"
import { AnswerPanel, useAnswerEditor } from "@/components/answer-panel"
import { AnswerTables, type CatalogRow } from "@/components/answer-tables"
import { ANSWER_CATALOG, CATEGORY_LABELS, answerLanguage } from "../../../src/answers/catalog"

/** Categories Questions lists; contact, links and the professional profile live on the Profile page. */
export const QUESTION_CATEGORIES = ["eligibility", "eeo"] as const

function savedRows(rows: Row[], advanced: boolean): Row[] {
  return rows.map(row => ({ ...row, language: row.language ?? "default",
    name: advanced ? row.key : ANSWER_CATALOG.find(spec => spec.key === row.key)?.label ?? row.key,
    categoryLabel: CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS] ?? row.category,
  }))
}
const columns: Column[] = [
  { key: "name", label: "Field" }, { key: "value", label: "Answer" },
  { key: "language", label: "Language" }, { key: "categoryLabel", label: "Category" },
  { key: "updated_at", label: "Updated", render: row => date(row.updated_at) },
]
function languageError(language: string, fallback: string): string {
  try { answerLanguage(language); if (fallback) answerLanguage(fallback); return "" }
  catch (error) { return (error as Error).message }
}
export function AnswersPage() {
  const api = useApi<Row[]>("answers/variants")
  const editor = useAnswerEditor()
  const [advanced, setAdvanced] = useState(false)
  const [language, setLanguage] = useState("default")
  const [fallback, setFallback] = useState("")
  const rows = savedRows(api.data ?? [], advanced)
  const custom = rows.filter(row => !ANSWER_CATALOG.some(spec => spec.key === row.key))
  const open = (key: string, lang = language) => editor.open(rows, key, lang)
  // A question listed here is edited inside its row; a new, custom or other field opens above the list.
  const listed = (key: string) => ANSWER_CATALOG.some(spec => spec.key === key && (QUESTION_CATEGORIES as readonly string[]).includes(spec.category))
  const inRow = !!editor.draft && !advanced && listed(editor.draft.key)
  // A correction link from the Apply checklist opens that field's editor once.
  const { search: route, update } = useWorkspaceState("answers")
  const [requested, setRequested] = useState("")
  if (route.field && api.data && requested !== route.field) { setRequested(route.field); open(route.field) }
  if (!route.field && requested) setRequested("")
  // Once its editor closes, the requested field leaves the URL so returning to this tab does not reopen it.
  const closed = !editor.draft && !!requested && route.field === requested
  useEffect(() => { if (closed) update({ field: "" }) }, [closed, update])
  return <Page title="Questions" description="What application portals ask that a resume does not answer: eligibility, availability and human review questions."
    actions={<Button size="sm" onClick={() => open("")}>Add question</Button>}>
    {route.returnTo && <a className="text-sm underline" href={`#${route.returnTo}`}>Back to the application checklist</a>}
    {editor.notice && <p role="status" className="text-sm">{editor.notice}</p>}
    <LoadState {...api} retry={api.refresh} />
    <div role="group" aria-label="Answer language" className="flex flex-wrap items-center gap-2 text-sm">
      <div className="flex items-center gap-2 rounded-full border py-1 pr-1 pl-3.5">
        <span aria-hidden className="text-muted-foreground">Language</span>
        <Input aria-label="Requested language" className="h-7 w-28 rounded-full border-0 bg-muted/50 shadow-none" value={language} onChange={e => setLanguage(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 rounded-full border py-1 pr-1 pl-3.5">
        <span aria-hidden className="text-muted-foreground">Fallback</span>
        <Input aria-label="Explicit fallback language (optional)" className="h-7 w-28 rounded-full border-0 bg-muted/50 shadow-none" value={fallback} placeholder="None" onChange={e => setFallback(e.target.value)} />
      </div>
      <label className="flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5"><input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} />Advanced mode</label>
    </div>
    {languageError(language, fallback) && <p role="alert">{languageError(language, fallback)}</p>}
    {api.data && <>
      {editor.draft && !inRow && <AnswerPanel editor={editor} rows={rows} advanced={advanced} />}
      <AnswerTables categories={QUESTION_CATEGORIES} editor={key => inRow && editor.draft?.key === key ? <AnswerPanel editor={editor} rows={rows} advanced={advanced} /> : null} rows={rows.map(row => ({ key: String(row.key), value: row.value == null ? null : String(row.value), language: String(row.language), source: row.autofill_source as CatalogRow["source"] }))}
        language={language} fallback={fallback} onEdit={open} />
      {custom.length > 0 && <Records rows={custom} noun="Custom questions" columns={columns} rowKey={row => `${row.key}:${row.language}`} onSelect={row => open(String(row.key), String(row.language))} />}
    </>}
  </Page>
}

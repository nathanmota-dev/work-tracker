import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Page, LoadState, Field } from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { useApi, request, publish, date, type Row } from "@/lib/api"
import { useWorkspaceState } from "@/lib/workspace-state"
import { AnswerEditor, draftError, type AnswerDraft } from "@/components/answer-editor"
import { AnswerTables, type CatalogRow } from "@/components/answer-tables"
import { ANSWER_CATALOG, CATEGORY_LABELS, answerLanguage } from "../../../src/answers/catalog"

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
function useAnswerEditor() {
  const [draft, setDraft] = useState<AnswerDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  function open(next: AnswerDraft) { setError(""); setNotice(""); setConfirmDelete(false); setDraft(next) }
  async function mutate(deleting = false) {
    if (!draft || !deleting && draftError(draft)) return
    setBusy(true); setError(""); setNotice("")
    try {
      const language = answerLanguage(draft.language)
      await request(deleting ? "answer/delete" : "answer", {
        key: draft.key.trim(), language,
        ...(!deleting ? { value: draft.value, category: draft.category.trim() || "custom" } : {}),
      })
      publish({ type: "changed" })
      setDraft(null); setNotice(deleting ? "Answer deleted." : "Answer saved.")
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return { draft, setDraft, busy, error, notice, confirmDelete, setConfirmDelete, open, mutate }
}
export function AnswersPage() {
  const api = useApi<Row[]>("answers/variants")
  const editor = useAnswerEditor()
  const [advanced, setAdvanced] = useState(false)
  const [language, setLanguage] = useState("default")
  const [fallback, setFallback] = useState("")
  const rows = savedRows(api.data ?? [], advanced)
  const custom = rows.filter(row => !ANSWER_CATALOG.some(spec => spec.key === row.key))
  function open(key: string, lang = language) {
    const row = rows.find(r => r.key === key && r.language === lang)
    editor.open({ key, value: String(row?.value ?? ""), category: String(row?.category ?? ANSWER_CATALOG.find(s => s.key === key)?.category ?? "custom"), language: lang, existing: !!row })
  }
  // A correction link from the Apply checklist opens that field's editor once.
  const { search: route, update } = useWorkspaceState("answers")
  const [requested, setRequested] = useState("")
  if (route.field && api.data && requested !== route.field) { setRequested(route.field); open(route.field) }
  if (!route.field && requested) setRequested("")
  // Once its editor closes, the requested field leaves the URL so returning to this tab does not reopen it.
  const closed = !editor.draft && !!requested && route.field === requested
  useEffect(() => { if (closed) update({ field: "" }) }, [closed, update])
  const draft = editor.draft
  let duplicate = false
  try { duplicate = !!draft && !draft.existing && rows.some(row => row.key === draft.key.trim() && row.language === answerLanguage(draft.language)) } catch { /* editor displays language validation */ }
  return <Page title="Answers" description="Your reusable details, ready for the next application."
    actions={<Button size="sm" onClick={() => open("")}>Add answer</Button>}>
    {route.returnTo && <a className="text-sm underline" href={`#${route.returnTo}`}>Back to the application checklist</a>}
    {editor.notice && <p role="status" className="text-sm">{editor.notice}</p>}
    <LoadState {...api} retry={api.refresh} />
    <div className="flex flex-wrap items-end gap-4">
      <Field label="Requested language"><Input value={language} onChange={e => setLanguage(e.target.value)} /></Field>
      <Field label="Explicit fallback language (optional)"><Input value={fallback} placeholder="No fallback" onChange={e => setFallback(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} />Advanced mode</label>
    </div>
    {languageError(language, fallback) && <p role="alert">{languageError(language, fallback)}</p>}
    {api.data && <>
      <AnswerTables rows={rows.map(row => ({ key: String(row.key), value: row.value == null ? null : String(row.value), language: String(row.language), source: row.autofill_source as CatalogRow["source"] }))}
        language={language} fallback={fallback} onEdit={open} />
      {custom.length > 0 && <Records rows={custom} noun="Custom answers" columns={columns} rowKey={row => `${row.key}:${row.language}`} onSelect={row => open(String(row.key), String(row.language))} />}
    </>}
    <Dialog open={!!draft} onOpenChange={value => { if (!value && !editor.busy) editor.setDraft(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{draft?.existing ? "Edit answer" : "Add an answer"}</DialogTitle>
        <DialogDescription>Saved answers are available to your application workflows.</DialogDescription></DialogHeader>
        {draft && <AnswerEditor {...editor} draft={draft} advanced={advanced} duplicate={duplicate}
          onSave={() => void editor.mutate()} onDelete={() => void editor.mutate(true)} />}
      </DialogContent>
    </Dialog>
  </Page>
}

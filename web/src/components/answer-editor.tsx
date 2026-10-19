import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, controlClass } from "@/components/workspace-ui"
import { ANSWER_CATALOG, answerLanguage, validateAnswer } from "../../../src/answers/catalog"

export type AnswerDraft = { key: string; value: string; category: string; language: string; existing: boolean }
export function draftError(draft: AnswerDraft): string {
  try { answerLanguage(draft.language) } catch (e) { return (e as Error).message }
  return validateAnswer(draft.key, draft.value) ?? ""
}
export function AnswerEditor({ draft, setDraft, advanced, busy, error, duplicate, onSave, onDelete, confirmDelete, setConfirmDelete }: {
  draft: AnswerDraft; setDraft: (draft: AnswerDraft | null) => void; advanced: boolean
  busy: boolean; error: string; duplicate: boolean; onSave: () => void; onDelete: () => void
  confirmDelete: boolean; setConfirmDelete: (value: boolean) => void
}) {
  const validation = draftError(draft)
  const spec = ANSWER_CATALOG.find((entry) => entry.key === draft.key)
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSave() }}>
    {advanced ? <>
      <Field label="Field key"><Input required value={draft.key} disabled={draft.existing || busy}
        placeholder="e.g. preferred_name" onChange={e => setDraft({ ...draft, key: e.target.value })} /></Field>
      <Field label="Category"><Input value={draft.category} disabled={busy}
        onChange={e => setDraft({ ...draft, category: e.target.value })} /></Field>
    </> : <Field label="Field"><select className={controlClass} value={draft.key} disabled={draft.existing || busy}
      onChange={e => setDraft({ ...draft, key: e.target.value, category: ANSWER_CATALOG.find(s => s.key === e.target.value)?.category ?? "custom" })}>
      <option value="">Choose a field</option>
      {ANSWER_CATALOG.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      {draft.key && !spec && <option value={draft.key}>{draft.key}</option>}
    </select></Field>}
    <Field label="Language"><Input required value={draft.language} disabled={draft.existing || busy}
      placeholder="default, en, pt-BR" onChange={e => setDraft({ ...draft, language: e.target.value })} /></Field>
    <p className="text-xs text-muted-foreground">The default version preserves existing workflows. Other languages require an explicit fallback selection.</p>
    {spec?.humanOnly && <p>Human review only. Demographic answers are never filled automatically.</p>}
    <Field label="Answer"><Textarea className={`${controlClass} h-28 py-2`} value={draft.value} disabled={busy}
      aria-invalid={!!validation} aria-describedby={validation ? "answer-validation" : undefined}
      onChange={e => setDraft({ ...draft, value: e.target.value })} /></Field>
    {validation && <p id="answer-validation" role="alert" className="text-sm text-destructive">{validation}</p>}
    {duplicate && <p className="text-xs text-destructive">This key and language already exist. Open the saved answer to edit it.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {confirmDelete && <p>Delete this language version? Other versions will be preserved.</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {draft.existing && <Button type="button" variant="destructive" disabled={busy}
        onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>{confirmDelete ? "Confirm deletion" : "Delete answer"}</Button>}
      {draft.existing && <Button type="button" variant="outline" disabled={busy}
        onClick={() => { setConfirmDelete(false); setDraft({ ...draft, existing: false, language: "", value: "" }) }}>Add language variant</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
      <Button disabled={busy || !draft.key.trim() || duplicate || !!validation}>{busy ? "Saving…" : "Save answer"}</Button>
    </div>
  </form>
}

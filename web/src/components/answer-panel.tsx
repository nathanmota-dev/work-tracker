import { useState } from "react"
import { AnswerEditor, draftError, type AnswerDraft } from "@/components/answer-editor"
import { cn } from "@/lib/utils"
import { request, publish, type Row } from "@/lib/api"
import { ANSWER_CATALOG, answerLanguage } from "../../../src/answers/catalog"

/** Saves or deletes one answer; `open` starts a draft from the saved rows. */
export function useAnswerEditor() {
  const [draft, setDraft] = useState<AnswerDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  function start(next: AnswerDraft) { setError(""); setNotice(""); setConfirmDelete(false); setDraft(next) }
  /** The editor of `key` in `language`, with its saved value when there is one. */
  function open(rows: Row[], key: string, language = "default") {
    const row = rows.find(item => item.key === key && (item.language ?? "default") === language)
    start({ key, value: String(row?.value ?? ""), category: String(row?.category ?? ANSWER_CATALOG.find(spec => spec.key === key)?.category ?? "custom"), language, existing: !!row })
  }
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
  return { draft, setDraft, busy, error, notice, confirmDelete, setConfirmDelete, start, open, mutate }
}
export type AnswerEditorState = ReturnType<typeof useAnswerEditor>

/**
 * The editor of the current draft in place, instead of a dialog: inside the
 * row it edits, or as a card at the top of the list. Escape cancels it.
 */
export function AnswerPanel({ editor, rows, advanced = false, className }: { editor: AnswerEditorState; rows: Row[]; advanced?: boolean; className?: string }) {
  const draft = editor.draft
  if (!draft) return null
  let duplicate = false
  try { duplicate = !draft.existing && rows.some(row => row.key === draft.key.trim() && (row.language ?? "default") === answerLanguage(draft.language)) } catch { /* the editor explains an invalid language */ }
  const title = draft.existing ? "Edit answer" : "Add an answer"
  return <section aria-label={title} className={cn("rounded-xl border bg-muted/20 p-4 animate-in fade-in-0", className)}
    onKeyDown={event => { if (event.key === "Escape" && !editor.busy) editor.setDraft(null) }}>
    <h3 className="mb-3 text-sm font-medium">{title}</h3>
    <AnswerEditor {...editor} draft={draft} advanced={advanced} duplicate={duplicate}
      onSave={() => void editor.mutate()} onDelete={() => void editor.mutate(true)} />
  </section>
}

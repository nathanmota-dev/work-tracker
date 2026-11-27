import { useState } from "react"
import { InlineEditorForm, useSave } from "@/components/inline-editor"
import { AnswerField } from "@/components/answer-editor"
import { publish, request, type Row } from "@/lib/api"
import { profileValue } from "@/lib/profile-details"
import { cn } from "@/lib/utils"
import { ANSWER_CATALOG, validateAnswer } from "../../../src/answers/catalog"

const label = (key: string) => ANSWER_CATALOG.find(spec => spec.key === key)?.label ?? key
const category = (key: string) => ANSWER_CATALOG.find(spec => spec.key === key)?.category ?? "custom"

/**
 * A section of the profile turned into its fields, edited in place and saved
 * together. `defaults` starts a field with what the page shows when no answer
 * is saved, such as the LinkedIn summary; a cleared field deletes its answer.
 */
export function InlineAnswers({ keys, rows, defaults = {}, columns = 1, onClose, onSaved }: {
  keys: string[]
  rows: Row[]
  defaults?: Record<string, string>
  columns?: 1 | 2
  onClose: () => void
  onSaved: () => void
}) {
  const saved = Object.fromEntries(keys.map(key => [key, profileValue(rows, key).value]))
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(key => [key, saved[key] || defaults[key] || ""])))
  const { busy, error, run } = useSave()
  const invalid = (key: string) => (drafts[key]!.trim() ? validateAnswer(key, drafts[key]!) : null)
  const changed = keys.filter(key => drafts[key]!.trim() !== saved[key])
  const save = () => run(async () => {
      for (const key of changed) {
        const value = drafts[key]!.trim()
        if (value) await request("answer", { key, value: drafts[key], category: category(key), language: "default" })
        else if (saved[key]) await request("answer/delete", { key, language: "default" })
      }
      publish({ type: "changed" })
      onSaved()
  })
  return (
    <InlineEditorForm busy={busy} error={error} canSave={!!changed.length && !keys.some(key => invalid(key))} note="Applications and your next resumes use these answers."
      onSubmit={() => void save()} onClose={onClose}>
      <div className={cn("grid gap-4", columns === 2 && "sm:grid-cols-2")}>
        {keys.map(key => (
          <div key={key} className={cn(columns === 2 && ["summary", "address", "social_links", "preferred_locations"].includes(key) && "sm:col-span-2")}>
            <AnswerField fieldKey={key} label={label(key)} value={drafts[key]!} disabled={busy} invalid={!!invalid(key)} describedBy={`${key}-validation`}
              onChange={value => setDrafts(current => ({ ...current, [key]: value }))} />
            {invalid(key) && <p id={`${key}-validation`} role="alert" className="mt-1 text-xs text-destructive">{invalid(key)}</p>}
          </div>
        ))}
      </div>
    </InlineEditorForm>
  )
}

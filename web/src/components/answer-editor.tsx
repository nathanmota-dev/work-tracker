import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, controlClass } from "@/components/workspace-ui"
import { DatePicker } from "@/components/ui/date-picker"
import { TagField } from "@/components/tag-field"
import { SelectControl } from "@/components/ui/select-control"
import { ANSWER_CATALOG, answerEntries, answerInput, answerLanguage, validateAnswer, type AnswerInput } from "../../../src/answers/catalog"

export type AnswerDraft = { key: string; value: string; category: string; language: string; existing: boolean }
export function draftError(draft: AnswerDraft): string {
  try { answerLanguage(draft.language) } catch (e) { return (e as Error).message }
  return validateAnswer(draft.key, draft.value) ?? ""
}
const YES_NO = ["Yes", "No"]
/** ISO dates for the date input; the portals' DD/MM/YYYY form is converted. */
const isoDate = (value: string) => { const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim()); return br ? `${br[3]}-${br[2]}-${br[1]}` : value }

/** The control that fits the field: text, email, phone, URL, date, choice, yes/no, several choices or tags. */
function ValueInput({ input, value, disabled, invalid, onChange, label = "Answer", describedBy = "answer-validation" }: { input: AnswerInput; value: string; disabled: boolean; invalid: boolean; onChange: (value: string) => void; label?: string; describedBy?: string }) {
  const common = { disabled, "aria-invalid": invalid, "aria-describedby": invalid ? describedBy : undefined }
  if (input.kind === "tags") return <TagField label={label} value={value} onChange={onChange} suggestions={input.suggestions} disabled={disabled} placeholder={input.urls ? "https://… and press Enter" : undefined} />
  if (input.kind === "multiselect") {
    const picked = answerEntries(value).map(item => item.toLowerCase())
    const toggle = (option: string) => onChange(input.options.filter(item => item === option ? !picked.includes(item.toLowerCase()) : picked.includes(item.toLowerCase())).join(", "))
    return <fieldset className="space-y-2" disabled={disabled}><legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{input.options.map(option => <label key={option} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={picked.includes(option.toLowerCase())} onChange={() => toggle(option)} />{option}</label>)}</div>
      <p className="text-xs text-muted-foreground">Pick every level you apply for; the agent uses the one that fits each role.</p></fieldset>
  }
  const choices = input.kind === "yesno" ? [...YES_NO, ...(["Prefer not to say"])] : input.kind === "select" ? [...input.options] : null
  if (choices) return <Field label={label}><SelectControl className={controlClass} value={value} {...common} onChange={e => onChange(e.target.value)}>
    <option value="">Choose…</option>
    {choices.map(option => <option key={option} value={option}>{option}</option>)}
    {value && !choices.some(option => option.toLowerCase() === value.toLowerCase()) && <option value={value}>{value}</option>}
  </SelectControl></Field>
  return null
}
function SimpleInput({ input, value, disabled, invalid, onChange, free, label = "Answer", describedBy = "answer-validation" }: { input: AnswerInput; value: string; disabled: boolean; invalid: boolean; onChange: (value: string) => void; free: boolean; label?: string; describedBy?: string }) {
  const common = { disabled, "aria-invalid": invalid, "aria-describedby": invalid ? describedBy : undefined }
  if (input.kind === "textarea" || free) return <Field label={label}><Textarea className={`${controlClass} h-28 py-2`} value={value} {...common} onChange={e => onChange(e.target.value)} /></Field>
  if (input.kind === "date") return <Field label={label}><DatePicker value={isoDate(value)} max={new Date().toISOString().slice(0, 10)} disabled={disabled} aria-label={label} onChange={onChange} /></Field>
  const type = { email: "email", phone: "tel", url: "url" }[input.kind as string] ?? "text"
  return <Field label={label}><Input type={type} value={value} {...common} autoComplete="off" onChange={e => onChange(e.target.value)} /></Field>
}

/** The control of one catalog field, labelled by `label`; used in place of the dialog by inline editors. */
export function AnswerField({ fieldKey, label, value, disabled, invalid, describedBy, onChange }: {
  fieldKey: string; label: string; value: string; disabled: boolean; invalid: boolean; describedBy?: string; onChange: (value: string) => void
}) {
  const input = answerInput(fieldKey)
  const props = { input, value, disabled, invalid, label, describedBy, onChange }
  return ["tags", "multiselect", "select", "yesno"].includes(input.kind) ? <ValueInput {...props} /> : <SimpleInput {...props} free={false} />
}

export function AnswerEditor({ draft, setDraft, advanced, busy, error, duplicate, onSave, onDelete, confirmDelete, setConfirmDelete }: {
  draft: AnswerDraft; setDraft: (draft: AnswerDraft | null) => void; advanced: boolean
  busy: boolean; error: string; duplicate: boolean; onSave: () => void; onDelete: () => void
  confirmDelete: boolean; setConfirmDelete: (value: boolean) => void
}) {
  const validation = draftError(draft)
  const spec = ANSWER_CATALOG.find((entry) => entry.key === draft.key)
  const catalogued = !!spec
  const input = answerInput(draft.key)
  const special = ["tags", "multiselect", "select", "yesno"].includes(input.kind)
  return <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); onSave() }}>
    {advanced ? <>
      <Field label="Field key"><Input required value={draft.key} disabled={draft.existing || busy}
        placeholder="e.g. preferred_name" onChange={e => setDraft({ ...draft, key: e.target.value })} /></Field>
      <Field label="Category"><Input value={draft.category} disabled={busy}
        onChange={e => setDraft({ ...draft, category: e.target.value })} /></Field>
    </> : draft.key && spec ? <div><p className="text-xs text-muted-foreground">Field</p><p className="font-medium" aria-label="Field">{spec.label}</p></div>
      : <Field label="Field"><select className={controlClass} value={draft.key} disabled={draft.existing || busy}
      onChange={e => setDraft({ ...draft, key: e.target.value, category: ANSWER_CATALOG.find(s => s.key === e.target.value)?.category ?? "custom" })}>
      <option value="">Choose a field</option>
      {ANSWER_CATALOG.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      {draft.key && !spec && <option value={draft.key}>{draft.key}</option>}
    </select></Field>}
    <Field label="Language"><Input required value={draft.language} disabled={draft.existing || busy}
      placeholder="default, en, pt-BR" onChange={e => setDraft({ ...draft, language: e.target.value })} /></Field>
    <p className="text-xs text-muted-foreground">The default version preserves existing workflows. Other languages require an explicit fallback selection.</p>
    {spec?.humanOnly && <p>Human review only. Demographic answers are never filled automatically.</p>}
    {special ? <ValueInput input={input} value={draft.value} disabled={busy} invalid={!!validation} onChange={value => setDraft({ ...draft, value })} />
      : <SimpleInput input={input} value={draft.value} disabled={busy} invalid={!!validation} free={!catalogued} onChange={value => setDraft({ ...draft, value })} />}
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

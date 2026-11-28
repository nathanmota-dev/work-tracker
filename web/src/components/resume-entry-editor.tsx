import { useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineEditorForm, useSave } from "@/components/inline-editor"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { period } from "@/components/profile-resume"
import { cn } from "@/lib/utils"
import type { ResumeEntry } from "../../../src/profile/types"

/** Field names of one entry, so the same editor serves roles and courses. */
export type EntryKind = "experience" | "education"
const COPY: Record<EntryKind, { title: string; organization: string; add: string; remove: string; hint: string; untitled: string }> = {
  experience: { title: "Title", organization: "Company", add: "Add experience", remove: "Remove experience", hint: "Start with the most recent.", untitled: "New experience" },
  education: { title: "Degree", organization: "School", add: "Add education", remove: "Remove education", hint: "Degrees, technical courses and bootcamps.", untitled: "New education" },
}
const blank = (): ResumeEntry => ({ title: "", organization: "", start: "", end: "", location: "", bullets: [], skills: [] })
/** The picker's `YYYY-MM-DD`; a month-only date opens on the 1st of that month. */
const pickerValue = (value: string) => (/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "")

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={cn("grid content-start gap-1.5 text-sm", wide && "sm:col-span-2")}><span className="font-medium">{label}</span>{children}</label>
}

/** The fields of one role or course. Bullets are one per line; the stack is comma separated. */
function EntryFields({ kind, entry, disabled, onChange }: { kind: EntryKind; entry: ResumeEntry; disabled: boolean; onChange: (entry: ResumeEntry) => void }) {
  const copy = COPY[kind]
  const current = entry.end === "Present"
  const set = (patch: Partial<ResumeEntry>) => onChange({ ...entry, ...patch })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={copy.title}><Input value={entry.title} disabled={disabled} onChange={e => set({ title: e.target.value })} /></Field>
      <Field label={copy.organization}><Input value={entry.organization} disabled={disabled} onChange={e => set({ organization: e.target.value })} /></Field>
      <div className="grid content-start gap-1.5 text-sm">
        <span className="font-medium">Start</span>
        <DatePicker aria-label="Start" value={pickerValue(entry.start)} disabled={disabled} onChange={value => set({ start: value })} />
      </div>
      <div className="grid content-start gap-1.5 text-sm">
        <span className="font-medium">End</span>
        {current ? <Input aria-label="End" value={kind === "experience" ? "Present" : "In progress"} disabled />
          : <DatePicker aria-label="End" value={pickerValue(entry.end)} disabled={disabled} onChange={value => set({ end: value })} />}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5 accent-primary" checked={current} disabled={disabled} onChange={e => set({ end: e.target.checked ? "Present" : "" })} />
          {kind === "experience" ? "I currently work here" : "In progress"}
        </label>
      </div>
      <Field label="Location" wide><Input value={entry.location} disabled={disabled} placeholder="City, country or Remote" onChange={e => set({ location: e.target.value })} /></Field>
      {kind === "experience" && <>
        <Field label="What you did" wide>
          <Textarea rows={5} value={entry.bullets.join("\n")} disabled={disabled} placeholder="One achievement per line."
            onChange={e => set({ bullets: e.target.value.split("\n") })} />
        </Field>
        <Field label="Stack" wide>
          <Input value={entry.skills.join(", ")} disabled={disabled} placeholder="Angular, TypeScript, AWS"
            onChange={e => set({ skills: e.target.value.split(",").map(item => item.trimStart()) })} />
        </Field>
      </>}
    </div>
  )
}

/** Drops the empty lines and tags the editing left behind. */
const tidy = (entry: ResumeEntry): ResumeEntry => ({
  ...entry, title: entry.title.trim(), organization: entry.organization.trim(), location: entry.location.trim(),
  bullets: entry.bullets.map(item => item.trim()).filter(Boolean), skills: entry.skills.map(item => item.trim()).filter(Boolean),
})

function EntryRow({ kind, entry, index, count, open, disabled, onToggle, onChange, onMove, onRemove }: {
  kind: EntryKind; entry: ResumeEntry; index: number; count: number; open: boolean; disabled: boolean
  onToggle: () => void; onChange: (entry: ResumeEntry) => void; onMove: (offset: -1 | 1) => void; onRemove: () => void
}) {
  const heading = entry.title || entry.organization || COPY[kind].untitled
  const detail = [entry.title ? entry.organization : "", period(entry)].filter(Boolean).join(" · ")
  return (
    <li className="border-b last:border-b-0">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{heading}</span>
          {!open && detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 pb-4 animate-in fade-in-0">
          <EntryFields kind={kind} entry={entry} disabled={disabled} onChange={onChange} />
          <div className="flex items-center gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={disabled || index === count - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
            <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" disabled={disabled} onClick={onRemove}>
              <Trash2 />{COPY[kind].remove}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Experience or education edited in place, like the resume reads it: each
 * entry opens its fields, entries are added, reordered and removed, and the
 * whole list is saved together.
 */
export function ResumeEntryEditor({ kind, entries, onClose, onSave }: {
  kind: EntryKind; entries: ResumeEntry[]; onClose: () => void; onSave: (entries: ResumeEntry[]) => Promise<void> | void
}) {
  const [drafts, setDrafts] = useState<ResumeEntry[]>(entries)
  const [open, setOpen] = useState<number | null>(null)
  const { busy, error, run } = useSave()
  const changed = JSON.stringify(drafts.map(tidy)) !== JSON.stringify(entries.map(tidy))
  const update = (index: number, entry: ResumeEntry) => setDrafts(list => list.map((item, i) => (i === index ? entry : item)))
  const move = (index: number, offset: -1 | 1) => {
    setDrafts(list => { const next = [...list]; [next[index], next[index + offset]] = [next[index + offset]!, next[index]!]; return next })
    setOpen(index + offset)
  }
  const remove = (index: number) => { setDrafts(list => list.filter((_, i) => i !== index)); setOpen(null) }
  const add = () => { setDrafts(list => [blank(), ...list]); setOpen(0) }
  const save = () => run(() => onSave(drafts.map(tidy).filter(entry => entry.title || entry.organization)))
  return (
    <InlineEditorForm busy={busy} error={error} canSave={changed} note="Your next resumes use these changes." className="space-y-2" onSubmit={() => void save()} onClose={onClose}>
      <p className="text-xs text-muted-foreground">{COPY[kind].hint}</p>
      <ul aria-label={kind === "experience" ? "Experience entries" : "Education entries"}>
        {drafts.map((entry, index) => (
          <EntryRow key={index} kind={kind} entry={entry} index={index} count={drafts.length} open={open === index} disabled={busy}
            onToggle={() => setOpen(open === index ? null : index)} onChange={next => update(index, next)}
            onMove={offset => move(index, offset)} onRemove={() => remove(index)} />
        ))}
      </ul>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={add}><Plus />{COPY[kind].add}</Button>
    </InlineEditorForm>
  )
}

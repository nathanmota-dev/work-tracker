import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineEditorForm, useSave } from "@/components/inline-editor"
import { Input } from "@/components/ui/input"

/**
 * A list of short items, such as skills or certifications, edited as chips:
 * Enter or a comma adds what was typed, × removes an item, and the list is
 * saved together.
 */
export function ChipListEditor({ items, label, placeholder, onClose, onSave }: {
  items: string[]; label: string; placeholder: string; onClose: () => void; onSave: (items: string[]) => Promise<void> | void
}) {
  const [drafts, setDrafts] = useState(items)
  const [text, setText] = useState("")
  const { busy, error, run } = useSave()
  const pending = text.split(",").map(item => item.trim()).filter(Boolean)
  const next = [...drafts, ...pending.filter(item => !drafts.some(saved => saved.toLowerCase() === item.toLowerCase()))]
  const changed = JSON.stringify(next) !== JSON.stringify(items)
  const commit = () => { setDrafts(next); setText("") }
  const save = () => run(async () => { setDrafts(next); setText(""); await onSave(next) })
  return (
    <InlineEditorForm busy={busy} error={error} canSave={changed} note="Separate several items with commas." onSubmit={() => void save()} onClose={onClose}>
      {drafts.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-2">
          {drafts.map(item => (
            <li key={item} className="flex items-center gap-1 rounded-full border bg-background py-1 pr-1 pl-3 text-sm">
              {item}
              <button type="button" aria-label={`Remove ${item}`} disabled={busy} onClick={() => setDrafts(list => list.filter(other => other !== item))}
                className="cursor-pointer rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input aria-label={`Add to ${label.toLowerCase()}`} value={text} disabled={busy} placeholder={placeholder} onChange={e => setText(e.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && text.trim()) { event.preventDefault(); commit() } }} />
        <Button type="button" size="sm" variant="outline" className="h-9" disabled={busy || !pending.length} onClick={commit}><Plus />Add</Button>
      </div>
    </InlineEditorForm>
  )
}

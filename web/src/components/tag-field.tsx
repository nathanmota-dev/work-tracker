import { useState } from "react"
import { Popover } from "radix-ui"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/workspace-ui"

export const roleSuggestions = ["Back-End", "Front-End", "Full Stack", "Software Engineer", "Mobile", "DevOps", "Data Engineer", "QA", "Product Manager", "Designer"] as const
export const locationSuggestions = ["Remote", "Hybrid", "Brazil", "São Paulo", "Rio de Janeiro", "Portugal", "United States", "Europe"] as const

/** Tags are stored as one comma-separated string so existing params and drafts keep working. */
export function parseTags(value: string) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean)
}
export function serializeTags(tags: string[]) {
  return tags.join(", ")
}

function SuggestionList({ options, active, onPick }: { options: string[]; active: number; onPick: (item: string) => void }) {
  return (
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="z-50 max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <ul role="listbox" aria-label="Suggestions">
          {options.map((item, index) => (
            <li
              key={item}
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              className="flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(item)}
            >
              {item}
            </li>
          ))}
        </ul>
      </Popover.Content>
    </Popover.Portal>
  )
}

function TagBadges({ tags, disabled, onRemove }: { tags: string[]; disabled?: boolean; onRemove: (tag: string) => void }) {
  if (!tags.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Selected values">
      {tags.map((tag) => (
        <li key={tag} className="max-w-full">
          <Badge variant="secondary" className="h-auto max-w-full gap-1 overflow-visible py-0.5 pr-1 text-[11px] leading-tight whitespace-normal break-words">
            {tag}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${tag}`}
              className="shrink-0 rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
              onClick={() => onRemove(tag)}
            >
              <X className="size-3" />
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export function TagField({ label, value, onChange, suggestions = [], placeholder, disabled, required }: {
  label: string
  value: string
  onChange: (value: string) => void
  suggestions?: readonly string[]
  placeholder?: string
  disabled?: boolean
  required?: boolean
}) {
  // The value always includes the text being typed so a submit without Enter still searches for it;
  // that in-progress text is the last entry and only becomes a badge on Enter or comma.
  const [draft, setDraft] = useState("")
  const all = parseTags(value)
  const tags = draft.trim() ? all.slice(0, -1) : all
  const emit = (committed: string[], pending: string) => onChange(serializeTags(pending.trim() ? [...committed, pending.trim()] : committed))
  const withNew = (text: string) => {
    const known = new Set(tags.map((tag) => tag.toLowerCase()))
    return [...tags, ...parseTags(text).filter((tag) => !known.has(tag.toLowerCase()) && known.add(tag.toLowerCase()))]
  }
  const commit = (text: string) => { setDraft(""); emit(withNew(text), "") }
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const query = draft.trim().toLowerCase()
  const options = suggestions.filter((item) => !tags.some((tag) => tag.toLowerCase() === item.toLowerCase()) && item.toLowerCase().includes(query))
  const showOptions = open && !disabled && options.length > 0
  const remove = (tag: string) => emit(tags.filter((item) => item !== tag), draft)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Field label={label}>
        <Popover.Root open={showOptions}>
        <Popover.Anchor asChild>
        <Input
          role="combobox"
          aria-expanded={showOptions}
          aria-autocomplete="list"
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1) }}
          placeholder={placeholder ?? "Type and press Enter"}
          disabled={disabled}
          required={required && !all.length}
          autoComplete="off"
          onChange={(e) => {
            const text = e.target.value
            const parts = text.split(",")
            const pending = parts[parts.length - 1].trimStart()
            setDraft(pending)
            setOpen(true)
            setActive(-1)
            emit(withNew(parts.slice(0, -1).join(",")), pending)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (!options.length) return
              e.preventDefault()
              setOpen(true)
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length)
            }
            else if (e.key === "Escape" && showOptions) { e.preventDefault(); setOpen(false) }
            else if (e.key === "Enter" && showOptions && active >= 0) { e.preventDefault(); commit(options[active]); setActive(-1) }
            else if (e.key === "Enter" && draft.trim()) { e.preventDefault(); commit(draft) }
            else if (e.key === "Backspace" && !draft && tags.length) remove(tags[tags.length - 1])
          }}
        />
        </Popover.Anchor>
        <SuggestionList options={options} active={active} onPick={commit} />
        </Popover.Root>
      </Field>
      <TagBadges tags={tags} disabled={disabled} onRemove={remove} />
    </div>
  )
}

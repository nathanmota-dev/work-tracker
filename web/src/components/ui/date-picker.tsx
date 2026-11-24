import { useState } from "react"
import { Popover } from "radix-ui"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]
const pad = (value: number) => String(value).padStart(2, "0")
/** `YYYY-MM-DD` of a local date, the value format of a date input. */
export const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
/** The local date of a `YYYY-MM-DD` value, or undefined when it is not one. */
export function fromIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return toIsoDate(date) === value ? date : undefined
}

/** Days of a month as weeks, padded with null so every week has seven cells. */
function weeks(month: Date): (Date | null)[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const cells: (Date | null)[] = Array(first.getDay()).fill(null)
  for (let day = 1; day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); day++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7))
}

/**
 * A date field with a calendar popover, the same look in every form. The value
 * is `YYYY-MM-DD`, or "" when empty; `max` is the last selectable day.
 */
export function DatePicker({ value, onChange, disabled, placeholder = "Pick a date", max, clearable = true, className, ...props }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  max?: string
  clearable?: boolean
  className?: string
  "aria-label"?: string
}) {
  const selected = fromIsoDate(value)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => selected ?? new Date())
  const today = toIsoDate(new Date())
  const shift = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1))
  const pick = (next: string) => { onChange(next); setOpen(false) }
  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) setMonth(selected ?? new Date()) }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          {...props}
          className={cn("flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.toLocaleDateString(undefined, { dateStyle: "medium" }) : placeholder}
          </span>
          <CalendarDays className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
            <p className="text-sm font-medium" aria-live="polite">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
          </div>
          <table className="w-full text-center text-sm" role="grid">
            <thead><tr>{WEEKDAYS.map((day, index) => <th key={index} className="py-1 text-xs font-normal text-muted-foreground">{day}</th>)}</tr></thead>
            <tbody>
              {weeks(month).map((week, row) => <tr key={row}>{week.map((date, column) => {
                const iso = date ? toIsoDate(date) : ""
                return <td key={column} className="p-0.5">
                  {date && <button
                    type="button"
                    disabled={!!max && iso > max}
                    aria-label={date.toLocaleDateString(undefined, { dateStyle: "full" })}
                    aria-pressed={iso === value}
                    onClick={() => pick(iso)}
                    className={cn("size-8 rounded-md text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30",
                      iso === today && "border border-primary", iso === value && "bg-primary text-primary-foreground hover:bg-primary")}
                  >{date.getDate()}</button>}
                </td>
              })}</tr>)}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between text-xs">
            {clearable ? <Button type="button" variant="ghost" size="sm" onClick={() => pick("")}>Clear</Button> : <span />}
            <Button type="button" variant="ghost" size="sm" disabled={!!max && today > max} onClick={() => pick(today)}>Today</Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

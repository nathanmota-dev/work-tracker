import type { ComponentType, ReactNode } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** One row of list filters: a search field followed by `FilterSelect`s. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="search" className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
}

export function FilterSearch({ value, placeholder, label, onChange }: {
  value: string
  placeholder: string
  label?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative min-w-56 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-full border bg-transparent pr-9 pl-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}
          className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export type FilterOption = { value: string; label: string }

/**
 * Pill dropdown of one filter. `value` "" is the "any" option, labelled by `label`;
 * a chosen option replaces the label so the active filters read at a glance.
 */
export function FilterSelect({ icon: Icon, label, anyLabel, value, options, onChange }: {
  icon: ComponentType<{ className?: string }>
  label: string
  /** The "no filter" item; defaults to "Any". */
  anyLabel?: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}) {
  const chosen = options.find(option => option.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`${label}: ${chosen?.label ?? anyLabel ?? "Any"}`}
          className={cn("h-9 rounded-full px-3.5 font-normal", chosen && "border-foreground/30 bg-accent/50")}>
          <Icon className="size-4 text-muted-foreground" />
          {chosen?.label ?? label}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">{anyLabel ?? "Any"}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

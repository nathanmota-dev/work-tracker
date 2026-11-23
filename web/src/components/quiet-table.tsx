import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { QuietApplication } from "@/lib/application-board"

const day = (value: string | null) => {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { dateStyle: "medium" })
    : "—"
}

/** Quiet applications with a checkbox per row and one that selects them all. */
export function QuietTable({
  items,
  selected,
  disabled,
  onChange,
}: {
  items: QuietApplication[]
  selected: Set<number>
  disabled: boolean
  onChange: (selected: Set<number>) => void
}) {
  if (!items.length)
    return <p className="text-sm text-muted-foreground">No submitted application is quiet for this long.</p>
  const all = items.every((item) => selected.has(item.id))
  function toggle(id: number, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    onChange(next)
  }
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <Table aria-label="Quiet applications">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={all}
                disabled={disabled}
                onChange={(e) => onChange(new Set(e.target.checked ? items.map((item) => item.id) : []))}
              />
            </TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead className="text-right">Days quiet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const name = item.company_name ?? `Application #${item.id}`
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${name}`}
                    checked={selected.has(item.id)}
                    disabled={disabled}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                  />
                </TableCell>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell>{item.role_title ?? "—"}</TableCell>
                <TableCell>{item.stage_name}</TableCell>
                <TableCell>{day(item.applied_at)}</TableCell>
                <TableCell className="text-right">{item.days_quiet}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

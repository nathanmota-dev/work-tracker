import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { SelectControl } from "@/components/ui/select-control"
import { useState, type ReactNode } from "react"
import { ArrowUpRight, Inbox, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { openExternal, text, webUrl, type Row } from "@/lib/api"
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-medium">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </header>
      {children}
    </section>
  )
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className="min-w-0 gap-4 rounded-2xl py-4 shadow-none">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  )
}
export function Empty({
  title = "Nothing here yet",
  description = "Your saved activity will appear here.",
  children,
}: {
  title?: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      <span className="rounded-xl border bg-muted/30 p-3">
        <Inbox className="size-5 text-muted-foreground" />
      </span>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean
  error: string
  retry: () => void
}) {
  if (error)
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 p-4 text-sm"
      >
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={retry} className="mt-3">
          <RefreshCw />
          Try again
        </Button>
      </div>
    )
  if (loading)
    return (
      <div aria-label="Loading workspace" role="status" className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    )
  return null
}
export function Stats({
  items,
}: {
  items: { label: string; value: ReactNode; hint?: string }[]
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <Card key={item.label} className="gap-0 rounded-2xl py-4 shadow-none">
          <CardContent className="px-4">
            <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
              <span
                className="size-1.5 rounded-full"
                style={{ background: `var(--chart-${(index % 5) + 1})` }}
              />
              {item.label}
            </p>
            <p className="text-[22px] font-semibold tracking-tight tabular-nums">
              {item.value}
            </p>
            {item.hint && (
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
export function Status({ value }: { value: unknown }) {
  return (
    <Badge
      variant="outline"
      className="max-w-full rounded-md bg-muted/30 font-normal"
    >
      {text(value).replaceAll("_", " ")}
    </Badge>
  )
}
export function ExternalLink({
  value,
  label = "Open link",
}: {
  value: unknown
  label?: string
}) {
  const [error, setError] = useState("")
  if (!webUrl(value)) return null
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void openExternal(value).catch((e) => setError(String(e.message)))
        }
      >
        {label}
        <ArrowUpRight className="size-3.5" />
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
export const controlClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-xs font-medium">
      {label}
      {children}
    </label>
  )
}
export function Details({
  row,
  title,
  onClose,
  children,
}: {
  row: Row | null
  title: string
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <Dialog
      open={!!row}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Details saved in your workspace</DialogDescription>
        </DialogHeader>
        <dl className="space-y-4">
          {Object.entries(row ?? {})
            .filter(([, v]) => v != null && v !== "")
            .map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 text-sm"
              >
                <dt className="capitalize text-muted-foreground">
                  {key.replaceAll("_", " ")}
                </dt>
                <dd className="whitespace-pre-wrap break-words">
                  {text(value)}
                </dd>
              </div>
            ))}
        </dl>
        {children}
      </DialogContent>
    </Dialog>
  )
}
export interface Column {
  key: string
  label: string
  render?: (row: Row) => ReactNode
}
export function Records({
  rows,
  columns,
  noun,
  onSelect,
  action,
}: {
  rows: Row[]
  columns: Column[]
  noun: string
  onSelect?: (row: Row) => void
  action?: ReactNode
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(0)
  const statuses = [
    ...new Set(
      rows
        .map((r) => r.status ?? r.state)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const filtered = rows.filter(
    (row) =>
      (!status || String(row.status ?? row.state) === status) &&
      Object.values(row).some((v) =>
        text(v).toLowerCase().includes(query.toLowerCase()),
      ),
  )
  const lastPage = Math.max(0, Math.ceil(filtered.length / 15) - 1)
  const current = Math.min(page, lastPage)
  return (
    <Panel
      title={noun}
      action={<Badge variant="secondary">{rows.length}</Badge>}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label={`Search ${noun}`}
            placeholder={`Search ${noun.toLowerCase()}…`}
            className="pl-9"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
          />
        </div>
        {statuses.length > 0 && (
          <SelectControl
            aria-label="Filter by status"
            className={controlClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </SelectControl>
        )}
        {action}
      </div>
      {!filtered.length ? (
        <Empty
          title={
            rows.length ? "No matching results" : `No ${noun.toLowerCase()} yet`
          }
          description={
            rows.length
              ? "Try a different search or status filter."
              : "As your job search progresses, your records will appear here."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      className="px-3 py-3 text-xs font-normal text-muted-foreground"
                    >
                      {col.label}
                    </TableHead>
                  ))}
                  {onSelect && (
                    <TableHead className="px-3">
                      <span className="sr-only">Details</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered
                  .slice(current * 15, (current + 1) * 15)
                  .map((row, i) => (
                    <TableRow
                      key={text(row.id ?? row.key ?? i)}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      {columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className="max-w-72 px-3 py-4 align-top break-words"
                        >
                          {col.render ? col.render(row) : text(row[col.key])}
                        </TableCell>
                      ))}
                      {onSelect && (
                        <TableCell className="px-3 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`View ${text(row.title ?? row.name ?? row.key ?? row.job_title ?? row.company ?? row.id)}`}
                            onClick={() => onSelect(row)}
                          >
                            View
                            <ArrowUpRight className="size-3" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {filtered.length} results · Page {current + 1} of {lastPage + 1}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={current >= lastPage}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}

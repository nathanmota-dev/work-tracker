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
import { ArrowUpRight, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Empty, Panel, controlClass } from "@/components/workspace-ui"
import { text, type Row } from "@/lib/api"

export interface Column {
  key: string
  label: string
  render?: (row: Row) => ReactNode
}
const PAGE_SIZE = 15

function RecordFilters({
  noun,
  query,
  status,
  statuses,
  action,
  onQuery,
  onStatus,
}: {
  noun: string
  query: string
  status: string
  statuses: string[]
  action?: ReactNode
  onQuery: (value: string) => void
  onStatus: (value: string) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <div className="relative min-w-40 flex-1">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label={`Search ${noun}`}
          placeholder={`Search ${noun.toLowerCase()}…`}
          className="pl-9"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {statuses.length > 0 && (
        <SelectControl
          aria-label="Filter by status"
          className={controlClass}
          value={status}
          onChange={(e) => onStatus(e.target.value)}
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
  )
}

function RecordTable({
  rows,
  columns,
  onSelect,
  rowKey,
}: {
  rows: Row[]
  columns: Column[]
  onSelect?: (row: Row) => void
  rowKey?: (row: Row) => string
}) {
  return (
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
          {rows.map((row, i) => (
            <TableRow
              key={rowKey ? rowKey(row) : text(row.id ?? row.key ?? i)}
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
  )
}

function Pagination({
  total,
  current,
  lastPage,
  onPage,
}: {
  total: number
  current: number
  lastPage: number
  onPage: (page: number) => void
}) {
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
      <span>
        {total} results · Page {current + 1} of {lastPage + 1}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={current === 0}
          onClick={() => onPage(current - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={current >= lastPage}
          onClick={() => onPage(current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export function Records({
  rows,
  columns,
  noun,
  onSelect,
  action,
  statusKey,
  rowKey,
}: {
  rows: Row[]
  columns: Column[]
  noun: string
  onSelect?: (row: Row) => void
  action?: ReactNode
  /** Column the status filter reads; defaults to `status`, then `state`. */
  statusKey?: string
  rowKey?: (row: Row) => string
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(0)
  const statusOf = (row: Row) =>
    statusKey ? row[statusKey] : (row.status ?? row.state)
  const statuses = [
    ...new Set(
      rows
        .map(statusOf)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const filtered = rows.filter(
    (row) =>
      (!status || String(statusOf(row)) === status) &&
      Object.values(row).some((v) =>
        text(v).toLowerCase().includes(query.toLowerCase()),
      ),
  )
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  return (
    <Panel
      title={noun}
      action={<Badge variant="secondary">{rows.length}</Badge>}
    >
      <RecordFilters
        noun={noun}
        query={query}
        status={status}
        statuses={statuses}
        action={action}
        onQuery={(value) => {
          setQuery(value)
          setPage(0)
        }}
        onStatus={(value) => {
          setStatus(value)
          setPage(0)
        }}
      />
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
          <RecordTable
            rows={filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)}
            columns={columns}
            onSelect={onSelect}
            rowKey={rowKey}
          />
          <Pagination
            total={filtered.length}
            current={current}
            lastPage={lastPage}
            onPage={setPage}
          />
        </>
      )}
    </Panel>
  )
}

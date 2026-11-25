import { createContext, useContext, useState, type ReactNode } from "react"
import { ArrowUpRight, Inbox, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"

// Hub tabs show whole pages as sections of one parent page.
const EmbeddedPage = createContext(false)
export function PageSection({ children }: { children: ReactNode }) {
  return <EmbeddedPage.Provider value>{children}</EmbeddedPage.Provider>
}
/**
 * @param back A BackButton shown left of the title.
 * @param fill The page takes the visible height instead of growing with its content, so a child can fill it.
 */
export function Page({
  title,
  description,
  actions,
  back,
  fill,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  back?: ReactNode
  fill?: boolean
  children: ReactNode
}) {
  const embedded = useContext(EmbeddedPage)
  const Heading = embedded ? "h2" : "h1"
  return (
    <section
      aria-label={embedded ? title : undefined}
      className={embedded ? "flex min-w-0 flex-col gap-4" : cn("flex min-w-0 flex-1 flex-col gap-6 p-6", fill && "min-h-0")}
    >
      <header className={embedded && !description && !actions ? "sr-only" : "flex flex-wrap items-start justify-between gap-4"}>
        <div className="flex min-w-0 items-start gap-2">
          {back}
          <div className="min-w-0">
            <Heading className={cn(embedded ? "text-sm font-medium" : "text-base font-medium", back && "leading-8")}>{title}</Heading>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </header>
      {children}
    </section>
  )
}
/** @param fill The panel takes its container's height and its content the remaining space. */
export function Panel({
  title,
  children,
  action,
  fill,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
  fill?: boolean
}) {
  return (
    <Card className={cn("min-w-0 gap-4 rounded-2xl py-4 shadow-none", fill && "h-full min-h-0")}>
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <CardContent className={cn("min-w-0 px-4", fill && "flex min-h-0 flex-1 flex-col")}>{children}</CardContent>
    </Card>
  )
}
export function Empty({
  title = "Nothing here yet",
  description = "Your saved activity will appear here.",
  children,
}: {
  title?: string
  description?: ReactNode
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
  className = "xl:grid-cols-4",
}: {
  items: { label: string; value: ReactNode; hint?: string }[]
  className?: string
}) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
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
  omit = [],
}: {
  row: Row | null
  title: string
  onClose: () => void
  children?: ReactNode
  /** Keys shown by a dedicated child component instead of the raw list. */
  omit?: string[]
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
            .filter(([key, v]) => v != null && v !== "" && !omit.includes(key))
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

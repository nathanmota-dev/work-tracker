import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/**
 * Side panel form with a scrolling body and a fixed Cancel and submit footer.
 * It cannot be closed while saving, so a pending save never loses its result.
 */
export function FormSheet({
  title,
  description,
  busy,
  error,
  submitLabel,
  canSubmit = true,
  className,
  footer,
  onClose,
  onSubmit,
  children,
}: {
  title: ReactNode
  description: ReactNode
  busy: boolean
  error: string
  submitLabel: string
  canSubmit?: boolean
  className?: string
  /** Extra content shown above the footer buttons, such as a hint. */
  footer?: ReactNode
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <SheetContent showCloseButton={!busy} className={cn("w-full gap-0 sm:max-w-xl", className)}>
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">{children}</div>
          <div className="space-y-3 border-t px-6 py-4">
            {footer}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || !canSubmit}>{busy ? "Saving…" : submitLabel}</Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/** A titled group of fields inside a form sheet. */
export function FormSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className={cn("grid gap-3 sm:grid-cols-2", className)}>{children}</div>
    </section>
  )
}

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { useBlocker } from "@tanstack/react-router"
import { Download, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Empty, Page, Panel } from "@/components/workspace-ui"
import { ResumeSourceEditor } from "@/components/resume-source-editor"
import { ResumeVariantCard } from "@/components/resume-variant-card"
import { useResumeLatex } from "@/lib/resume-latex"
import type { ResumeVariant } from "@/lib/variants"
const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))

/** Ctrl+S or Cmd+S anywhere on the page runs `save` instead of the browser's own save. */
function useSaveShortcut(save: () => void) {
  const latest = useRef(save)
  useEffect(() => { latest.current = save })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

/** Asks before leaving the page with unsaved LaTeX, by link, back button or closing the window. */
function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker({ shouldBlockFn: () => dirty, enableBeforeUnload: () => dirty, withResolver: true })
  return <Dialog open={blocker.status === "blocked"} onOpenChange={open => { if (!open) blocker.reset?.() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogDescription>Your LaTeX edits are not saved. Leaving now discards them.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => blocker.reset?.()}>Keep editing</Button>
        <Button variant="destructive" onClick={() => blocker.proceed?.()}>Discard changes</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

/**
 * A saved resume as an editor: its LaTeX and details on the left, its PDF on
 * the right. Saving compiles a new PDF that replaces the one shown.
 */
export function ResumeWorkspace({ variant, busy, back }: { variant: ResumeVariant; busy: boolean; back: ReactNode }) {
  const latex = useResumeLatex(variant.id)
  const [error, setError] = useState("")
  const locked = variant.status === "generating" || variant.status === "waiting_for_sign_in" || !!variant.archivedAt
  const canSave = latex.status === "ready" && latex.dirty && !latex.saving && !locked
  const save = () => { if (canSave) void latex.save() }
  useSaveShortcut(save)
  const download = () => { setError(""); void window.desktop?.savePdf(variant.pdf!.id).catch((e: Error) => setError(e.message)) }
  const actions = <>
    {latex.status === "ready" && <Button disabled={!canSave} onClick={save} title="Save and compile (Ctrl+S)"><Save />{latex.saving ? "Saving…" : "Save"}</Button>}
    <Button variant="outline" disabled={!variant.pdf} onClick={download}><Download />Download</Button>
  </>
  // From xl up, both halves share the visible height: the editor and the PDF scroll on their own.
  return <Page title={variant.name} back={back} actions={actions} fill>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-2">
      <Tabs defaultValue="code" className="h-[85dvh] min-h-0 gap-3 xl:h-auto">
        <TabsList><TabsTrigger value="code">Code</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList>
        <TabsContent value="code" className="min-h-0 flex-1"><ResumeSourceEditor latex={latex} readOnly={locked || latex.saving} /></TabsContent>
        <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto"><ResumeVariantCard variant={variant} busy={busy} /></TabsContent>
      </Tabs>
      <div className="flex h-[85dvh] min-h-0 flex-col xl:h-auto">
        {variant.pdf
          ? <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfViewer title={`${variant.name} PDF`} artifact={variant.pdf} download={false} fill /></Suspense>
          : <Panel title="PDF"><Empty title="No PDF yet" description="The PDF appears here once the resume is ready." /></Panel>}
      </div>
    </div>
    <UnsavedChangesGuard dirty={latex.dirty} />
  </Page>
}

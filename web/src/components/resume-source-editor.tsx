import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { Empty } from "@/components/workspace-ui"
import type { LatexError, ResumeLatex } from "@/lib/resume-latex"
import { cn } from "@/lib/utils"
// CodeMirror loads only when a resume with LaTeX is opened.
const LatexCodeEditor = lazy(() => import("@/components/latex-code-editor").then(module => ({ default: module.LatexCodeEditor })))

/** The last save's compilation errors; each one opens its file at its line. */
function SaveFailure({ latex, onOpen }: { latex: ResumeLatex; onOpen: (error: LatexError) => void }) {
  if (!latex.failure) return null
  const [summary, ...rest] = latex.failure.split("\n")
  return <div role="alert" className="max-h-40 shrink-0 space-y-2 overflow-y-auto rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
    <p className="font-medium text-destructive">{summary}</p>
    {latex.errors.length
      ? <ul className="space-y-1">{latex.errors.map((error, index) => <li key={index}>
        <button type="button" className="text-left hover:underline" onClick={() => onOpen(error)}>
          <span className="font-mono text-muted-foreground">{error.file}:{error.line}</span> {error.message}
        </button>
      </li>)}</ul>
      : rest.length > 0 && <pre className="whitespace-pre-wrap font-mono text-muted-foreground">{rest.join("\n")}</pre>}
  </div>
}

/**
 * The LaTeX files of a saved resume in a code editor, with the file picker
 * when the project has several and the errors of the last save.
 */
export function ResumeSourceEditor({ latex, readOnly }: { latex: ResumeLatex; readOnly?: boolean }) {
  const [focus, setFocus] = useState<{ line: number }>()
  if (latex.status === "loading") return <p role="status" className="text-sm text-muted-foreground">Loading LaTeX…</p>
  if (latex.status === "missing") return <Empty title="No LaTeX source" description="This resume was imported as a PDF, so there is no LaTeX to edit. Its PDF is still available to download." />
  if (latex.status === "error") return <div role="alert" className="space-y-2 text-sm">
    <p className="text-destructive">{latex.loadError}</p>
    <Button size="sm" variant="outline" onClick={latex.retry}>Try again</Button>
  </div>
  const file = latex.files.find(item => item.name === latex.active) ?? latex.files[0]!
  const open = (error: LatexError) => {
    if (latex.files.some(item => item.name === error.file)) latex.setActive(error.file)
    setFocus({ line: error.line })
  }
  return <div className="flex h-full min-h-0 flex-col gap-3">
    {(latex.files.length > 1 || latex.dirty) && <div className="flex flex-wrap items-center gap-3 text-xs">
      {latex.files.length > 1 && <SelectControl aria-label="LaTeX file" className="h-8 w-56" value={file.name} onChange={event => { setFocus(undefined); latex.setActive(event.target.value) }}>
        {latex.files.map(item => <option key={item.name} value={item.name}>{latex.isChanged(item.name) ? `${item.name} •` : item.name}</option>)}
      </SelectControl>}
      {latex.dirty && <span className={cn("text-muted-foreground", latex.saving && "animate-pulse")}>{latex.saving ? "Saving and compiling…" : "Unsaved changes"}</span>}
    </div>}
    <div className="min-h-0 flex-1">
      <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading editor…</p>}>
        <LatexCodeEditor key={file.name} label={`LaTeX of ${file.name}`} value={file.text} readOnly={readOnly} focus={focus} onChange={text => latex.edit(file.name, text)} />
      </Suspense>
    </div>
    <SaveFailure latex={latex} onOpen={open} />
  </div>
}

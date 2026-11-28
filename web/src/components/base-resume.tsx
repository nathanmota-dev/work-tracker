import { lazy, Suspense } from "react"
import { Badge } from "@/components/ui/badge"
import { ResumeSources } from "@/components/resume-sources"
import { Empty, LoadState, Panel } from "@/components/workspace-ui"
import { useApi } from "@/lib/api"
import type { SourcesState } from "@/lib/preparation"
import { resumeHref } from "@/lib/variants"
const LatexCodeEditor = lazy(() => import("@/components/latex-code-editor").then(module => ({ default: module.LatexCodeEditor })))

/** Id of the base resume in the Resumes routes; saved variants use generated ids. */
export const BASE_RESUME_ID = "base"

/**
 * The default resume in the Resumes grid. It is never tailored or scored:
 * every tailored resume is generated from it as a new variant.
 */
export function BaseResumeTile() {
  const api = useApi<SourcesState>("resume-sources")
  const source = api.data?.source
  const detail = !api.data ? "Loading…" : source ? `Built from ${source.file}` : "Upload your profile to start"
  return <a href={resumeHref(BASE_RESUME_ID)} aria-label="Base resume (default)"
    className="group flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
    <div className="relative rounded-lg bg-accent/30 py-4">
      <div aria-hidden className="relative mx-auto flex h-32 w-24 flex-col items-center gap-2 rounded-sm bg-muted px-3 pt-4 shadow-sm transition-transform group-hover:-rotate-2">
        <span className="h-2 w-12 self-start rounded bg-muted-foreground/30" />
        {[10, 14, 12, 16, 11, 13].map((width, i) => <span key={i} className="h-1.5 self-start rounded bg-muted-foreground/20" style={{ width: `${width * 4}px` }} />)}
      </div>
      <span className="absolute right-2 top-2"><Badge>Default</Badge></span>
    </div>
    <div className="min-w-0 space-y-2">
      <h3 className="truncate text-sm font-medium">Base resume</h3>
      <p className="truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
      <p className="text-xs text-muted-foreground">Generated from your profile: tailored resumes are new variants.</p>
    </div>
  </a>
}

function LatexView() {
  const latex = useApi<{ file: string; text: string }>("resume-sources/latex")
  return <>
    <LoadState {...latex} retry={latex.refresh} />
    {latex.data && <div className="h-[60dvh] min-h-0">
      <Suspense fallback={<p role="status">Loading editor…</p>}><LatexCodeEditor label={`${latex.data.file} (read-only)`} value={latex.data.text} onChange={() => {}} readOnly /></Suspense>
    </div>}
  </>
}
/** The generated LaTeX, read-only: the profile is what changes it. */
function BaseLatex() {
  const sources = useApi<SourcesState>("resume-sources")
  return <Panel title="Generated LaTeX">
    {sources.data?.source ? <LatexView /> : <Empty title="No LaTeX yet" description="It appears once your profile has resume data or a LinkedIn PDF." />}
  </Panel>
}

/** The base resume's page: its status and generated LaTeX on the left, its PDF filling the rest. */
export function BaseResumeDetail() {
  return <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(18rem,32rem)_1fr] [&>*:first-child]:xl:min-h-0 [&>*:first-child]:xl:overflow-y-auto">
    <ResumeSources friendly fill><BaseLatex /></ResumeSources>
  </div>
}

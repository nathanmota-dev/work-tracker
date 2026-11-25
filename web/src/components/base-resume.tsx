import { Badge } from "@/components/ui/badge"
import { ResumeSources } from "@/components/resume-sources"
import { useApi } from "@/lib/api"
import type { SourcesState } from "@/lib/preparation"
import { resumeHref } from "@/lib/variants"

/** Id of the base resume in the Resumes routes; saved variants use generated ids. */
export const BASE_RESUME_ID = "base"

const name = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? ""

/**
 * The default resume in the Resumes grid. It is never tailored or scored:
 * every tailored resume is generated from it as a new variant.
 */
export function BaseResumeTile() {
  const api = useApi<SourcesState>("resume-sources")
  const config = api.data?.config
  const ready = !!config?.projectDir
  const detail = !api.data ? "Loading…" : ready ? `${config.mainFile} · ${name(config.projectDir)}` : "Add your LaTeX resume to start"
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
      <p className="text-xs text-muted-foreground">Never changes: tailored resumes are new variants.</p>
    </div>
  </a>
}

/** The base resume's page: its sources on the left and its PDF filling the rest, like a saved resume. */
export function BaseResumeDetail() {
  return <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(18rem,26rem)_1fr] [&>*:first-child]:xl:min-h-0 [&>*:first-child]:xl:overflow-y-auto">
    <ResumeSources friendly fill />
  </div>
}

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { LoadState, Panel } from "@/components/workspace-ui"
import { PdfViewer } from "@/components/pdf-viewer"
import { request, publish, useApi } from "@/lib/api"
import type { PdfArtifact, SourcesState } from "@/lib/preparation"

const KIND = { data: "resume data", linkedin: "LinkedIn export" } as const

/** Which profile file the base resume is built from, or how to add one. */
function SourceLine({ state }: { state: SourcesState }) {
  if (!state.source) return <p className="text-sm">Upload your resume data (.json) or your LinkedIn PDF in <a className="underline" href="#/profile">Profile</a>: your base resume is built from it.</p>
  return <p className="text-sm">Built from <span className="font-medium break-all">{state.source.file}</span> ({KIND[state.source.kind]}). It is generated again whenever your profile changes.</p>
}

/**
 * The base resume every tailored resume starts from: generated from the
 * profile, compiled with pdfLaTeX. `friendly` (Resumes → Base resume) also
 * shows `children` under the panel and the PDF beside them, compiling it when missing.
 */
export function ResumeSources({ onPreview, friendly = false, fill = false, children }: { onPreview?: (artifact: PdfArtifact) => void; friendly?: boolean; fill?: boolean; children?: ReactNode }) {
  const api = useApi<SourcesState>("resume-sources")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  async function preview() {
    setBusy(true); setError("")
    try { const artifact = await request<PdfArtifact>("resume-sources/preview", {}); onPreview?.(artifact); api.refresh(); publish({ type: "resume-sources-changed" }); setNotice(`Base PDF ready (${artifact.pages} pages).`) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  // Opening Base resume, or changing the profile while it is open, compiles the missing PDF.
  // The last PDF stays shown until the new one is ready.
  const compiled = useRef<string | null>(null)
  const shown = useRef<PdfArtifact | null>(null)
  const data = api.data
  if (data?.preview) shown.current = data.preview
  const ready = !!data?.source && !data.preview && !data.busy && data.dependencies.every(d => d.available)
  // Each profile version is compiled once: a failure is not retried until the profile changes again.
  useEffect(() => {
    const version = data?.version ?? null
    if (!friendly || !ready || busy || compiled.current === version) return
    compiled.current = version
    void preview()
  })
  const panel = <Panel title="Base resume">
    <LoadState {...api} retry={api.refresh} />
    {data && <div className="space-y-3">
      <SourceLine state={data} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || data.busy || !data.source || data.dependencies.some(d => !d.available)} onClick={() => void preview()}>{busy ? "Compiling…" : "Update base PDF"}</Button>
        {busy && <Button type="button" variant="outline" onClick={() => void request("application-preparation/cancel", { runId: "preview" }).catch(e => setError(e.message))}>Cancel</Button>}
      </div>
      {data.dependencies.some(d => !d.available) && <p className="text-sm text-muted-foreground">Install these tools and make them available on PATH: {data.dependencies.filter(d => !d.available).map(d => d.command).join(", ")}. The resume also needs the Roboto, titlesec, enumitem and fancyhdr LaTeX packages.</p>}
      {data.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </Panel>
  return friendly ? <><div className="space-y-4">{panel}{children}</div><div className={fill ? "flex h-[85dvh] min-h-0 flex-col xl:h-auto" : undefined}><PdfViewer title="Base resume PDF" artifact={data?.preview ?? shown.current} fill={fill} /></div></> : panel
}

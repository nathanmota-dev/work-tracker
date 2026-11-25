import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectControl } from "@/components/ui/select-control"
import { Field, LoadState, Panel, controlClass } from "@/components/workspace-ui"
import { PdfViewer } from "@/components/pdf-viewer"
import { request, publish, useApi } from "@/lib/api"
import type { PdfArtifact, ResumeSourcesConfig, SourcesState } from "@/lib/preparation"
const empty: ResumeSourcesConfig = { projectDir: "", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir: "" }
type PathKey = "projectDir" | "dataFile" | "profileDir"
const name = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? ""
const SOURCES: { key: PathKey; label: string; shown: (config: ResumeSourcesConfig) => string; empty: string }[] = [
  { key: "projectDir", label: "LaTeX resume", shown: config => config.mainFile, empty: "Not selected" },
  { key: "dataFile", label: "Resume data", shown: config => name(config.dataFile), empty: "Optional: only the LaTeX is used" },
  { key: "profileDir", label: "Profile folder", shown: config => name(config.profileDir), empty: "Not selected" },
]
/** Each source by its file or folder name only; the full paths stay under Advanced. */
function SourceSummary({ config, busy, choose }: { config: ResumeSourcesConfig; busy: boolean; choose: (key: PathKey) => void }) {
  return <ul className="divide-y rounded-lg border text-sm" aria-label="Selected sources">
    {SOURCES.map(source => {
      const selected = config[source.key] ? source.shown(config) : ""
      return <li key={source.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
        <span className="font-medium">{source.label}</span>
        <span className={selected ? "break-all" : "text-muted-foreground"}>{selected || source.empty}</span>
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={busy || !window.desktop?.chooseSource} aria-label={`${selected ? "Change" : "Choose"} ${source.label}`} onClick={() => choose(source.key)}>{selected ? "Change" : "Choose"}</Button>
      </li>
    })}
  </ul>
}
type Fields = { draft: ResumeSourcesConfig; busy: boolean; change: (key: keyof ResumeSourcesConfig, value: string) => void; choose: (key: PathKey) => void }
function SourceFields({ draft, busy, change, choose }: Fields) {
  return <div className="space-y-4">
    <Field label="LaTeX project folder"><div className="flex gap-2"><Input value={draft.projectDir} onChange={e => change("projectDir", e.target.value)} placeholder="/path/to/base/latex" disabled={busy} /><Button type="button" variant="outline" onClick={() => choose("projectDir")} disabled={busy}>Browse</Button></div></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Main .tex file"><Input value={draft.mainFile} onChange={e => change("mainFile", e.target.value)} disabled={busy} /></Field>
      <Field label="Compiler"><SelectControl className={controlClass} value={draft.engine} onChange={e => change("engine", e.target.value)} disabled={busy}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></SelectControl></Field>
    </div>
    <Field label="Optional data file (.json)"><div className="flex gap-2"><Input value={draft.dataFile} onChange={e => change("dataFile", e.target.value)} placeholder="Leave empty to use only the LaTeX" disabled={busy} /><Button type="button" variant="outline" onClick={() => choose("dataFile")} disabled={busy}>Browse</Button></div></Field>
    <Field label="Profile folder"><div className="flex gap-2"><Input value={draft.profileDir} onChange={e => change("profileDir", e.target.value)} placeholder="Folder with your LinkedIn export and resume PDFs" disabled={busy} /><Button type="button" variant="outline" onClick={() => choose("profileDir")} disabled={busy}>Browse</Button></div></Field>
  </div>
}
/**
 * The LaTeX project, data file and profile folder of every tailored resume.
 * `friendly` (Resumes → Base resume) names each source without its path, keeps
 * the paths under Advanced and shows the base PDF, compiling it when missing.
 */
export function ResumeSources({ onPreview, friendly = false, fill = false }: { onPreview?: (artifact: PdfArtifact) => void; friendly?: boolean; fill?: boolean }) {
  const api = useApi<SourcesState>("resume-sources")
  const [draft, setDraft] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => { if (api.data && !dirty) setDraft(api.data.config) }, [api.data, dirty])
  function change(key: keyof ResumeSourcesConfig, value: string) { setDraft(d => ({ ...d, [key]: value })); setDirty(true); setNotice("") }
  async function pick(key: PathKey) { return window.desktop?.chooseSource(key === "dataFile" ? "data" : "folder") }
  async function choose(key: PathKey) {
    try { const value = await pick(key); if (value) change(key, value) }
    catch (e) { setError((e as Error).message) }
  }
  /** Choosing from the summary saves at once, with the other sources as they are saved. */
  async function chooseAndSave(key: PathKey) {
    try { const value = await pick(key); if (value) { setDirty(false); await save({ ...(api.data?.config ?? draft), [key]: value }) } }
    catch (e) { setError((e as Error).message) }
  }
  async function save(config = draft) {
    setBusy(true); setError("")
    try {
      const state = await request<SourcesState>("resume-sources", config)
      setDirty(false); setNotice("Resume sources saved."); api.refresh(); publish({ type: "resume-sources-changed" })
      if (state.dependencies.every(d => d.available)) {
        setPreviewing(true)
        const artifact = await request<PdfArtifact>("resume-sources/preview", {})
        onPreview?.(artifact); api.refresh(); publish({ type: "resume-sources-changed" }); setNotice("Sources saved and base PDF ready.")
      }
    }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false); setPreviewing(false) }
  }
  async function preview() {
    setPreviewing(true); setBusy(true); setError("")
    try { const artifact = await request<PdfArtifact>("resume-sources/preview", {}); onPreview?.(artifact); api.refresh(); publish({ type: "resume-sources-changed" }); setNotice(`Base PDF ready (${artifact.pages} pages).`) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false); setPreviewing(false) }
  }
  // Opening Base resume compiles a missing base PDF once; a failure is shown and left to retry.
  // Profile changes give the sources a new version: the last PDF stays shown until it is updated.
  const compiled = useRef(false)
  const shown = useRef<PdfArtifact | null>(null)
  const data = api.data
  if (data?.preview) shown.current = data.preview
  const ready = !!data && !data.preview && !shown.current && !data.busy && !!data.config.projectDir && data.dependencies.every(d => d.available)
  useEffect(() => {
    if (!friendly || compiled.current || !ready || busy || dirty) return
    compiled.current = true
    void preview()
  })
  const fields = <SourceFields draft={draft} busy={busy} change={change} choose={key => void choose(key)} />
  const panel = <Panel title="Resume sources">
    <p className="mb-4 text-sm text-muted-foreground">{friendly ? "The LaTeX resume every tailored resume starts from, your optional resume data and your profile folder. A resume in base/latex and a profile in base/data are detected automatically. Each execution uses its own copy." : "Your local resume in base/latex/resume.tex and your profile folder base/data, with resume-data.json, your LinkedIn export and other resume PDFs, are detected automatically. Change these paths to use another project. Each execution uses its own copy."}</p>
    <LoadState {...api} retry={api.refresh} />
    {api.data && friendly && <SourceSummary config={api.data.config} busy={busy || api.data.busy} choose={key => void chooseAndSave(key)} />}
    {api.data && <form className={friendly ? "mt-4 space-y-4" : "space-y-4"} onSubmit={e => { e.preventDefault(); void save() }}>
      {friendly ? <details className="text-sm" open={dirty || undefined}>
        <summary className="cursor-pointer text-muted-foreground">Advanced: paths and compiler</summary>
        <div className="mt-4">{fields}</div>
      </details> : fields}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || api.data.busy || !dirty}>{busy ? "Working…" : "Save sources"}</Button><Button type="button" variant="outline" disabled={busy || api.data.busy || dirty || !draft.projectDir || api.data.dependencies.some(d => !d.available)} onClick={() => void preview()}>Update base PDF</Button>{previewing && <Button type="button" variant="outline" onClick={() => void request("application-preparation/cancel", { runId: "preview" }).catch(e => setError(e.message))}>Cancel preview</Button>}</div>
      {api.data.dependencies.some(d => !d.available) && <p className="text-sm text-muted-foreground">Install these tools and make them available on PATH: {api.data.dependencies.filter(d => !d.available).map(d => d.command).join(", ")}. The project may also require LaTeX packages and fonts.</p>}
      {api.data.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>}
  </Panel>
  return friendly ? <>{panel}<div className={fill ? "flex h-[85dvh] min-h-0 flex-col xl:h-auto" : undefined}><PdfViewer title="Base resume PDF" artifact={data?.preview ?? shown.current} fill={fill} /></div></> : panel
}

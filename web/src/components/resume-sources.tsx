import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectControl } from "@/components/ui/select-control"
import { Field, LoadState, Panel, controlClass } from "@/components/workspace-ui"
import { request, publish, useApi } from "@/lib/api"
import type { PdfArtifact, ResumeSourcesConfig, SourcesState } from "@/lib/preparation"
const empty: ResumeSourcesConfig = { projectDir: "", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir: "" }
type PathKey = "projectDir" | "dataFile" | "profileDir"
export function ResumeSources({ onPreview }: { onPreview?: (artifact: PdfArtifact) => void }) {
  const api = useApi<SourcesState>("resume-sources")
  const [draft, setDraft] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => { if (api.data && !dirty) setDraft(api.data.config) }, [api.data, dirty])
  function change(key: keyof ResumeSourcesConfig, value: string) { setDraft(d => ({ ...d, [key]: value })); setDirty(true); setNotice("") }
  async function choose(key: PathKey) {
    try { const value = await window.desktop?.chooseSource(key === "dataFile" ? "data" : "folder"); if (value) change(key, value) }
    catch (e) { setError((e as Error).message) }
  }
  async function save() {
    setBusy(true); setError("")
    try {
      const state = await request<SourcesState>("resume-sources", draft)
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
  return <Panel title="Resume sources">
    <p className="mb-4 text-sm text-muted-foreground">Your local resume in base/latex/resume.tex and your profile folder base/data, with resume-data.json, your LinkedIn export and other resume PDFs, are detected automatically. Change these paths to use another project. Each execution uses its own copy.</p>
    <LoadState {...api} retry={api.refresh} />
    {api.data && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
      <Field label="LaTeX project folder"><div className="flex gap-2"><Input value={draft.projectDir} onChange={e => change("projectDir", e.target.value)} placeholder="/path/to/base/latex" disabled={busy} /><Button type="button" variant="outline" onClick={() => void choose("projectDir")} disabled={busy}>Browse</Button></div></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Main .tex file"><Input value={draft.mainFile} onChange={e => change("mainFile", e.target.value)} disabled={busy} /></Field>
        <Field label="Compiler"><SelectControl className={controlClass} value={draft.engine} onChange={e => change("engine", e.target.value)} disabled={busy}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></SelectControl></Field>
      </div>
      <Field label="Optional data file (.json)"><div className="flex gap-2"><Input value={draft.dataFile} onChange={e => change("dataFile", e.target.value)} placeholder="Leave empty to use only the LaTeX" disabled={busy} /><Button type="button" variant="outline" onClick={() => void choose("dataFile")} disabled={busy}>Browse</Button></div></Field>
      <Field label="Profile folder"><div className="flex gap-2"><Input value={draft.profileDir} onChange={e => change("profileDir", e.target.value)} placeholder="Folder with your LinkedIn export and resume PDFs" disabled={busy} /><Button type="button" variant="outline" onClick={() => void choose("profileDir")} disabled={busy}>Browse</Button></div></Field>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || api.data.busy || !dirty}>{busy ? "Working…" : "Save sources"}</Button><Button type="button" variant="outline" disabled={busy || api.data.busy || dirty || !draft.projectDir || api.data.dependencies.some(d => !d.available)} onClick={() => void preview()}>Update base PDF</Button>{previewing && <Button type="button" variant="outline" onClick={() => void request("application-preparation/cancel", { runId: "preview" }).catch(e => setError(e.message))}>Cancel preview</Button>}</div>
      {api.data.dependencies.some(d => !d.available) && <p className="text-sm text-muted-foreground">Install these tools and make them available on PATH: {api.data.dependencies.filter(d => !d.available).map(d => d.command).join(", ")}. The project may also require LaTeX packages and fonts.</p>}
      {api.data.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>}
  </Panel>
}

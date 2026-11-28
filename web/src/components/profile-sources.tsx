import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LoadState, Panel } from "@/components/workspace-ui"
import { ProfileUpload } from "@/components/profile-upload"
import { KIND_LABELS, STATUS_LABELS, importAgain, useProfileSources, type ProfileSourcesState } from "@/lib/profile-sources"

function Files({ state }: { state: ProfileSourcesState }) {
  if (!state.assets.length) return <p className="text-sm">No files in your profile yet. Add your resume PDF, your LinkedIn PDF or your resume data.</p>
  return <ul className="space-y-2 text-sm" aria-label="Profile files">
    {state.assets.map(asset => <li key={asset.file} className="flex flex-wrap items-baseline gap-x-3 border-b pb-2 last:border-0">
      <span className="font-medium break-all">{asset.file}</span>
      <span className="text-muted-foreground">{KIND_LABELS[asset.kind ?? "pending"]}</span>
      <span className={asset.status === "failed" ? "text-destructive" : undefined}>{STATUS_LABELS[asset.status]}</span>
      {asset.warnings.map(warning => <span key={warning} className="basis-full text-xs text-muted-foreground">{warning}</span>)}
    </li>)}
  </ul>
}

/** Which file the profile and the base resume are built from. */
function Source({ source }: { source: ProfileSourcesState["source"] }) {
  if (!source) return <p className="text-sm">Add your resume data (.json) or your LinkedIn PDF: your profile and your base resume are built from it.</p>
  return <p className="text-sm">Your profile and base resume are built from <span className="font-medium break-all">{source.file}</span> ({KIND_LABELS[source.kind]}). Other PDFs are reference text for tailored resumes.</p>
}

/** What the profile folder holds and which file the profile is built from. */
export function ProfileSources() {
  const api = useProfileSources()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function run(change: () => Promise<unknown>) {
    setBusy(true); setError("")
    try { await change(); api.refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const state = api.data
  return <Panel title="Profile sources" action={state?.profileDir && state.assets.length ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(importAgain)}>{busy ? "Working…" : "Reimport all"}</Button> : undefined}>
    <p className="mb-4 text-sm text-muted-foreground">Your profile comes from one file: your resume data (.json) or your LinkedIn export (profile → More → Save to PDF). Adding one replaces the other. Resumes you already have as PDFs are kept as reference text for tailored resumes.</p>
    <LoadState loading={api.loading && !state} error={api.error} retry={api.refresh} />
    {state && <div className="space-y-4">
      <ProfileUpload disabled={busy} onUploaded={api.refresh} />
      {state.importing && <p role="status" className="text-sm text-muted-foreground">Importing your files…</p>}
      <Files state={state} />
      <Source source={state.source} />
      {state.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </Panel>
}

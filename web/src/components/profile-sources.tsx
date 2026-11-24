import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LoadState, Panel } from "@/components/workspace-ui"
import { ProfileUpload } from "@/components/profile-upload"
import { KIND_LABELS, STATUS_LABELS, chooseSource, importAgain, useProfileSources, type ChoiceSource, type LinkedInExperience, type ProfileConflict, type ProfileSourcesState } from "@/lib/profile-sources"

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

const period = (role: LinkedInExperience) => [role.start, role.end].filter(Boolean).join(" – ")
/** Read-only: extracted text is rendered as text, never as HTML. */
function Extracted({ linkedin }: { linkedin: NonNullable<ProfileSourcesState["linkedin"]> }) {
  return <details className="text-sm">
    <summary className="cursor-pointer">{linkedin.experiences} experiences · {linkedin.education} education · {linkedin.skills} skills</summary>
    <ol className="mt-3 space-y-3" aria-label="Extracted experiences">
      {linkedin.entries.map((role, index) => <li key={index}>
        <p className="font-medium">{role.title} · {role.company}</p>
        <p className="text-xs text-muted-foreground">{[period(role), role.location].filter(Boolean).join(" · ")}</p>
        {role.bullets.length > 0 && <ul className="mt-1 list-disc pl-5">{role.bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}</ul>}
      </li>)}
    </ol>
  </details>
}

const OPTIONS: [ChoiceSource | null, string][] = [["data", "Data file"], ["linkedin", "LinkedIn"], [null, "Decide later"]]
function Conflicts({ conflicts, busy, choose }: { conflicts: ProfileConflict[]; busy: boolean; choose: (conflict: ProfileConflict, source: ChoiceSource | null) => void }) {
  const decided = conflicts.filter(conflict => conflict.chosen).length
  return <section aria-label="Profile conflicts" className="space-y-3 text-sm">
    <p className="font-medium">{decided} of {conflicts.length} conflicts decided</p>
    <p className="text-xs text-muted-foreground">Your data file and the LinkedIn export disagree. Choose the correct value once; tailored resumes use it. Until you decide, the base resume keeps its value.</p>
    <ul className="space-y-3">{conflicts.map(conflict => <li key={conflict.key} className="space-y-2 rounded-lg border p-3">
      <p>{conflict.label}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={conflict.label}>
        {OPTIONS.map(([source, label]) => <Button key={label} size="sm" variant={conflict.chosen === source ? "default" : "outline"} aria-pressed={conflict.chosen === source} disabled={busy} onClick={() => choose(conflict, source)}>
          {source ? `${label}: ${conflict.values[source]}` : label}
        </Button>)}
      </div>
    </li>)}</ul>
  </section>
}

/** What the profile folder holds, what was extracted from it and the conflicts to decide. */
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
    <p className="mb-4 text-sm text-muted-foreground">Tailored resumes use everything in your profile as evidence: your resume data, your LinkedIn export (profile → More → Save to PDF) and resumes you already have as PDFs. Files you place in the profile folder are imported automatically.</p>
    <LoadState loading={api.loading && !state} error={api.error} retry={api.refresh} />
    {state && <div className="space-y-4">
      <ProfileUpload disabled={busy} onUploaded={api.refresh} />
      {state.importing && <p role="status" className="text-sm text-muted-foreground">Importing your files…</p>}
      <Files state={state} />
      {state.linkedin && <Extracted linkedin={state.linkedin} />}
      {state.conflicts.length > 0 && <Conflicts conflicts={state.conflicts} busy={busy} choose={(conflict, source) => void run(() => chooseSource(conflict.key, source))} />}
      {state.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </Panel>
}

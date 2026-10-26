import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Panel } from "@/components/workspace-ui"
import { date, request } from "@/lib/api"
import type { BackupSummary, RestoreResult } from "@/lib/backup"

const records: [string, string][] = [
  ["jobs", "Jobs"],
  ["applications", "Applications"],
  ["application_runs", "Preparations"],
  ["pdf_artifacts", "PDFs"],
  ["recruiters", "Recruiters"],
  ["interviews", "Interviews"],
]

function useFolder() {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  return { value, setValue, error, setError }
}

function FolderField({ label, folder, disabled, onChange }: { label: string; folder: ReturnType<typeof useFolder>; disabled: boolean; onChange?: () => void }) {
  return (
    <Field label={label}>
      <Input value={folder.value} onChange={(e) => { folder.setValue(e.target.value); onChange?.() }} placeholder="/absolute/path/to/folder" disabled={disabled} />
    </Field>
  )
}

function Excluded({ summary }: { summary: BackupSummary }) {
  if (!summary.excluded.length) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">Not included</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {summary.excluded.map((item) => <li key={`${item.kind}:${item.path}`}><span className="break-all">{item.path}</span> — {item.reason}</li>)}
      </ul>
    </div>
  )
}

export function BackupSummaryView({ summary }: { summary: BackupSummary }) {
  return (
    <div aria-label="Backup summary" className="space-y-3 rounded-xl border p-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Created</dt><dd>{date(summary.createdAt)}</dd>
        <dt className="text-muted-foreground">App version</dt><dd>{summary.appVersion}</dd>
        <dt className="text-muted-foreground">Schema</dt><dd>v{summary.schemaVersion}</dd>
        {records.filter(([key]) => key in summary.counts).map(([key, label]) => (
          <div key={key} className="contents"><dt className="text-muted-foreground">{label}</dt><dd>{summary.counts[key]}</dd></div>
        ))}
        <dt className="text-muted-foreground">Artifact files</dt><dd>{summary.artifacts}</dd>
      </dl>
      <Excluded summary={summary} />
    </div>
  )
}

function CreateBackup() {
  const folder = useFolder()
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<BackupSummary>()
  async function create() {
    setBusy(true); folder.setError(""); setCreated(undefined)
    try { setCreated(await request<BackupSummary>("workspace-backup/create", { destination: folder.value })) }
    catch (e) { folder.setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <Panel title="Back up workspace">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <p className="text-sm text-muted-foreground">Saves a verified copy of the database, settings and generated PDFs to a new folder. Browser sign-in sessions and external resume projects are not included.</p>
        <FolderField label="Backup destination" folder={folder} disabled={busy} />
        <Button disabled={busy || !folder.value.trim()}>{busy ? "Backing up…" : "Create backup"}</Button>
        {created && <p role="status" className="break-all text-sm">Backup created at {created.path}.</p>}
        {created && <Excluded summary={created} />}
        {folder.error && <p role="alert" className="text-sm text-destructive">{folder.error}</p>}
      </form>
    </Panel>
  )
}

function RestoreBackup() {
  const folder = useFolder()
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<BackupSummary>()
  const [restored, setRestored] = useState<RestoreResult>()
  const reset = () => { setSummary(undefined); setRestored(undefined); folder.setError("") }
  async function run(action: () => Promise<void>) {
    setBusy(true); folder.setError("")
    try { await action() } catch (e) { folder.setError((e as Error).message) } finally { setBusy(false) }
  }
  const check = () => run(async () => { reset(); setSummary(await request<BackupSummary>("workspace-backup/inspect", { path: folder.value })) })
  const restore = (checked: BackupSummary) => run(async () => {
    setRestored(await request<RestoreResult>("workspace-backup/restore", { path: checked.path, fingerprint: checked.fingerprint }))
    setSummary(undefined)
  })
  return (
    <Panel title="Restore workspace">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Replaces the current records, settings and PDFs with a backup. The current workspace is kept in the backups folder first.</p>
        <FolderField label="Backup folder" folder={folder} disabled={busy} onChange={reset} />
        <Button type="button" variant="outline" disabled={busy || !folder.value.trim()} onClick={() => void check()}>Check backup</Button>
        {summary && <BackupSummaryView summary={summary} />}
        {summary && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void restore(summary)}>{busy ? "Restoring…" : "Restore this backup"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={reset}>Cancel</Button>
          </div>
        )}
        {restored && <p role="status" className="break-all text-sm">Workspace restored. The previous workspace was kept at {restored.previous}.</p>}
        {folder.error && <p role="alert" className="text-sm text-destructive">{folder.error}</p>}
      </div>
    </Panel>
  )
}

export function WorkspaceBackup() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CreateBackup />
      <RestoreBackup />
    </div>
  )
}

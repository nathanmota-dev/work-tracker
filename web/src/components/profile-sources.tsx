import { FileJson, FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { LoadState, Panel } from "@/components/workspace-ui"
import { ProfileUpload } from "@/components/profile-upload"
import { KIND_LABELS, STATUS_LABELS, useProfileSources, type ProfileAssetState, type ProfileSourcesState } from "@/lib/profile-sources"

/** What a file does for the profile: it is the profile, or reference text for tailoring. */
function Role({ asset, source }: { asset: ProfileAssetState; source: ProfileSourcesState["source"] }) {
  if (asset.status !== "imported") return <span className={asset.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{STATUS_LABELS[asset.status]}</span>
  return source?.file === asset.file ? <Badge>Profile source</Badge> : <Badge variant="outline">Reference</Badge>
}

function Files({ state }: { state: ProfileSourcesState }) {
  if (!state.assets.length) return null
  return <section className="space-y-2">
    <p className="text-sm font-medium">Your profile files</p>
    <ul className="space-y-2 text-sm" aria-label="Profile files">
      {state.assets.map(asset => {
        const Icon = asset.kind === "data" ? FileJson : FileText
        return <li key={asset.file} className="flex items-center gap-3 rounded-lg border p-3">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={asset.file}>{asset.file}</p>
            <p className="text-xs text-muted-foreground">{KIND_LABELS[asset.kind ?? "pending"]}</p>
            {asset.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
          </div>
          <Role asset={asset} source={state.source} />
        </li>
      })}
    </ul>
  </section>
}

/** Uploads the profile's files and lists them with the one the profile is built from. */
export function ProfileSources() {
  const api = useProfileSources()
  const state = api.data
  return <Panel title="Profile sources">
    <p className="mb-4 text-sm text-muted-foreground">Your profile and base resume come from one file: your resume data (.json) or your LinkedIn PDF (profile → More → Save to PDF). Uploading one replaces the other. Other resume PDFs are kept as reference text for tailored resumes.</p>
    <LoadState loading={api.loading && !state} error={api.error} retry={api.refresh} />
    {state && <div className="space-y-5">
      <ProfileUpload disabled={false} onUploaded={api.refresh} />
      {state.importing && <p role="status" className="text-sm text-muted-foreground">Importing your files…</p>}
      <Files state={state} />
      {state.warnings.filter(warning => !state.assets.some(asset => asset.warnings.some(item => warning.endsWith(item)))).map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
    </div>}
  </Panel>
}

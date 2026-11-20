import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Markdown } from "@/components/markdown"
import { Panel } from "@/components/workspace-ui"
import { useAppUpdates } from "@/hooks/use-app-updates"
import { openExternal } from "@/lib/api"
import type { UpdateError, UpdateStatus } from "@/types/updates"

const statuses: Record<UpdateStatus, string> = {
  idle: "Updates are checked automatically every 12 hours.",
  checking: "Checking for updates…",
  "up-to-date": "You are on the latest version.",
  available: "A new version is available.",
  downloading: "Downloading the update…",
  ready: "The update is downloaded and ready to install.",
  installing: "Installing the update and restarting…",
  unavailable: "Automatic updates are only available in the AppImage installed from a release.",
  error: "The last update action failed.",
}
const errors: Record<UpdateError, string> = {
  network: "Could not reach the update server. Check your connection and try again.",
  metadata: "The release information is invalid or incomplete.",
  permission: "Work Tracker cannot replace its own file. Check that the AppImage is writable.",
  integrity: "The downloaded file failed verification and was discarded. Download it again.",
  installation: "The update could not be installed. Your current version was kept.",
  storage: "Could not save the update state on this device.",
}

const date = (value: number | string | null) => value === null ? "Never" : new Date(value).toLocaleString()

export function AppUpdates() {
  const { state, run } = useAppUpdates()
  const [confirm, setConfirm] = useState(false)
  const busy = ["checking", "downloading", "installing"].includes(state.status)
  const ready = state.status === "ready" || (state.status === "error" && state.retryAction === "install")
  const downloadable = state.status === "available" || (state.status === "error" && state.retryAction === "download")
  return (
    <Panel title="Updates">
      <div className="flex min-w-0 flex-col gap-4" aria-busy={busy}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Installed version</dt><dd>{state.installedVersion}</dd></div>
          <div><dt className="text-muted-foreground">Last checked</dt><dd>{date(state.lastSuccess)}</dd></div>
          {state.release && <>
            <div><dt className="text-muted-foreground">Available version</dt><dd>{state.release.version}</dd></div>
            {state.release.releaseDate && <div><dt className="text-muted-foreground">Released</dt><dd>{date(state.release.releaseDate)}</dd></div>}
          </>}
        </dl>
        <p role="status" className="text-sm">{statuses[state.status]}</p>
        {state.error && <p role="alert" className="text-sm text-destructive">{errors[state.error]}</p>}
        {state.status === "downloading" && <div className="flex items-center gap-3">
          <progress className="h-2 w-full accent-primary" aria-label="Download progress" value={state.progress ?? 0} max={100} />
          <span className="text-sm tabular-nums">{Math.round(state.progress ?? 0)}%</span>
        </div>}
        {state.release && <div className="min-w-0 space-y-3">
          {state.release.notes && <div className="max-h-64 overflow-auto break-words text-sm text-muted-foreground"><Markdown text={state.release.notes} /></div>}
          <a className="text-sm text-primary underline underline-offset-4" href={state.release.url} onClick={(event) => { event.preventDefault(); void openExternal(state.release!.url) }}>View release on GitHub</a>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || ready || state.status === "unavailable"} onClick={() => void run("check")}>Check for updates</Button>
          {downloadable && <Button disabled={busy} onClick={() => void run("download")}>Download update</Button>}
          {ready && <Button disabled={busy} onClick={() => setConfirm(true)}>Restart and install</Button>}
        </div>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart to install?</DialogTitle>
            <DialogDescription>Work Tracker will close and reopen on the new version. Your data in ~/.work-tracker is not changed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={() => { setConfirm(false); void run("install") }}>Restart and install</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { reconnect, restartBackend, useBackend } from "@/lib/backend"
function ServerOffline() {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b bg-destructive/10 px-4 py-2 text-sm">
    <div className="min-w-0 space-y-1">
      <p className="font-medium">Work Tracker server is not running</p>
      <p>Start it again by running <code>work-tracker</code> in a terminal. This window reconnects automatically.</p>
    </div>
    <Button size="sm" variant="outline" onClick={reconnect}>Try again</Button>
  </div>
}
/**
 * Shows when the backend process stopped and offers a manual restart. Open
 * screens reload when the new backend connects; executions that were active
 * are shown as interrupted and are never repeated automatically.
 */
export function BackendStatus() {
  const backend = useBackend()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  if (!backend || backend.status === "ready" || backend.status === "starting" && !backend.restarts) return null
  if (backend.status === "reconnecting")
    return <div role="status" className="border-b px-4 py-2 text-sm">Reconnecting to the server…</div>
  if (backend.status === "offline") return <ServerOffline />
  if (backend.status === "starting")
    return <div role="status" className="border-b px-4 py-2 text-sm">Restarting backend…</div>
  const restart = async () => {
    setBusy(true)
    setError("")
    try {
      if (!await restartBackend()) setError("The backend could not be restarted. Close and reopen Work Tracker.")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const failed = backend.status === "failed"
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b bg-destructive/10 px-4 py-2 text-sm">
    <div className="min-w-0 space-y-1">
      <p className="font-medium">{failed ? "Backend could not be recovered" : "Backend unavailable"}</p>
      <p>{backend.message}</p>
      {failed
        ? <p>It stopped {backend.failures} times in a row, so it will not be restarted again. Check the log at <code className="break-all">{backend.logPath}</code>, then close and reopen Work Tracker.</p>
        : <p className="text-muted-foreground">Active executions were interrupted and will not be repeated. Open screens reload after reconnecting.</p>}
      {error && <p>{error}</p>}
    </div>
    {!failed && <Button size="sm" variant="outline" disabled={busy} onClick={() => void restart()}>Restart backend</Button>}
  </div>
}

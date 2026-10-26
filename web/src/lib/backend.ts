import { useEffect, useState } from "react"
import { subscribe } from "./api"
import { transport } from "./transport"
/** Time without a connection before the browser app reports that the server is not running. */
export const OFFLINE_AFTER_MS = 10_000
/**
 * Backend process state. The desktop shell reports its supervised process
 * (see `src/server/supervisor.ts`); in the browser it follows the connection.
 */
export type BackendState = {
  status: "starting" | "ready" | "unavailable" | "failed" | "reconnecting" | "offline"
  restarts: number
  failures: number
  message?: string
  logPath: string
}
function backendState(value: unknown): BackendState | undefined {
  return value && typeof value === "object" && "status" in value ? value as BackendState : undefined
}
const browserState = (status: BackendState["status"]): BackendState => ({ status, restarts: 0, failures: 0, logPath: "" })
/** Browser: reconnecting right after a drop, offline once nothing answers for `OFFLINE_AFTER_MS`. */
function watchConnection(set: (state: BackendState) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let connected = false
  const update = (live: boolean) => {
    clearTimeout(timer)
    if (live) { connected = true; return set(browserState("ready")) }
    set(browserState(connected ? "reconnecting" : "starting"))
    timer = setTimeout(() => set(browserState("offline")), OFFLINE_AFTER_MS)
  }
  let pushed = false
  void transport().connectionStatus().then(live => { if (!pushed) update(live) }).catch(() => {})
  const stop = subscribe(event => {
    if (event.type !== "connection") return
    pushed = true
    update(event.live === true)
  })
  return () => { clearTimeout(timer); stop() }
}
export function useBackend() {
  const [state, setState] = useState<BackendState>()
  useEffect(() => {
    const current = transport()
    if (!current.backendStatus) return watchConnection(setState)
    let active = true
    // A pushed event is newer than the initial snapshot that may still be in flight.
    let pushed = false
    void current.backendStatus().then((value) => {
      if (active && !pushed) setState(backendState(value))
    }).catch(() => {})
    const stop = subscribe((event) => {
      if (event.type !== "backend") return
      pushed = true
      setState(backendState(event.state))
    })
    return () => {
      active = false
      stop()
    }
  }, [])
  return state
}
/** Ask the desktop shell for a new backend process; false when it refused (already running or failed repeatedly). */
export async function restartBackend(): Promise<boolean> {
  const current = transport()
  if (!current.restartBackend) throw new Error("Restarting the backend requires the desktop app.")
  return current.restartBackend()
}
/** Browser: try to reach the server again now. */
export function reconnect() {
  transport().reconnect?.()
}

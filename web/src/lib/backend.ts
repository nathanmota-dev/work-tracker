import { useEffect, useState } from "react"
import { subscribe } from "./api"
/** Backend process state reported by the desktop shell (see `desktop/src/backend-supervisor.ts`). */
export type BackendState = {
  status: "starting" | "ready" | "unavailable" | "failed"
  restarts: number
  failures: number
  message?: string
  logPath: string
}
function backendState(value: unknown): BackendState | undefined {
  return value && typeof value === "object" && "status" in value ? value as BackendState : undefined
}
export function useBackend() {
  const [state, setState] = useState<BackendState>()
  useEffect(() => {
    let active = true
    // A pushed event is newer than the initial snapshot that may still be in flight.
    let pushed = false
    void window.desktop?.backendStatus?.().then((value) => {
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
  if (!window.desktop?.restartBackend) throw new Error("Restarting the backend requires the desktop app.")
  return window.desktop.restartBackend()
}

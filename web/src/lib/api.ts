import { useCallback, useEffect, useState } from "react"
export type Row = Record<string, unknown>
export type ApiEvent = { type: string; [key: string]: unknown }
const listeners = new Set<(event: ApiEvent) => void>()
let started = false
function startEvents() {
  if (started) return
  started = true
  window.desktop?.onEvent((event) => {
    if (event && typeof event === "object" && "type" in event)
      publish(event as ApiEvent)
  })
}
export function publish(event: ApiEvent) {
  for (const listener of listeners) listener(event)
}
export function subscribe(listener: (event: ApiEvent) => void) {
  startEvents()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  if (!window.desktop?.request)
    throw new Error(
      "Open Work Tracker in the desktop app to connect to your workspace.",
    )
  return (await window.desktop.request(path, body)) as T
}
const dependencies: Record<string, string[]> = {
  overview: [
    "profile_metrics",
    "recruiters",
    "interviews",
    "jobs",
    "applications",
  ],
  metrics: ["profile_metrics"],
  "profile-snapshot": ["profile_metrics"],
  profile: ["profile"],
  answers: ["applicant_answers"],
  "answers/variants": ["applicant_answers"],
  activity: ["activity_log"],
  outreach: ["outreach_attempts", "outreach_budget", "recruiters"],
  "recruiters/due": ["outreach_attempts", "recruiters"],
  applications: ["applications", "jobs"],
  "applications/summary": ["applications"],
  jobs: ["jobs", "applications"],
  "application-board": ["applications", "application_stages", "application_events"],
  "acp/providers": ["integrations"],
  "integrations/status": ["integrations", "applicant_answers", "profile"],
  "acp/permissions": ["agent_permissions"],
  "preparation-batches": ["preparation_batches", "jobs"],
}
export function useApi<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => { setLoading(true); setRevision((v) => v + 1) }, [])
  useEffect(
    () =>
      subscribe((event) => {
        if (
          ((path === "acp/permissions" || path.startsWith("preparation-batches")) && (event.type === "hello" || event.type === "connection" && event.live === true)) || event.type === "changed" &&
          (!event.table ||
            event.table === "unknown" ||
            (dependencies[path.startsWith("preparation-batches/") ? "preparation-batches" : path] ?? [path]).includes(String(event.table)))
        )
          refresh()
      }),
    [path, refresh],
  )
  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    request<T>(path)
      .then((value) => {
        if (active) setData(value)
      })
      .catch((e) => {
        if (active) setError(String(e.message ?? e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [path, revision])
  return { data, error, loading, refresh }
}
export function useConnection() {
  const [live, setLive] = useState(false)
  useEffect(() => {
    let active = true
    void window.desktop?.connectionStatus().then((value) => {
      if (active) setLive(value)
    })
    const stop = subscribe((event) => {
      if (event.type === "connection") setLive(event.live === true)
    })
    return () => {
      active = false
      stop()
    }
  }, [])
  return live
}
export function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
export function date(value: unknown) {
  if (!value) return "Not scheduled"
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
}
export function webUrl(value: unknown) {
  try {
    const url = new URL(String(value))
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
export async function openExternal(value: unknown) {
  const url = webUrl(value)
  if (!url) return
  if (window.desktop) await window.desktop.openExternal(url)
  else window.open(url, "_blank", "noopener,noreferrer")
}

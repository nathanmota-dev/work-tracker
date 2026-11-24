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
  jobs: ["jobs", "applications", "job_rankings"],
  rankings: ["job_rankings", "jobs"],
  "rankings/candidates": ["job_rankings", "jobs", "applications"],
  "application-board": ["applications", "application_stages", "application_events"],
  "application-board/quiet": ["applications", "application_stages", "application_events", "followup_drafts"],
  "acp/providers": ["integrations"],
  "integrations/status": ["integrations", "applicant_answers", "profile"],
  "onboarding/status": ["integrations", "applicant_answers", "jobs", "applications", "onboarding_state"],
  "acp/permissions": ["agent_permissions"],
  "preparation-batches": ["preparation_batches", "jobs"],
  "interview-preps": ["interview_preps"],
  followups: ["followup_drafts"],
  "followups/candidates": ["followup_drafts", "applications", "application_stages", "application_events"],
  "company-research": ["company_research"],
  "gates/profile": ["candidate_languages", "gate_profile"],
  "gates/jobs": ["jobs", "candidate_languages", "gate_profile"],
  "profile-sources": ["profile_imports"],
  "resume-sources": ["resume_sources", "profile_imports"],
  "resume-variants": ["resume_variants"],
  "ats/best": ["jobs", "resume_variants"],
  "ats/jobs": ["jobs", "resume_variants", "application_runs", "applications"],
}
/** Dependency entry of a read path: parameterized paths share their base entry. */
function dependencyKey(path: string) {
  if (path.startsWith("preparation-batches/")) return "preparation-batches"
  if (path.startsWith("interview-preps/")) return "interview-preps"
  if (path.startsWith("gates/jobs/")) return "gates/jobs"
  if (path.startsWith("ats/jobs/")) return "ats/jobs"
  return path.split("?")[0]
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
            (dependencies[dependencyKey(path)] ?? [path]).includes(String(event.table)))
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

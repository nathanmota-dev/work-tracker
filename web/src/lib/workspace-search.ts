import { ONBOARDING_STEPS } from "../../../src/onboarding/types"
const string = (value: unknown) => typeof value === "string" ? value : ""
const choice = (value: unknown, values: string[], fallback: string) => values.includes(string(value)) ? String(value) : fallback
const integer = (value: unknown, minimum: number, fallback: number, maximum = Number.MAX_SAFE_INTEGER) => {
  const n = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isSafeInteger(n) && n >= minimum && n <= maximum ? n : fallback
}

/** Only existing workspace controls are accepted; malformed URLs are harmless. */
export function validateWorkspaceSearch(path: string, search: Record<string, unknown>): WorkspaceSearch {
  if (path === "dashboard") return { step: choice(search.step, [...ONBOARDING_STEPS], "") || undefined }
  if (path === "profile") return { ...validateWorkspaceSearch("answers", search), tab: choice(search.tab, ["profile", "answers", "linkedin", "deal-breakers"], "profile") }
  if (path === "contacts") return { ...validateWorkspaceSearch("search", search), tab: choice(search.tab, ["people", "follow-ups", "find"], "people") }
  const records = {
    q: string(search.q), status: string(search.status),
    page: integer(search.page, 0, 0), selected: integer(search.selected, path === "jobs" ? 1 : 0, -1) >= 0 ? String(Number(search.selected)) : "",
    selection: Array.isArray(search.selection) ? [...new Set(search.selection.filter((v): v is string => typeof v === "string"))] : [],
  }
  if (path === "jobs") return {
    ...records, view: choice(search.view === "active" ? "shortlist" : search.view, ["new", "shortlist", "archived"], "new"),
    keywords: string(search.keywords), location: string(search.location),
    workType: choice(search.workType, ["remote", "hybrid", "on-site"], ""), maxPages: integer(search.maxPages, 1, 1, 10),
    focus: search.focus === true || search.focus === "true",
    discover: search.discover === true || search.discover === "true", mode: choice(search.mode, ["find", "search", "assess"], "find"),
  }
  if (path === "applications") return {
    ...records, view: choice(search.view, ["list", "board"], "list"), tab: choice(search.tab, ["active", "archived"], "active"),
    highlight: integer(search.highlight, 1, 0) || undefined, review: search.review === true || search.review === "true",
  }
  if (path === "search") return {
    ...records, savedJobId: integer(search.savedJobId, 1, 0) || undefined, kind: choice(search.kind, ["jobs", "people"], "people"),
    keywords: string(search.keywords), location: string(search.location), company: string(search.company),
    workType: choice(search.workType, ["remote", "hybrid", "on-site"], ""), maxPages: integer(search.maxPages, 1, 1, 10), resultId: string(search.resultId),
  }
  if (path === "apply") return {
    batchId: string(search.batchId) || undefined, itemId: string(search.itemId) || undefined, pendingOnly: search.pendingOnly === true || search.pendingOnly === "true",
    jobId: integer(search.jobId, 1, 0) || undefined, applicationId: integer(search.applicationId, 1, 0) || undefined,
    runId: string(search.runId) || undefined, provider: typeof search.provider === "string" ? search.provider : undefined, model: typeof search.model === "string" ? search.model : undefined,
    pdfTab: choice(search.pdfTab, ["base", "tailored"], "base"), workspaceTab: choice(search.workspaceTab, ["activity", "report"], "activity"),
  }
  // The console tab became Setup; skills now start from their own screens.
  if (path === "launch") return { tab: choice(search.tab, ["setup", "history"], "setup"), target: string(search.target) }
  if (path === "interview-prep") return { q: string(search.q) }
  if (path === "resume") return { id: string(search.id) || undefined }
  if (path === "answers") return { field: string(search.field), returnTo: /^\/apply(\?|$)/.test(string(search.returnTo)) ? string(search.returnTo) : "" }
  return {}
}
export type WorkspaceSearch = {
  focus?: boolean; discover?: boolean; tab?: string; highlight?: number; review?: boolean
  q?: string; status?: string; page?: number; view?: string; selected?: string; selection?: string[]
  savedJobId?: number; kind?: string; keywords?: string; location?: string; company?: string; workType?: string; maxPages?: number; resultId?: string
  jobId?: number; applicationId?: number; runId?: string; provider?: string; model?: string; effort?: string; pdfTab?: string; workspaceTab?: string
  batchId?: string; itemId?: string; pendingOnly?: boolean
  mode?: string; skill?: string; target?: string; query?: string; username?: string; url?: string; jobIds?: string
  field?: string; returnTo?: string; step?: string; id?: string
}

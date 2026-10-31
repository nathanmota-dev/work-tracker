import type { Row } from "@/lib/api"
import type {
  ApplicationOrigin,
  ApplicationSummary,
  ApplicationView,
  JourneyPhase,
} from "../../../src/applications/journey"
export type { ApplicationOrigin, ApplicationSummary, ApplicationView, JourneyPhase }

/** Mutually exclusive steps, in journey order; computed by the server. */
export const PHASES: Record<JourneyPhase, { label: string; hint: string }> = {
  draft: { label: "Drafts", hint: "No validated resume yet" },
  prepared: { label: "Prepared", hint: "Resume ready, portal not filled" },
  filled: { label: "Filled", hint: "Portal filled, waiting for your submit" },
  submitted: { label: "Submitted", hint: "Confirmed as sent" },
}
export const PHASE_LABELS: Record<JourneyPhase, string> = {
  draft: "Draft",
  prepared: "Prepared",
  filled: "Filled",
  submitted: "Submitted",
}
export const VIEWS: Record<ApplicationView, { label: string; hint: string }> = {
  preparation: {
    label: "Preparation",
    hint: "Not on the board stages yet.",
  },
  tracking: {
    label: "Tracking",
    hint: "Active on the board.",
  },
  archived: {
    label: "Archived",
    hint: "Closed processes; reopen them on the board.",
  },
}
export const ORIGINS: Record<ApplicationOrigin, string> = {
  preparation: "Apply",
  agent: "Agent",
  manual: "Manual",
  unknown: "Unknown",
}

export type NextStep =
  | { kind: "prepare"; label: string }
  | { kind: "board"; label: string }
  | { kind: "review"; label: string }

/** The contextual action that moves an application forward. */
export function nextStep(row: Row): NextStep {
  if (row.view === "archived") return { kind: "board", label: "Reopen on board" }
  if (row.view === "tracking") return { kind: "board", label: "Open board" }
  switch (row.phase as JourneyPhase) {
    case "submitted":
      return { kind: "review", label: "Resolve in Needs review" }
    case "filled":
      return { kind: "prepare", label: "Submit in Apply" }
    case "prepared":
      return { kind: "prepare", label: "Fill in Apply" }
    default:
      return { kind: "prepare", label: "Prepare application" }
  }
}

/** The Jobs action that opens the application detail for a job's latest attempt. */
export function applyLabel(application?: Row) {
  if (!application) return "Apply"
  return nextStep(application).kind === "prepare" ? "Continue application" : "View application"
}

/** Phase and view totals for a list, using the server-computed columns. */
export function countRows(rows: Row[]) {
  const phases: Record<JourneyPhase, number> = { draft: 0, prepared: 0, filled: 0, submitted: 0 }
  const views: Record<ApplicationView, number> = { preparation: 0, tracking: 0, archived: 0 }
  for (const row of rows) {
    phases[(row.phase as JourneyPhase) in phases ? (row.phase as JourneyPhase) : "draft"] += 1
    views[(row.view as ApplicationView) in views ? (row.view as ApplicationView) : "preparation"] += 1
  }
  return { phases, views }
}

/** The most useful next step across all applications, for the dashboard. */
export function summaryStep(summary: ApplicationSummary) {
  if (summary.phases.filled)
    return { label: "Submit filled applications", href: "#/applications" }
  if (summary.phases.draft || summary.phases.prepared)
    return { label: "Continue preparing", href: "#/applications" }
  if (summary.views.tracking)
    return { label: "Open board", href: "#/applications?view=board" }
  return { label: "Apply from your shortlist", href: "#/jobs?view=shortlist" }
}

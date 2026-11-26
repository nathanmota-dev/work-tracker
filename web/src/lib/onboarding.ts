import { useEffect } from "react"
import { publish, request, subscribe, useApi } from "./api"
import { ANSWER_CATALOG } from "../../../src/answers/catalog"
import type { OnboardingItem, OnboardingStatus, OnboardingStep, StepId } from "../../../src/onboarding/types"
export type { OnboardingItem, OnboardingStatus, OnboardingStep, StepId }

export const stepCopy: Record<StepId, { title: string; description: string; action: string }> = {
  resume: { title: "Set up your base resume", description: "Choose your LaTeX resume project and make the LaTeX and PDF tools available.", action: "Open base resume" },
  answers: { title: "Fill essential answers", description: "Add the basics every application asks for.", action: "Add answers" },
  search: { title: "Run your first search", description: "Search LinkedIn, or add a role by hand, to start your list of jobs.", action: "Search jobs" },
  apply: { title: "Prepare your first application", description: "Prepare a shortlisted role, or register an application you already sent.", action: "Open the shortlist" },
}

/** The exact place that fixes the step's first pending requirement. */
export function stepHref(step: OnboardingStep): string {
  const target = step.items.find(item => !item.ready)?.target
  switch (step.id) {
    case "resume": return "#/resume?id=base"
    case "answers": return `#/profile?tab=answers${target ? `&field=${encodeURIComponent(target)}` : ""}`
    case "search": return "#/jobs?focus=true&mode=search"
    case "apply": return "#/jobs?view=shortlist"
  }
}

/** Opens the Dashboard checklist at one step, even while it is hidden. */
export const getStartedLink = (id: StepId) => `#/dashboard?step=${id}`

export function itemText(item: OnboardingItem): string {
  if (item.key === "sources") return `LaTeX project: ${item.ready ? "ready" : item.reason === "invalid" ? "cannot be read — check its folder and files" : "not chosen"}`
  if (item.key === "tools") return `LaTeX and PDF tools: ${item.ready ? "available" : `missing ${item.reason}`}`
  if (item.key === "jobs") return item.ready ? "A job is saved." : "No saved jobs yet."
  if (item.key === "applications") return item.ready ? "An application is prepared or sent." : "No application prepared or sent yet."
  const label = ANSWER_CATALOG.find(spec => spec.key === item.key)?.label ?? item.key
  return `${label}: ${item.ready ? "ready" : item.reason === "invalid" ? "invalid" : "missing"}`
}

export async function saveOnboarding(preferences: { hidden?: boolean; skipped?: StepId[]; completed?: true; setupCompleted?: true }) {
  await request("onboarding/preferences", preferences)
  if (preferences.setupCompleted) setupDone = true
  publish({ type: "changed", table: "onboarding_state" })
}

// Once the setup is finished it never comes back, so later navigations need no status.
let setupDone = false
export const setupRemembered = () => setupDone
export function rememberSetup() { setupDone = true }
/** Test seam: forget the remembered setup result. */
export function forgetSetup() { setupDone = false }

/** Refreshes on workspace changes and on resume source saves, which only the interface announces. */
export function useOnboarding() {
  const api = useApi<OnboardingStatus>("onboarding/status")
  const { refresh } = api
  useEffect(() => subscribe(event => { if (event.type === "resume-sources-changed") refresh() }), [refresh])
  // Ignore anything that is not a status, such as a shared test double.
  const status = Array.isArray(api.data?.steps) ? api.data : undefined
  const next = status?.steps.find(step => step.id === status.next)
  return { ...api, status, next, step: (id: StepId) => status?.steps.find(step => step.id === id) }
}

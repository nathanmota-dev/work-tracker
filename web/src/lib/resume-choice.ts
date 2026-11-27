import { request } from "@/lib/api"
import type { ResumePick } from "@/lib/context-draft"
import type { PreparationRun } from "@/lib/preparation"
import type { ResumeVariant } from "@/lib/variants"
import type { DocumentVersion } from "../../../src/preparation/types"

/** Marks an execution that reused a saved resume; no agent generated it. */
export const SAVED_RESUME = "saved-resume"
/** Marks an execution that used the base resume as it is. */
export const BASE_RESUME = "base-resume"
/** No agent generated these executions' PDFs, so the selected agent fills them. */
export const usesReadyPdf = (provider?: string) => provider === SAVED_RESUME || provider === BASE_RESUME

type Input = { review: boolean; run?: PreparationRun; version?: DocumentVersion; saved: ResumeVariant[]; pick?: ResumePick }

/** The card of the application's resume: the base or saved resume it came from, else its own. */
function cardOf({ review, run, version, saved }: Input): string | undefined {
  if (!run) return undefined
  if (!review && run.provider === BASE_RESUME) return "base"
  const variant = !review && run.provider === SAVED_RESUME ? saved.find(item => item.id === version?.variant?.id) : undefined
  return variant?.id ?? "application"
}

/**
 * The resume chosen to fill the application. A choice is "application" (the
 * resume generated for it), "base" or a saved resume's id.
 *
 * @property current The card of the resume the application already uses.
 * @property selected The chosen card; the current one until another is picked.
 * @property replacement The base or saved resume that filling must start using first.
 * @property provider Where the resume to be filled comes from.
 */
export function resumeChoice(input: Input) {
  const { review, run, saved, pick } = input
  const current = cardOf(input)
  const picked = !review && pick && pick.runId === run?.id && (pick.choice === current || pick.choice === "base" || saved.some(item => item.id === pick.choice)) ? pick.choice : undefined
  const selected = picked ?? current
  const replacement = selected === current ? undefined : selected
  const provider = !replacement ? run?.provider : replacement === "base" ? BASE_RESUME : SAVED_RESUME
  return { current, selected, replacement, provider }
}

/** Start using the base or a saved resume in the application; no agent runs. */
export function startUsing(choice: string, target: { jobId?: number; applicationId?: number }) {
  return choice === "base"
    ? request<{ id: string; application_id: number | null }>("application-preparation/use-base", target)
    : request<{ id: string; application_id: number | null }>("application-preparation/use-variant", { ...target, variantId: choice })
}

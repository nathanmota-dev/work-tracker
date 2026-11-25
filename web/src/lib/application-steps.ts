import type { ApplyBlock } from "@/components/apply-readiness"

export type StepKey = "description" | "resume" | "fill" | "submission"
export type StepState = "done" | "current" | "blocked" | "upcoming"
export type ApplicationStep = {
  key: StepKey
  label: string
  hint: string
  state: StepState
  blocks: ApplyBlock[]
}
const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "description", label: "Job description", hint: "Save or fetch the role description" },
  { key: "resume", label: "Resume", hint: "Use a saved resume or generate a tailored one, then approve it" },
  { key: "fill", label: "Fill portal", hint: "The selected agent fills the form with the approved PDF" },
  { key: "submission", label: "Confirm submission", hint: "Submit in the browser, then confirm here" },
]
export type StepInput = {
  /** Saved, or fetchable from LinkedIn when generating. */
  description: boolean
  approved: boolean
  filled: boolean
  submitted: boolean
  generate: ApplyBlock[]
  fill: ApplyBlock[]
}

/**
 * The application's steps, derived from its journey phase and readiness. A
 * later milestone completes the earlier ones, so a regenerated draft of a
 * submitted application still reads as submitted.
 */
export function applicationSteps(input: StepInput): ApplicationStep[] {
  const milestones = [input.description, input.approved, input.filled, input.submitted]
  const reached = milestones.lastIndexOf(true)
  const blocks: Record<StepKey, ApplyBlock[]> = {
    description: input.generate.filter((block) => block.action === "description"),
    resume: input.generate.filter((block) => block.action !== "description"),
    fill: input.fill,
    submission: [],
  }
  return STEPS.map((step, index) => {
    const state: StepState =
      index <= reached ? "done"
      : index > reached + 1 ? "upcoming"
      : blocks[step.key].length ? "blocked" : "current"
    return { ...step, state, blocks: state === "blocked" ? blocks[step.key] : [] }
  })
}

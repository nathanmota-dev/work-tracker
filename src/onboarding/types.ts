/** Get started contracts shared by the backend and the desktop interface. */

/** Steps in the order the user follows them. */
export const ONBOARDING_STEPS = ["connect", "resume", "answers", "search", "apply"] as const;
export type StepId = typeof ONBOARDING_STEPS[number];
/** Only the agent steps can be skipped, so manual tracking needs no agent. */
export const OPTIONAL_STEPS: readonly StepId[] = ["connect", "resume"];

/**
 * One requirement of a step.
 *
 * @property [reason] Why a pending item is not ready.
 * @property [target] Integration or answer field to correct first.
 */
export interface OnboardingItem { key: string; ready: boolean; reason?: string; target?: string }
export interface OnboardingStep { id: StepId; optional: boolean; state: "done" | "pending" | "skipped"; items: OnboardingItem[] }

/**
 * @property complete Every step is done or skipped.
 * @property completedAt First time the checklist was complete; the card hides itself then.
 */
export interface OnboardingStatus {
  steps: OnboardingStep[];
  hidden: boolean;
  completedAt: string | null;
  complete: boolean;
  next: StepId | null;
}

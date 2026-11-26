/** Get started contracts shared by the backend and the desktop interface. */

/**
 * Dashboard checklist steps in the order the user follows them. Connecting an
 * agent is not one of them: the full-screen setup requires it before the app opens.
 */
export const ONBOARDING_STEPS = ["resume", "answers", "search", "apply"] as const;
export type StepId = typeof ONBOARDING_STEPS[number];
/** Only the base resume can be skipped, so tracking by hand needs no LaTeX project. */
export const OPTIONAL_STEPS: readonly StepId[] = ["resume"];

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
 * @property agentReady Claude Code or opencode passed a diagnostic for its current command.
 * @property readyAgents The ACP targets, such as `acp/claude-code`, that passed it.
 * @property setupCompletedAt When the full-screen setup finished; null keeps the app on it.
 */
export interface OnboardingStatus {
  agentReady: boolean;
  readyAgents: string[];
  setupCompletedAt: string | null;
  steps: OnboardingStep[];
  hidden: boolean;
  completedAt: string | null;
  complete: boolean;
  next: StepId | null;
}

/**
 * Single contract for an application's journey. Preparation, portal filling,
 * submission and tracking are independent dimensions of one application record;
 * the board stage lives in `current_stage_id`. Every caller (HTTP services, CLI
 * and agents) changes these dimensions only through TRANSITIONS.
 */
export const JOURNEY_STATES = {
  preparation: ["not_started", "in_progress", "ready", "failed"],
  fill: ["not_started", "in_progress", "filled", "needs_input", "failed"],
  submission: ["not_submitted", "submitted"],
  tracking: ["active", "archived"],
} as const;

export type JourneyDimension = keyof typeof JOURNEY_STATES;
export type PreparationStatus = (typeof JOURNEY_STATES.preparation)[number];
export type FillStatus = (typeof JOURNEY_STATES.fill)[number];
export type SubmissionStatus = (typeof JOURNEY_STATES.submission)[number];
export type TrackingStatus = (typeof JOURNEY_STATES.tracking)[number];

/** Where an application record came from; never inferred from titles. */
export const APPLICATION_ORIGINS = ["preparation", "manual", "agent", "unknown"] as const;
export type ApplicationOrigin = (typeof APPLICATION_ORIGINS)[number];
/** Who requested a transition; stored with each recorded change. */
export type JourneyActor = "api" | "cli" | "agent" | "system";

/** Legacy records the v4 migration could not classify deterministically (feature 04). */
export const REVIEW_REASONS = ["missing_job", "unknown_status", "missing_stage", "duplicate_job"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export interface JourneyState {
  preparation_status: PreparationStatus;
  fill_status: FillStatus;
  submission_status: SubmissionStatus;
  /** Null until the application is tracked on the board. */
  tracking_status: TrackingStatus | null;
}

/**
 * @property from States the action may start from.
 * @property idempotent Repeating the action when the dimension already holds
 *   `to` is a no-op instead of an error.
 * @property lockedAfterSubmit A submitted application keeps its documents and
 *   fill result; the action is rejected after submission.
 * @property requires Other dimensions that must hold a given state.
 */
interface Transition<D extends JourneyDimension = JourneyDimension> {
  dimension: D;
  from: readonly (typeof JOURNEY_STATES)[D][number][];
  to: (typeof JOURNEY_STATES)[D][number];
  idempotent?: boolean;
  lockedAfterSubmit?: boolean;
  requires?: Partial<JourneyState>;
  message: string;
}
const transition = <D extends JourneyDimension>(value: Transition<D>) => value;

export const TRANSITIONS = {
  "prepare.start": transition({ dimension: "preparation", from: ["not_started", "ready", "failed"], to: "in_progress", idempotent: true, lockedAfterSubmit: true, message: "A resume is already being prepared." }),
  "prepare.complete": transition({ dimension: "preparation", from: ["not_started", "in_progress", "failed"], to: "ready", idempotent: true, lockedAfterSubmit: true, message: "No resume preparation is pending." }),
  "prepare.fail": transition({ dimension: "preparation", from: ["in_progress"], to: "failed", message: "No resume preparation is running." }),
  "prepare.cancel": transition({ dimension: "preparation", from: ["in_progress"], to: "not_started", message: "No resume preparation is running." }),
  "prepare.restore": transition({ dimension: "preparation", from: ["in_progress"], to: "ready", message: "No resume preparation is running." }),
  "fill.start": transition({ dimension: "fill", from: ["not_started", "filled", "needs_input", "failed"], to: "in_progress", idempotent: true, lockedAfterSubmit: true, requires: { preparation_status: "ready" }, message: "The portal is already being filled." }),
  "fill.complete": transition({ dimension: "fill", from: ["not_started", "in_progress", "needs_input", "failed"], to: "filled", idempotent: true, lockedAfterSubmit: true, message: "The portal is already filled." }),
  "fill.needs_input": transition({ dimension: "fill", from: ["not_started", "in_progress", "filled", "failed"], to: "needs_input", idempotent: true, lockedAfterSubmit: true, message: "The portal already needs input." }),
  "fill.fail": transition({ dimension: "fill", from: ["in_progress"], to: "failed", message: "No portal fill is running." }),
  "fill.cancel": transition({ dimension: "fill", from: ["in_progress"], to: "not_started", message: "No portal fill is running." }),
  "fill.restore": transition({ dimension: "fill", from: ["in_progress"], to: "filled", message: "No portal fill is running." }),
  "fill.reset": transition({ dimension: "fill", from: ["filled", "needs_input", "failed"], to: "not_started", idempotent: true, lockedAfterSubmit: true, message: "The portal fill cannot be reset now." }),
  submit: transition({ dimension: "submission", from: ["not_submitted"], to: "submitted", idempotent: true, message: "This application is already submitted." }),
  archive: transition({ dimension: "tracking", from: ["active"], to: "archived", message: "Reopen this application before changing its stage or archiving it." }),
  reopen: transition({ dimension: "tracking", from: ["archived"], to: "active", message: "This application is already active." }),
} as const satisfies Record<string, Transition>;

export type JourneyAction = keyof typeof TRANSITIONS;

export class JourneyError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

const column = (dimension: JourneyDimension) => `${dimension}_status` as keyof JourneyState;
export const SUBMITTED_LOCK_MESSAGE = "This application is already submitted. Its resume and portal answers are preserved.";

/**
 * Validate `action` against `state` without side effects. Returns the next state
 * and whether anything changes; throws JourneyError for an invalid transition.
 */
export function planTransition(state: JourneyState, action: JourneyAction): { changed: boolean; next: JourneyState } {
  const rule: Transition = TRANSITIONS[action];
  const key = column(rule.dimension);
  const current = state[key];
  if (rule.idempotent && current === rule.to) return { changed: false, next: state };
  if (rule.lockedAfterSubmit && state.submission_status === "submitted") throw new JourneyError(SUBMITTED_LOCK_MESSAGE);
  if (current === null || !(rule.from as readonly string[]).includes(current)) throw new JourneyError(rule.message);
  for (const [name, value] of Object.entries(rule.requires ?? {}))
    if (state[name as keyof JourneyState] !== value) throw new JourneyError("Generate a validated resume before filling the application.");
  return { changed: true, next: { ...state, [key]: rule.to } };
}

/** Legacy `applications.status` summary kept for older readers and agents. */
export function legacyStatus(state: JourneyState): string {
  if (state.submission_status === "submitted") return "submitted";
  if (state.fill_status === "filled" || state.fill_status === "needs_input") return state.fill_status;
  return "draft";
}

/** Legacy `--status` values accepted by the CLI and the actions they request. */
export const STATUS_ACTIONS: Record<string, JourneyAction | null> = {
  draft: null,
  filled: "fill.complete",
  needs_input: "fill.needs_input",
  submitted: "submit",
  applied: "submit",
};
export function statusAction(status: string): JourneyAction | null {
  if (!Object.hasOwn(STATUS_ACTIONS, status))
    throw new JourneyError(`Unknown application status "${status}". Use ${Object.keys(STATUS_ACTIONS).join(", ")}.`, 400);
  return STATUS_ACTIONS[status]!;
}

import { expect, test } from "vitest";
import {
  JOURNEY_STATES,
  JourneyError,
  SUBMITTED_LOCK_MESSAGE,
  TRANSITIONS,
  legacyStatus,
  planTransition,
  statusAction,
  type JourneyAction,
  type JourneyState,
} from "./journey.ts";

const base: JourneyState = {
  preparation_status: "ready",
  fill_status: "not_started",
  submission_status: "not_submitted",
  tracking_status: "active",
};
const actions = Object.keys(TRANSITIONS) as JourneyAction[];
const matrix = actions.flatMap((action) => {
  const rule = TRANSITIONS[action];
  return JOURNEY_STATES[rule.dimension].map((from) => [action, from] as const);
});

test.each(matrix)("%s from %s follows the transition table", (action, from) => {
  const rule = TRANSITIONS[action];
  const key = `${rule.dimension}_status` as keyof JourneyState;
  const state = { ...base, [key]: from };
  const valid = (rule.from as readonly string[]).includes(from);
  const repeat = "idempotent" in rule && rule.idempotent && from === rule.to;
  if (valid || repeat) {
    const { changed, next } = planTransition(state, action);
    expect(changed).toBe(!repeat);
    expect(next[key]).toBe(rule.to);
  } else {
    expect(() => planTransition(state, action)).toThrow(JourneyError);
  }
});

test.each(actions.filter((action) => TRANSITIONS[action].dimension !== "tracking"))(
  "%s changes only its own dimension",
  (action) => {
    const rule = TRANSITIONS[action];
    const key = `${rule.dimension}_status` as keyof JourneyState;
    const state = { ...base, [key]: rule.from[0] };
    const { next } = planTransition(state, action);
    for (const other of Object.keys(base) as (keyof JourneyState)[])
      if (other !== key) expect(next[other]).toBe(state[other]);
  },
);

test("submission, preparation and stage stay independent", () => {
  const prepared = planTransition({ ...base, preparation_status: "in_progress" }, "prepare.complete").next;
  expect(prepared.submission_status).toBe("not_submitted");
  const filled = planTransition(prepared, "fill.complete").next;
  expect(filled.submission_status).toBe("not_submitted");
  const submitted = planTransition(filled, "submit").next;
  expect(submitted).toMatchObject({ preparation_status: "ready", fill_status: "filled" });
  // Archiving the tracked application never clears the submission.
  expect(planTransition(submitted, "archive").next).toMatchObject({ tracking_status: "archived", submission_status: "submitted" });
  // A submission can be recorded without preparation (manual registration).
  expect(planTransition({ ...base, preparation_status: "not_started" }, "submit").changed).toBe(true);
});

test.each(["prepare.start", "prepare.complete", "fill.start", "fill.complete", "fill.needs_input", "fill.reset"] as const)(
  "%s is rejected after submission and preserves documents",
  (action) => {
    const rule = TRANSITIONS[action];
    const key = `${rule.dimension}_status` as keyof JourneyState;
    const state: JourneyState = { ...base, submission_status: "submitted", [key]: rule.from[0] };
    expect(() => planTransition(state, action)).toThrow(SUBMITTED_LOCK_MESSAGE);
  },
);

test("settling an interrupted execution stays allowed after submission", () => {
  const state: JourneyState = { ...base, submission_status: "submitted", preparation_status: "in_progress", fill_status: "in_progress" };
  expect(planTransition(state, "prepare.fail").next.preparation_status).toBe("failed");
  expect(planTransition(state, "fill.cancel").next.fill_status).toBe("not_started");
});

test("repeating an idempotent action is a no-op; non-idempotent repeats are rejected", () => {
  const submitted: JourneyState = { ...base, submission_status: "submitted" };
  expect(planTransition(submitted, "submit")).toEqual({ changed: false, next: submitted });
  expect(() => planTransition({ ...base, tracking_status: "archived" }, "archive")).toThrow("Reopen this application");
  expect(() => planTransition(base, "reopen")).toThrow("already active");
});

test("filling requires a ready resume and untracked records cannot be archived", () => {
  expect(() => planTransition({ ...base, preparation_status: "failed" }, "fill.start")).toThrow("validated resume");
  expect(() => planTransition({ ...base, tracking_status: null }, "archive")).toThrow(JourneyError);
});

test("the legacy status summary is derived from the dimensions", () => {
  expect(legacyStatus(base)).toBe("draft");
  expect(legacyStatus({ ...base, fill_status: "filled" })).toBe("filled");
  expect(legacyStatus({ ...base, fill_status: "needs_input" })).toBe("needs_input");
  expect(legacyStatus({ ...base, fill_status: "failed" })).toBe("draft");
  expect(legacyStatus({ ...base, fill_status: "filled", submission_status: "submitted" })).toBe("submitted");
});

test("legacy CLI statuses map to journey actions and unknown values are rejected", () => {
  expect(statusAction("draft")).toBeNull();
  expect(statusAction("filled")).toBe("fill.complete");
  expect(statusAction("needs_input")).toBe("fill.needs_input");
  expect(statusAction("submitted")).toBe("submit");
  expect(statusAction("applied")).toBe("submit");
  expect(() => statusAction("toString")).toThrow('Unknown application status "toString"');
  try {
    statusAction("sent");
  } catch (error) {
    expect(error).toMatchObject({ status: 400 });
  }
});

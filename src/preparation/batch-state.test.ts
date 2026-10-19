import { expect, test } from "vitest";
import { deriveItem, needsReview, SUPERSEDED_MESSAGE, type ItemSignals, type ItemState } from "./batch-state.ts";

const none: ItemSignals = { runStatus: null, runPhase: null, runError: null, decision: false, filled: false, portalStarted: false, approved: false, submitted: false, superseded: false };
const queued: ItemState = { phase: "queued", status: "pending", error: null };
const run = (signals: Partial<ItemSignals>): ItemSignals => ({ ...none, runStatus: "running", runPhase: "tailoring", ...signals });

test("an item without an execution keeps its stored state", () => {
  expect(deriveItem(queued, none)).toEqual({ ...queued, holdsPortal: false });
  expect(deriveItem({ phase: "queued", status: "failed", error: "Job archived" }, none)).toEqual({ phase: "queued", status: "failed", error: "Job archived", holdsPortal: false });
});

test("a running execution sets the phase and a pending permission becomes a decision wait", () => {
  expect(deriveItem(queued, run({}))).toEqual({ phase: "tailoring", status: "running", error: null, holdsPortal: false });
  expect(deriveItem(queued, run({ decision: true, runPhase: "compiling" }))).toMatchObject({ phase: "compiling", status: "waiting_for_decision" });
  expect(deriveItem({ phase: "waiting_for_fill", status: "pending", error: null }, run({ runPhase: "filling" }))).toEqual({ phase: "filling", status: "running", error: null, holdsPortal: true });
  expect(deriveItem({ phase: "filling", status: "pending", error: null }, run({ runPhase: "review" }))).toMatchObject({ phase: "filling", status: "running" });
});

test("a generated resume waits for approval, and only an approved PDF enters the fill phase", () => {
  const completed = { ...none, runStatus: "completed", runPhase: "review" } as const;
  expect(deriveItem({ phase: "compiling", status: "running", error: null }, completed)).toEqual({ phase: "ready_for_review", status: "waiting_for_user", error: null, holdsPortal: false });
  expect(deriveItem({ phase: "ready_for_review", status: "waiting_for_user", error: null }, { ...completed, approved: true })).toEqual({ phase: "waiting_for_fill", status: "pending", error: null, holdsPortal: false });
});

test("a completed fill reserves the portal until the application is submitted", () => {
  const filled = { ...none, runStatus: "completed", runPhase: "review", approved: true, filled: true } as const;
  expect(deriveItem({ phase: "filling", status: "running", error: null }, filled)).toEqual({ phase: "in_review", status: "waiting_for_user", error: null, holdsPortal: true });
  expect(deriveItem({ phase: "in_review", status: "waiting_for_user", error: null }, { ...filled, submitted: true })).toEqual({ phase: "submitted", status: "completed", error: null, holdsPortal: false });
});

test("an application moved to another execution is no longer managed by the batch", () => {
  expect(deriveItem({ phase: "ready_for_review", status: "waiting_for_user", error: null }, { ...none, runStatus: "completed", runPhase: "review", superseded: true }))
    .toEqual({ phase: "ready_for_review", status: "cancelled", error: SUPERSEDED_MESSAGE, holdsPortal: false });
});

test.each([
  ["failed", "failed", "Compile error", "Compile error"],
  ["interrupted", "interrupted", "The app closed", "The app closed"],
  ["cancelled", "interrupted", "Cancelled", "Stopped before finishing. Retry to continue from its last checkpoint."],
  ["waiting_for_sign_in", "waiting_for_sign_in", null, null],
  ["unknown", "failed", null, null],
] as const)("a %s execution stops the item as %s and keeps its phase", (runStatus, status, runError, error) => {
  expect(deriveItem({ phase: "tailoring", status: "running", error: null }, { ...none, runStatus: runStatus as ItemSignals["runStatus"], runPhase: "compiling", runError }))
    .toEqual({ phase: "compiling", status, error, holdsPortal: false });
});

test("a requested retry stays pending and a refused start keeps its reason", () => {
  const failed = { ...none, runStatus: "failed", runPhase: "tailoring", runError: "Agent failed" } as const;
  expect(deriveItem({ phase: "tailoring", status: "pending", error: "old" }, failed)).toEqual({ phase: "tailoring", status: "pending", error: null, holdsPortal: false });
  expect(deriveItem({ phase: "tailoring", status: "failed", error: "Restore this job first." }, failed)).toEqual({ phase: "tailoring", status: "failed", error: "Restore this job first.", holdsPortal: false });
  expect(deriveItem({ phase: "tailoring", status: "failed", error: null }, failed)).toMatchObject({ error: "Agent failed" });
});

test("a fill that stopped without a result keeps the portal reserved and needs review", () => {
  const stopped = { ...none, runStatus: "interrupted", runPhase: "filling", portalStarted: true } as const;
  expect(deriveItem({ phase: "filling", status: "running", error: null }, stopped)).toMatchObject({ phase: "filling", status: "interrupted", holdsPortal: true });
  expect(deriveItem({ phase: "filling", status: "pending", error: null }, stopped)).toMatchObject({ status: "pending", holdsPortal: true });
  expect(deriveItem({ phase: "filling", status: "running", error: null }, { ...stopped, portalStarted: false, runStatus: "failed" })).toMatchObject({ status: "failed", holdsPortal: false });
  expect(needsReview(stopped)).toBe(true);
  expect(needsReview({ ...stopped, runStatus: "running" })).toBe(false);
  expect(needsReview({ ...stopped, runPhase: "tailoring" })).toBe(false);
  expect(needsReview({ ...stopped, runStatus: null })).toBe(false);
});

test("cancelled items stay cancelled, even when the application is submitted later", () => {
  const cancelled: ItemState = { phase: "in_review", status: "cancelled", error: null };
  expect(deriveItem(cancelled, { ...none, runStatus: "completed", filled: true, submitted: true })).toEqual({ ...cancelled, holdsPortal: false });
});

import { expect, test } from "vitest";
import { reviewResult, reviewSummary } from "./batch-review.ts";
import type { ItemState } from "./batch-state.ts";

const item: ItemState = { phase: "queued", status: "pending", error: null };
const signals = { prepared: false, filled: false, submitted: false, adjustmentRequested: false };
test("results are exclusive and successful preparation never counts as submission", () => {
  expect(reviewResult(item, signals)).toBe("pending");
  expect(reviewResult(item, { ...signals, prepared: true })).toBe("prepared");
  expect(reviewResult(item, { ...signals, prepared: true, filled: true })).toBe("filled");
  expect(reviewResult(item, { ...signals, prepared: true, filled: true, submitted: true })).toBe("submitted");
  expect(reviewResult({ ...item, status: "completed" }, signals)).toBe("submitted");
  expect(reviewResult({ ...item, status: "cancelled" }, { ...signals, submitted: true })).toBe("cancelled");
  for (const status of ["failed", "interrupted"] as const) expect(reviewResult({ ...item, status }, { ...signals, filled: true })).toBe("failed");
  expect(reviewResult(item, { ...signals, prepared: true, adjustmentRequested: true })).toBe("pending");
  expect(reviewSummary(["prepared", "filled", "submitted", "failed", "cancelled", "pending", "prepared"].map(result => ({ result: result as ReturnType<typeof reviewResult> }))))
    .toEqual({ prepared: 2, filled: 1, submitted: 1, failed: 1, cancelled: 1, pending: 1 });
  expect(reviewSummary([])).toEqual({ prepared: 0, filled: 0, submitted: 0, failed: 0, cancelled: 0, pending: 0 });
});
